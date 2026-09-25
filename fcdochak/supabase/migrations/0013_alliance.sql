-- FC도착 0013 — 등록 업체와의 제휴 구조(v2 alliance) · docs/alliance-plan.md
--
-- 확정가·보장을 내려면 계약 주체가 필요하다. 플랫폼이 직접 국제물류주선업에 등록하기 전에는
-- 등록된 주선업체(제휴 주선사)가 자기 이름으로 셀러와 계약하고, 플랫폼은 표준화·위험 계산·준비금 일부 분담을 맡는다.
--
--   · alliance_partners      — 물류사 조직과 제휴 후보·상태. 상태 칸만 운영자가 바꾼다(감사 기록은 앱이 남긴다).
--   · alliance_requirements  — 요건 확인 기록(등록증·보증보험·사업자등록증·사고 이력…). 고치지 않고 새 판(supersedes_id).
--   · alliance_terms         — 계약 조건 판(수수료율·준비금율·책임 비율·유효기간). UPDATE 권한 없음, 새 판만.
--   · alliance_settlements   — 정산 명세. UPDATE 권한 없음, 바로잡거나 세금계산서 번호를 적을 때 새 판.
--
-- 누가 보나: 운영자 전부 · 물류사는 자기 것만 · 화주는 표를 못 읽고 fcd.alliance_contract_party 함수로
-- 「이름·등록번호 끝 4자리」만 받는다. 스위치(v2.alliance_enabled)가 꺼져 있으면 그 함수는 아무것도 내지 않는다.
-- 이 파일은 자료를 지우거나 덮지 않는다.

-- 제휴 후보·상태 ------------------------------------------------------------------
create table fcd.alliance_partners (
  id uuid primary key default gen_random_uuid(),
  partner_org_id uuid not null unique references fcd.orgs (id) on delete cascade,
  status text not null default 'applied'
    check (status in ('candidate', 'applied', 'reviewing', 'active', 'suspended', 'ended')),
  -- 신청 때 적은 국제물류주선업 등록번호(확인된 값은 요건 기록의 ref_no)
  registration_no text check (registration_no is null or length(registration_no) <= 60),
  applied_note text check (applied_note is null or length(applied_note) <= 600),
  applied_by uuid,
  status_note text check (status_note is null or length(status_note) <= 600),
  decided_at timestamptz,
  decided_by uuid,
  created_at timestamptz not null default now()
);
create index alliance_partners_status_idx on fcd.alliance_partners (status, created_at desc);

-- 요건 확인 기록 ------------------------------------------------------------------
create table fcd.alliance_requirements (
  id uuid primary key default gen_random_uuid(),
  alliance_id uuid not null references fcd.alliance_partners (id) on delete cascade,
  partner_org_id uuid not null references fcd.orgs (id) on delete cascade,
  kind text not null check (kind in ('registration_cert', 'guarantee_bond', 'biz_reg', 'incident_history', 'cargo_insurance')),
  version integer not null default 1 check (version >= 1),
  supersedes_id uuid references fcd.alliance_requirements (id) on delete cascade,
  status text not null check (status in ('submitted', 'verified', 'rejected')),
  ref_no text check (ref_no is null or length(ref_no) <= 80),        -- 등록번호·증권번호·사업자등록번호
  amount bigint check (amount is null or amount >= 0),              -- 보증 금액(원)
  valid_until date,                                                  -- 만료일(등록기준 신고 기한·보험 기간 끝)
  file_name text check (file_name is null or length(file_name) <= 120),
  storage_path text check (storage_path is null or length(storage_path) <= 300),
  size_bytes integer check (size_bytes is null or size_bytes >= 0),
  note text check (note is null or length(note) <= 1000),
  created_by uuid not null,
  created_at timestamptz not null default now()
);
create index alliance_requirements_idx on fcd.alliance_requirements (alliance_id, kind, created_at desc);
create unique index alliance_requirements_one_successor on fcd.alliance_requirements (supersedes_id) where supersedes_id is not null;
create unique index alliance_requirements_one_root on fcd.alliance_requirements (alliance_id, kind) where supersedes_id is null;

