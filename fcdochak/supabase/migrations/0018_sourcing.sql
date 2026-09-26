-- FC도착 0018 — 유사상품 중국 소싱처 발굴(v2 3차 sourcing · 패밀리 확장 모듈, 미리보기) · 기획 docs/sourcing-plan.md
--
--   ① sourcing_requests         — 화주의 소싱 요청(유사상품 조건). 쌓기만
--   ② sourcing_request_events   — 요청 상태·담당 배정 기록. 쌓기만(현재 상태 = 가장 최근 기록, 없으면 접수)
--   ③ sourcing_candidates       — 후보 공급처(현지 소싱 담당 = 운영자만 넣는다). 쌓기만
--   ④ candidate_quotes          — 후보의 조건(단가 구간·최소 주문량·생산 일수·샘플비·개당 무게/부피). 바꾸면 새 판(supersedes_id)
--   ⑤ sourcing_sample_interests — 샘플 요청(관심 등록). 한 사람이 후보마다 한 번
--
-- 스위치 fcd.settings 'sourcing.enabled'(기본 꺼짐) — 꺼져 있어도 요청은 「미리보기」로 기록만 한다(preview = true).
-- 이 파일은 자료를 지우거나 덮지 않는다. 기존 표·정책을 고치지 않는다.
-- 다섯 표 모두 RLS: 화주는 자기 조직 것만, 운영자는 전부. 어떤 표에도 UPDATE·DELETE 권한이 없다.

-- ① 요청 ---------------------------------------------------------------------------
create table fcd.sourcing_requests (
  id uuid primary key default gen_random_uuid(),
  request_no text not null unique check (request_no ~ '^SR-[0-9A-Z-]{4,30}$'),
  org_id uuid not null references fcd.orgs (id) on delete cascade,
  created_by uuid not null references fcd.profiles (id) on delete cascade,
  -- 시작점: 저장한 SKU · 판매 분석 상품(3차 sales) · 직접 입력
  origin text not null check (origin in ('sku', 'sales', 'manual')),
  origin_ref text check (origin_ref is null or length(origin_ref) <= 80),
  product_name text not null check (length(product_name) between 2 and 120),
  category text not null check (length(category) between 1 and 40),
  keywords text[] not null default '{}' check (cardinality(keywords) <= 12),
  image_url text check (image_url is null or (length(image_url) <= 500 and image_url ~ '^https?://')),
  -- 목표 판매가(원, 부가세 포함) · 월 판매량 · 첫 발주 수량
  target_price integer check (target_price is null or target_price between 100 and 100000000),
  monthly_units integer check (monthly_units is null or monthly_units between 0 and 10000000),
  first_order_units integer check (first_order_units is null or first_order_units between 1 and 10000000),
  needs_cert boolean not null default false,
  cert_note text check (cert_note is null or length(cert_note) <= 120),
  hub text references fcd.hubs (code),
  note text check (note is null or length(note) <= 600),
  -- 처리 기한(접수일 + sourcing.rules.slaDays)
  due_on date not null,
  -- 스위치 꺼짐일 때 남긴 요청(관심 등록처럼 기록만)
  preview boolean not null default true,
  created_at timestamptz not null default now()
);
create index sourcing_requests_org_idx on fcd.sourcing_requests (org_id, created_at desc);

alter table fcd.sourcing_requests enable row level security;
grant select, insert on fcd.sourcing_requests to fcd_user;
create policy sreq_read on fcd.sourcing_requests for select to fcd_user using (
  fcd.is_platform() or (fcd.org_visible(org_id) and fcd.is_member(org_id))
);
create policy sreq_insert on fcd.sourcing_requests for insert to fcd_user with check (
  created_by = fcd.uid() and fcd.is_member(org_id) and fcd.org_kind(org_id) = 'shipper'
);

-- ② 상태·담당 기록 ------------------------------------------------------------------
create table fcd.sourcing_request_events (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references fcd.sourcing_requests (id) on delete cascade,
  org_id uuid not null references fcd.orgs (id) on delete cascade,
  status text not null check (status in ('requested', 'researching', 'candidates_ready', 'sample_requested', 'closed', 'cancelled')),
  -- 담당(운영 조직 사람) — 비어 있으면 담당 없음
  assignee_id uuid references fcd.profiles (id) on delete set null,
  note text check (note is null or length(note) <= 300),
  actor_id uuid not null references fcd.profiles (id) on delete cascade,
  created_at timestamptz not null default now()
);
create index sourcing_request_events_req_idx on fcd.sourcing_request_events (request_id, created_at desc);

