-- FC도착 0020 — 원스톱 대행형 구역(v2 4차 onestop · 미리보기) · 기획 docs/onestop-plan.md
--
--   ① onestop_orders        — 맡기기 접수 기록. 새 판(supersedes_id)으로만 바꾼다
--                             첫 판(version 1)은 화주 본인이, 뒤 판(실측 CBM·선적 잇기·다시 셈)은 운영자만
--                             root_id = 첫 판 id(첫 판은 null) — 주문 하나를 판이 바뀌어도 같은 번호로 부른다
--   ② onestop_order_events  — 단계 기록. 쌓기만 한다. 단계는 앞으로만(건너뛰기는 된다), 문제(issue)는 언제든(취소 뒤 제외)
--                             접수 → 사입 대금 확인 → 공장 입고 → 검품 → 바코드 → 혼적 출항 → 통관 → FC 입고
--
-- 스위치 fcd.settings 'onestop.enabled'(기본 꺼짐) — 꺼져 있으면 preview = true 주문만 넣을 수 있다(「접수 기록만 · 대행 계약 전」).
-- 결제·발송·대행 계약은 없다. 이 파일은 자료를 지우거나 덮지 않는다. 기존 표·정책을 고치지 않는다.
-- 두 표 모두 RLS: 화주는 자기 조직 것만, 운영자는 전부. 어떤 표에도 UPDATE·DELETE 권한이 없다.

-- 단계 순서(문제 기록 issue 는 순서 없음 = null, 취소는 맨 끝)
create or replace function fcd.onestop_stage_rank(p text) returns integer
language sql immutable as $$
  select case p
    when 'received' then 0 when 'payment_confirmed' then 1 when 'factory_received' then 2 when 'inspected' then 3
    when 'barcoded' then 4 when 'departed' then 5 when 'customs_cleared' then 6 when 'fc_received' then 7
    when 'cancelled' then 99 else null end
$$;
grant execute on function fcd.onestop_stage_rank(text) to fcd_user;

-- ① 접수 기록(새 판) ---------------------------------------------------------------------
create table fcd.onestop_orders (
  id uuid primary key default gen_random_uuid(),
  order_no text not null check (order_no ~ '^OS-[0-9A-Z-]{4,30}$'),
  org_id uuid not null references fcd.orgs (id) on delete cascade,
  created_by uuid references fcd.profiles (id) on delete set null,
  version integer not null default 1 check (version >= 1),
  root_id uuid references fcd.onestop_orders (id) on delete cascade,
  supersedes_id uuid references fcd.onestop_orders (id) on delete cascade,
  -- 무엇을
  product_name text not null check (length(product_name) between 2 and 120),
  category text not null check (length(category) between 1 and 40),
  source_url text check (source_url is null or (length(source_url) <= 500 and source_url ~ '^https?://')),
  units integer not null check (units between 1 and 1000000),
  cartons integer not null check (cartons between 1 and 100000),
  cbm numeric(10, 2) not null check (cbm > 0 and cbm <= 200),
  kg numeric(10, 1) not null check (kg > 0 and kg <= 100000),
  -- 개당 매입가(사입 대행·관부가세 추정용, 모르면 비움)
  unit_price numeric(12, 2) check (unit_price is null or unit_price > 0),
  currency text not null default 'RMB' check (currency in ('RMB', 'USD', 'KRW')),
  -- 어디서 어디로
  hub text not null references fcd.hubs (code),
  mode text not null check (mode in ('LCL', 'FERRY')),
  port text not null references fcd.ports (code),
  fc_code text not null references fcd.fc_centers (code),
  -- 맡길 일
  purchase boolean not null default false,
  barcode boolean not null default true,
  inspection text not null default 'basic' check (inspection in ('none', 'basic', 'full')),
  -- 그때 본 가격 하나(요금표 판·줄·9구간 참고치와의 차이) — 기록용. 합계는 서버가 순수 함수로 셈한다
  quote jsonb not null check (jsonb_typeof(quote) = 'object'),
  total_krw integer not null check (total_krw >= 0),
  -- 운영이 이은 선적(그 화주의 선적) — 출항·통관·FC 입고는 선적 9단계를 따라간다
  shipment_id uuid references fcd.shipments (id) on delete set null,
  -- 이 판이 중국 창고 실측값인가
  measured boolean not null default false,
  preview boolean not null default true,
  note text check (note is null or length(note) <= 600),
  change_note text check (change_note is null or length(change_note) <= 300),
  created_at timestamptz not null default now(),
  unique (order_no, version),
  check ((supersedes_id is null) = (version = 1)),
  check ((root_id is null) = (version = 1))
);
create index onestop_orders_org_idx on fcd.onestop_orders (org_id, created_at desc);
create index onestop_orders_root_idx on fcd.onestop_orders (root_id);
create unique index onestop_orders_one_successor on fcd.onestop_orders (supersedes_id) where supersedes_id is not null;

