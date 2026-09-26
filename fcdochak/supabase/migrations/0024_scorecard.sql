-- FC도착 0024 — 물류사 성적표(v2 6차 scorecard) · 기획 docs/scorecard-plan.md
--
--   ① partner_cargo_submissions — 물류사가 제출한 화물번호(쌓기만). 단계 기록은 5차 cargo_tracks(물류사 조직 소유, 서버가 만든다)에 쌓인다.
--   ② partner_customs_codes     — 업체 ↔ 관세청 화물운송주선업자 부호 연결(새 판, 운영자만 넣는다).
--   ③ broker_profiles           — 관세사 기본 정보(등록번호·주 세관 — 흉내 첫 판 · 운영 입력, 새 판).
--   ④ scorecard_snapshots       — 성적표 계산 결과(새 판, 서버 신뢰 경로만 넣는다). 예시 판은 demo_org_id.
--   ⑤ scorecard_disputes        — 이의 제기와 처리(쌓기만, 지금 상태 = 같은 root 의 마지막 줄).
--   보기 v_scorecard_named  — 가장 최근 판 · 표본 기준 이상 · 이름 붙은 성적은 로그인 화주·그 업체·운영자만(RLS 를 그대로 받는 security_invoker)
--   보기 v_scorecard_public — 공개(비로그인) — 이름 없는 집계만. scorecard.public_named 가 켜지면 이름 붙은 판도.
--
-- 이 파일은 자료를 지우거나 덮지 않는다(DELETE·TRUNCATE·UPDATE 없음). 기존 표·정책을 고치지 않는다.

-- 로그인한 사람이 (보이는) 화주 조직 구성원인가 — 이름 붙은 성적을 보는 조건
create or replace function fcd.is_shipper_user() returns boolean
language sql stable security definer set search_path = fcd, pg_temp as $$
  select exists (
    select 1 from fcd.memberships m join fcd.orgs o on o.id = m.org_id
     where m.user_id = fcd.uid() and o.kind = 'shipper' and fcd.org_visible(o.id)
  )
$$;
revoke all on function fcd.is_shipper_user() from public;
grant execute on function fcd.is_shipper_user() to fcd_public, fcd_user;

-- 이름 붙은 성적 공개 스위치(설정 scorecard.public_named, 없으면 꺼짐)
create or replace function fcd.scorecard_named_public() returns boolean
language sql stable security definer set search_path = fcd, pg_temp as $$
  select coalesce((select value = 'true'::jsonb from fcd.v_current_settings where key = 'scorecard.public_named'), false)
$$;
revoke all on function fcd.scorecard_named_public() from public;
grant execute on function fcd.scorecard_named_public() to fcd_public, fcd_user;

-- ① 물류사 제출 화물번호(쌓기만) ---------------------------------------------------------------
create table fcd.partner_cargo_submissions (
  id uuid primary key default gen_random_uuid(),
  partner_org_id uuid not null references fcd.orgs (id) on delete cascade,
  submitted_by uuid references fcd.profiles (id) on delete set null,
  batch_id uuid not null,
  kind text not null check (kind in ('cargo_no', 'mbl', 'hbl')),
  number text not null check (number ~ '^[A-Z0-9-]{4,35}$' and number !~ '^P[0-9]{12}$'),
  bl_year smallint check (bl_year is null or bl_year between 2000 and 2100),
  port text references fcd.ports (code),
  mode text references fcd.modes (code),
  created_at timestamptz not null default now(),
  check ((kind = 'cargo_no') = (bl_year is null))
);
create unique index partner_cargo_submissions_one on fcd.partner_cargo_submissions (partner_org_id, kind, number, coalesce(bl_year, 0));
create index partner_cargo_submissions_org_idx on fcd.partner_cargo_submissions (partner_org_id, created_at desc);

alter table fcd.partner_cargo_submissions enable row level security;
grant select, insert on fcd.partner_cargo_submissions to fcd_user;
create policy pcs_read on fcd.partner_cargo_submissions for select to fcd_user using (
  fcd.is_platform() or (fcd.org_visible(partner_org_id) and fcd.is_member(partner_org_id))
);
create policy pcs_insert on fcd.partner_cargo_submissions for insert to fcd_user with check (
  submitted_by = fcd.uid() and fcd.is_member(partner_org_id) and fcd.org_kind(partner_org_id) = 'partner'
);

-- ② 업체 ↔ 관세청 화물운송주선업자 부호(새 판) ------------------------------------------------------
create table fcd.partner_customs_codes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references fcd.orgs (id) on delete cascade,
  -- 부호 형식은 원문 확인 필요 — 영문 대문자·숫자 2~12자로 넓게 받는다
  code text check (code is null or code ~ '^[A-Z0-9]{2,12}$'),
  registered_name text check (registered_name is null or length(registered_name) <= 120),
  source text not null check (source in ('unipass', 'mock', 'admin')),
  status text not null check (status in ('linked', 'unlinked')),
  note text check (note is null or length(note) <= 300),
  supersedes_id uuid references fcd.partner_customs_codes (id) on delete set null,
  created_by uuid references fcd.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  check ((status = 'linked') = (code is not null))
);
create index partner_customs_codes_org_idx on fcd.partner_customs_codes (org_id, created_at desc);

