import 'server-only';
/** 화주 워크스페이스 조회 — 모두 asUser(RLS) 안에서. 조직은 뷰어의 현재 조직. */
import type { Queryable } from '../db';

export interface Series {
  d: string;
  v: number;
}

function days(n: number, end = new Date()): string[] {
  const out: string[] = [];
  const base = Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate());
  const k = new Date(end.getTime() + 9 * 3600_000);
  const todayK = Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), k.getUTCDate());
  void base;
  for (let i = n - 1; i >= 0; i--) out.push(new Date(todayK - i * 86400_000).toISOString().slice(0, 10));
  return out;
}

export function fillDaily(rows: { d: string; v: number }[], n: number): Series[] {
  const m = new Map(rows.map((r) => [r.d, Number(r.v)]));
  return days(n).map((d) => ({ d, v: m.get(d) ?? 0 }));
}

export const shortDay = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;

export async function shipperDashboard(q: Queryable, orgId: string, period: number) {
  const spend = await q.query<{ d: string; v: number; units: number }>(
    `select to_char(b.created_at at time zone 'Asia/Seoul', 'YYYY-MM-DD') d, sum(bd.total)::bigint v, sum(r.units)::int units
       from fcd.bookings b join fcd.bids bd on bd.id = b.bid_id join fcd.quote_requests r on r.id = b.request_id
      where b.shipper_org_id = $1 and b.created_at >= now() - ($2::int * 2) * interval '1 day'
      group by 1`,
    [orgId, period],
  );
  const cut = days(period)[0];
  const cur = spend.filter((s) => s.d >= cut);
  const prev = spend.filter((s) => s.d < cut);
  const sum = (a: typeof spend, k: 'v' | 'units') => a.reduce((s, x) => s + Number(x[k]), 0);

  const month = (
    await q.query<{ cur: number; prev: number }>(
      `select
         coalesce(sum(bd.total) filter (where date_trunc('month', b.created_at at time zone 'Asia/Seoul') = date_trunc('month', now() at time zone 'Asia/Seoul')), 0)::bigint cur,
         coalesce(sum(bd.total) filter (where date_trunc('month', b.created_at at time zone 'Asia/Seoul') = date_trunc('month', now() at time zone 'Asia/Seoul') - interval '1 month'), 0)::bigint prev
       from fcd.bookings b join fcd.bids bd on bd.id = b.bid_id where b.shipper_org_id = $1`,
      [orgId],
    )
  )[0];

  const dev = await q.query<{ d: string; dev: number }>(
    `select to_char(i.issued_on, 'YYYY-MM-DD') d, (i.total - bd.total)::float8 / nullif(bd.total, 0) dev
       from fcd.v_invoices_current i join fcd.shipments s on s.id = i.shipment_id
       join fcd.bookings b on b.id = s.booking_id join fcd.bids bd on bd.id = b.bid_id
      where s.shipper_org_id = $1 and i.issued_on >= (now() at time zone 'Asia/Seoul')::date - ($2::int * 2)`,
    [orgId, period],
  );
  const avg = (a: number[]) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
  const devCur = avg(dev.filter((x) => x.d >= cut).map((x) => x.dev));
  const devPrev = avg(dev.filter((x) => x.d < cut).map((x) => x.dev));

  const counts = (
    await q.query<{ active: number; open_reqs: number; review_wait: number; exceptions: number; comparable: number; closing: number; invoices_new: number }>(
      `select
        (select count(*) from fcd.shipments where shipper_org_id = $1 and stage < 9)::int active,
        (select count(*) from fcd.v_quote_requests where org_id = $1 and display_status in ('waiting','bidding','closing_soon'))::int open_reqs,
        (select count(*) from fcd.shipments s where s.shipper_org_id = $1 and s.stage = 9 and s.delivered_at > now() - interval '30 days' and not exists (select 1 from fcd.reviews r where r.shipment_id = s.id))::int review_wait,
        (select count(*) from fcd.exceptions e join fcd.shipments s on s.id = e.shipment_id where s.shipper_org_id = $1 and e.resolved_at is null)::int exceptions,
        (select count(*) from fcd.v_quote_requests where org_id = $1 and display_status = 'comparable')::int comparable,
        (select count(*) from fcd.v_quote_requests where org_id = $1 and display_status = 'closing_soon')::int closing,
        (select count(*) from fcd.v_invoices_current i join fcd.shipments s on s.id = i.shipment_id where s.shipper_org_id = $1 and i.created_at > now() - interval '7 days')::int invoices_new`,
      [orgId],
    )
  )[0];

  const shipments = await q.query<ShipmentRow>(SHIPMENT_SELECT + ` where s.shipper_org_id = $1 and s.stage < 9 order by s.stage desc, s.created_at desc limit 8`, [orgId]);
  const todo = await q.query<{ kind: string; id: string; title: string; sub: string; href: string; at: string }>(
    `select * from (
       select 'comparable' kind, r.id, r.req_no title, r.title sub, '/app/requests/' || r.id href, r.bid_deadline at
         from fcd.v_quote_requests r where r.org_id = $1 and r.display_status = 'comparable'
       union all
       select 'closing', r.id, r.req_no, r.title, '/app/requests/' || r.id, r.bid_deadline
         from fcd.v_quote_requests r where r.org_id = $1 and r.display_status = 'closing_soon'
       union all
       select 'exception', e.id, s.shipment_no, e.kind || ':' || e.note, '/app/shipments/' || s.id, e.opened_at
         from fcd.exceptions e join fcd.shipments s on s.id = e.shipment_id where s.shipper_org_id = $1 and e.resolved_at is null
       union all
       select 'review', s.id, s.shipment_no, 'FC 입고 완료 — 평가를 남겨 주세요', '/app/shipments/' || s.id || '?tab=review', s.delivered_at
         from fcd.shipments s where s.shipper_org_id = $1 and s.stage = 9 and s.delivered_at > now() - interval '30 days' and not exists (select 1 from fcd.reviews r where r.shipment_id = s.id)
     ) t order by at desc limit 7`,
    [orgId],
  );
  return {
    month,
    spendSeries: fillDaily(cur.map((c) => ({ d: c.d, v: Number(c.v) })), period),
    spend: sum(cur, 'v'),
    spendPrev: sum(prev, 'v'),
    perUnit: sum(cur, 'units') ? Math.round(sum(cur, 'v') / sum(cur, 'units')) : null,
    perUnitPrev: sum(prev, 'units') ? Math.round(sum(prev, 'v') / sum(prev, 'units')) : null,
    devCur,
    devPrev,
    devSeries: dev.filter((x) => x.d >= cut).map((x) => x.dev),
    counts,
    shipments,
    todo,
  };
}