-- 계약 조건 판 --------------------------------------------------------------------
create table fcd.alliance_terms (
  id uuid primary key default gen_random_uuid(),
  alliance_id uuid not null references fcd.alliance_partners (id) on delete cascade,
  partner_org_id uuid not null references fcd.orgs (id) on delete cascade,
  terms_no text not null,
  version integer not null default 1 check (version >= 1),
  supersedes_id uuid references fcd.alliance_terms (id) on delete cascade,
  model text not null check (model in ('partner_contract', 'sales_agency')),
  commission_bp integer not null check (commission_bp between 0 and 3000),
  reserve_bp integer not null check (reserve_bp between 0 and 10000),
  liability jsonb not null,
  valid_from date not null,
  valid_until date not null,
  status text not null check (status in ('draft', 'agreed', 'ended')),
  signed_on date,
  note text check (note is null or length(note) <= 1000),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  unique (terms_no, version),
  check (valid_until >= valid_from),
  check (status <> 'agreed' or signed_on is not null),
  check (model = 'partner_contract' or reserve_bp = 0)
);
create index alliance_terms_idx on fcd.alliance_terms (alliance_id, created_at desc);
create unique index alliance_terms_one_successor on fcd.alliance_terms (supersedes_id) where supersedes_id is not null;

-- 정산 명세 -----------------------------------------------------------------------
create table fcd.alliance_settlements (
  id uuid primary key default gen_random_uuid(),
  alliance_id uuid not null references fcd.alliance_partners (id) on delete cascade,
  partner_org_id uuid not null references fcd.orgs (id) on delete cascade,
  terms_id uuid not null references fcd.alliance_terms (id) on delete cascade,
  statement_no text not null,
  version integer not null default 1 check (version >= 1),
  supersedes_id uuid references fcd.alliance_settlements (id) on delete cascade,
  period_start date not null,
  period_end date not null,
  lines jsonb not null,
  shipments integer not null check (shipments >= 0),
  gross_firm bigint not null check (gross_firm >= 0),
  commission bigint not null check (commission >= 0),
  commission_vat bigint not null check (commission_vat >= 0),
  reserve_in bigint not null check (reserve_in >= 0),
  platform_share bigint not null check (platform_share >= 0),
  partner_share bigint not null check (partner_share >= 0),
  seller_share bigint not null check (seller_share >= 0),
  reserve_opening bigint not null check (reserve_opening >= 0),
  reserve_drawn bigint not null check (reserve_drawn >= 0),
  reserve_shortfall bigint not null check (reserve_shortfall >= 0),
  reserve_closing bigint not null check (reserve_closing >= 0),
  net_payable bigint not null,
  status text not null check (status in ('draft', 'issued', 'void')),
  tax_invoice_no text check (tax_invoice_no is null or length(tax_invoice_no) <= 60),
  note text check (note is null or length(note) <= 1000),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  unique (statement_no, version),
  check (period_end >= period_start),
  check (net_payable = commission + commission_vat + reserve_in - platform_share)
);
create index alliance_settlements_idx on fcd.alliance_settlements (alliance_id, period_end desc);
create unique index alliance_settlements_one_successor on fcd.alliance_settlements (supersedes_id) where supersedes_id is not null;

-- 현재 판 보기(부르는 사람의 RLS 그대로) ----------------------------------------------
create view fcd.v_alliance_requirements_current with (security_invoker = true) as
  select r.* from fcd.alliance_requirements r
  where not exists (select 1 from fcd.alliance_requirements n where n.supersedes_id = r.id);
create view fcd.v_alliance_terms_current with (security_invoker = true) as
  select t.* from fcd.alliance_terms t
  where not exists (select 1 from fcd.alliance_terms n where n.supersedes_id = t.id);
create view fcd.v_alliance_settlements_current with (security_invoker = true) as
  select s.* from fcd.alliance_settlements s
  where not exists (select 1 from fcd.alliance_settlements n where n.supersedes_id = s.id);
grant select on fcd.v_alliance_requirements_current, fcd.v_alliance_terms_current, fcd.v_alliance_settlements_current to fcd_user;

-- 도움 함수 -----------------------------------------------------------------------
-- 제휴 기록이 그 물류사 것인가
create or replace function fcd.alliance_of(p_alliance uuid, p_partner uuid) returns boolean
language sql stable security definer set search_path = fcd, pg_temp as $$
  select exists (select 1 from fcd.alliance_partners a where a.id = p_alliance and a.partner_org_id = p_partner)
$$;

-- 새 판이 잇는 판이 같은 사슬의 「현재 판」인가(첫 판이면 그 칸에 아직 판이 없어야 한다)
create or replace function fcd.alliance_req_chain_ok(p_alliance uuid, p_kind text, p_super uuid) returns boolean
language sql stable security definer set search_path = fcd, pg_temp as $$
  select case when p_super is null then
    not exists (select 1 from fcd.alliance_requirements r where r.alliance_id = p_alliance and r.kind = p_kind)
  else exists (
    select 1 from fcd.alliance_requirements r
    where r.id = p_super and r.alliance_id = p_alliance and r.kind = p_kind
      and not exists (select 1 from fcd.alliance_requirements n where n.supersedes_id = r.id)
  ) end
