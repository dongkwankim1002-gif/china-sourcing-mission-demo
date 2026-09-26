-- FC도착 0022 — 통관·입고 알리미(v2 5차 tracker) · 기획 docs/tracker-plan.md
--
--   ① cargo_tracks        — 조직이 저장한 번호(화물관리번호 / M B/L / H B/L + 연도). 선적·물류사·관세사와 잇는다.
--                           화주가 고칠 수 있는 칸은 별명·방식·선적·물류사·관세사·보관 끝(archived_at)뿐(칸 단위 권한).
--                           단계·마지막 조회는 서버 신뢰 경로(폴링)만 쓴다. 거래·계약 기록이 아니다(DECISIONS).
--   ② cargo_track_events  — 관세청(또는 흉내) 단계 기록. 쌓기만 한다. 사용자에게는 읽기만 — 실측이 조작되지 않게
--                           넣는 곳은 서버 신뢰 경로 하나(source = unipass | mock). 원문은 처리구분·일시·요약 앞부분만.
--   ③ track_watches       — 알림 켜짐/꺼짐. 쌓기만(지금 값 = 사람·번호별 마지막 줄).
--   ④ lead_time_stats     — (물류사·관세사·항구·방식)별 p50·p90·표본. 계산할 때마다 새 판(supersedes_id).
--                           예시 자료로 셈한 판은 demo_org_id 로 데모 조직 하나에 매단다 — 걷어내면 함께 사라진다.
--   ⑤ unipass_poll_runs   — 폴링 회차 기록(방식·호출·실패·건너뜀). 번호·키·응답 원문은 없다. 운영자만 읽는다.
--   공개 보기 v_lead_time_public — 지금 판 중 표본 기준(tracker.rules.minSamples) 이상만.
--   함수 fcd.track_same_day — 같은 항구·방식·같은 날 입항분의 수리 완료 수(표본 기준 미만이면 빈 결과).
--
-- 이 파일은 자료를 지우거나 덮지 않는다(DELETE·TRUNCATE·UPDATE 없음). 기존 표·정책을 고치지 않는다.

-- 단계 순서(정규화 아홉 단계 — src/lib/unipass/stages.ts 와 같다)
create or replace function fcd.track_stage_rank(p text) returns integer
language sql immutable as $$
  select case p
    when 'manifest' then 1 when 'arrival' then 2 when 'unloading' then 3 when 'bonded_in' then 4
    when 'declared' then 5 when 'cleared' then 6 when 'released' then 7 when 'domestic' then 8 when 'fc' then 9
    else null end
$$;
grant execute on function fcd.track_stage_rank(text) to fcd_public, fcd_user;

-- ① 번호 ------------------------------------------------------------------------------------
create table fcd.cargo_tracks (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references fcd.orgs (id) on delete cascade,
  created_by uuid references fcd.profiles (id) on delete set null,
  kind text not null check (kind in ('cargo_no', 'mbl', 'hbl')),
  -- 영문 대문자·숫자·하이픈만. 개인통관고유부호(P + 숫자 12자리)는 받지 않는다
  number text not null check (number ~ '^[A-Z0-9-]{4,35}$' and number !~ '^P[0-9]{12}$'),
  bl_year smallint check (bl_year is null or bl_year between 2000 and 2100),
  label text check (label is null or length(label) <= 60),
  mode text references fcd.modes (code),
  port text references fcd.ports (code),
  port_raw text check (port_raw is null or port_raw ~ '^[A-Z0-9]{2,10}$'),
  shipment_id uuid references fcd.shipments (id) on delete set null,
  partner_org_id uuid references fcd.orgs (id) on delete set null,
  broker_org_id uuid references fcd.orgs (id) on delete set null,
  -- 서버가 쓰는 칸(폴링·조회 뒤)
  stage text check (stage is null or fcd.track_stage_rank(stage) is not null),
  status_raw text check (status_raw is null or length(status_raw) <= 60),
  arrival_on date,
  last_checked_at timestamptz,
  last_error text check (last_error is null or length(last_error) <= 120),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  -- B/L 은 연도가 있어야 하고, 화물관리번호는 연도가 없다
  check ((kind = 'cargo_no') = (bl_year is null))
);
create unique index cargo_tracks_one_per_org on fcd.cargo_tracks (org_id, kind, number, coalesce(bl_year, 0));
create index cargo_tracks_org_idx on fcd.cargo_tracks (org_id, created_at desc);
create index cargo_tracks_shipment_idx on fcd.cargo_tracks (shipment_id) where shipment_id is not null;
create index cargo_tracks_day_idx on fcd.cargo_tracks (port, arrival_on);

