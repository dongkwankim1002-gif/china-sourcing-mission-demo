-- FC도착 0008 — 확정가·보장 자리(v2 assure)
--
-- 계약을 떠안거나 돈을 받는 기능은 자리만 만든다. 켜는 값은 fcd.settings 의 v2.* 스위치(기본 꺼짐).
-- 켜도 실제 계약·결제는 없다 — 확정가는 국제물류주선업 등록, 보장은 보험사, 후불은 금융사 제휴가 전제다.
--
--   · assure_interests  — 「관심 등록」(확정가 firm · 회송 보장 coverage · 물류비 후불 deferred · 공동 혼적 consolidation).
--                          본인 것만 보고, 운영자는 모두 본다. 고치거나 지울 권한이 없다.
--   · firm_price_quotes — 시범 확정가 견적 기록. 거래 기록이라 UPDATE 권한이 없고, 다시 내면 새 판(supersedes_id).

create table fcd.assure_interests (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references fcd.orgs (id) on delete cascade,
  user_id uuid not null references fcd.profiles (id) on delete cascade,
  kind text not null check (kind in ('firm', 'coverage', 'deferred', 'consolidation')),
  source text not null check (source in ('compare', 'request', 'other')),
  detail jsonb,
  note text check (note is null or length(note) <= 300),
  created_at timestamptz not null default now()
);
create unique index assure_interests_one on fcd.assure_interests (user_id, kind);
create index assure_interests_org_idx on fcd.assure_interests (org_id, created_at desc);

create table fcd.firm_price_quotes (
  id uuid primary key default gen_random_uuid(),
  quote_no text not null,
  version integer not null default 1 check (version >= 1),
  supersedes_id uuid references fcd.firm_price_quotes (id) on delete cascade,
  org_id uuid not null references fcd.orgs (id) on delete cascade,
  created_by uuid not null references fcd.profiles (id) on delete cascade,
  source text not null check (source in ('compare', 'request')),
  request_id uuid references fcd.quote_requests (id) on delete cascade,
  lane jsonb not null,
  sample_n integer not null check (sample_n >= 1),
  base_total bigint not null check (base_total >= 0),
  premium bigint not null check (premium >= 0),
  firm_price bigint not null check (firm_price >= base_total),
  confidence_bp integer not null check (confidence_bp between 5000 and 9999),
  stats jsonb not null,
  rates jsonb not null,
  pilot boolean not null default true,
  valid_until date not null,
  created_at timestamptz not null default now(),
  unique (quote_no, version)
);
create index firm_price_quotes_org_idx on fcd.firm_price_quotes (org_id, created_at desc);
create unique index firm_price_quotes_one_successor on fcd.firm_price_quotes (supersedes_id) where supersedes_id is not null;

alter table fcd.assure_interests enable row level security;
alter table fcd.firm_price_quotes enable row level security;

-- 관심 등록 — 본인 것만, 운영자는 모두 --------------------------------------------
grant select, insert on fcd.assure_interests to fcd_user;
create policy ai_read on fcd.assure_interests for select to fcd_user using (
  fcd.org_visible(org_id) and (user_id = fcd.uid() or fcd.is_platform())
);
create policy ai_insert on fcd.assure_interests for insert to fcd_user with check (
  user_id = fcd.uid() and fcd.is_member(org_id) and fcd.org_kind(org_id) = 'shipper'
);

-- 확정가 견적 — 수정 권한 없음, 새 판만 --------------------------------------------
grant select, insert on fcd.firm_price_quotes to fcd_user;
create policy fpq_read on fcd.firm_price_quotes for select to fcd_user using (
  fcd.org_visible(org_id) and (fcd.is_member(org_id) or fcd.is_platform())
);
create policy fpq_insert on fcd.firm_price_quotes for insert to fcd_user with check (
  created_by = fcd.uid() and fcd.is_member(org_id) and fcd.org_kind(org_id) = 'shipper'
  and (request_id is null or exists (select 1 from fcd.quote_requests q where q.id = request_id and q.org_id = firm_price_quotes.org_id))
  and (firm_price_quotes.supersedes_id is null or exists (select 1 from fcd.firm_price_quotes p where p.id = firm_price_quotes.supersedes_id and p.org_id = firm_price_quotes.org_id))
);
