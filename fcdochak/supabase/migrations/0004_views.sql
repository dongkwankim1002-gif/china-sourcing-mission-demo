-- FC도착 0004 — 보기(view)
-- security_invoker 보기: 부르는 사람의 RLS 를 그대로 받는다.
-- 집계 보기(v_partner_metrics, v_market_counts): 소유자 권한으로 전체를 세되,
--   조직 단위로 데모 숨김(org_visible)을 건다. 개별 줄은 내보내지 않고 숫자만 낸다.

create view fcd.v_current_settings with (security_invoker = true) as
  select distinct on (key) key, value, note, created_at, created_by
  from fcd.settings
  order by key, created_at desc, id desc;

create view fcd.v_current_duty_rates with (security_invoker = true) as
  select distinct on (category) category, name_ko, rate_bp, note, created_at
  from fcd.duty_rates
  order by category, created_at desc, id desc;

-- 현재 판 = 뒤를 잇는 판이 없는 요금표
create view fcd.v_rate_cards_current with (security_invoker = true) as
  select r.* from fcd.rate_cards r
  where not exists (select 1 from fcd.rate_cards n where n.supersedes_id = r.id);

create view fcd.v_bids_current with (security_invoker = true) as
  select b.* from fcd.bids b
  where not exists (select 1 from fcd.bids n where n.supersedes_id = b.id);

create view fcd.v_invoices_current with (security_invoker = true) as
  select i.* from fcd.invoices i
  where not exists (select 1 from fcd.invoices n where n.supersedes_id = i.id);

-- 견적 요청의 화면 상태
--   응찰 대기 · 응찰 중 · 마감 임박(24시간 안) · 비교 가능(마감 뒤, 응찰 있음) · 선택 완료 · 만료(마감 뒤 응찰 없음 / 비교 기한 7일 넘김) · 취소
create view fcd.v_quote_requests with (security_invoker = true) as
  select q.*,
    coalesce(bc.n, 0) as bid_count,
    bc.min_total,
    case
      when q.status = 'cancelled' then 'cancelled'
      when q.status = 'selected' then 'selected'
      when q.bid_deadline > now() and coalesce(bc.n, 0) = 0 and q.bid_deadline - now() > interval '24 hours' then 'waiting'
      when q.bid_deadline > now() and q.bid_deadline - now() <= interval '24 hours' then 'closing_soon'
      when q.bid_deadline > now() then 'bidding'
      when coalesce(bc.n, 0) > 0 and now() - q.bid_deadline <= interval '7 days' then 'comparable'
      else 'expired'
    end as display_status
  from fcd.quote_requests q
  left join lateral (
    select count(*)::int as n, min(b.total)::bigint as min_total
    from fcd.v_bids_current b where b.request_id = q.id and b.status = 'submitted'
  ) bc on true;

-- 업체 실측 점수 — 선적·청구 기록에서 계산한다. 손으로 넣는 칸이 없다.
create view fcd.v_partner_metrics as
  with done as (
    select s.partner_org_id as org_id, s.units, s.fc_returned_units, s.delivered_at, s.eta_fc
    from fcd.shipments s
    where s.stage = 9 and s.delivered_at is not null
  ),
  inv as (
    select i.shipment_id, i.total, i.partner_org_id
    from fcd.invoices i
    where not exists (select 1 from fcd.invoices n where n.supersedes_id = i.id)
  ),
  dev as (
    select inv.partner_org_id as org_id,
           (inv.total - b.total)::float8 / nullif(b.total, 0) as d
    from inv
    join fcd.shipments s on s.id = inv.shipment_id
    join fcd.bookings bk on bk.id = s.booking_id
    join fcd.bids b on b.id = bk.bid_id
  ),
  cert as (
    select b.org_id, avg(b.confirmed_total::float8 / nullif(b.total, 0)) as c
    from fcd.bids b
    where b.created_at > now() - interval '180 days'
    group by b.org_id
  ),
  rv as (
    select partner_org_id as org_id, count(*)::int as n, avg(rating)::float8 as a
    from fcd.reviews where published group by partner_org_id
  )
  select o.id as org_id,
    (select count(*) from done where done.org_id = o.id)::int as shipments_done,
    (select avg(case when (d.delivered_at at time zone 'Asia/Seoul')::date <= d.eta_fc then 1.0 else 0.0 end)
       from done d where d.org_id = o.id)::float8 as on_time_rate,
    (select sum(d.fc_returned_units)::float8 / nullif(sum(d.units), 0)
       from done d where d.org_id = o.id and d.delivered_at > now() - interval '30 days') as return_rate_30d,
    (select count(*) from done d where d.org_id = o.id and d.delivered_at > now() - interval '30 days')::int as done_30d,
    (select avg(abs(dev.d)) from dev where dev.org_id = o.id)::float8 as avg_deviation,
    (select avg(dev.d) from dev where dev.org_id = o.id)::float8 as avg_signed_deviation,
    (select count(*) from dev where dev.org_id = o.id)::int as invoiced_count,
    (select c from cert where cert.org_id = o.id)::float8 as price_certainty,
    coalesce((select n from rv where rv.org_id = o.id), 0) as reviews_count,
    (select a from rv where rv.org_id = o.id) as avg_rating
  from fcd.orgs o
  where o.kind = 'partner' and fcd.org_visible(o.id);

-- 공개 첫 화면의 살아 있는 숫자
create view fcd.v_market_counts as
  select
    (select count(*) from fcd.rate_cards r
      where r.created_at >= (date_trunc('day', now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul')
        and fcd.partner_priced(r.org_id))::int as cards_today,
    (select count(*) from fcd.quote_requests q
      where q.created_at >= now() - interval '7 days' and fcd.org_visible(q.org_id))::int as requests_week,
    (select count(*) from fcd.orgs o where fcd.partner_listed(o.id))::int as partners_listed,
    (select count(*) from fcd.orgs o
      where o.kind = 'partner' and o.status = 'official' and fcd.org_visible(o.id))::int as partners_official,
    (select count(*) from fcd.shipments s
      where s.stage = 9 and s.delivered_at > now() - interval '30 days' and fcd.org_visible(s.shipper_org_id))::int as delivered_30d,
    (select count(*) from fcd.v_rate_cards_current r
      where r.status = 'active' and r.valid_to >= (now() at time zone 'Asia/Seoul')::date
        and fcd.partner_priced(r.org_id))::int as cards_active;

grant select on fcd.v_current_settings, fcd.v_current_duty_rates, fcd.v_rate_cards_current,
  fcd.v_partner_metrics, fcd.v_market_counts to fcd_public, fcd_user;
grant select on fcd.v_bids_current, fcd.v_invoices_current, fcd.v_quote_requests to fcd_user;
