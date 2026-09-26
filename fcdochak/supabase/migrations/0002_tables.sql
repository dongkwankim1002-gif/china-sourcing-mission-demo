-- FC도착 0002 — 표
-- 규칙: 데모 자료는 is_demo 조직 아래에만 있고, 조직 아래 모든 것은 ON DELETE CASCADE 로 매달린다.
-- 규칙: 요금표·응찰·청구서·상태 이력·등급·감사·설정은 고치지 않고 새 줄(새 판)을 쌓는다.

-- 참조 ----------------------------------------------------------------------

create table fcd.hubs (
  code text primary key,
  name_ko text not null,
  name_zh text not null,
  province_ko text not null,
  lat double precision not null,
  lng double precision not null,
  stage smallint not null default 1 check (stage between 1 and 3),
  ord smallint not null default 0
);

create table fcd.ports (
  code text primary key,
  name_ko text not null,
  name_zh text not null,
  lat double precision not null,
  lng double precision not null,
  ord smallint not null default 0
);

create table fcd.modes (
  code text primary key check (code in ('LCL', 'FERRY', 'FCL', 'AIR')),
  name_ko text not null,
  name_zh text not null,
  days_min smallint not null,
  days_max smallint not null,
  ord smallint not null default 0,
  check (days_min <= days_max)
);

create table fcd.fc_centers (
  code text primary key,
  name text not null,
  region text not null,
  km_incheon integer not null,
  km_pyeongtaek integer not null
);

create table fcd.segments (
  code text primary key,
  ord smallint not null unique,
  name_ko text not null,
  name_zh text not null,
  description_ko text not null
);

create table fcd.cargo_traits (
  code text primary key,
  name_ko text not null,
  name_zh text not null,
  verdict_ko text not null,
  requirement_ko text not null,
  needs_capability boolean not null default false,
  blocked_modes text[] not null default '{}',
  ord smallint not null default 0
);

-- 설정은 새 판으로 쌓는다. 현재값 = 키별 가장 최근 줄.
create table fcd.settings (
  id uuid primary key default gen_random_uuid(),
  key text not null,
  value jsonb not null,
  note text,
  created_by uuid,
  created_at timestamptz not null default now()
);
create index settings_key_idx on fcd.settings (key, created_at desc);

create table fcd.duty_rates (
  id uuid primary key default gen_random_uuid(),
  category text not null,
  name_ko text not null,
  rate_bp integer not null check (rate_bp between 0 and 10000),
  note text,
  created_by uuid,
  created_at timestamptz not null default now()
);
create index duty_rates_cat_idx on fcd.duty_rates (category, created_at desc);

-- 조직·사람 ------------------------------------------------------------------

create table fcd.orgs (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('shipper', 'partner', 'platform')),
  name text not null,
  name_zh text,
  slug text unique,
  is_demo boolean not null default false,
  status text not null default 'active'
    check (status in ('active', 'public_info', 'pending_verification', 'official', 'deletion_requested', 'deleted')),
  business_type text
    check (business_type in ('forwarder', 'consolidator', 'ferry_agent', 'air_forwarder', 'customs_broker', 'fulfillment_3pl')),
  biz_reg_no text,
  license_no text,
  cargo_insurance text,
  related_party_note text,
  logo_path text,
  hq_city text,
  address text,
  phone text,
  website text,
  intro text,
  public_source text,
  public_checked_on date,
  default_locale text not null default 'ko' check (default_locale in ('ko', 'zh')),
  created_at timestamptz not null default now()
);
create index orgs_kind_idx on fcd.orgs (kind, status);

create table fcd.org_hubs (
  org_id uuid not null references fcd.orgs (id) on delete cascade,
  hub text not null references fcd.hubs (code),
  primary key (org_id, hub)
);

create table fcd.org_modes (
  org_id uuid not null references fcd.orgs (id) on delete cascade,
  mode text not null references fcd.modes (code),
  primary key (org_id, mode)
);

create table fcd.org_capabilities (
  org_id uuid not null references fcd.orgs (id) on delete cascade,
  trait text not null references fcd.cargo_traits (code),
  primary key (org_id, trait)
);

-- 사람은 반드시 소속 조직(home_org) 하나에 매달린다 — 조직을 지우면 사람도 사라진다.
-- id 는 Supabase Auth 의 사용자 id 와 같다(외래키는 걸지 않는다: 로컬 PGlite 에는 auth 스키마가 없다).
create table fcd.profiles (
  id uuid primary key,
  home_org_id uuid not null references fcd.orgs (id) on delete cascade,
  email text not null unique,
  name text not null,
  phone text,
  locale text not null default 'ko' check (locale in ('ko', 'zh')),
  created_at timestamptz not null default now()
);

