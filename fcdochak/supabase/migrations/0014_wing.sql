-- FC도착 0014 — 쿠팡 WING 연동(v2 2차 wing) · 기획 docs/wing-plan.md
--   ① wing_connections      — 조직별 키 연결. 키는 암호문(blob)만, 끝 4자리만 평문. 새 판으로만 쌓는다(폐기도 새 판)
--   ② wing_inbound_requests — 가져온 입고 요청(흉내·파일·API). 다시 가져와 바뀌면 새 판
--   ③ wing_matches          — 입고 요청 ↔ 선적 짝(사람이 확정). 풀기·바꾸기도 새 판
--   ④ wing_access_log       — 키 저장·폐기·꺼냄·호출 막힘·가져오기·짝·바코드 기록. 쌓기만
--
-- 이 파일은 자료를 지우거나 덮지 않는다. 기존 표·제약을 고치지 않는다.
-- 네 표 모두 RLS: 그 화주 조직 사람만(접근 기록은 운영자도 읽는다). 어떤 표에도 UPDATE·DELETE 권한이 없다.

-- ① 키 연결 ------------------------------------------------------------------------
create table fcd.wing_connections (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references fcd.orgs (id) on delete cascade,
  version integer not null default 1 check (version >= 1),
  supersedes_id uuid references fcd.wing_connections (id) on delete cascade,
  -- 허가 받는 길: 판매자 본인 키(자체개발) · 연동 업체 선택
  method text not null check (method in ('self_key', 'partner_solution')),
  -- saved = 저장만(스위치 꺼짐·아직 확인 안 함) · verified = 호출 확인됨 · failed = 쿠팡이 받지 않음 · revoked = 폐기
  status text not null check (status in ('saved', 'verified', 'failed', 'revoked')),
  -- AES-256-GCM 암호문 v1.<키 지문>.<iv>.<tag>.<본문> — fcd_user 는 이 칸을 읽을 권한이 없다
  key_blob text check (key_blob is null or key_blob ~ '^v1\.[0-9a-f]{8}\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]+$'),
  kek_id text check (kek_id is null or kek_id ~ '^[0-9a-f]{8}$'),
  vendor_last4 text check (vendor_last4 is null or length(vendor_last4) between 1 and 4),
  access_last4 text check (access_last4 is null or length(access_last4) between 1 and 4),
  -- WING 에서 키를 발급받은 날(만료 알림용, 셀러가 적는다)
  issued_on date,
  note text check (note is null or length(note) <= 400),
  created_by uuid,
  created_at timestamptz not null default now(),
  check ((status = 'revoked') = (key_blob is null)),
  check (key_blob is null or kek_id is not null),
  check ((supersedes_id is null) = (version = 1))
);
create index wing_connections_org_idx on fcd.wing_connections (org_id, created_at desc);
create unique index wing_connections_one_root on fcd.wing_connections (org_id) where supersedes_id is null;
create unique index wing_connections_one_successor on fcd.wing_connections (supersedes_id) where supersedes_id is not null;

-- 현재 판 — 암호문 칸은 싣지 않는다(has_key 는 상태로 안다: 폐기가 아니면 암호문이 있다)
create view fcd.v_wing_connections_current with (security_invoker = true) as
  select c.id, c.org_id, c.version, c.supersedes_id, c.method, c.status, c.kek_id, c.vendor_last4, c.access_last4,
         c.issued_on, c.note, c.created_by, c.created_at, (c.status <> 'revoked') as has_key
    from fcd.wing_connections c
   where not exists (select 1 from fcd.wing_connections n where n.supersedes_id = c.id);

-- 새 판을 쌓아도 되는가: 첫 판이면 그 조직에 아직 기록이 없고, 아니면 잇는 판이 그 조직의 현재 판
create or replace function fcd.wing_connection_ok(p_org uuid, p_super uuid, p_version integer) returns boolean
language sql stable security definer set search_path = fcd, pg_temp as $$
  select case
    when p_super is null then p_version = 1 and not exists (select 1 from fcd.wing_connections c where c.org_id = p_org)
    else exists (
      select 1 from fcd.wing_connections c
       where c.id = p_super and c.org_id = p_org and c.version + 1 = p_version
         and not exists (select 1 from fcd.wing_connections n where n.supersedes_id = c.id)
    )
  end
$$;
revoke all on function fcd.wing_connection_ok(uuid, uuid, integer) from public;
grant execute on function fcd.wing_connection_ok(uuid, uuid, integer) to fcd_user;

