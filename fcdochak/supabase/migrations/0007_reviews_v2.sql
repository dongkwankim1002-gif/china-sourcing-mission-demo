-- FC도착 0007 — 점수·후기 정직하게 (v2 trust)
--
-- ① 후기가 어떤 끝으로 끝난 선적에 대한 것인가(outcome)
--    선적 상태값은 표준 9단계(stage 1~9) · FC 회송 수량(fc_returned_units) · 예외(exceptions.kind) 뿐이다.
--    「분실」 상태값은 없다 — 그래서 끝을 이 값들에서 읽는다:
--      delivered    FC 입고 완료(9단계), 회송 없음
--      fc_returned  FC 입고 완료(9단계), 회송 수량 있음
--      fc_rejected  9단계 전인데 「FC 입고 반려」 예외가 열린 적 있음
--      lost         9단계 전, FC 도착 예정일 + 설정 review_lost_after_days 일이 지남(분실·미도착)
--    화주가 고르는 값이 아니다. 넣을 때 정책이 선적 기록에서 다시 계산해 같은지 본다.
--    이 파일 전 후기(outcome 이 빈 줄)는 모두 9단계 뒤에 남은 것 — 읽을 때 선적 기록으로 채운다(고쳐 쓰지 않는다).
--
-- ② 업체 공개 답변(review_replies) — 고치지 않고 새 판(supersedes_id)으로 쌓는다. UPDATE·DELETE 권한 없음.
--
-- ③ 점수 표본·청구 편차 분포를 읽는 함수(partner_trust_facts) — 숫자만 낸다(선적·화주를 가리키는 값 없음).
--
-- 지우거나 덮는 문장이 없다(열 추가·새 표·새 함수·새 정책만).

alter table fcd.reviews add column if not exists outcome text
  check (outcome in ('delivered', 'fc_returned', 'fc_rejected', 'lost'));