alter table fcd.sourcing_request_events enable row level security;
grant select, insert on fcd.sourcing_request_events to fcd_user;
create policy sev_read on fcd.sourcing_request_events for select to fcd_user using (
  fcd.is_platform() or (fcd.org_visible(org_id) and fcd.is_member(org_id))
);
-- 운영자는 어떤 상태든, 화주는 자기 요청의 「취소」만
create policy sev_insert on fcd.sourcing_request_events for insert to fcd_user with check (
  actor_id = fcd.uid()
  and exists (select 1 from fcd.sourcing_requests r where r.id = request_id and r.org_id = sourcing_request_events.org_id)
  and (
    fcd.is_platform()
    or (status = 'cancelled' and assignee_id is null and fcd.is_member(org_id) and fcd.org_kind(org_id) = 'shipper')
  )
);

-- 현재 상태 — 가장 최근 기록(같은 때면 id 순), 없으면 접수
create view fcd.v_sourcing_requests_current with (security_invoker = true) as
  select r.*,
         coalesce(e.status, 'requested') as status,
         e.assignee_id,
         e.created_at as status_at
    from fcd.sourcing_requests r
    left join lateral (
      select x.status, x.assignee_id, x.created_at from fcd.sourcing_request_events x
       where x.request_id = r.id order by x.created_at desc, x.id desc limit 1
    ) e on true;
grant select on fcd.v_sourcing_requests_current to fcd_user;

-- ③ 후보 공급처 ----------------------------------------------------------------------
create table fcd.sourcing_candidates (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references fcd.sourcing_requests (id) on delete cascade,
  org_id uuid not null references fcd.orgs (id) on delete cascade,
  -- 화면에 보이는 이름 — 실제 회사 이름은 담당이 확인한 뒤에만(흉내 후보는 「예시 공장 A」)
  label text not null check (length(label) between 1 and 60),
  supplier_kind text not null check (supplier_kind in ('factory', 'trader', 'unknown')),
  hub text references fcd.hubs (code),
  region text check (region is null or length(region) <= 40),
  product_title text not null check (length(product_title) between 1 and 160),
  category text check (category is null or length(category) <= 40),
  rating numeric(2, 1) check (rating is null or rating between 0 and 5),
  years_active integer check (years_active is null or years_active between 0 and 100),
  -- 공급처가 주장한 인증 · 담당이 서류로 확인한 인증(KC 가 아닌 중국 인증도 있다)
  certs_claimed text[] not null default '{}' check (cardinality(certs_claimed) <= 10),
  certs_verified text[] not null default '{}' check (cardinality(certs_verified) <= 10),
  -- 어디서 찾았나: 담당 조사 · 셀러가 붙인 링크 확인 · 흉내 제공자(예시) · 공식 API(차후)
  source text not null check (source in ('manual', 'seller_link', 'mock', 'api')),
  source_url text check (source_url is null or (length(source_url) <= 500 and source_url ~ '^https?://')),
  image_url text check (image_url is null or (length(image_url) <= 500 and image_url ~ '^https?://')),
  -- 넣을 때 셈한 유사도(0~100)와 까닭 — 정렬·참고용
  similarity integer not null check (similarity between 0 and 100),
  similarity_detail jsonb,
  note text check (note is null or length(note) <= 400),
  created_by uuid not null references fcd.profiles (id) on delete cascade,
  created_at timestamptz not null default now()
);
create index sourcing_candidates_req_idx on fcd.sourcing_candidates (request_id, created_at);

alter table fcd.sourcing_candidates enable row level security;
grant select, insert on fcd.sourcing_candidates to fcd_user;
create policy scand_read on fcd.sourcing_candidates for select to fcd_user using (
  fcd.is_platform() or (fcd.org_visible(org_id) and fcd.is_member(org_id))
);
create policy scand_insert on fcd.sourcing_candidates for insert to fcd_user with check (
  fcd.is_platform() and created_by = fcd.uid()
  and exists (select 1 from fcd.sourcing_requests r where r.id = request_id and r.org_id = sourcing_candidates.org_id)
);