alter table fcd.wing_connections enable row level security;
grant select (id, org_id, version, supersedes_id, method, status, kek_id, vendor_last4, access_last4, issued_on, note, created_by, created_at) on fcd.wing_connections to fcd_user;
grant insert (org_id, version, supersedes_id, method, status, key_blob, kek_id, vendor_last4, access_last4, issued_on, note, created_by) on fcd.wing_connections to fcd_user;
grant select on fcd.v_wing_connections_current to fcd_user;
create policy wing_conn_read on fcd.wing_connections for select to fcd_user using (
  fcd.org_visible(org_id) and fcd.is_member(org_id)
);
create policy wing_conn_insert on fcd.wing_connections for insert to fcd_user with check (
  fcd.is_member(org_id) and fcd.org_kind(org_id) = 'shipper' and created_by = fcd.uid()
  and fcd.wing_connection_ok(org_id, supersedes_id, version)
);

-- ④ 접근 기록(①의 꺼냄 함수가 쓰므로 먼저) ---------------------------------------------
create table fcd.wing_access_log (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references fcd.orgs (id) on delete cascade,
  connection_id uuid references fcd.wing_connections (id) on delete cascade,
  actor_id uuid,
  action text not null check (action in (
    'key_saved', 'key_revoked', 'key_decrypted', 'api_blocked', 'api_called', 'api_failed',
    'imported', 'matched', 'unlinked', 'barcode_filed'
  )),
  -- 키 값은 싣지 않는다 — 건수·출처·입고 요청 번호·선적 id 정도
  detail jsonb,
  created_at timestamptz not null default now()
);
create index wing_access_log_org_idx on fcd.wing_access_log (org_id, created_at desc);
create index wing_access_log_action_idx on fcd.wing_access_log (action, created_at desc);

alter table fcd.wing_access_log enable row level security;
grant select, insert on fcd.wing_access_log to fcd_user;
create policy wing_log_read on fcd.wing_access_log for select to fcd_user using (
  fcd.is_platform() or (fcd.org_visible(org_id) and fcd.is_member(org_id))
);
create policy wing_log_insert on fcd.wing_access_log for insert to fcd_user with check (
  actor_id = fcd.uid() and fcd.is_member(org_id) and action <> 'key_decrypted' -- 꺼냄 기록은 함수만 쓴다
);

-- 암호문 꺼내기 — 그 조직 사람만, 현재 판·폐기 아님일 때만. 꺼낼 때마다 접근 기록. 운영자도 못 꺼낸다.
create or replace function fcd.wing_key_blob(p_conn uuid) returns text
language plpgsql volatile security definer set search_path = fcd, pg_temp as $$
declare
  c record;
begin
  if fcd.uid() is null then return null; end if;
  select w.id, w.org_id, w.key_blob into c
    from fcd.wing_connections w
   where w.id = p_conn and w.status <> 'revoked'
     and not exists (select 1 from fcd.wing_connections n where n.supersedes_id = w.id);
  if not found or not fcd.is_member(c.org_id) or not fcd.org_visible(c.org_id) then return null; end if;
  insert into fcd.wing_access_log (org_id, connection_id, actor_id, action) values (c.org_id, c.id, fcd.uid(), 'key_decrypted');
  return c.key_blob;
end $$;
revoke all on function fcd.wing_key_blob(uuid) from public;
grant execute on function fcd.wing_key_blob(uuid) to fcd_user;

-- ② 가져온 입고 요청 ------------------------------------------------------------------
create table fcd.wing_inbound_requests (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references fcd.orgs (id) on delete cascade,
  source text not null check (source in ('mock', 'file', 'api')),
  batch_id uuid not null,
  external_no text not null check (external_no ~ '^[A-Za-z0-9][A-Za-z0-9_-]{2,39}$'),
  center_name text check (center_name is null or length(center_name) <= 60),
  fc_code text references fcd.fc_centers (code),
  planned_on date,
  sku_count integer check (sku_count is null or sku_count >= 0),
  units integer check (units is null or units >= 0),
  boxes integer check (boxes is null or boxes >= 0),
  status_raw text check (status_raw is null or length(status_raw) <= 40),
  received_units integer check (received_units is null or received_units >= 0),
  returned_units integer check (returned_units is null or returned_units >= 0),
  version integer not null default 1 check (version >= 1),
  supersedes_id uuid references fcd.wing_inbound_requests (id) on delete cascade,
  created_by uuid,
  created_at timestamptz not null default now(),
  check ((supersedes_id is null) = (version = 1))
);
create index wing_inbound_org_idx on fcd.wing_inbound_requests (org_id, created_at desc);
create unique index wing_inbound_one_root on fcd.wing_inbound_requests (org_id, external_no) where supersedes_id is null;
create unique index wing_inbound_one_successor on fcd.wing_inbound_requests (supersedes_id) where supersedes_id is not null;

create view fcd.v_wing_inbound_current with (security_invoker = true) as
  select r.* from fcd.wing_inbound_requests r
   where not exists (select 1 from fcd.wing_inbound_requests n where n.supersedes_id = r.id);