export interface ShipmentRow {
  id: string;
  shipment_no: string;
  stage: number;
  mode: string;
  origin_hub: string;
  port: string;
  fc_code: string;
  fc_name: string;
  units: number;
  cbm: number;
  eta_fc: string | null;
  etd: string | null;
  delivered_at: string | null;
  created_at: string;
  partner_id: string;
  partner_name: string;
  partner_slug: string;
  shipper_name: string | null;
  req_id: string;
  req_no: string;
  title: string;
  bid_total: number;
  invoice_total: number | null;
  open_exceptions: number;
  exception_kinds: string[] | null;
  reviewed: boolean;
  last_event_at: string | null;
}

export const SHIPMENT_SELECT = `
  select s.id, s.shipment_no, s.stage, s.mode, s.origin_hub, s.port, s.fc_code, fc.name fc_name, s.units, s.cbm, s.eta_fc, s.etd, s.delivered_at, s.created_at,
         p.id partner_id, p.name partner_name, p.slug partner_slug, sh.name shipper_name, r.id req_id, r.req_no, r.title,
         bd.total bid_total,
         (select i.total from fcd.v_invoices_current i where i.shipment_id = s.id order by i.created_at desc limit 1) invoice_total,
         (select count(*) from fcd.exceptions e where e.shipment_id = s.id and e.resolved_at is null)::int open_exceptions,
         (select array_agg(distinct e.kind) from fcd.exceptions e where e.shipment_id = s.id and e.resolved_at is null) exception_kinds,
         exists (select 1 from fcd.reviews rv where rv.shipment_id = s.id) reviewed,
         (select max(ev.occurred_at) from fcd.shipment_events ev where ev.shipment_id = s.id) last_event_at
    from fcd.shipments s
    join fcd.bookings b on b.id = s.booking_id
    join fcd.bids bd on bd.id = b.bid_id
    join fcd.quote_requests r on r.id = b.request_id
    join fcd.fc_centers fc on fc.code = s.fc_code
    left join fcd.orgs p on p.id = s.partner_org_id
    left join fcd.orgs sh on sh.id = s.shipper_org_id`;

