-- FC도착 0012 — v2 검토에서 나온 권한 조이기(0007·0009·0010 보강)
--
-- 자료를 지우거나 덮지 않는다. 기존 정책은 지우지 않고, 제한(restrictive) 정책을 덧붙여 좁힌다.
-- 함수는 같은 이름·같은 인자로 다시 만든다(create or replace) — 부르는 쪽은 그대로다.
--
--   ① fcd.shipment_outcome · review_outcome · review_partner — 볼 수 있는 선적·후기일 때만 값을 낸다
--   ② fcd.partner_trust_facts — 목록에 오른(심사 중·정지가 아닌) 업체만. 본인 조직·운영자는 그대로 본다
--   ③ 초대 거두기 — 이미 거둔 초대는 다시 고칠 수 없고, 거둔 시각은 지금 이전만
--   ④ 이벤트 쓰기 — 대상(선적·견적 요청)을 볼 수 있어야 하고, 셀러는 그 대상의 셀러, 가입은 자기 조직만

-- ① ---------------------------------------------------------------------------
-- 보는 사람 조건 없이 선적 기록에서 끝을 읽는 속 함수. 누구에게도 실행 권한을 주지 않는다(아래 security definer 함수만 부른다).
create or replace function fcd.shipment_outcome_raw(s uuid) returns text
language sql stable security definer set search_path = fcd, pg_temp as $$
  select fcd.outcome_of(
    x.stage, x.fc_returned_units,
    exists (select 1 from fcd.exceptions e where e.shipment_id = x.id and e.kind = 'fc_rejected'),
    x.eta_fc, fcd.setting_num('review_lost_after_days'), (now() at time zone 'Asia/Seoul')::date)
  from fcd.shipments x where x.id = s
$$;
revoke all on function fcd.shipment_outcome_raw(uuid) from public;

create or replace function fcd.shipment_outcome(s uuid) returns text
language sql stable security definer set search_path = fcd, pg_temp as $$
  select case when fcd.can_see_shipment(s) then fcd.shipment_outcome_raw(s) end
$$;

-- 공개 후기(0007 전 후기)도 끝을 채워야 하므로 선적 가시성이 아니라 후기 가시성으로 본다
create or replace function fcd.review_outcome(r uuid) returns text
language sql stable security definer set search_path = fcd, pg_temp as $$
  select coalesce(v.outcome, fcd.shipment_outcome_raw(v.shipment_id))
    from fcd.reviews v where v.id = r and fcd.review_visible(r)
$$;

create or replace function fcd.review_partner(r uuid) returns uuid
language sql stable security definer set search_path = fcd, pg_temp as $$
  select partner_org_id from fcd.reviews where id = r and fcd.review_visible(r)
$$;

-- ② ---------------------------------------------------------------------------
create or replace function fcd.partner_trust_facts(p_orgs uuid[], p_days integer)
returns table (org_id uuid, sample_n integer, delivered_n integer, returned_n integer, rejected_n integer, lost_n integer, deviations float8[])
language sql stable security definer set search_path = fcd, pg_temp as $$
  with o as (
    select id from fcd.orgs
     where id = any(p_orgs) and kind = 'partner' and fcd.org_visible(id)
       and (fcd.partner_listed(id) or fcd.is_member(id) or fcd.is_platform())
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

-- ③ ---------------------------------------------------------------------------
-- 기존 invites_revoke(허용)에 더해 걸린다: 아직 거두지 않은 초대만, 거둔 시각은 지금 이전
create policy invites_revoke_once on fcd.partner_invites as restrictive for update to fcd_user
  using (revoked_at is null)
  with check (revoked_at is not null and revoked_at <= now());

-- ④ ---------------------------------------------------------------------------
create or replace function fcd.event_target_ok(p_kind text, p_target_kind text, p_target uuid, p_org uuid, p_seller uuid) returns boolean
language sql stable security definer set search_path = fcd, pg_temp as $$
  select case
    when p_kind = 'signed_up' then p_target_kind = 'org' and p_target = p_org
    when p_target_kind = 'org' then p_target = p_org
    when p_target_kind = 'shipment' then p_target is not null and fcd.can_see_shipment(p_target)
      and (p_seller is null or exists (select 1 from fcd.shipments s where s.id = p_target and s.shipper_org_id = p_seller))
    when p_target_kind = 'quote_request' then p_target is not null and fcd.can_see_request(p_target)
      and (p_seller is null or exists (select 1 from fcd.quote_requests q where q.id = p_target and q.org_id = p_seller))
    else p_target is null
  end
$$;

create policy events_insert_target on fcd.events as restrictive for insert to fcd_user
  with check (coalesce(fcd.event_target_ok(kind, target_kind, target_id, org_id, seller_org_id), false));

do $$
declare f text;
begin
  foreach f in array array['shipment_outcome(uuid)', 'review_outcome(uuid)', 'review_partner(uuid)', 'partner_trust_facts(uuid[], integer)'] loop
    execute format('revoke all on function fcd.%s from public', f);
    execute format('grant execute on function fcd.%s to fcd_public, fcd_user', f);
  end loop;
  execute 'revoke all on function fcd.event_target_ok(text, text, uuid, uuid, uuid) from public';
  execute 'grant execute on function fcd.event_target_ok(text, text, uuid, uuid, uuid) to fcd_user';
end $$;