-- 스위치가 꺼져 있으면 미리보기 주문만
create or replace function fcd.onestop_preview_ok(p_preview boolean) returns boolean
language sql stable security definer set search_path = fcd, pg_temp as $$
  select p_preview or coalesce((select value = 'true'::jsonb from fcd.v_current_settings where key = 'onestop.enabled'), false)
$$;
revoke all on function fcd.onestop_preview_ok(boolean) from public;
grant execute on function fcd.onestop_preview_ok(boolean) to fcd_user;

-- 뒤 판을 쌓아도 되는가: 잇는 판이 같은 주문(같은 뿌리·번호·조직)의 지금 판이고 판 번호가 하나 크다.
-- 선적을 이으면 그 선적은 같은 화주의 것이어야 한다.
create or replace function fcd.onestop_version_ok(p_root uuid, p_super uuid, p_version integer, p_org uuid, p_no text, p_shipment uuid) returns boolean
language sql stable security definer set search_path = fcd, pg_temp as $$
  select exists (
      select 1 from fcd.onestop_orders o
       where o.id = p_super and coalesce(o.root_id, o.id) = p_root and o.org_id = p_org and o.order_no = p_no
         and o.version + 1 = p_version
         and not exists (select 1 from fcd.onestop_orders n where n.supersedes_id = o.id)
    )
    and (p_shipment is null or exists (select 1 from fcd.shipments s where s.id = p_shipment and s.shipper_org_id = p_org))
$$;
revoke all on function fcd.onestop_version_ok(uuid, uuid, integer, uuid, text, uuid) from public;
grant execute on function fcd.onestop_version_ok(uuid, uuid, integer, uuid, text, uuid) to fcd_user;

alter table fcd.onestop_orders enable row level security;
grant select, insert on fcd.onestop_orders to fcd_user;
create policy os_orders_read on fcd.onestop_orders for select to fcd_user using (
  fcd.is_platform() or (fcd.org_visible(org_id) and fcd.is_member(org_id))
);
create policy os_orders_insert on fcd.onestop_orders for insert to fcd_user with check (
  created_by = fcd.uid()
  and fcd.onestop_preview_ok(preview)
  and (
    -- 첫 판: 화주 본인 조직, 선적·실측은 못 적는다
    (version = 1 and fcd.is_member(org_id) and fcd.org_kind(org_id) = 'shipper' and shipment_id is null and not measured)
    -- 뒤 판: 운영자만
    or (version > 1 and fcd.is_platform() and fcd.onestop_version_ok(root_id, supersedes_id, version, org_id, order_no, shipment_id))
  )
);

