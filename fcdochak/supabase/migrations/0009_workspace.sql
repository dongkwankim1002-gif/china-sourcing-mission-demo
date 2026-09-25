-- FC도착 0009 — 셀러 공간(workspace)
--   ① 서류함 칸(documents.shelf) — 인보이스·패킹리스트·쿠팡 바코드 PDF·B/L·기타
--   ② 청구 승인/이의(invoice_decisions) — 덧붙이기만. 결정을 바꾸면 새 판(supersedes_id)
--   ③ 거래처 초대(partner_invites) — 토큰은 해시만 저장, 만료, 한 번 쓰면 끝
--   ④ 거래처 연결(shipper_partners) — 초대 링크로 들어온 물류사를 그 화주의 거래처로
--
-- 이 파일은 자료를 지우거나 덮지 않는다. 기존 표의 제약도 풀지 않는다
-- (documents.kind 의 check 를 넓히려면 DROP CONSTRAINT 가 필요해, 대신 칸을 하나 덧붙였다).

-- ① 서류함 칸 ------------------------------------------------------------------
-- 비어 있으면 kind 로 가른다(commercial_invoice → invoice, packing_list → packing_list, bl → bl, 나머지 → other).
alter table fcd.documents add column if not exists shelf text
  check (shelf in ('invoice', 'packing_list', 'coupang_barcode', 'bl', 'other'));

create or replace function fcd.doc_shelf(p_kind text, p_shelf text) returns text
language sql immutable as $$
  select coalesce(p_shelf, case p_kind
    when 'commercial_invoice' then 'invoice'
    when 'packing_list' then 'packing_list'
    when 'bl' then 'bl'
    else 'other' end)
$$;
revoke all on function fcd.doc_shelf(text, text) from public;
grant execute on function fcd.doc_shelf(text, text) to fcd_public, fcd_user;

-- 서류 한 장 = 한 줄. 서류함 칸을 계산해 붙인다. 읽기 권한은 documents 의 RLS 그대로(security_invoker).
create view fcd.v_documents with (security_invoker = true) as
  select d.*, fcd.doc_shelf(d.kind, d.shelf) as box from fcd.documents d;
grant select on fcd.v_documents to fcd_user;

-- ② 청구 승인/이의 ---------------------------------------------------------------
-- 화주가 물류사 청구서(현재 판)에 「승인」 또는 「이의(사유)」를 남긴다.
-- 고치지 않는다: 결정을 바꾸면 supersedes_id 로 새 판. 청구서가 새 판으로 정정되면 결정은 그 새 청구서에 새로 남긴다.
create table fcd.invoice_decisions (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references fcd.invoices (id) on delete cascade,
  shipment_id uuid not null references fcd.shipments (id) on delete cascade,
  shipper_org_id uuid not null references fcd.orgs (id) on delete cascade,
  decision text not null check (decision in ('approved', 'disputed')),
  reason text check (reason is null or length(reason) <= 1000),
  -- 결정할 때 본 금액(견적 대비 차이의 근거) — 스냅숏
  quote_total bigint not null check (quote_total >= 0),
  invoice_total bigint not null check (invoice_total >= 0),
  supersedes_id uuid references fcd.invoice_decisions (id) on delete cascade,
  created_by uuid,
  created_at timestamptz not null default now(),
  check (decision = 'approved' or length(btrim(coalesce(reason, ''))) >= 5)
);
create index invoice_decisions_inv_idx on fcd.invoice_decisions (invoice_id, created_at desc);
create index invoice_decisions_ship_idx on fcd.invoice_decisions (shipment_id);
create unique index invoice_decisions_one_successor on fcd.invoice_decisions (supersedes_id) where supersedes_id is not null;
create unique index invoice_decisions_one_root on fcd.invoice_decisions (invoice_id) where supersedes_id is null;

create view fcd.v_invoice_decisions_current with (security_invoker = true) as
  select d.* from fcd.invoice_decisions d
  where not exists (select 1 from fcd.invoice_decisions n where n.supersedes_id = d.id);