create table fcd.memberships (
  user_id uuid not null references fcd.profiles (id) on delete cascade,
  org_id uuid not null references fcd.orgs (id) on delete cascade,
  role text not null
    check (role in ('shipper_admin', 'shipper_member', 'partner_admin', 'partner_member', 'platform_admin')),
  created_at timestamptz not null default now(),
  primary key (user_id, org_id)
);

-- Supabase Auth 를 안 쓸 때(로컬·시험)만 쓰는 비밀번호 해시
create table fcd.local_credentials (
  user_id uuid primary key references fcd.profiles (id) on delete cascade,
  password_hash text not null,
  created_at timestamptz not null default now()
);

-- 요금표 ---------------------------------------------------------------------

create table fcd.rate_cards (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references fcd.orgs (id) on delete cascade,
  card_no text not null,
  version integer not null default 1 check (version >= 1),
  supersedes_id uuid references fcd.rate_cards (id) on delete cascade,
  origin_hub text not null references fcd.hubs (code),
  port text not null references fcd.ports (code),
  mode text not null references fcd.modes (code),
  valid_from date not null,
  valid_to date not null,
  certainty text not null check (certainty in ('confirmed', 'estimated', 'extra_possible')),
  fuel_surcharge_separate boolean not null default false,
  is_public_price boolean not null default false,
  transit_days_min smallint not null,
  transit_days_max smallint not null,
  status text not null default 'active' check (status in ('active', 'withdrawn')),
  change_note text,
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (card_no, version),
  check (valid_from <= valid_to),
  check (transit_days_min <= transit_days_max)
);
create index rate_cards_lane_idx on fcd.rate_cards (origin_hub, port, mode);
create index rate_cards_org_idx on fcd.rate_cards (org_id);
create unique index rate_cards_one_successor on fcd.rate_cards (supersedes_id) where supersedes_id is not null;

create table fcd.rate_card_lines (
  id uuid primary key default gen_random_uuid(),
  rate_card_id uuid not null references fcd.rate_cards (id) on delete cascade,
  segment text not null references fcd.segments (code),
  included boolean not null,
  basis text not null check (basis in ('per_cbm', 'per_rt', 'per_kg', 'per_chargeable_kg', 'per_carton', 'per_unit',
                                       'per_pallet', 'per_container', 'per_shipment', 'percent_goods')),
  unit_price numeric(14, 2) not null check (unit_price >= 0),
  currency text not null check (currency in ('KRW', 'RMB', 'USD')),
  min_charge numeric(14, 2) check (min_charge >= 0),
  certainty text not null check (certainty in ('confirmed', 'estimated', 'extra_possible')),
  note text
);
create index rate_card_lines_card_idx on fcd.rate_card_lines (rate_card_id);

create table fcd.rate_card_tiers (
  id uuid primary key default gen_random_uuid(),
  rate_card_id uuid not null references fcd.rate_cards (id) on delete cascade,
  segment text not null references fcd.segments (code),
  min_qty numeric(12, 3) not null check (min_qty >= 0),
  discount_bp integer not null check (discount_bp between 0 and 9000)
);
create index rate_card_tiers_card_idx on fcd.rate_card_tiers (rate_card_id);

-- 화주 ---------------------------------------------------------------------

create table fcd.skus (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references fcd.orgs (id) on delete cascade,
  name text not null,
  preset text,
  hs_category text not null default 'general',
  units integer not null check (units > 0),
  cartons integer not null check (cartons > 0),
  kg numeric(12, 2) not null check (kg > 0),
  cbm numeric(12, 3) not null check (cbm > 0),
  goods_value numeric(14, 2) not null check (goods_value >= 0),
  goods_currency text not null default 'RMB' check (goods_currency in ('KRW', 'RMB', 'USD')),
  traits text[] not null default '{}',
  target_price integer,
  archived boolean not null default false,
  created_by uuid,
  created_at timestamptz not null default now()
);
create index skus_org_idx on fcd.skus (org_id);