-- ④ 후보 조건(새 판) ------------------------------------------------------------------
create table fcd.candidate_quotes (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references fcd.sourcing_candidates (id) on delete cascade,
  org_id uuid not null references fcd.orgs (id) on delete cascade,
  version integer not null default 1 check (version >= 1),
  supersedes_id uuid references fcd.candidate_quotes (id) on delete cascade,
  -- withdrawn = 후보 내림(담당 판단·권리자 신고 등)
  status text not null check (status in ('active', 'withdrawn')),
  currency text not null check (currency in ('RMB', 'USD')),
  -- 단가 구간 [{ "minQty": 100, "unitPrice": 12.5 }, …] — minQty 오름차순
  tiers jsonb not null check (jsonb_typeof(tiers) = 'array' and jsonb_array_length(tiers) between 1 and 8),
  moq integer not null check (moq between 1 and 10000000),
  lead_days_min integer not null check (lead_days_min between 0 and 365),
  lead_days_max integer not null check (lead_days_max between 0 and 365),
  sample_fee numeric(12, 2) check (sample_fee is null or sample_fee >= 0),
  sample_days integer check (sample_days is null or sample_days between 0 and 180),
  unit_kg numeric(10, 3) not null check (unit_kg > 0),
  unit_cbm numeric(12, 5) not null check (unit_cbm > 0),
  units_per_carton integer not null check (units_per_carton between 1 and 100000),
  valid_until date,
  note text check (note is null or length(note) <= 300),
  created_by uuid not null references fcd.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  check (lead_days_max >= lead_days_min),
  check ((supersedes_id is null) = (version = 1))
);
create index candidate_quotes_cand_idx on fcd.candidate_quotes (candidate_id, version desc);
create unique index candidate_quotes_one_root on fcd.candidate_quotes (candidate_id) where supersedes_id is null;
create unique index candidate_quotes_one_successor on fcd.candidate_quotes (supersedes_id) where supersedes_id is not null;

create view fcd.v_candidate_quotes_current with (security_invoker = true) as
  select c.* from fcd.candidate_quotes c
   where not exists (select 1 from fcd.candidate_quotes n where n.supersedes_id = c.id);
grant select on fcd.v_candidate_quotes_current to fcd_user;

-- 새 판을 쌓아도 되는가: 첫 판이면 그 후보에 아직 조건이 없고, 아니면 잇는 판이 그 후보의 현재 판
create or replace function fcd.candidate_quote_ok(p_cand uuid, p_org uuid, p_super uuid, p_version integer) returns boolean
language sql stable security definer set search_path = fcd, pg_temp as $$
  select exists (select 1 from fcd.sourcing_candidates s where s.id = p_cand and s.org_id = p_org)
     and case
       when p_super is null then p_version = 1 and not exists (select 1 from fcd.candidate_quotes c where c.candidate_id = p_cand)
       else exists (
         select 1 from fcd.candidate_quotes c
          where c.id = p_super and c.candidate_id = p_cand and c.version + 1 = p_version
            and not exists (select 1 from fcd.candidate_quotes n where n.supersedes_id = c.id)
       )
     end
$$;
revoke all on function fcd.candidate_quote_ok(uuid, uuid, uuid, integer) from public;
grant execute on function fcd.candidate_quote_ok(uuid, uuid, uuid, integer) to fcd_user;

alter table fcd.candidate_quotes enable row level security;
grant select, insert on fcd.candidate_quotes to fcd_user;
create policy cquote_read on fcd.candidate_quotes for select to fcd_user using (
  fcd.is_platform() or (fcd.org_visible(org_id) and fcd.is_member(org_id))
);
create policy cquote_insert on fcd.candidate_quotes for insert to fcd_user with check (
  fcd.is_platform() and created_by = fcd.uid()
  and fcd.candidate_quote_ok(candidate_id, org_id, supersedes_id, version)
);

-- ⑤ 샘플 요청(관심 등록) ----------------------------------------------------------------
create table fcd.sourcing_sample_interests (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references fcd.orgs (id) on delete cascade,
  user_id uuid not null references fcd.profiles (id) on delete cascade,
  request_id uuid not null references fcd.sourcing_requests (id) on delete cascade,
  candidate_id uuid not null references fcd.sourcing_candidates (id) on delete cascade,
  -- 그때 본 조건(판 번호·수량·개당 도착원가) — 기록용
  detail jsonb,
  note text check (note is null or length(note) <= 300),
  created_at timestamptz not null default now(),
  unique (user_id, candidate_id)
);
create index sourcing_sample_interests_org_idx on fcd.sourcing_sample_interests (org_id, created_at desc);

alter table fcd.sourcing_sample_interests enable row level security;
grant select, insert on fcd.sourcing_sample_interests to fcd_user;
create policy ssi_read on fcd.sourcing_sample_interests for select to fcd_user using (
  fcd.is_platform() or (fcd.org_visible(org_id) and fcd.is_member(org_id))
);
create policy ssi_insert on fcd.sourcing_sample_interests for insert to fcd_user with check (
  user_id = fcd.uid() and fcd.is_member(org_id) and fcd.org_kind(org_id) = 'shipper'
  and exists (
    select 1 from fcd.sourcing_candidates c
     where c.id = candidate_id and c.request_id = sourcing_sample_interests.request_id and c.org_id = sourcing_sample_interests.org_id
  )
);