grant select on fcd.v_invoice_decisions_current to fcd_user;

-- 결정을 남겨도 되는 청구서인가: 그 선적의 현재 판 청구서이고, 새 판이면 같은 청구서의 현재 결정을 잇는다.
create or replace function fcd.invoice_decision_ok(p_invoice uuid, p_shipment uuid, p_shipper uuid, p_super uuid) returns boolean
language sql stable security definer set search_path = fcd, pg_temp as $$
  select exists (
      select 1 from fcd.invoices i join fcd.shipments s on s.id = i.shipment_id
      where i.id = p_invoice and i.shipment_id = p_shipment and s.shipper_org_id = p_shipper
        and not exists (select 1 from fcd.invoices n where n.supersedes_id = i.id)
    )
    and (
      (p_super is null and not exists (select 1 from fcd.invoice_decisions d where d.invoice_id = p_invoice))
      or exists (
        select 1 from fcd.invoice_decisions d
        where d.id = p_super and d.invoice_id = p_invoice
          and not exists (select 1 from fcd.invoice_decisions n where n.supersedes_id = d.id)
      )
    )
$$;
revoke all on function fcd.invoice_decision_ok(uuid, uuid, uuid, uuid) from public;
grant execute on function fcd.invoice_decision_ok(uuid, uuid, uuid, uuid) to fcd_user;

alter table fcd.invoice_decisions enable row level security;
grant select, insert on fcd.invoice_decisions to fcd_user; -- UPDATE·DELETE 없음
create policy inv_dec_read on fcd.invoice_decisions for select to fcd_user using (
  fcd.org_visible(shipper_org_id) and fcd.can_see_shipment(shipment_id)
);
create policy inv_dec_insert on fcd.invoice_decisions for insert to fcd_user with check (
  fcd.is_member(shipper_org_id) and fcd.org_kind(shipper_org_id) = 'shipper'
  and created_by = fcd.uid()
  and fcd.invoice_decision_ok(invoice_id, shipment_id, shipper_org_id, supersedes_id)
);

-- ③ 거래처 초대 -----------------------------------------------------------------
-- 링크의 토큰 자체는 저장하지 않는다(sha-256 16진 64자만). 링크는 만들 때 한 번만 화면에 보인다.
create table fcd.partner_invites (
  id uuid primary key default gen_random_uuid(),
  shipper_org_id uuid not null references fcd.orgs (id) on delete cascade,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  partner_name text not null check (length(btrim(partner_name)) between 1 and 80),
  contact_email text check (contact_email is null or length(contact_email) <= 120),
  note text check (note is null or length(note) <= 400),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  check (expires_at > created_at)
);
create index partner_invites_org_idx on fcd.partner_invites (shipper_org_id, created_at desc);

-- ④ 거래처 연결 -----------------------------------------------------------------
create table fcd.shipper_partners (
  shipper_org_id uuid not null references fcd.orgs (id) on delete cascade,
  partner_org_id uuid not null references fcd.orgs (id) on delete cascade,
  invite_id uuid references fcd.partner_invites (id) on delete set null,
  created_by uuid,
  created_at timestamptz not null default now(),
  primary key (shipper_org_id, partner_org_id),
  check (shipper_org_id <> partner_org_id)
);
create unique index shipper_partners_one_use on fcd.shipper_partners (invite_id) where invite_id is not null;
create index shipper_partners_partner_idx on fcd.shipper_partners (partner_org_id);

alter table fcd.partner_invites enable row level security;
alter table fcd.shipper_partners enable row level security;