create table fcd.quote_requests (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references fcd.orgs (id) on delete cascade,
  req_no text not null unique,
  title text not null,
  sku_id uuid references fcd.skus (id) on delete set null,
  units integer not null check (units > 0),
  cartons integer not null check (cartons > 0),
  kg numeric(12, 2) not null check (kg > 0),
  cbm numeric(12, 3) not null check (cbm > 0),
  goods_value numeric(14, 2) not null,
  goods_currency text not null check (goods_currency in ('KRW', 'RMB', 'USD')),
  hs_category text not null default 'general',
  traits text[] not null default '{}',
  origin_hub text not null references fcd.hubs (code),
  port text not null references fcd.ports (code),
  mode text references fcd.modes (code),
  fc_code text not null references fcd.fc_centers (code),
  ready_on date not null,
  bid_deadline timestamptz not null,
  status text not null default 'open' check (status in ('open', 'selected', 'cancelled')),
  note text,
  created_by uuid,
  created_at timestamptz not null default now()
);
create index quote_requests_org_idx on fcd.quote_requests (org_id, created_at desc);
create index quote_requests_lane_idx on fcd.quote_requests (origin_hub, port);

create table fcd.quote_request_events (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references fcd.quote_requests (id) on delete cascade,
  kind text not null,
  detail text,
  actor_id uuid,
  created_at timestamptz not null default now()
);
create index qre_req_idx on fcd.quote_request_events (request_id, created_at);

-- 응찰 — 9구간 금액 스냅숏. 고치지 않고 새 판(version, supersedes_id)으로.
create table fcd.bids (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references fcd.quote_requests (id) on delete cascade,
  org_id uuid not null references fcd.orgs (id) on delete cascade,
  bid_no text not null,
  version integer not null default 1,
  supersedes_id uuid references fcd.bids (id) on delete cascade,
  rate_card_id uuid references fcd.rate_cards (id) on delete set null,
  kind text not null check (kind in ('auto', 'adjusted')),
  mode text not null references fcd.modes (code),
  amounts jsonb not null,
  certainties jsonb not null,
  total bigint not null check (total >= 0),
  confirmed_total bigint not null check (confirmed_total >= 0),
  transit_days_min smallint not null,
  transit_days_max smallint not null,
  valid_until timestamptz not null,
  status text not null default 'submitted' check (status in ('submitted', 'withdrawn')),
  note text,
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (bid_no, version)
);
create index bids_req_idx on fcd.bids (request_id);
create index bids_org_idx on fcd.bids (org_id);
create unique index bids_one_successor on fcd.bids (supersedes_id) where supersedes_id is not null;

create table fcd.bookings (
  id uuid primary key default gen_random_uuid(),
  booking_no text not null unique,
  request_id uuid not null references fcd.quote_requests (id) on delete cascade,
  bid_id uuid not null references fcd.bids (id) on delete cascade,
  shipper_org_id uuid not null references fcd.orgs (id) on delete cascade,
  partner_org_id uuid not null references fcd.orgs (id) on delete cascade,
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (request_id)
);

create table fcd.shipments (
  id uuid primary key default gen_random_uuid(),
  shipment_no text not null unique,
  booking_id uuid not null references fcd.bookings (id) on delete cascade,
  shipper_org_id uuid not null references fcd.orgs (id) on delete cascade,
  partner_org_id uuid not null references fcd.orgs (id) on delete cascade,
  origin_hub text not null references fcd.hubs (code),
  port text not null references fcd.ports (code),
  mode text not null references fcd.modes (code),
  fc_code text not null references fcd.fc_centers (code),
  units integer not null,
  cartons integer not null,
  kg numeric(12, 2) not null,
  cbm numeric(12, 3) not null,
  stage smallint not null default 1 check (stage between 1 and 9),
  etd date,
  eta_fc date,
  delivered_at timestamptz,
  fc_returned_units integer not null default 0 check (fc_returned_units >= 0),
  created_at timestamptz not null default now()
);
create index shipments_shipper_idx on fcd.shipments (shipper_org_id);
create index shipments_partner_idx on fcd.shipments (partner_org_id);

-- 상태 이력 — 표준 9단계 + 업체가 쓰는 원래 상태값. 쌓기만 한다.
create table fcd.shipment_events (
  id uuid primary key default gen_random_uuid(),
  shipment_id uuid not null references fcd.shipments (id) on delete cascade,
  stage smallint not null check (stage between 1 and 9),
  raw_status text,
  note text,
  occurred_at timestamptz not null,
  created_by uuid,
  created_at timestamptz not null default now()
);
create index shipment_events_idx on fcd.shipment_events (shipment_id, occurred_at);

