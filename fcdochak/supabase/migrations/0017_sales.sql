-- FC도착 0017 — 쿠팡 API 제공 · 판매 분석(v2 3차 sales) · 기획 docs/sales-plan.md
--   ① sales_sync_runs           — 동기화 기록(흉내·파일·API · 막힘/실패). 쌓기만
--   ② sales_products            — 상품(옵션) · 우리 SKU 연결. 바뀌면 새 판
--   ③ sales_orders              — 주문 줄(하루 묶음 허용). 바뀌면 새 판
--   ④ sales_inventory_snapshots — 재고 스냅숏. 쌓기만
--   ⑤ sales_returns             — 반품 줄. 바뀌면 새 판
--   ⑥ sales_settlements         — 정산(쿠팡 응답 모양 확인 필요 — 표만, verified 기본 거짓). 새 판
--   ⑦ wing_consents             — 「읽는 것·하지 않는 것」 동의 기록. 쌓기만
--   ⑧ wing_key_alerts           — 키 만료 알림을 (발급일·종류)마다 한 번만 넣었는지. 쌓기만(서버 신뢰 경로만 쓴다)
--
-- 이 파일은 자료를 지우거나 덮지 않는다. 기존 표·제약을 고치지 않는다.
-- 모든 표 RLS: 그 화주 조직 사람만(데모 숨김 규칙 org_visible). 어떤 표에도 UPDATE·DELETE 권한이 없다.
-- 주문자·수령인 같은 개인정보 칸은 두지 않는다(날짜·수량·금액·옵션만).

-- ① 동기화 기록 ---------------------------------------------------------------------
create table fcd.sales_sync_runs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references fcd.orgs (id) on delete cascade,
  source text not null check (source in ('mock', 'file', 'api')),
  -- ok = 가져옴 · blocked = 스위치 꺼짐(시험 모드) · failed = 쿠팡 오류 · unsupported = 공개 API 확인 필요
  status text not null check (status in ('ok', 'blocked', 'failed', 'unsupported')),
  range_from date,
  range_to date,
  -- 종류별 줄 수 {products, orders, inventory, returns} · 오류 코드. 키 값은 싣지 않는다
  counts jsonb,
  detail jsonb,
  created_by uuid,
  created_at timestamptz not null default now(),
  check (range_from is null or range_to is null or range_from <= range_to)
);
create index sales_sync_runs_org_idx on fcd.sales_sync_runs (org_id, created_at desc);

alter table fcd.sales_sync_runs enable row level security;
grant select, insert on fcd.sales_sync_runs to fcd_user;
create policy sales_sync_read on fcd.sales_sync_runs for select to fcd_user using (
  fcd.org_visible(org_id) and fcd.is_member(org_id)
);
create policy sales_sync_insert on fcd.sales_sync_runs for insert to fcd_user with check (
  fcd.is_member(org_id) and fcd.org_kind(org_id) = 'shipper' and created_by = fcd.uid()
);