-- 초대: 만든 화주 조직 사람만 본다. 해시 칸은 읽기 권한에서 뺀다(칸 단위 권한).
grant select (id, shipper_org_id, partner_name, contact_email, note, expires_at, revoked_at, created_by, created_at) on fcd.partner_invites to fcd_user;
grant insert (shipper_org_id, token_hash, partner_name, contact_email, note, expires_at, created_by) on fcd.partner_invites to fcd_user;
grant update (revoked_at) on fcd.partner_invites to fcd_user; -- 거두기만
create policy invites_read on fcd.partner_invites for select to fcd_user using (
  fcd.org_visible(shipper_org_id) and (fcd.is_member(shipper_org_id) or fcd.is_platform())
);
create policy invites_insert on fcd.partner_invites for insert to fcd_user with check (
  fcd.is_member(shipper_org_id) and fcd.org_kind(shipper_org_id) = 'shipper' and created_by = fcd.uid()
);
create policy invites_revoke on fcd.partner_invites for update to fcd_user
  using (fcd.is_member(shipper_org_id))
  with check (fcd.is_member(shipper_org_id) and revoked_at is not null);

-- 연결: 두 조직 사람과 운영자가 본다. 넣기는 아래 함수로만(초대 확인을 건너뛰지 못하게 INSERT 권한 없음).
grant select on fcd.shipper_partners to fcd_user;
create policy shipper_partners_read on fcd.shipper_partners for select to fcd_user using (
  fcd.org_visible(shipper_org_id) and fcd.org_visible(partner_org_id)
  and (fcd.is_member(shipper_org_id) or fcd.is_member(partner_org_id) or fcd.is_platform())
);

-- 초대 상태 보기 — 링크를 연 사람(로그인 전 포함)에게 필요한 것만: 상태·화주 이름·받는 곳 이름·만료.
create or replace function fcd.invite_lookup(p_hash text)
returns table (status text, shipper_name text, partner_name text, expires_at timestamptz)
language sql stable security definer set search_path = fcd, pg_temp as $$
  select
    case
      when i.revoked_at is not null then 'revoked'
      when exists (select 1 from fcd.shipper_partners sp where sp.invite_id = i.id) then 'used'
      when i.expires_at <= now() then 'expired'
      else 'open'
    end,
    o.name, i.partner_name, i.expires_at
  from fcd.partner_invites i join fcd.orgs o on o.id = i.shipper_org_id
  where i.token_hash = p_hash and fcd.org_visible(i.shipper_org_id)
$$;
revoke all on function fcd.invite_lookup(text) from public;
grant execute on function fcd.invite_lookup(text) to fcd_public, fcd_user;

-- 초대 받기 — 물류사 조직 관리자만. 열린 초대면 연결을 넣고 'ok'. 아니면 까닭을 돌려준다.
create or replace function fcd.accept_partner_invite(p_hash text, p_partner uuid) returns text
language plpgsql security definer set search_path = fcd, pg_temp as $$
declare
  inv record;
  n integer;
begin
  if fcd.uid() is null or not fcd.is_org_admin(p_partner) or coalesce(fcd.org_kind(p_partner), '') <> 'partner' then
    return 'not_partner_admin';
  end if;
  select i.id, i.shipper_org_id, i.expires_at, i.revoked_at into inv
    from fcd.partner_invites i where i.token_hash = p_hash for update;
  if not found or not fcd.org_visible(inv.shipper_org_id) then return 'not_found'; end if;
  if inv.revoked_at is not null then return 'revoked'; end if;
  if exists (select 1 from fcd.shipper_partners sp where sp.invite_id = inv.id) then return 'used'; end if;
  if inv.expires_at <= now() then return 'expired'; end if;
  insert into fcd.shipper_partners (shipper_org_id, partner_org_id, invite_id, created_by)
    values (inv.shipper_org_id, p_partner, inv.id, fcd.uid())
    on conflict (shipper_org_id, partner_org_id) do nothing;
  get diagnostics n = row_count;
  if n = 0 then return 'already'; end if;
  return 'ok';
end $$;
revoke all on function fcd.accept_partner_invite(text, uuid) from public;
grant execute on function fcd.accept_partner_invite(text, uuid) to fcd_user;