alter table fcd.partner_customs_codes enable row level security;
grant select, insert on fcd.partner_customs_codes to fcd_user;
create policy pcc_read on fcd.partner_customs_codes for select to fcd_user using (
  fcd.is_platform() or (fcd.org_visible(org_id) and fcd.is_member(org_id))
);
create policy pcc_insert on fcd.partner_customs_codes for insert to fcd_user with check (
  fcd.is_platform() and created_by = fcd.uid() and fcd.org_kind(org_id) = 'partner'
);

create view fcd.v_partner_customs_codes_current with (security_invoker = true) as
  select c.* from fcd.partner_customs_codes c
   where not exists (select 1 from fcd.partner_customs_codes n where n.supersedes_id = c.id);
grant select on fcd.v_partner_customs_codes_current to fcd_user;

-- ③ 관세사 기본 정보(새 판) ------------------------------------------------------------------------
create table fcd.broker_profiles (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references fcd.orgs (id) on delete cascade,
  registration_no text check (registration_no is null or length(registration_no) <= 60),
  customs_offices text[] not null default '{}' check (cardinality(customs_offices) <= 10),
  ports text[] not null default '{}' check (cardinality(ports) <= 10),
  specialties text check (specialties is null or length(specialties) <= 300),
  source text not null check (source in ('mock', 'admin')),
  supersedes_id uuid references fcd.broker_profiles (id) on delete set null,
  created_by uuid references fcd.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
create index broker_profiles_org_idx on fcd.broker_profiles (org_id, created_at desc);

create or replace function fcd.is_broker_org(o uuid) returns boolean
language sql stable security definer set search_path = fcd, pg_temp as $$
  select exists (select 1 from fcd.orgs where id = o and kind = 'partner' and business_type = 'customs_broker')
$$;
revoke all on function fcd.is_broker_org(uuid) from public;
grant execute on function fcd.is_broker_org(uuid) to fcd_public, fcd_user;

alter table fcd.broker_profiles enable row level security;
grant select on fcd.broker_profiles to fcd_public;
grant select, insert on fcd.broker_profiles to fcd_user;
-- 성적이 아닌 기본 정보(등록번호·주 세관)는 공개 업체면 누구나 본다
create policy broker_profiles_read_public on fcd.broker_profiles for select to fcd_public using (fcd.partner_listed(org_id));
create policy broker_profiles_read on fcd.broker_profiles for select to fcd_user using (fcd.is_platform() or fcd.partner_listed(org_id) or fcd.is_member(org_id));
create policy broker_profiles_insert on fcd.broker_profiles for insert to fcd_user with check (
  fcd.is_platform() and created_by = fcd.uid() and fcd.is_broker_org(org_id)
);

create view fcd.v_broker_profiles_current with (security_invoker = true) as
  select b.* from fcd.broker_profiles b
   where not exists (select 1 from fcd.broker_profiles n where n.supersedes_id = b.id);
grant select on fcd.v_broker_profiles_current to fcd_public, fcd_user;

-- ④ 성적표 스냅숏(계산 새 판) ----------------------------------------------------------------------
create table fcd.scorecard_snapshots (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null,
  computed_at timestamptz not null default now(),
  entity_kind text not null check (entity_kind in ('overall', 'partner', 'broker')),
  entity_org_id uuid references fcd.orgs (id) on delete cascade,
  -- null = 모든 항구 / 모든 방식을 묶은 판
  port text references fcd.ports (code),
  mode text references fcd.modes (code),
  window_days integer not null check (window_days between 1 and 730),
  from_on date not null,
  to_on date not null,
  n integer not null check (n >= 0),
  -- 지표(영업일 p50·p90·늦는 폭·분포·검사 비율·반입→반출·반출→FC·추이·전체 대비) — src/lib/scorecard/engine.ts 의 모양
  metrics jsonb not null check (jsonb_typeof(metrics) = 'object'),
  -- 번호 출처별 수 · 교차 확인 · 이상치
  sources jsonb not null check (jsonb_typeof(sources) = 'object'),
  -- 제출률(물류사 · 전체 판에만)
  submission jsonb check (submission is null or jsonb_typeof(submission) = 'object'),
  certified boolean not null default false,
  demo_org_id uuid references fcd.orgs (id) on delete cascade,
  supersedes_id uuid references fcd.scorecard_snapshots (id) on delete set null,
  created_at timestamptz not null default now(),
  check ((entity_kind = 'overall') = (entity_org_id is null)),
  check (from_on <= to_on),
  check (not certified or entity_kind = 'partner')
);
create index scorecard_snapshots_batch_idx on fcd.scorecard_snapshots (computed_at desc, batch_id);
create index scorecard_snapshots_entity_idx on fcd.scorecard_snapshots (entity_org_id) where entity_org_id is not null;

alter table fcd.scorecard_snapshots enable row level security;
grant select on fcd.scorecard_snapshots to fcd_user;
-- 이름 붙은 성적 = 운영자 · 그 업체 구성원 · 로그인 화주(또는 공개 스위치). 이름 없는 집계는 로그인한 누구나. 예시 판은 DEMO_MODE 일 때만
create policy scorecard_read on fcd.scorecard_snapshots for select to fcd_user using (
  fcd.is_platform() or (
    (demo_org_id is null or fcd.demo_on())
    and (entity_org_id is null or (fcd.org_visible(entity_org_id)
         and (fcd.is_member(entity_org_id) or fcd.is_shipper_user() or fcd.scorecard_named_public())))
  )
);

-- 로그인 사용자용 — 가장 최근 판 · 표본 기준 이상. RLS 를 그대로 받는다
create view fcd.v_scorecard_named with (security_invoker = true) as
  with cur as (select batch_id from fcd.scorecard_snapshots order by computed_at desc, created_at desc limit 1),
       rule as (select coalesce((select (value ->> 'minSamples')::int from fcd.v_current_settings where key = 'scorecard.rules'), 5) as min_n)
  select s.id, s.entity_kind, s.entity_org_id, s.port, s.mode, s.window_days, s.from_on, s.to_on, s.n, s.metrics, s.sources, s.submission,
         s.certified, (s.demo_org_id is not null) as is_example, s.computed_at
    from fcd.scorecard_snapshots s, cur, rule
   where s.batch_id = cur.batch_id and s.n >= rule.min_n;
grant select on fcd.v_scorecard_named to fcd_user;

-- 공개(소유자 권한 보기 — v_lead_time_public 과 같은 방식). 이름 없는 집계만, 스위치가 켜지면 이름 붙은 판도(보이는 업체만)
create view fcd.v_scorecard_public as
  with cur as (select batch_id from fcd.scorecard_snapshots order by computed_at desc, created_at desc limit 1),
       rule as (select coalesce((select (value ->> 'minSamples')::int from fcd.v_current_settings where key = 'scorecard.rules'), 5) as min_n)
  select s.entity_kind, s.entity_org_id, s.port, s.mode, s.window_days, s.from_on, s.to_on, s.n, s.metrics, s.sources,
         case when s.entity_org_id is null then null else s.submission end as submission, s.certified,
         (s.demo_org_id is not null) as is_example, s.computed_at
    from fcd.scorecard_snapshots s, cur, rule
   where s.batch_id = cur.batch_id and s.n >= rule.min_n
     and (s.demo_org_id is null or fcd.demo_on())
     and (s.entity_org_id is null or (fcd.scorecard_named_public() and fcd.partner_listed(s.entity_org_id)));
grant select on fcd.v_scorecard_public to fcd_public, fcd_user;

-- ⑤ 이의 제기(쌓기만) ---------------------------------------------------------------------------
create table fcd.scorecard_disputes (
  id uuid primary key default gen_random_uuid(),
  root_id uuid references fcd.scorecard_disputes (id) on delete cascade,
  partner_org_id uuid not null references fcd.orgs (id) on delete cascade,
  kind text not null check (kind in ('open', 'note', 'accepted', 'rejected', 'withdrawn')),
  metric text check (metric is null or metric in ('clearance', 'inspection', 'bonded_release', 'release_fc', 'submission', 'other')),
  -- 이의를 든 화물번호(영문·숫자·하이픈). 받아들이면 그 화물을 성적에서 뺀다
  cargo_ref text check (cargo_ref is null or cargo_ref ~ '^[A-Z0-9-]{4,40}$'),
  body text not null check (length(body) between 1 and 1000),
  created_by uuid references fcd.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  check ((kind = 'open') = (root_id is null))
);
create index scorecard_disputes_org_idx on fcd.scorecard_disputes (partner_org_id, created_at desc);
create index scorecard_disputes_root_idx on fcd.scorecard_disputes (root_id, created_at);

create or replace function fcd.dispute_root_ok(p_root uuid, p_org uuid) returns boolean
language sql stable security definer set search_path = fcd, pg_temp as $$
  select p_root is null or exists (select 1 from fcd.scorecard_disputes d where d.id = p_root and d.root_id is null and d.partner_org_id = p_org)
$$;
revoke all on function fcd.dispute_root_ok(uuid, uuid) from public;
grant execute on function fcd.dispute_root_ok(uuid, uuid) to fcd_user;

alter table fcd.scorecard_disputes enable row level security;
grant select, insert on fcd.scorecard_disputes to fcd_user;
create policy disputes_read on fcd.scorecard_disputes for select to fcd_user using (
  fcd.is_platform() or (fcd.org_visible(partner_org_id) and fcd.is_member(partner_org_id))
);
-- 업체는 열기·덧붙이기·거두기, 운영자는 덧붙이기·받아들이기·돌려보내기
create policy disputes_insert on fcd.scorecard_disputes for insert to fcd_user with check (
  created_by = fcd.uid()
  and fcd.dispute_root_ok(root_id, partner_org_id)
  and (
    (kind in ('open', 'note', 'withdrawn') and fcd.is_member(partner_org_id) and fcd.org_kind(partner_org_id) = 'partner')
    or (kind in ('note', 'accepted', 'rejected') and fcd.is_platform())
  )
);