create or replace function fcd.wing_inbound_ok(p_org uuid, p_ext text, p_super uuid, p_version integer) returns boolean
language sql stable security definer set search_path = fcd, pg_temp as $$
  select case
    when p_super is null then p_version = 1
    else exists (
      select 1 from fcd.wing_inbound_requests r
       where r.id = p_super and r.org_id = p_org and r.external_no = p_ext and r.version + 1 = p_version
         and not exists (select 1 from fcd.wing_inbound_requests n where n.supersedes_id = r.id)
    )
  end
$$;
revoke all on function fcd.wing_inbound_ok(uuid, text, uuid, integer) from public;
grant execute on function fcd.wing_inbound_ok(uuid, text, uuid, integer) to fcd_user;

alter table fcd.wing_inbound_requests enable row level security;
grant select, insert on fcd.wing_inbound_requests to fcd_user;
grant select on fcd.v_wing_inbound_current to fcd_user;
create policy wing_inbound_read on fcd.wing_inbound_requests for select to fcd_user using (
  fcd.org_visible(org_id) and fcd.is_member(org_id)
);
create policy wing_inbound_insert on fcd.wing_inbound_requests for insert to fcd_user with check (
  fcd.is_member(org_id) and fcd.org_kind(org_id) = 'shipper' and created_by = fcd.uid()
  and fcd.wing_inbound_ok(org_id, external_no, supersedes_id, version)
);

-- ③ 짝 ------------------------------------------------------------------------------
-- 입고 요청은 번호(external_no)로 가리킨다 — 다시 가져와 새 판이 생겨도 짝이 이어진다.
create table fcd.wing_matches (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references fcd.orgs (id) on delete cascade,
  external_no text not null check (external_no ~ '^[A-Za-z0-9][A-Za-z0-9_-]{2,39}$'),
  -- 비어 있으면 짝 풀기
  shipment_id uuid references fcd.shipments (id) on delete cascade,
  action text not null check (action in ('confirmed', 'unlinked')),
  -- 확정할 때 본 제안 점수·까닭(사람이 다른 선적을 고르면 그 선적 점수)
  score integer check (score is null or score between 0 and 100),
  reason jsonb,
  supersedes_id uuid references fcd.wing_matches (id) on delete cascade,
  created_by uuid,
  created_at timestamptz not null default now(),
  check ((action = 'confirmed') = (shipment_id is not null))
);
create index wing_matches_org_idx on fcd.wing_matches (org_id, created_at desc);
create index wing_matches_ship_idx on fcd.wing_matches (shipment_id);
create unique index wing_matches_one_root on fcd.wing_matches (org_id, external_no) where supersedes_id is null;
create unique index wing_matches_one_successor on fcd.wing_matches (supersedes_id) where supersedes_id is not null;

create view fcd.v_wing_matches_current with (security_invoker = true) as
  select m.* from fcd.wing_matches m
   where not exists (select 1 from fcd.wing_matches n where n.supersedes_id = m.id);

-- 짝을 남겨도 되는가: 입고 요청이 그 조직 것 · 선적도 그 조직(화주) 것 · 그 선적이 다른 입고 요청과 이미 짝이 아님 · 판을 바르게 잇는다
create or replace function fcd.wing_match_ok(p_org uuid, p_ext text, p_ship uuid, p_super uuid) returns boolean
language sql stable security definer set search_path = fcd, pg_temp as $$
  select exists (select 1 from fcd.wing_inbound_requests r where r.org_id = p_org and r.external_no = p_ext)
    and (p_ship is null or exists (select 1 from fcd.shipments s where s.id = p_ship and s.shipper_org_id = p_org))
    and (p_ship is null or not exists (
      select 1 from fcd.wing_matches m
       where m.org_id = p_org and m.shipment_id = p_ship and m.action = 'confirmed' and m.external_no <> p_ext
         and not exists (select 1 from fcd.wing_matches n where n.supersedes_id = m.id)
    ))
    and (
      (p_super is null and not exists (select 1 from fcd.wing_matches m where m.org_id = p_org and m.external_no = p_ext))
      or exists (
        select 1 from fcd.wing_matches m
         where m.id = p_super and m.org_id = p_org and m.external_no = p_ext
           and not exists (select 1 from fcd.wing_matches n where n.supersedes_id = m.id)
      )
    )
$$;
revoke all on function fcd.wing_match_ok(uuid, text, uuid, uuid) from public;
grant execute on function fcd.wing_match_ok(uuid, text, uuid, uuid) to fcd_user;

alter table fcd.wing_matches enable row level security;
grant select, insert on fcd.wing_matches to fcd_user;
grant select on fcd.v_wing_matches_current to fcd_user;
create policy wing_matches_read on fcd.wing_matches for select to fcd_user using (
  fcd.org_visible(org_id) and fcd.is_member(org_id)
);
create policy wing_matches_insert on fcd.wing_matches for insert to fcd_user with check (
  fcd.is_member(org_id) and fcd.org_kind(org_id) = 'shipper' and created_by = fcd.uid()
  and fcd.wing_match_ok(org_id, external_no, shipment_id, supersedes_id)
);