-- 잇는 것이 맞는가: 선적은 같은 화주의 것, 물류사는 partner 조직, 관세사는 partner 조직(관세사 업종)
create or replace function fcd.track_links_ok(p_org uuid, p_shipment uuid, p_partner uuid, p_broker uuid) returns boolean
language sql stable security definer set search_path = fcd, pg_temp as $$
  select fcd.is_member(p_org)
    and (p_shipment is null or exists (select 1 from fcd.shipments s where s.id = p_shipment and s.shipper_org_id = p_org))
    and (p_partner is null or exists (select 1 from fcd.orgs o where o.id = p_partner and o.kind = 'partner'))
    and (p_broker is null or exists (select 1 from fcd.orgs o where o.id = p_broker and o.kind = 'partner' and o.business_type = 'customs_broker'))
$$;
revoke all on function fcd.track_links_ok(uuid, uuid, uuid, uuid) from public;
grant execute on function fcd.track_links_ok(uuid, uuid, uuid, uuid) to fcd_user;

alter table fcd.cargo_tracks enable row level security;
grant select, insert on fcd.cargo_tracks to fcd_user;
grant update (label, mode, shipment_id, partner_org_id, broker_org_id, archived_at) on fcd.cargo_tracks to fcd_user;
create policy tracks_read on fcd.cargo_tracks for select to fcd_user using (
  fcd.is_platform() or (fcd.org_visible(org_id) and fcd.is_member(org_id))
);
create policy tracks_insert on fcd.cargo_tracks for insert to fcd_user with check (
  created_by = fcd.uid()
  and fcd.org_kind(org_id) = 'shipper'
  and fcd.track_links_ok(org_id, shipment_id, partner_org_id, broker_org_id)
  -- 서버가 쓰는 칸은 사용자가 채우지 못한다
  and stage is null and status_raw is null and arrival_on is null and last_checked_at is null and last_error is null
);
create policy tracks_update on fcd.cargo_tracks for update to fcd_user
  using (fcd.is_member(org_id) and fcd.org_kind(org_id) = 'shipper')
  with check (fcd.track_links_ok(org_id, shipment_id, partner_org_id, broker_org_id));

-- ② 단계 기록(쌓기만) --------------------------------------------------------------------------
create table fcd.cargo_track_events (
  id uuid primary key default gen_random_uuid(),
  track_id uuid not null references fcd.cargo_tracks (id) on delete cascade,
  org_id uuid not null references fcd.orgs (id) on delete cascade,
  -- 정규화 단계(모르는 처리구분이면 null — 원문만 보인다)
  stage text check (stage is null or fcd.track_stage_rank(stage) is not null),
  raw_type text not null check (length(raw_type) between 1 and 60),
  raw_summary text check (raw_summary is null or length(raw_summary) <= 120),
  occurred_at timestamptz not null,
  source text not null check (source in ('unipass', 'mock')),
  -- 같은 기록을 두 번 넣지 않는다(처리구분 + 처리일시)
  fingerprint text not null check (length(fingerprint) between 1 and 200),
  created_at timestamptz not null default now(),
  unique (track_id, fingerprint)
);
create index cargo_track_events_track_idx on fcd.cargo_track_events (track_id, occurred_at);

alter table fcd.cargo_track_events enable row level security;
grant select on fcd.cargo_track_events to fcd_user;
create policy track_events_read on fcd.cargo_track_events for select to fcd_user using (
  fcd.is_platform() or (fcd.org_visible(org_id) and fcd.is_member(org_id))
);

-- ③ 알림 켜짐(쌓기만) ---------------------------------------------------------------------------
create table fcd.track_watches (
  id uuid primary key default gen_random_uuid(),
  track_id uuid not null references fcd.cargo_tracks (id) on delete cascade,
  org_id uuid not null references fcd.orgs (id) on delete cascade,
  user_id uuid not null references fcd.profiles (id) on delete cascade,
  enabled boolean not null,
  created_at timestamptz not null default now()
);
create index track_watches_idx on fcd.track_watches (track_id, user_id, created_at desc);

alter table fcd.track_watches enable row level security;
grant select, insert on fcd.track_watches to fcd_user;
create policy watches_read on fcd.track_watches for select to fcd_user using (
  fcd.is_platform() or (fcd.org_visible(org_id) and fcd.is_member(org_id))
);
create policy watches_insert on fcd.track_watches for insert to fcd_user with check (
  user_id = fcd.uid() and fcd.is_member(org_id)
  and exists (select 1 from fcd.cargo_tracks t where t.id = track_id and t.org_id = track_watches.org_id)
);

create view fcd.v_track_watch_current with (security_invoker = true) as
  select distinct on (w.track_id, w.user_id) w.*
    from fcd.track_watches w
   order by w.track_id, w.user_id, w.created_at desc, w.id desc;
grant select on fcd.v_track_watch_current to fcd_user;

