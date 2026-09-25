import 'server-only';
/**
 * 운영 지표 읽기 — 이벤트(fcd.events)와 그 대상(응찰·청구·선적)을 읽어 순수 함수(src/lib/metrics.ts)에 넘긴다.
 * 운영자(asUser, is_platform)만 부른다. 예시(데모) 조직은 includeDemo 가 거짓이면 뺀다.
 */
import type { Queryable } from '../db';
import {
  activeSellers,
  countIn,
  EVENT_KINDS,
  inviteRatio,
  lastMonths,
  monthlyActiveSellers,
  monthlyCount,
  monthlyRevenuePerShipment,
  quoteVsInvoice,
  repeatRate,
  returnRate,
  revenuePerShipment,
  trailingRanges,
  type EventKind,
  type MetricEvent,
} from '../metrics';
import type { SegmentAmounts } from '../money';
import type { AppSettings } from './settings';

export async function adminMetrics(q: Queryable, s: AppSettings, today: string, includeDemo: boolean, days = 30) {
  const demo = includeDemo ? 'true' : 'not o.is_demo';
  const { cur, prev } = trailingRanges(today, days);
  const months = lastMonths(today, 6);
  const since = `${months[0]}-01`;

  const events = (
    await q.query<{ kind: EventKind; seller_org_id: string | null; occurred_at: string }>(
      `select e.kind, e.seller_org_id, e.occurred_at from fcd.events e join fcd.orgs o on o.id = e.org_id
        where ${demo} and e.occurred_at >= least($1::timestamptz, $2::date::timestamptz - interval '9 hours')`,
      [prev.from, since],
    )
  ).map<MetricEvent>((e) => ({ kind: e.kind, sellerOrgId: e.seller_org_id, at: new Date(e.occurred_at).toISOString() }));

  // 재선적률은 처음 예약까지 거슬러 봐야 한다 — 예약만 기간 없이
  const booked = (
    await q.query<{ seller_org_id: string | null; occurred_at: string }>(
      `select e.seller_org_id, e.occurred_at from fcd.events e join fcd.orgs o on o.id = e.org_id where ${demo} and e.kind = 'booked'`,
    )
  ).map<MetricEvent>((e) => ({ kind: 'booked', sellerOrgId: e.seller_org_id, at: new Date(e.occurred_at).toISOString() }));

  const signups = (
    await q.query<{ occurred_at: string; org_kind: string; via: string | null }>(
      `select e.occurred_at, coalesce(e.detail->>'orgKind', o.kind) org_kind, e.detail->>'via' via
         from fcd.events e join fcd.orgs o on o.id = e.org_id where ${demo} and e.kind = 'signed_up'`,
    )
  ).map((x) => ({ at: new Date(x.occurred_at).toISOString(), orgKind: (x.org_kind === 'partner' ? 'partner' : 'shipper') as 'shipper' | 'partner', via: x.via }));

  // 청구 — 청구 이벤트가 있는 선적의 청구서 판 전부 + 고른 응찰 합계(최신 판은 순수 함수가 고른다)
  const invoices = (
    await q.query<{ shipment_id: string; created_at: string; version: number; total: number; bid_total: number }>(
      `select i.shipment_id, i.created_at, i.version, i.total::float8 total, bd.total::float8 bid_total
         from fcd.invoices i join fcd.shipments s on s.id = i.shipment_id join fcd.bookings bk on bk.id = s.booking_id
         join fcd.bids bd on bd.id = bk.bid_id join fcd.orgs o on o.id = s.shipper_org_id
        where ${demo} and s.id in (select target_id from fcd.events where kind = 'invoiced')`,
    )
  ).map((x) => ({ shipmentId: x.shipment_id, at: new Date(x.created_at).toISOString(), version: Number(x.version), total: Number(x.total), bidTotal: Number(x.bid_total) }));

  const inbound = (
    await q.query<{ occurred_at: string; units: number; returned: number }>(
      `select e.occurred_at, s.units, s.fc_returned_units returned from fcd.events e join fcd.shipments s on s.id = e.target_id
         join fcd.orgs o on o.id = e.org_id where ${demo} and e.kind = 'fc_inbound'`,
    )
  ).map((x) => ({ at: new Date(x.occurred_at).toISOString(), units: Number(x.units), returned: Number(x.returned) }));

  const bookedAmounts = (
    await q.query<{ occurred_at: string; amounts: SegmentAmounts }>(
      `select e.occurred_at, bd.amounts from fcd.events e join fcd.bids bd on bd.id::text = e.detail->>'bidId'
         join fcd.orgs o on o.id = e.org_id where ${demo} and e.kind = 'booked'`,
    )
  ).map((x) => ({ at: new Date(x.occurred_at).toISOString(), amounts: x.amounts }));

  const inFlight = (
    await q.query<{ n: number }>(
      `select count(*)::int n from fcd.shipments s join fcd.orgs o on o.id = s.shipper_org_id where ${demo} and s.stage < 9`,
    )
  )[0].n;

  const recent = await q.query<{ kind: EventKind; occurred_at: string; org: string; seller: string | null; is_demo: boolean }>(
    `select e.kind, e.occurred_at, o.name org, so.name seller, o.is_demo
       from fcd.events e join fcd.orgs o on o.id = e.org_id left join fcd.orgs so on so.id = e.seller_org_id
      where ${demo} order by e.occurred_at desc limit 15`,
  );

  const rate = s.commissionRateBp;
  const funnel = EVENT_KINDS.filter((k) => k !== 'signed_up').map((k) => ({ kind: k, cur: countIn(events, k, cur), prev: countIn(events, k, prev) }));
  return {
    days,
    range: cur,
    months,
    activeSellers: { cur: activeSellers(events, cur), prev: activeSellers(events, prev) },
    managed: { cur: countIn(events, 'booked', cur), prev: countIn(events, 'booked', prev), inFlight },
    invite: { cur: inviteRatio(signups, cur), prev: inviteRatio(signups, prev) },
    repeat: { cur: repeatRate(booked, cur), prev: repeatRate(booked, prev) },
    billing: { cur: quoteVsInvoice(invoices, cur), prev: quoteVsInvoice(invoices, prev) },
    returns: { cur: returnRate(inbound, cur), prev: returnRate(inbound, prev) },
    revenue: { cur: revenuePerShipment(bookedAmounts, cur, rate), prev: revenuePerShipment(bookedAmounts, prev, rate), rateBp: rate },
    monthly: {
      active: monthlyActiveSellers(events, months),
      booked: monthlyCount(events, 'booked', months),
      revenue: monthlyRevenuePerShipment(bookedAmounts, months, rate),
    },
    funnel,
    recent,
    totalEvents: events.length,
  };
}