$$;

create or replace function fcd.alliance_terms_chain_ok(p_alliance uuid, p_no text, p_super uuid) returns boolean
language sql stable security definer set search_path = fcd, pg_temp as $$
  select case when p_super is null then
    not exists (select 1 from fcd.alliance_terms t where t.terms_no = p_no)
  else exists (
    select 1 from fcd.alliance_terms t
    where t.id = p_super and t.alliance_id = p_alliance and t.terms_no = p_no
      and not exists (select 1 from fcd.alliance_terms n where n.supersedes_id = t.id)
  ) end
$$;

create or replace function fcd.alliance_settlement_chain_ok(p_alliance uuid, p_terms uuid, p_no text, p_super uuid) returns boolean
language sql stable security definer set search_path = fcd, pg_temp as $$
  select exists (select 1 from fcd.alliance_terms t where t.id = p_terms and t.alliance_id = p_alliance)
    and case when p_super is null then
      not exists (select 1 from fcd.alliance_settlements s where s.statement_no = p_no)
    else exists (
      select 1 from fcd.alliance_settlements s
      where s.id = p_super and s.alliance_id = p_alliance and s.statement_no = p_no
        and not exists (select 1 from fcd.alliance_settlements n where n.supersedes_id = s.id)
    ) end
$$;

-- 등록번호 끝 4자리(숫자·글자만 세어) — TS registrationTail 과 같은 규칙
create or replace function fcd.alliance_tail(p text) returns text
language sql immutable as $$
  select nullif(right(regexp_replace(coalesce(p, ''), '[^0-9A-Za-z]', '', 'g'), 4), '')
$$;

revoke all on function fcd.alliance_of(uuid, uuid) from public;
revoke all on function fcd.alliance_req_chain_ok(uuid, text, uuid) from public;
revoke all on function fcd.alliance_terms_chain_ok(uuid, text, uuid) from public;
revoke all on function fcd.alliance_settlement_chain_ok(uuid, uuid, text, uuid) from public;
revoke all on function fcd.alliance_tail(text) from public;
grant execute on function fcd.alliance_of(uuid, uuid) to fcd_user;
grant execute on function fcd.alliance_req_chain_ok(uuid, text, uuid) to fcd_user;
grant execute on function fcd.alliance_terms_chain_ok(uuid, text, uuid) to fcd_user;
grant execute on function fcd.alliance_settlement_chain_ok(uuid, uuid, text, uuid) to fcd_user;
grant execute on function fcd.alliance_tail(text) to fcd_user;

-- 권한 ---------------------------------------------------------------------------
alter table fcd.alliance_partners enable row level security;
alter table fcd.alliance_requirements enable row level security;
alter table fcd.alliance_terms enable row level security;
alter table fcd.alliance_settlements enable row level security;

-- 제휴 후보: 물류사는 자기 것 신청(applied), 운영자는 후보 등록(candidate)과 상태 바꾸기
grant select on fcd.alliance_partners to fcd_user;
grant insert (partner_org_id, status, registration_no, applied_note, applied_by) on fcd.alliance_partners to fcd_user;
grant update (status, status_note, decided_at, decided_by) on fcd.alliance_partners to fcd_user;
create policy ap_read on fcd.alliance_partners for select to fcd_user using (
  fcd.org_visible(partner_org_id) and (fcd.is_member(partner_org_id) or fcd.is_platform())
);
create policy ap_insert on fcd.alliance_partners for insert to fcd_user with check (
  fcd.org_kind(partner_org_id) = 'partner' and applied_by = fcd.uid() and (
    (status = 'applied' and fcd.is_member(partner_org_id))
    or (status = 'candidate' and fcd.is_platform())
  )
);
create policy ap_update on fcd.alliance_partners for update to fcd_user
  using (fcd.is_platform())
  with check (fcd.is_platform() and decided_by = fcd.uid());

-- 요건 기록: 물류사는 「올림」만, 운영자는 확인·반려 판. UPDATE·DELETE 없음
grant select, insert on fcd.alliance_requirements to fcd_user;
create policy ar_read on fcd.alliance_requirements for select to fcd_user using (
  fcd.org_visible(partner_org_id) and (fcd.is_member(partner_org_id) or fcd.is_platform())
);
create policy ar_insert on fcd.alliance_requirements for insert to fcd_user with check (
  created_by = fcd.uid()
  and fcd.alliance_of(alliance_id, partner_org_id)
  and fcd.alliance_req_chain_ok(alliance_id, kind, supersedes_id)
  and ((status = 'submitted' and fcd.is_member(partner_org_id)) or fcd.is_platform())
);