-- ④ 소요 통계(계산 새 판) -------------------------------------------------------------------------
create table fcd.lead_time_stats (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null,
  computed_at timestamptz not null default now(),
  metric text not null check (metric in ('arrival_to_clearance', 'clearance_to_fc')),
  level text not null check (level in ('port_mode', 'partner', 'partner_broker')),
  partner_org_id uuid references fcd.orgs (id) on delete cascade,
  broker_org_id uuid references fcd.orgs (id) on delete cascade,
  port text not null references fcd.ports (code),
  mode text not null references fcd.modes (code),
  window_days integer not null check (window_days between 1 and 730),
  from_on date not null,
  to_on date not null,
  -- 영업일
  p50 numeric(6, 2) not null check (p50 >= 0),
  p90 numeric(6, 2) not null check (p90 >= p50),
  n integer not null check (n >= 1),
  -- 영업일별 건수 [0일, 1일, …, 마지막 칸 = 그 이상]
  hist jsonb not null check (jsonb_typeof(hist) = 'array'),
  -- 예시(데모) 자료로 셈한 판이면 그 데모 조직(걷어내기 때 CASCADE). 실제 자료면 null
  demo_org_id uuid references fcd.orgs (id) on delete cascade,
  supersedes_id uuid references fcd.lead_time_stats (id) on delete set null,
  created_at timestamptz not null default now(),
  check ((level = 'port_mode') = (partner_org_id is null)),
  check ((level = 'partner_broker') = (broker_org_id is not null)),
  check (from_on <= to_on)
);
create index lead_time_stats_batch_idx on fcd.lead_time_stats (computed_at desc, batch_id);
create index lead_time_stats_partner_idx on fcd.lead_time_stats (partner_org_id) where partner_org_id is not null;

alter table fcd.lead_time_stats enable row level security;
grant select on fcd.lead_time_stats to fcd_user;
create policy lead_time_read on fcd.lead_time_stats for select to fcd_user using (fcd.is_platform());

-- 공개 보기 — 가장 최근 판(batch)만, 표본 기준 이상만, 보이는 업체만, 예시 판은 DEMO_MODE 일 때만.
-- 소유자 권한 보기(v_partner_metrics 와 같은 방식): 원 표를 읽되 거르는 조건을 여기서 건다.
create view fcd.v_lead_time_public as
  with cur as (select batch_id from fcd.lead_time_stats order by computed_at desc, created_at desc limit 1),
       rule as (
         select coalesce((select (value ->> 'minSamples')::int from fcd.v_current_settings where key = 'tracker.rules'), 5) as min_n
       )
  select s.metric, s.level, s.partner_org_id, s.broker_org_id, s.port, s.mode, s.window_days, s.from_on, s.to_on,
         s.p50::float8 as p50, s.p90::float8 as p90, s.n, s.hist, (s.demo_org_id is not null) as is_example, s.computed_at
    from fcd.lead_time_stats s, cur, rule
   where s.batch_id = cur.batch_id
     and s.n >= rule.min_n
     and (s.demo_org_id is null or fcd.demo_on())
     and (s.partner_org_id is null or fcd.partner_listed(s.partner_org_id))
     and (s.broker_org_id is null or fcd.partner_listed(s.broker_org_id));
grant select on fcd.v_lead_time_public to fcd_public, fcd_user;

-- ⑤ 폴링 회차 기록 -------------------------------------------------------------------------------
create table fcd.unipass_poll_runs (
  id uuid primary key default gen_random_uuid(),
  trigger text not null check (trigger in ('cron', 'manual', 'lookup', 'save')),
  mode text not null check (mode in ('http', 'mock', 'off')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  tracks_seen integer not null default 0 check (tracks_seen >= 0),
  calls integer not null default 0 check (calls >= 0),
  failures integer not null default 0 check (failures >= 0),
  skipped integer not null default 0 check (skipped >= 0),
  changed integer not null default 0 check (changed >= 0),
  note text check (note is null or length(note) <= 200),
  actor_id uuid references fcd.profiles (id) on delete set null
);
create index unipass_poll_runs_idx on fcd.unipass_poll_runs (started_at desc);

alter table fcd.unipass_poll_runs enable row level security;
grant select on fcd.unipass_poll_runs to fcd_user;
create policy poll_runs_read on fcd.unipass_poll_runs for select to fcd_user using (fcd.is_platform());

-- 같은 항구·방식·같은 날 입항분 중 수리된 수 — 개별 번호는 내지 않는다. 표본 기준 미만이면 줄이 없다.
create or replace function fcd.track_same_day(p_port text, p_mode text, p_day date)
returns table (total integer, cleared integer)
language sql stable security definer set search_path = fcd, pg_temp as $$
  with x as (
    select count(*)::int total,
           count(*) filter (where coalesce(fcd.track_stage_rank(t.stage), 0) >= 6)::int cleared
      from fcd.cargo_tracks t
     where t.port = p_port and (p_mode is null or t.mode = p_mode) and t.arrival_on = p_day
       and t.archived_at is null and fcd.org_visible(t.org_id)
  )
  select x.total, x.cleared from x
   where x.total >= coalesce((select (value ->> 'minSamples')::int from fcd.v_current_settings where key = 'tracker.rules'), 5)
$$;
revoke all on function fcd.track_same_day(text, text, date) from public;
grant execute on function fcd.track_same_day(text, text, date) to fcd_public, fcd_user;