-- ② 단계 기록(쌓기만) ---------------------------------------------------------------------
create table fcd.onestop_order_events (
  id uuid primary key default gen_random_uuid(),
  -- 주문의 첫 판 id(판이 바뀌어도 같은 주문)
  order_id uuid not null references fcd.onestop_orders (id) on delete cascade,
  org_id uuid not null references fcd.orgs (id) on delete cascade,
  stage text not null check (stage in ('received', 'payment_confirmed', 'factory_received', 'inspected', 'barcoded', 'departed', 'customs_cleared', 'fc_received', 'cancelled', 'issue')),
  note text check (note is null or length(note) <= 300),
  occurred_at timestamptz not null default now(),
  actor_id uuid references fcd.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  check (stage <> 'issue' or note is not null)
);
create index onestop_order_events_order_idx on fcd.onestop_order_events (order_id, created_at desc);

-- 지금 단계 순서(기록 없으면 접수 0)
create or replace function fcd.onestop_current_rank(p_order uuid) returns integer
language sql stable security definer set search_path = fcd, pg_temp as $$
  select coalesce(max(fcd.onestop_stage_rank(e.stage)), 0) from fcd.onestop_order_events e where e.order_id = p_order and e.stage <> 'issue'
$$;
revoke all on function fcd.onestop_current_rank(uuid) from public;
grant execute on function fcd.onestop_current_rank(uuid) to fcd_user;

-- 이 단계를 남겨도 되는가 — 운영: 앞으로만·문제는 언제든·취소는 출항 전 · 화주: 접수 단계의 취소만 · 취소 뒤에는 아무것도
create or replace function fcd.onestop_event_ok(p_order uuid, p_stage text, p_platform boolean) returns boolean
language sql stable security definer set search_path = fcd, pg_temp as $$
  select case
    when fcd.onestop_current_rank(p_order) = 99 then false
    when p_platform then case
      when p_stage = 'issue' then true
      when p_stage = 'cancelled' then fcd.onestop_current_rank(p_order) < 5
      when p_stage = 'received' then false
      else fcd.onestop_stage_rank(p_stage) > fcd.onestop_current_rank(p_order)
    end
    else p_stage = 'cancelled' and fcd.onestop_current_rank(p_order) = 0
  end
$$;
revoke all on function fcd.onestop_event_ok(uuid, text, boolean) from public;
grant execute on function fcd.onestop_event_ok(uuid, text, boolean) to fcd_user;

alter table fcd.onestop_order_events enable row level security;
grant select, insert on fcd.onestop_order_events to fcd_user;
create policy os_events_read on fcd.onestop_order_events for select to fcd_user using (
  fcd.is_platform() or (fcd.org_visible(org_id) and fcd.is_member(org_id))
);
create policy os_events_insert on fcd.onestop_order_events for insert to fcd_user with check (
  actor_id = fcd.uid()
  and exists (select 1 from fcd.onestop_orders o where o.id = order_id and o.version = 1 and o.org_id = onestop_order_events.org_id)
  and (
    (fcd.is_platform() and fcd.onestop_event_ok(order_id, stage, true))
    or (fcd.is_member(org_id) and fcd.org_kind(org_id) = 'shipper' and fcd.onestop_event_ok(order_id, stage, false))
  )
);

-- 지금 판 + 지금 단계 — 주문 하나에 한 줄(root = 첫 판 id)
create view fcd.v_onestop_orders_current with (security_invoker = true) as
  select o.*,
         coalesce(o.root_id, o.id) as root,
         coalesce((
           select e.stage from fcd.onestop_order_events e
            where e.order_id = coalesce(o.root_id, o.id) and e.stage <> 'issue'
            order by fcd.onestop_stage_rank(e.stage) desc, e.created_at desc limit 1
         ), 'received') as stage,
         (select max(e.occurred_at) from fcd.onestop_order_events e where e.order_id = coalesce(o.root_id, o.id)) as stage_at,
         (select r.created_at from fcd.onestop_orders r where r.id = coalesce(o.root_id, o.id)) as received_at
    from fcd.onestop_orders o
   where not exists (select 1 from fcd.onestop_orders n where n.supersedes_id = o.id);
grant select on fcd.v_onestop_orders_current to fcd_user;