-- 설정 값 읽기(숫자). 운영 DB 에 글자로 감싸 저장된 jsonb("14")도 읽는다.
create or replace function fcd.setting_num(k text) returns numeric
language sql stable security definer set search_path = fcd, pg_temp as $$
  select nullif(value #>> '{}', '')::numeric from fcd.v_current_settings where key = k
$$;

-- 선적의 끝 — 순수 판정(표를 읽지 않는다)
create or replace function fcd.outcome_of(p_stage smallint, p_returned integer, p_rejected boolean, p_eta date, p_lost_days numeric, p_today date)
returns text language sql immutable as $$
  select case
    when p_stage = 9 and coalesce(p_returned, 0) > 0 then 'fc_returned'
    when p_stage = 9 then 'delivered'
    when p_rejected then 'fc_rejected'
    when p_eta is not null and p_lost_days is not null and p_eta + p_lost_days::int < p_today then 'lost'
    else null
  end
$$;

-- 선적 하나의 끝(평가할 수 있으면 값, 아직이면 null)
create or replace function fcd.shipment_outcome(s uuid) returns text
language sql stable security definer set search_path = fcd, pg_temp as $$
  select fcd.outcome_of(
    x.stage, x.fc_returned_units,
    exists (select 1 from fcd.exceptions e where e.shipment_id = x.id and e.kind = 'fc_rejected'),
    x.eta_fc, fcd.setting_num('review_lost_after_days'), (now() at time zone 'Asia/Seoul')::date)
  from fcd.shipments x where x.id = s
$$;

-- 후기의 끝 — 적어 둔 값이 있으면 그것, 없으면(이전 후기) 선적 기록에서
create or replace function fcd.review_outcome(r uuid) returns text
language sql stable security definer set search_path = fcd, pg_temp as $$
  select coalesce(v.outcome, fcd.shipment_outcome(v.shipment_id)) from fcd.reviews v where v.id = r
$$;

-- 후기를 볼 수 있는가(reviews 읽기 정책과 같은 뜻)
create or replace function fcd.review_visible(r uuid) returns boolean
language sql stable security definer set search_path = fcd, pg_temp as $$
  select exists (
    select 1 from fcd.reviews v
    where v.id = r and fcd.org_visible(v.shipper_org_id) and fcd.org_visible(v.partner_org_id)
      and ((v.published and fcd.partner_listed(v.partner_org_id))
           or fcd.is_member(v.shipper_org_id) or fcd.is_member(v.partner_org_id) or fcd.is_platform())
  )
$$;

create or replace function fcd.review_partner(r uuid) returns uuid
language sql stable security definer set search_path = fcd, pg_temp as $$
  select partner_org_id from fcd.reviews where id = r
$$;

-- 새 후기는 끝(outcome)을 반드시 적고, 그 값이 선적 기록과 같아야 한다(평가할 수 없는 선적이면 null 이라 막힌다).
-- 기존 허용 정책(reviews_insert)에 더해 걸리는 제한 정책이다.
create policy reviews_insert_outcome on fcd.reviews as restrictive for insert to fcd_user
  with check (outcome is not null and outcome = fcd.shipment_outcome(shipment_id));

-- 업체 공개 답변 ------------------------------------------------------------
create table fcd.review_replies (
  id uuid primary key default gen_random_uuid(),
  review_id uuid not null references fcd.reviews (id) on delete cascade,
  partner_org_id uuid not null references fcd.orgs (id) on delete cascade,
  version integer not null default 1 check (version >= 1),
  supersedes_id uuid references fcd.review_replies (id) on delete cascade,
  body text not null check (char_length(body) between 5 and 600),
  created_by uuid,
  created_at timestamptz not null default now(),
  check ((version = 1) = (supersedes_id is null))
);
create index review_replies_review_idx on fcd.review_replies (review_id);
-- 한 후기에 첫 판은 하나, 한 판을 잇는 판도 하나(갈래가 생기지 않는다)
create unique index review_replies_first on fcd.review_replies (review_id) where supersedes_id is null;
create unique index review_replies_one_successor on fcd.review_replies (supersedes_id) where supersedes_id is not null;

-- 새 판을 이을 때 같은 후기·같은 업체의 바로 앞 판인지
create or replace function fcd.reply_chain_ok(p_supersedes uuid, p_review uuid, p_partner uuid, p_version integer) returns boolean
language sql stable security definer set search_path = fcd, pg_temp as $$
  select case when p_supersedes is null then p_version = 1
    else exists (select 1 from fcd.review_replies p
                 where p.id = p_supersedes and p.review_id = p_review and p.partner_org_id = p_partner and p.version + 1 = p_version)
  end
$$;

alter table fcd.review_replies enable row level security;
grant select on fcd.review_replies to fcd_public, fcd_user;
grant insert on fcd.review_replies to fcd_user;
create policy replies_read on fcd.review_replies for select to fcd_public, fcd_user using (fcd.review_visible(review_id));
create policy replies_insert on fcd.review_replies for insert to fcd_user with check (
  fcd.is_member(partner_org_id)
  and partner_org_id = fcd.review_partner(review_id)
  and fcd.review_visible(review_id)
  and created_by = fcd.uid()
  and fcd.reply_chain_ok(supersedes_id, review_id, partner_org_id, version)
);

create view fcd.v_review_replies_current with (security_invoker = true) as
  select r.* from fcd.review_replies r
  where not exists (select 1 from fcd.review_replies n where n.supersedes_id = r.id);
grant select on fcd.v_review_replies_current to fcd_public, fcd_user;

-- 점수 표본·편차 분포 ---------------------------------------------------------
-- p_days 일 안에 끝난 선적(outcome 이 있는 것) 수와 끝별 수, 그리고 청구 편차 목록(작은 값부터).
-- 편차 정의는 v_partner_metrics 와 같다: (현재 판 청구 합계 − 응찰 합계) / 응찰 합계.
create or replace function fcd.partner_trust_facts(p_orgs uuid[], p_days integer)
returns table (org_id uuid, sample_n integer, delivered_n integer, returned_n integer, rejected_n integer, lost_n integer, deviations float8[])
language sql stable security definer set search_path = fcd, pg_temp as $$
  with o as (
    select id from fcd.orgs where id = any(p_orgs) and kind = 'partner' and fcd.org_visible(id)
  ),
  k as (select fcd.setting_num('review_lost_after_days') as lost_days, (now() at time zone 'Asia/Seoul')::date as today),
  sh as (
    select s.partner_org_id as org_id,
           fcd.outcome_of(s.stage, s.fc_returned_units, rj.first_at is not null, s.eta_fc, k.lost_days, k.today) as outcome,
           case when s.stage = 9 then s.delivered_at
                when rj.first_at is not null then rj.first_at
                else ((s.eta_fc + k.lost_days::int)::timestamp at time zone 'Asia/Seoul') end as ended_at
    from fcd.shipments s
    cross join k
    left join lateral (select min(e.opened_at) as first_at from fcd.exceptions e where e.shipment_id = s.id and e.kind = 'fc_rejected') rj on true
    where s.partner_org_id in (select id from o)
  ),
  win as (select * from sh where outcome is not null and ended_at > now() - make_interval(days => p_days)),
  dev as (
    select i.partner_org_id as org_id, (i.total - b.total)::float8 / nullif(b.total, 0) as d
    from fcd.invoices i
    join fcd.shipments s on s.id = i.shipment_id
    join fcd.bookings bk on bk.id = s.booking_id
    join fcd.bids b on b.id = bk.bid_id
    where i.partner_org_id in (select id from o)
      and not exists (select 1 from fcd.invoices n where n.supersedes_id = i.id)
  )
  select o.id,
    (select count(*) from win where win.org_id = o.id)::int,
    (select count(*) from win where win.org_id = o.id and outcome = 'delivered')::int,
    (select count(*) from win where win.org_id = o.id and outcome = 'fc_returned')::int,
    (select count(*) from win where win.org_id = o.id and outcome = 'fc_rejected')::int,
    (select count(*) from win where win.org_id = o.id and outcome = 'lost')::int,
    coalesce((select array_agg(dev.d order by dev.d) from dev where dev.org_id = o.id and dev.d is not null), '{}'::float8[])
  from o
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'setting_num(text)', 'shipment_outcome(uuid)', 'review_outcome(uuid)', 'review_visible(uuid)', 'review_partner(uuid)',
    'reply_chain_ok(uuid, uuid, uuid, integer)', 'partner_trust_facts(uuid[], integer)',
    'outcome_of(smallint, integer, boolean, date, numeric, date)'
  ] loop
    execute format('revoke all on function fcd.%s from public', f);
    execute format('grant execute on function fcd.%s to fcd_public, fcd_user', f);
  end loop;
end $$;