export interface RequestRow {
  id: string;
  req_no: string;
  title: string;
  origin_hub: string;
  port: string;
  mode: string | null;
  fc_code: string;
  units: number;
  cbm: number;
  kg: number;
  cartons: number;
  goods_value: number;
  goods_currency: string;
  traits: string[];
  hs_category: string;
  ready_on: string;
  bid_deadline: string;
  status: string;
  display_status: string;
  bid_count: number;
  min_total: number | null;
  created_at: string;
  note: string | null;
  sku_id: string | null;
  org_id: string;
}

export const REQUEST_SELECT = `select id, req_no, title, origin_hub, port, mode, fc_code, units, cbm, kg, cartons, goods_value, goods_currency, traits, hs_category,
  ready_on, bid_deadline, status, display_status, bid_count, min_total, created_at, note, sku_id, org_id from fcd.v_quote_requests`;

export async function listRequests(q: Queryable, orgId: string) {
  return q.query<RequestRow>(`${REQUEST_SELECT} where org_id = $1 order by created_at desc limit 500`, [orgId]);
}

export async function listShipments(q: Queryable, where: string, params: unknown[]) {
  return q.query<ShipmentRow>(`${SHIPMENT_SELECT} where ${where} order by s.created_at desc limit 500`, params);
}

export interface SkuRow {
  id: string;
  name: string;
  preset: string | null;
  hs_category: string;
  units: number;
  cartons: number;
  kg: number;
  cbm: number;
  goods_value: number;
  goods_currency: string;
  traits: string[];
  target_price: number | null;
  archived: boolean;
  created_at: string;
}

export async function listSkus(q: Queryable, orgId: string, includeArchived = false) {
  return q.query<SkuRow>(
    `select id, name, preset, hs_category, units, cartons, kg, cbm, goods_value, goods_currency, traits, target_price, archived, created_at
       from fcd.skus where org_id = $1 and ($2 or not archived) order by archived, created_at desc`,
    [orgId, includeArchived],
  );
}

export interface NotificationRow {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  link: string | null;
  read_at: string | null;
  created_at: string;
}

export async function listNotifications(q: Queryable, userId: string, limit = 300) {
  return q.query<NotificationRow>(
    `select id, kind, title, body, link, read_at, created_at from fcd.notifications where user_id = $1 order by created_at desc limit $2`,
    [userId, limit],
  );
}

export async function notificationPrefs(q: Queryable, userId: string) {
  return q.query<{ kind: string; in_app: boolean; email: boolean; sms: boolean; kakao: boolean }>(
    `select kind, in_app, email, sms, kakao from fcd.notification_prefs where user_id = $1`,
    [userId],
  );
}

export interface BidRow {
  id: string;
  bid_no: string;
  version: number;
  org_id: string;
  partner_name: string;
  partner_slug: string;
  partner_status: string;
  logo_path: string | null;
  related_party_note: string | null;
  kind: string;
  mode: string;
  amounts: Record<string, number | null>;
  certainties: Record<string, string | null>;
  total: number;
  confirmed_total: number;
  transit_days_min: number;
  transit_days_max: number;
  valid_until: string;
  status: string;
  note: string | null;
  created_at: string;
  rate_card_id: string | null;
}