-- 계약 조건 판: 운영자만 쓴다. 물류사는 자기 것을 읽는다
grant select, insert on fcd.alliance_terms to fcd_user;
create policy at_read on fcd.alliance_terms for select to fcd_user using (
  fcd.org_visible(partner_org_id) and (fcd.is_member(partner_org_id) or fcd.is_platform())
);
create policy at_insert on fcd.alliance_terms for insert to fcd_user with check (
  fcd.is_platform() and created_by = fcd.uid()
  and fcd.alliance_of(alliance_id, partner_org_id)
  and fcd.alliance_terms_chain_ok(alliance_id, terms_no, supersedes_id)
);

-- 정산 명세: 운영자만 쓴다. 물류사는 자기 것을 읽는다
grant select, insert on fcd.alliance_settlements to fcd_user;
create policy as_read on fcd.alliance_settlements for select to fcd_user using (
  fcd.org_visible(partner_org_id) and (fcd.is_member(partner_org_id) or fcd.is_platform())
);
create policy as_insert on fcd.alliance_settlements for insert to fcd_user with check (
  fcd.is_platform() and created_by = fcd.uid()
  and fcd.alliance_of(alliance_id, partner_org_id)
  and fcd.alliance_settlement_chain_ok(alliance_id, terms_id, statement_no, supersedes_id)
);

-- 화주 확정가 카드의 「계약 상대」 --------------------------------------------------------
-- 조건: 스위치 켜짐 · 제휴 중(active) · 보이는 조직 · 필수 요건(설정 alliance.rules.requiredKinds)의 현재 판이 모두
-- 「확인함」이고 만료 전(보증보험은 최소 금액 이상) · 현재 계약 판이 서명함(agreed)이고 오늘이 유효기간 안.
-- 고른 업체(p_prefer)가 조건을 채우면 그 업체, 아니면 가장 최근에 서명한 제휴사. 이름과 등록번호 끝 4자리만 낸다.
create or replace function fcd.alliance_contract_party(p_prefer uuid)
returns table (partner_name text, reg_tail text, terms_no text, valid_until date, preferred boolean)
language sql stable security definer set search_path = fcd, pg_temp as $$
  with cfg as (
    select
      coalesce((select value = 'true'::jsonb from fcd.v_current_settings where key = 'v2.alliance_enabled'), false) as on_,
      coalesce((select array(select jsonb_array_elements_text(value -> 'requiredKinds')) from fcd.v_current_settings where key = 'alliance.rules'),
               array['registration_cert', 'guarantee_bond', 'biz_reg', 'incident_history']) as kinds,
      coalesce((select (value ->> 'minBondAmount')::bigint from fcd.v_current_settings where key = 'alliance.rules'), 100000000) as min_bond,
      (now() at time zone 'Asia/Seoul')::date as today
  ),
  cur_req as (
    select r.* from fcd.alliance_requirements r
    where not exists (select 1 from fcd.alliance_requirements n where n.supersedes_id = r.id)
  ),
  cur_terms as (
    select t.* from fcd.alliance_terms t
    where not exists (select 1 from fcd.alliance_terms n where n.supersedes_id = t.id)
  )
  select o.name, fcd.alliance_tail(reg.ref_no), t.terms_no, t.valid_until, (a.partner_org_id = p_prefer)
  from fcd.alliance_partners a
  join fcd.orgs o on o.id = a.partner_org_id
  cross join cfg
  join cur_terms t on t.alliance_id = a.id and t.status = 'agreed' and cfg.today between t.valid_from and t.valid_until
  join cur_req reg on reg.alliance_id = a.id and reg.kind = 'registration_cert' and reg.status = 'verified'
  where cfg.on_ and a.status = 'active' and fcd.org_visible(a.partner_org_id)
    and not exists (
      select 1 from unnest(cfg.kinds) k(kind)
      where not exists (
        select 1 from cur_req r
        where r.alliance_id = a.id and r.kind = k.kind and r.status = 'verified'
          and (r.valid_until is null or r.valid_until >= cfg.today)
          and (r.kind <> 'guarantee_bond' or coalesce(r.amount, 0) >= cfg.min_bond)
      )
    )
  order by (a.partner_org_id = p_prefer) desc, t.signed_on desc nulls last, t.created_at desc
  limit 1
$$;
revoke all on function fcd.alliance_contract_party(uuid) from public;
grant execute on function fcd.alliance_contract_party(uuid) to fcd_user;