create table fcd.exceptions (
  id uuid primary key default gen_random_uuid(),
  shipment_id uuid not null references fcd.shipments (id) on delete cascade,
  kind text not null check (kind in ('customs_hold', 'inspection', 'fc_rejected', 'ferry_cancelled', 'billing_deviation')),
  note text not null,
  opened_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolution text,
  created_by uuid
);
create index exceptions_ship_idx on fcd.exceptions (shipment_id);

create table fcd.documents (
  id uuid primary key default gen_random_uuid(),
  shipment_id uuid not null references fcd.shipments (id) on delete cascade,
  org_id uuid not null references fcd.orgs (id) on delete cascade,
  kind text not null check (kind in ('commercial_invoice', 'packing_list', 'bl', 'co', 'import_declaration', 'photo', 'other')),
  file_name text not null,
  storage_path text,
  size_bytes integer,
  created_by uuid,
  created_at timestamptz not null default now()
);
create index documents_ship_idx on fcd.documents (shipment_id);

-- 청구서 — 9구간 스냅숏. 정정은 새 판.
create table fcd.invoices (
  id uuid primary key default gen_random_uuid(),
  invoice_no text not null,
  version integer not null default 1,
  supersedes_id uuid references fcd.invoices (id) on delete cascade,
  shipment_id uuid not null references fcd.shipments (id) on delete cascade,
  partner_org_id uuid not null references fcd.orgs (id) on delete cascade,
  amounts jsonb not null,
  total bigint not null check (total >= 0),
  note text,
  issued_on date not null,
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (invoice_no, version)
);
create index invoices_ship_idx on fcd.invoices (shipment_id);
create unique index invoices_one_successor on fcd.invoices (supersedes_id) where supersedes_id is not null;

create table fcd.reviews (
  id uuid primary key default gen_random_uuid(),
  shipment_id uuid not null unique references fcd.shipments (id) on delete cascade,
  shipper_org_id uuid not null references fcd.orgs (id) on delete cascade,
  partner_org_id uuid not null references fcd.orgs (id) on delete cascade,
  rating smallint not null check (rating between 1 and 5),
  on_time_ok boolean not null,
  billing_ok boolean not null,
  body text not null,
  author_label text not null,
  published boolean not null default true,
  created_by uuid,
  created_at timestamptz not null default now()
);
create index reviews_partner_idx on fcd.reviews (partner_org_id);

create table fcd.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references fcd.profiles (id) on delete cascade,
  org_id uuid not null references fcd.orgs (id) on delete cascade,
  kind text not null check (kind in ('bid_arrived', 'deadline_soon', 'exception', 'invoice_arrived', 'booking', 'status', 'system')),
  title text not null,
  body text,
  link text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user_idx on fcd.notifications (user_id, created_at desc);

create table fcd.notification_prefs (
  user_id uuid not null references fcd.profiles (id) on delete cascade,
  kind text not null,
  in_app boolean not null default true,
  email boolean not null default false,
  sms boolean not null default false,
  kakao boolean not null default false,
  primary key (user_id, kind)
);

-- 운영 ---------------------------------------------------------------------

create table fcd.verification_requests (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references fcd.orgs (id) on delete cascade,
  requester_name text not null,
  requester_email text not null,
  requester_phone text,
  message text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  decided_at timestamptz,
  decided_by uuid,
  decision_note text,
  created_at timestamptz not null default now()
);

create table fcd.deletion_requests (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references fcd.orgs (id) on delete cascade,
  requester_name text not null,
  requester_email text not null,
  reason text not null,
  status text not null default 'pending' check (status in ('pending', 'done', 'rejected')),
  decided_at timestamptz,
  decided_by uuid,
  decision_note text,
  created_at timestamptz not null default now()
);

create table fcd.grade_records (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references fcd.orgs (id) on delete cascade,
  grade text not null check (grade in ('fc_ready')),
  granted boolean not null,
  basis jsonb not null,
  note text,
  created_by uuid,
  created_at timestamptz not null default now()
);
create index grade_records_org_idx on fcd.grade_records (org_id, created_at desc);

create table fcd.ad_slots (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references fcd.orgs (id) on delete cascade,
  lane_hub text references fcd.hubs (code),
  lane_port text references fcd.ports (code),
  starts_on date not null,
  ends_on date not null,
  status text not null default 'active' check (status in ('active', 'ended')),
  created_by uuid,
  created_at timestamptz not null default now(),
  check (starts_on <= ends_on)
);

create table fcd.audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid,
  org_id uuid references fcd.orgs (id) on delete cascade,
  action text not null,
  target text,
  detail jsonb,
  created_at timestamptz not null default now()
);
create index audit_log_idx on fcd.audit_log (created_at desc);