export async function requestDetail(q: Queryable, id: string) {
  const r = (await q.query<RequestRow>(`${REQUEST_SELECT} where id = $1`, [id]))[0];
  if (!r) return null;
  const bids = await q.query<BidRow>(
    `select b.id, b.bid_no, b.version, b.org_id, o.name partner_name, o.slug partner_slug, o.status partner_status, o.logo_path, o.related_party_note,
            b.kind, b.mode, b.amounts, b.certainties, b.total, b.confirmed_total, b.transit_days_min, b.transit_days_max, b.valid_until, b.status, b.note, b.created_at, b.rate_card_id
       from fcd.v_bids_current b join fcd.orgs o on o.id = b.org_id
      where b.request_id = $1 order by b.total`,
    [id],
  );
  const events = await q.query<{ kind: string; detail: string | null; created_at: string; who: string | null }>(
    `select e.kind, e.detail, e.created_at, p.name who from fcd.quote_request_events e left join fcd.profiles p on p.id = e.actor_id
      where e.request_id = $1 order by e.created_at desc`,
    [id],
  );
  const booking = (
    await q.query<{ id: string; booking_no: string; bid_id: string; shipment_id: string | null; created_at: string }>(
      `select b.id, b.booking_no, b.bid_id, (select s.id from fcd.shipments s where s.booking_id = b.id limit 1) shipment_id, b.created_at from fcd.bookings b where b.request_id = $1`,
      [id],
    )
  )[0] ?? null;
  return { r, bids, events, booking };
}

export async function shipmentDetail(q: Queryable, id: string) {
  const s = (await q.query<ShipmentRow & { shipper_org_id: string; partner_org_id: string; fc_returned_units: number; booking_no: string; bid_id: string; kg: number; cartons: number }>(
    SHIPMENT_SELECT.replace('select s.id,', 'select s.shipper_org_id, s.partner_org_id, s.fc_returned_units, s.kg, s.cartons, b.booking_no, b.id booking_id, bd.id bid_id, s.id,') + ` where s.id = $1`,
    [id],
  ))[0];
  if (!s) return null;
  const [events, exceptions, docs, invoices, bid, review] = await Promise.all([
    q.query<{ id: string; stage: number; raw_status: string | null; note: string | null; occurred_at: string; who: string | null }>(
      `select e.id, e.stage, e.raw_status, e.note, e.occurred_at, p.name who from fcd.shipment_events e left join fcd.profiles p on p.id = e.created_by where e.shipment_id = $1 order by e.occurred_at desc`,
      [id],
    ),
    q.query<{ id: string; kind: string; note: string; opened_at: string; resolved_at: string | null; resolution: string | null }>(
      `select id, kind, note, opened_at, resolved_at, resolution from fcd.exceptions where shipment_id = $1 order by opened_at desc`,
      [id],
    ),
    q.query<{ id: string; kind: string; shelf: string | null; file_name: string; size_bytes: number | null; created_at: string; storage_path: string | null; org_name: string }>(
      `select d.id, d.kind, d.shelf, d.file_name, d.size_bytes, d.created_at, d.storage_path, o.name org_name from fcd.documents d join fcd.orgs o on o.id = d.org_id where d.shipment_id = $1 order by d.created_at desc`,
      [id],
    ),
    q.query<{ id: string; invoice_no: string; version: number; supersedes_id: string | null; amounts: Record<string, number | null>; total: number; note: string | null; issued_on: string; created_at: string; current: boolean }>(
      `select i.id, i.invoice_no, i.version, i.supersedes_id, i.amounts, i.total, i.note, i.issued_on, i.created_at,
              not exists (select 1 from fcd.invoices n where n.supersedes_id = i.id) current
         from fcd.invoices i where i.shipment_id = $1 order by i.created_at desc`,
      [id],
    ),
    q.query<{ amounts: Record<string, number | null>; certainties: Record<string, string | null>; total: number; transit_days_min: number; transit_days_max: number }>(
      `select amounts, certainties, total, transit_days_min, transit_days_max from fcd.bids where id = $1`,
      [s.bid_id],
    ),
    q.query<{ rating: number; body: string; on_time_ok: boolean; billing_ok: boolean; created_at: string }>(
      `select rating, body, on_time_ok, billing_ok, created_at from fcd.reviews where shipment_id = $1`,
      [id],
    ),
  ]);
  return { s, events, exceptions, docs, invoices, bid: bid[0], review: review[0] ?? null };
}
