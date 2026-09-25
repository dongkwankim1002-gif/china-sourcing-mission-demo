/**
 * 데모 이벤트 — 이미 넣은 데모 자료(요청·응찰·예약·선적 이력·청구·평가·조직)에서 이벤트 줄을 만든다.
 * 데모 조직(is_demo) 아래 자료만 읽고, 이벤트도 데모 조직에 매달려 걷어내기 때 함께 사라진다.
 * 멱등: 데모 조직의 이벤트가 이미 있으면 아무것도 하지 않는다.
 */
import type { Queryable } from '@/lib/db/driver';

export async function seedDemoEvents(q: Queryable): Promise<number> {
  const has = await q.query<{ n: number }>(
    `select count(*)::int n from fcd.events e join fcd.orgs o on o.id = e.org_id where o.is_demo`,
  );
  if (has[0].n > 0) return 0;
  const before = await q.query<{ n: number }>(`select count(*)::int n from fcd.events`);
  await q.exec(`
    -- 가입(화주·물류사 조직이 생긴 때)
    insert into fcd.events (org_id, seller_org_id, actor_id, kind, target_kind, target_id, detail, occurred_at, created_at)
    select o.id, case when o.kind = 'shipper' then o.id end, null, 'signed_up', 'org', o.id,
           jsonb_build_object('orgKind', o.kind, 'via', 'direct'), o.created_at, o.created_at
      from fcd.orgs o where o.is_demo and o.kind in ('shipper', 'partner');

    -- 견적 요청
    insert into fcd.events (org_id, seller_org_id, actor_id, kind, target_kind, target_id, occurred_at, created_at)
    select r.org_id, r.org_id, r.created_by, 'quote_requested', 'quote_request', r.id, r.created_at, r.created_at
      from fcd.quote_requests r join fcd.orgs o on o.id = r.org_id where o.is_demo;

    -- 요청 취소
    insert into fcd.events (org_id, seller_org_id, actor_id, kind, target_kind, target_id, occurred_at, created_at)
    select r.org_id, r.org_id, e.actor_id, 'request_cancelled', 'quote_request', r.id, e.created_at, e.created_at
      from fcd.quote_request_events e join fcd.quote_requests r on r.id = e.request_id join fcd.orgs o on o.id = r.org_id
     where o.is_demo and e.kind = 'cancelled';

    -- 응찰(첫 판)
    insert into fcd.events (org_id, seller_org_id, actor_id, kind, target_kind, target_id, detail, occurred_at, created_at)
    select b.org_id, r.org_id, b.created_by, 'bid_submitted', 'quote_request', r.id, jsonb_build_object('bidId', b.id), b.created_at, b.created_at
      from fcd.bids b join fcd.quote_requests r on r.id = b.request_id join fcd.orgs o on o.id = r.org_id
     where o.is_demo and b.version = 1;

    -- 응찰 선택 · 예약
    insert into fcd.events (org_id, seller_org_id, actor_id, kind, target_kind, target_id, detail, occurred_at, created_at)
    select bk.shipper_org_id, bk.shipper_org_id, bk.created_by, 'bid_selected', 'quote_request', bk.request_id, jsonb_build_object('bidId', bk.bid_id), bk.created_at, bk.created_at
      from fcd.bookings bk join fcd.orgs o on o.id = bk.shipper_org_id where o.is_demo;
    insert into fcd.events (org_id, seller_org_id, actor_id, kind, target_kind, target_id, detail, occurred_at, created_at)
    select bk.shipper_org_id, bk.shipper_org_id, bk.created_by, 'booked', 'shipment', s.id,
           jsonb_build_object('bidId', bk.bid_id, 'partnerOrgId', bk.partner_org_id), bk.created_at, bk.created_at
      from fcd.bookings bk join fcd.shipments s on s.booking_id = bk.id join fcd.orgs o on o.id = bk.shipper_org_id where o.is_demo;

    -- 선적·출항(5단계) · FC 입고(9단계) — 상태 이력의 첫 기록
    insert into fcd.events (org_id, seller_org_id, actor_id, kind, target_kind, target_id, occurred_at, created_at)
    select s.partner_org_id, s.shipper_org_id, e.created_by, case e.stage when 5 then 'shipped' else 'fc_inbound' end, 'shipment', s.id, e.occurred_at, e.occurred_at
      from (select distinct on (shipment_id, stage) * from fcd.shipment_events where stage in (5, 9) order by shipment_id, stage, occurred_at) e
      join fcd.shipments s on s.id = e.shipment_id join fcd.orgs o on o.id = s.shipper_org_id
     where o.is_demo;

    -- 회송
    insert into fcd.events (org_id, seller_org_id, actor_id, kind, target_kind, target_id, detail, occurred_at, created_at)
    select s.partner_org_id, s.shipper_org_id, null, 'returned', 'shipment', s.id, jsonb_build_object('units', s.fc_returned_units), s.delivered_at, s.delivered_at
      from fcd.shipments s join fcd.orgs o on o.id = s.shipper_org_id
     where o.is_demo and s.stage = 9 and s.fc_returned_units > 0 and s.delivered_at is not null;

    -- 청구(판마다)
    insert into fcd.events (org_id, seller_org_id, actor_id, kind, target_kind, target_id, detail, occurred_at, created_at)
    select i.partner_org_id, s.shipper_org_id, i.created_by, 'invoiced', 'shipment', s.id, jsonb_build_object('total', i.total, 'version', i.version), i.created_at, i.created_at
      from fcd.invoices i join fcd.shipments s on s.id = i.shipment_id join fcd.orgs o on o.id = s.shipper_org_id where o.is_demo;

    -- 평가
    insert into fcd.events (org_id, seller_org_id, actor_id, kind, target_kind, target_id, detail, occurred_at, created_at)
    select v.shipper_org_id, v.shipper_org_id, v.created_by, 'reviewed', 'shipment', v.shipment_id, jsonb_build_object('rating', v.rating), v.created_at, v.created_at
      from fcd.reviews v join fcd.orgs o on o.id = v.shipper_org_id where o.is_demo;
  `);
  const after = await q.query<{ n: number }>(`select count(*)::int n from fcd.events`);
  return after[0].n - before[0].n;
}