-- ② 상품(옵션) ----------------------------------------------------------------------
create table fcd.sales_products (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references fcd.orgs (id) on delete cascade,
  source text not null check (source in ('mock', 'file', 'api')),
  batch_id uuid,
  -- 쿠팡 옵션 번호(흉내는 「EX-VI-」 = 예시)
  external_id text not null check (external_id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{2,39}$'),
  name text not null check (length(name) between 1 and 120),
  option_name text check (option_name is null or length(option_name) <= 80),
  -- 판매가(부가세 포함, 원) — 목록 가격. 실판매가는 주문 금액에서 셈한다
  list_price integer check (list_price is null or list_price >= 0),
  -- 우리 SKU(도착원가·견적 요청의 화물 조건). 같은 조직 SKU 만(함수로 검사)
  sku_id uuid references fcd.skus (id) on delete set null,
  version integer not null default 1 check (version >= 1),
  supersedes_id uuid references fcd.sales_products (id) on delete cascade,
  created_by uuid,
  created_at timestamptz not null default now(),
  check ((supersedes_id is null) = (version = 1))
);
create index sales_products_org_idx on fcd.sales_products (org_id);
create unique index sales_products_one_root on fcd.sales_products (org_id, external_id) where supersedes_id is null;
create unique index sales_products_one_successor on fcd.sales_products (supersedes_id) where supersedes_id is not null;

create view fcd.v_sales_products_current with (security_invoker = true) as
  select p.* from fcd.sales_products p
   where not exists (select 1 from fcd.sales_products n where n.supersedes_id = p.id);

create or replace function fcd.sales_product_ok(p_org uuid, p_ext text, p_super uuid, p_version integer, p_sku uuid) returns boolean
language sql stable security definer set search_path = fcd, pg_temp as $$
  select (p_sku is null or exists (select 1 from fcd.skus s where s.id = p_sku and s.org_id = p_org))
    and case
      when p_super is null then p_version = 1
      else exists (
        select 1 from fcd.sales_products r
         where r.id = p_super and r.org_id = p_org and r.external_id = p_ext and r.version + 1 = p_version
           and not exists (select 1 from fcd.sales_products n where n.supersedes_id = r.id)
      )
    end
$$;
revoke all on function fcd.sales_product_ok(uuid, text, uuid, integer, uuid) from public;
grant execute on function fcd.sales_product_ok(uuid, text, uuid, integer, uuid) to fcd_user;

alter table fcd.sales_products enable row level security;
grant select, insert on fcd.sales_products to fcd_user;
grant select on fcd.v_sales_products_current to fcd_user;
create policy sales_products_read on fcd.sales_products for select to fcd_user using (
  fcd.org_visible(org_id) and fcd.is_member(org_id)
);
create policy sales_products_insert on fcd.sales_products for insert to fcd_user with check (
  fcd.is_member(org_id) and fcd.org_kind(org_id) = 'shipper' and created_by = fcd.uid()
  and fcd.sales_product_ok(org_id, external_id, supersedes_id, version, sku_id)
);

-- ③ 주문 줄 -------------------------------------------------------------------------
create table fcd.sales_orders (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references fcd.orgs (id) on delete cascade,
  source text not null check (source in ('mock', 'file', 'api')),
  batch_id uuid,
  external_id text not null check (external_id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{2,59}$'),
  product_ext text not null check (product_ext ~ '^[A-Za-z0-9][A-Za-z0-9_-]{2,39}$'),
  ordered_on date not null,
  units integer not null check (units >= 0),
  -- 결제 금액(부가세 포함, 원)
  amount bigint not null check (amount >= 0),
  -- 하루 묶음이면 그날 주문 건수(한 건이면 1)
  order_count integer not null default 1 check (order_count >= 0),
  -- 취소되면 새 판으로 cancelled = true
  cancelled boolean not null default false,
  version integer not null default 1 check (version >= 1),
  supersedes_id uuid references fcd.sales_orders (id) on delete cascade,
  created_by uuid,
  created_at timestamptz not null default now(),
  check ((supersedes_id is null) = (version = 1))
);
create index sales_orders_org_idx on fcd.sales_orders (org_id, ordered_on desc);
create unique index sales_orders_one_root on fcd.sales_orders (org_id, external_id) where supersedes_id is null;
create unique index sales_orders_one_successor on fcd.sales_orders (supersedes_id) where supersedes_id is not null;

create view fcd.v_sales_orders_current with (security_invoker = true) as
  select o.* from fcd.sales_orders o
   where not exists (select 1 from fcd.sales_orders n where n.supersedes_id = o.id);

create or replace function fcd.sales_order_ok(p_org uuid, p_ext text, p_super uuid, p_version integer) returns boolean
language sql stable security definer set search_path = fcd, pg_temp as $$
  select case
    when p_super is null then p_version = 1
    else exists (
      select 1 from fcd.sales_orders r
       where r.id = p_super and r.org_id = p_org and r.external_id = p_ext and r.version + 1 = p_version
         and not exists (select 1 from fcd.sales_orders n where n.supersedes_id = r.id)
    )
  end
$$;
revoke all on function fcd.sales_order_ok(uuid, text, uuid, integer) from public;
grant execute on function fcd.sales_order_ok(uuid, text, uuid, integer) to fcd_user;

alter table fcd.sales_orders enable row level security;
grant select, insert on fcd.sales_orders to fcd_user;
grant select on fcd.v_sales_orders_current to fcd_user;
create policy sales_orders_read on fcd.sales_orders for select to fcd_user using (
  fcd.org_visible(org_id) and fcd.is_member(org_id)
);
create policy sales_orders_insert on fcd.sales_orders for insert to fcd_user with check (
  fcd.is_member(org_id) and fcd.org_kind(org_id) = 'shipper' and created_by = fcd.uid()
  and fcd.sales_order_ok(org_id, external_id, supersedes_id, version)
);

-- ④ 재고 스냅숏 ----------------------------------------------------------------------
create table fcd.sales_inventory_snapshots (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references fcd.orgs (id) on delete cascade,
  source text not null check (source in ('mock', 'file', 'api')),
  batch_id uuid,
  product_ext text not null check (product_ext ~ '^[A-Za-z0-9][A-Za-z0-9_-]{2,39}$'),
  snap_on date not null,
  -- 판매 가능 재고
  on_hand integer not null check (on_hand >= 0),
  -- 입고 진행 중(알면)
  inbound_units integer check (inbound_units is null or inbound_units >= 0),
  created_by uuid,
  created_at timestamptz not null default now()
);
create index sales_inv_org_idx on fcd.sales_inventory_snapshots (org_id, product_ext, snap_on desc, created_at desc);

-- 상품·날짜마다 가장 최근에 넣은 스냅숏
create view fcd.v_sales_inventory_daily with (security_invoker = true) as
  select distinct on (s.org_id, s.product_ext, s.snap_on) s.*
    from fcd.sales_inventory_snapshots s
   order by s.org_id, s.product_ext, s.snap_on, s.created_at desc;

alter table fcd.sales_inventory_snapshots enable row level security;
grant select, insert on fcd.sales_inventory_snapshots to fcd_user;
grant select on fcd.v_sales_inventory_daily to fcd_user;
create policy sales_inv_read on fcd.sales_inventory_snapshots for select to fcd_user using (
  fcd.org_visible(org_id) and fcd.is_member(org_id)
);
create policy sales_inv_insert on fcd.sales_inventory_snapshots for insert to fcd_user with check (
  fcd.is_member(org_id) and fcd.org_kind(org_id) = 'shipper' and created_by = fcd.uid()
);

-- ⑤ 반품 줄 -------------------------------------------------------------------------
create table fcd.sales_returns (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references fcd.orgs (id) on delete cascade,
  source text not null check (source in ('mock', 'file', 'api')),
  batch_id uuid,
  external_id text not null check (external_id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{2,59}$'),
  product_ext text not null check (product_ext ~ '^[A-Za-z0-9][A-Za-z0-9_-]{2,39}$'),
  returned_on date not null,
  units integer not null check (units >= 0),
  -- 우리 분류(쿠팡 사유 코드와의 대응은 확인 필요): 변심·불량·파손·오배송·설명과 다름·기타
  reason text not null check (reason in ('change_of_mind', 'defect', 'damaged', 'wrong_item', 'not_as_described', 'other')),
  reason_raw text check (reason_raw is null or length(reason_raw) <= 80),
  version integer not null default 1 check (version >= 1),
  supersedes_id uuid references fcd.sales_returns (id) on delete cascade,
  created_by uuid,
  created_at timestamptz not null default now(),
  check ((supersedes_id is null) = (version = 1))
);
create index sales_returns_org_idx on fcd.sales_returns (org_id, returned_on desc);
create unique index sales_returns_one_root on fcd.sales_returns (org_id, external_id) where supersedes_id is null;
create unique index sales_returns_one_successor on fcd.sales_returns (supersedes_id) where supersedes_id is not null;

create view fcd.v_sales_returns_current with (security_invoker = true) as
  select r.* from fcd.sales_returns r
   where not exists (select 1 from fcd.sales_returns n where n.supersedes_id = r.id);

create or replace function fcd.sales_return_ok(p_org uuid, p_ext text, p_super uuid, p_version integer) returns boolean
language sql stable security definer set search_path = fcd, pg_temp as $$
  select case
    when p_super is null then p_version = 1
    else exists (
      select 1 from fcd.sales_returns r
       where r.id = p_super and r.org_id = p_org and r.external_id = p_ext and r.version + 1 = p_version
         and not exists (select 1 from fcd.sales_returns n where n.supersedes_id = r.id)
    )
  end
$$;
revoke all on function fcd.sales_return_ok(uuid, text, uuid, integer) from public;
grant execute on function fcd.sales_return_ok(uuid, text, uuid, integer) to fcd_user;

alter table fcd.sales_returns enable row level security;
grant select, insert on fcd.sales_returns to fcd_user;
grant select on fcd.v_sales_returns_current to fcd_user;
create policy sales_returns_read on fcd.sales_returns for select to fcd_user using (
  fcd.org_visible(org_id) and fcd.is_member(org_id)
);
create policy sales_returns_insert on fcd.sales_returns for insert to fcd_user with check (
  fcd.is_member(org_id) and fcd.org_kind(org_id) = 'shipper' and created_by = fcd.uid()
  and fcd.sales_return_ok(org_id, external_id, supersedes_id, version)
);

-- ⑥ 정산 — 쿠팡 정산 API 의 응답 모양(로켓그로스 포함 여부)은 확인 필요. 표만 두고, 확인 전 값은 verified = false
create table fcd.sales_settlements (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references fcd.orgs (id) on delete cascade,
  source text not null check (source in ('mock', 'file', 'api')),
  batch_id uuid,
  period_from date not null,
  period_to date not null,
  gross bigint not null check (gross >= 0),
  fee bigint not null check (fee >= 0),
  payout bigint not null,
  verified boolean not null default false,
  note text check (note is null or length(note) <= 400),
  version integer not null default 1 check (version >= 1),
  supersedes_id uuid references fcd.sales_settlements (id) on delete cascade,
  created_by uuid,
  created_at timestamptz not null default now(),
  check (period_from <= period_to),
  check ((supersedes_id is null) = (version = 1))
);
create index sales_settlements_org_idx on fcd.sales_settlements (org_id, period_to desc);
create unique index sales_settlements_one_root on fcd.sales_settlements (org_id, period_from, period_to) where supersedes_id is null;
create unique index sales_settlements_one_successor on fcd.sales_settlements (supersedes_id) where supersedes_id is not null;

create or replace function fcd.sales_settlement_ok(p_org uuid, p_super uuid, p_version integer) returns boolean
language sql stable security definer set search_path = fcd, pg_temp as $$
  select case
    when p_super is null then p_version = 1
    else exists (
      select 1 from fcd.sales_settlements r
       where r.id = p_super and r.org_id = p_org and r.version + 1 = p_version
         and not exists (select 1 from fcd.sales_settlements n where n.supersedes_id = r.id)
    )
  end
$$;
revoke all on function fcd.sales_settlement_ok(uuid, uuid, integer) from public;
grant execute on function fcd.sales_settlement_ok(uuid, uuid, integer) to fcd_user;

alter table fcd.sales_settlements enable row level security;
grant select, insert on fcd.sales_settlements to fcd_user;
create policy sales_settlements_read on fcd.sales_settlements for select to fcd_user using (
  fcd.org_visible(org_id) and fcd.is_member(org_id)
);
create policy sales_settlements_insert on fcd.sales_settlements for insert to fcd_user with check (
  fcd.is_member(org_id) and fcd.org_kind(org_id) = 'shipper' and created_by = fcd.uid()
  and fcd.sales_settlement_ok(org_id, supersedes_id, version)
);

-- ⑦ 동의 기록 — 키를 넣고 거둘 수 있는 사람(화주 관리자)만 -------------------------------------
create table fcd.wing_consents (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references fcd.orgs (id) on delete cascade,
  consent_version text not null check (length(consent_version) between 1 and 60),
  -- 읽는 것·하지 않는 것 목록(그때 보인 그대로)
  scopes jsonb not null,
  agreed boolean not null,
  agreed_by uuid not null,
  created_at timestamptz not null default now()
);
create index wing_consents_org_idx on fcd.wing_consents (org_id, created_at desc);

alter table fcd.wing_consents enable row level security;
grant select, insert on fcd.wing_consents to fcd_user;
create policy wing_consents_read on fcd.wing_consents for select to fcd_user using (
  fcd.org_visible(org_id) and fcd.is_member(org_id)
);
create policy wing_consents_insert on fcd.wing_consents for insert to fcd_user with check (
  fcd.is_org_admin(org_id) and fcd.org_kind(org_id) = 'shipper' and agreed_by = fcd.uid()
);

-- ⑧ 키 만료 알림 한 번만 -----------------------------------------------------------------
-- 알림 표(fcd.notifications)에 넣는 것은 서버 신뢰 경로(asSystem)뿐이므로 fcd_user 에는 읽기만 준다.
create table fcd.wing_key_alerts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references fcd.orgs (id) on delete cascade,
  issued_on date not null,
  kind text not null check (kind in ('soon', 'expired')),
  expires_on date not null,
  created_at timestamptz not null default now(),
  unique (org_id, issued_on, kind)
);

alter table fcd.wing_key_alerts enable row level security;
grant select on fcd.wing_key_alerts to fcd_user;
create policy wing_key_alerts_read on fcd.wing_key_alerts for select to fcd_user using (
  fcd.org_visible(org_id) and fcd.is_member(org_id)
);
