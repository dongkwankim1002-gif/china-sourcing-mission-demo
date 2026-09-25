import 'server-only';
/** 운영 어드민 조회 — 운영자는 RLS 상 모든 조직을 본다(데모 포함, 화면에 「예시」 표시). */
import type { Queryable } from '../db';
import { commissionAmount, commissionBase, isFcReady, recommendScore } from '../money';
import type { AppSettings } from './settings';

export async function adminDashboard(q: Queryable, s: AppSettings, includeDemo: boolean) {
  const demoCond = includeDemo ? 'true' : 'not o.is_demo';
  const daily = await q.query<{ d: string; requests: number; bookings: number; gmv: number }>(
    `with days as (select generate_series((now() at time zone 'Asia/Seoul')::date - 29, (now() at time zone 'Asia/Seoul')::date, interval '1 day')::date d)
     select to_char(days.d, 'YYYY-MM-DD') d,
       (select count(*) from fcd.quote_requests r join fcd.orgs o on o.id = r.org_id where ${demoCond} and (r.created_at at time zone 'Asia/Seoul')::date = days.d)::int requests,
       (select count(*) from fcd.bookings b join fcd.orgs o on o.id = b.shipper_org_id where ${demoCond} and (b.created_at at time zone 'Asia/Seoul')::date = days.d)::int bookings,
       (select coalesce(sum(bd.total), 0) from fcd.bookings b join fcd.bids bd on bd.id = b.bid_id join fcd.orgs o on o.id = b.shipper_org_id where ${demoCond} and (b.created_at at time zone 'Asia/Seoul')::date = days.d)::bigint gmv
     from days order by days.d`,
  );
  const prev = (
    await q.query<{ requests: number; bookings: number; gmv: number }>(
      `select
        (select count(*) from fcd.quote_requests r join fcd.orgs o on o.id = r.org_id where ${demoCond} and r.created_at between now() - interval '60 days' and now() - interval '30 days')::int requests,
        (select count(*) from fcd.bookings b join fcd.orgs o on o.id = b.shipper_org_id where ${demoCond} and b.created_at between now() - interval '60 days' and now() - interval '30 days')::int bookings,
        (select coalesce(sum(bd.total),0) from fcd.bookings b join fcd.bids bd on bd.id = b.bid_id join fcd.orgs o on o.id = b.shipper_org_id where ${demoCond} and b.created_at between now() - interval '60 days' and now() - interval '30 days')::bigint gmv`,
    )
  )[0];
  const booked = await q.query<{ amounts: Record<string, number | null>; created_at: string }>(
    `select bd.amounts, b.created_at from fcd.bookings b join fcd.bids bd on bd.id = b.bid_id join fcd.orgs o on o.id = b.shipper_org_id
      where ${demoCond} and b.created_at > now() - interval '60 days'`,
  );
  const cut = Date.now() - 30 * 86400_000;
  const comm = (from: (x: (typeof booked)[number]) => boolean) => booked.filter(from).reduce((t, b) => t + commissionAmount(b.amounts, s.commissionRateBp), 0);
  const commission = comm((b) => new Date(b.created_at).getTime() > cut);
  const commissionPrev = comm((b) => new Date(b.created_at).getTime() <= cut);
  const commBase30 = booked.filter((b) => new Date(b.created_at).getTime() > cut).reduce((t, b) => t + commissionBase(b.amounts), 0);

  const devRet = (
    await q.query<{ dev: number | null; dev_prev: number | null; ret: number | null; ret_prev: number | null }>(
      `with inv as (
         select i.total, bd.total bid, i.issued_on from fcd.v_invoices_current i join fcd.shipments s on s.id = i.shipment_id join fcd.bookings b on b.id = s.booking_id
           join fcd.bids bd on bd.id = b.bid_id join fcd.orgs o on o.id = s.shipper_org_id where ${demoCond})
       select
        (select avg(abs(total - bid)::float8 / bid) from inv where issued_on > (now() at time zone 'Asia/Seoul')::date - 30) dev,
        (select avg(abs(total - bid)::float8 / bid) from inv where issued_on between (now() at time zone 'Asia/Seoul')::date - 60 and (now() at time zone 'Asia/Seoul')::date - 30) dev_prev,
        (select sum(fc_returned_units)::float8 / nullif(sum(units), 0) from fcd.shipments s join fcd.orgs o on o.id = s.shipper_org_id where ${demoCond} and s.stage = 9 and s.delivered_at > now() - interval '30 days') ret,
        (select sum(fc_returned_units)::float8 / nullif(sum(units), 0) from fcd.shipments s join fcd.orgs o on o.id = s.shipper_org_id where ${demoCond} and s.stage = 9 and s.delivered_at between now() - interval '60 days' and now() - interval '30 days') ret_prev`,
    )
  )[0];

  const heat = await q.query<{ lane: string; w: number; n: number }>(
    `select r.origin_hub || '→' || r.port lane, floor(extract(epoch from (now() - r.created_at)) / 604800)::int w, count(*)::int n
       from fcd.quote_requests r join fcd.orgs o on o.id = r.org_id
      where ${demoCond} and r.created_at > now() - interval '84 days' group by 1, 2`,
  );

  const ranking = await q.query<{ id: string; name: string; slug: string; is_demo: boolean; status: string; shipments_done: number; on_time_rate: number | null; avg_deviation: number | null; return_rate_30d: number | null; done_30d: number; invoiced_count: number; price_certainty: number | null; related_party_note: string | null }>(
    `select o.id, o.name, o.slug, o.is_demo, o.status, o.related_party_note, m.shipments_done, m.on_time_rate, m.avg_deviation, m.return_rate_30d, m.done_30d, m.invoiced_count, m.price_certainty
       from fcd.v_partner_metrics m join fcd.orgs o on o.id = m.org_id where ${demoCond} and o.status in ('official','pending_verification')`,
  );
  const ranked = ranking
    .map((r) => ({
      ...r,
      score: recommendScore(
        { onTimeRate: r.shipments_done ? r.on_time_rate : null, avgDeviation: r.invoiced_count ? r.avg_deviation : null, fcReturnRate: r.done_30d ? r.return_rate_30d : null, priceCertainty: r.price_certainty ?? 0.5 },
        s.scoreCaps,
      ),
      fcReady: isFcReady(r.shipments_done, r.return_rate_30d, s.fcReadyRule),
    }))
    .sort((a, b) => b.score - a.score);

  const queues = (
    await q.query<{ verify: number; deletion: number; billing: number; exceptions: number }>(
      `select
        (select count(*) from fcd.verification_requests v join fcd.orgs o on o.id = v.org_id where v.status = 'pending' and ${demoCond})::int verify,
        (select count(*) from fcd.deletion_requests v join fcd.orgs o on o.id = v.org_id where v.status = 'pending' and ${demoCond})::int deletion,
        (select count(*) from fcd.exceptions e join fcd.shipments s on s.id = e.shipment_id join fcd.orgs o on o.id = s.shipper_org_id where e.kind = 'billing_deviation' and e.resolved_at is null and ${demoCond})::int billing,
        (select count(*) from fcd.exceptions e join fcd.shipments s on s.id = e.shipment_id join fcd.orgs o on o.id = s.shipper_org_id where e.resolved_at is null and ${demoCond})::int exceptions`,
    )
  )[0];

  const sum = (k: 'requests' | 'bookings' | 'gmv') => daily.reduce((t, d) => t + Number(d[k]), 0);
  return { daily, prev, totals: { requests: sum('requests'), bookings: sum('bookings'), gmv: sum('gmv') }, commission, commissionPrev, commBase30, devRet, heat, ranked, queues };
}
