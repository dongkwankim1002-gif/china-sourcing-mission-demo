import 'server-only';
/**
 * 판매 분석 조회(v2 3차 sales) — 모두 asUser(RLS) 안에서 부른다. 키 값은 다루지 않는다(연결 여부만 2차 wing 의 currentConnection 으로).
 *   · 열림 판정: 키를 맡긴 조직 = live · 데모 조직의 흉내 동기화 = example · 없음 = none(권유 + 미리보기)
 *   · 개당 도착원가: 실제 선적·청구(최근 N건) → 없으면 구간 시세(비교 엔진 중간값)
 *   · 운송일: 그 SKU 최근 선적 구간의 유효 요금표 운송일(최대) 중간값 → 없으면 방식표 최대 일수
 */
import { cache } from 'react';
import { asUser, todayKst, type Queryable } from '../db';
import { STANDARD_ROUTE } from '../standard-cargo';
import { SEGMENTS_TO_KR_PORT, estimateDutyVat, goodsValueKrw, summarizeArrival, type Currency } from '../money';
import { arrivalPerUnit, median, type ActualShipmentCost, type ArrivalPerUnit, type MarketCost } from '../money/sales';
import { analyzeSales, type DeliveredShipment, type SalesAnalysis, type TransitInfo } from '../sales/analyze';
import { PREVIEW_PRODUCTS, PREVIEW_SALES_SEED, mockSales } from '../sales/mock';
import { parseEgressIps, parseSalesRules } from '../sales/settings';
import { SALES_CONSENT } from '../sales/consent';
import type { SalesAccess, SalesDataset, SalesRules } from '../sales/types';
import { parseFeeBasis, type CoupangFeeBasis } from '../tools-settings';
import { compare, rankOffers, sortOffers } from './compare';
import { loadSettings, type AppSettings } from './settings';
import { currentConnection, wingSettings, type WingConnectionRow } from './wing';
import { ensureKeyExpiryAlert } from './sales-alerts';
import type { ExpiryAlert } from '../sales/alerts';
import type { Viewer } from './viewer';

export async function salesRules(q: Queryable): Promise<SalesRules> {
  const r = await q.query<{ value: unknown }>(`select value from fcd.v_current_settings where key = 'sales.rules'`);
  return parseSalesRules(r[0]?.value);
}

export async function egressIps(q: Queryable): Promise<string[]> {
  const r = await q.query<{ value: unknown }>(`select value from fcd.v_current_settings where key = 'wing.egress_ips'`);
  return parseEgressIps(r[0]?.value);
}

export interface ConsentRow {
  consent_version: string;
  agreed: boolean;
  created_at: string;
  who: string | null;
}

/** 이 조직의 가장 최근 동의 기록 */
export async function latestConsent(q: Queryable, orgId: string): Promise<ConsentRow | null> {
  const r = await q.query<ConsentRow>(
    `select c.consent_version, c.agreed, c.created_at, p.name who from fcd.wing_consents c left join fcd.profiles p on p.id = c.agreed_by
      where c.org_id = $1 order by c.created_at desc limit 1`,
    [orgId],
  );
  return r[0] ?? null;
}

/** 현재 판 동의가 있는가(최근 기록이 동의 · 판이 같다) */
export function consentOk(c: ConsentRow | null): boolean {
  return !!c && c.agreed && c.consent_version === SALES_CONSENT.version;
}

export interface SyncRunRow {
  source: 'mock' | 'file' | 'api';
  status: 'ok' | 'blocked' | 'failed' | 'unsupported';
  counts: Record<string, number> | null;
  detail: Record<string, unknown> | null;
  created_at: string;
  who: string | null;
}

export async function syncRuns(q: Queryable, orgId: string, limit = 8): Promise<SyncRunRow[]> {
  return q.query<SyncRunRow>(
    `select r.source, r.status, r.counts, r.detail, r.created_at, p.name who from fcd.sales_sync_runs r left join fcd.profiles p on p.id = r.created_by
      where r.org_id = $1 order by r.created_at desc limit $2`,
    [orgId, limit],
  );
}

/** 판매 분석을 여는가 — 순수 판정(시험용으로 드러낸다) */
export function decideAccess(o: { hasKey: boolean; isDemo: boolean; hasMockSync: boolean }): SalesAccess {
  if (o.hasKey) return 'live';
  if (o.isDemo && o.hasMockSync) return 'example';
  return 'none';
}

export async function salesAccess(q: Queryable, org: { id: string; is_demo: boolean }): Promise<{ access: SalesAccess; conn: WingConnectionRow | null }> {
  const conn = await currentConnection(q, org.id);
  const mock = org.is_demo ? (await q.query<{ n: number }>(`select count(*)::int n from fcd.sales_sync_runs where org_id = $1 and source = 'mock' and status = 'ok'`, [org.id]))[0].n > 0 : false;
  return { access: decideAccess({ hasKey: !!conn?.has_key, isDemo: org.is_demo, hasMockSync: mock }), conn };
}

export async function loadDataset(q: Queryable, orgId: string, since: string): Promise<SalesDataset> {
  const [products, orders, inventory, returns] = await Promise.all([
    q.query<{ external_id: string; name: string; option_name: string | null; list_price: number | null; sku_id: string | null }>(
      `select external_id, name, option_name, list_price, sku_id from fcd.v_sales_products_current where org_id = $1 order by external_id`,
      [orgId],
    ),
    q.query<{ external_id: string; product_ext: string; ordered_on: string; units: number; amount: string | number; order_count: number; cancelled: boolean }>(
      `select external_id, product_ext, ordered_on::text ordered_on, units, amount, order_count, cancelled from fcd.v_sales_orders_current where org_id = $1 and ordered_on >= $2::date`,
      [orgId, since],
    ),
    q.query<{ product_ext: string; snap_on: string; on_hand: number; inbound_units: number | null }>(
      `select product_ext, snap_on::text snap_on, on_hand, inbound_units from fcd.v_sales_inventory_daily where org_id = $1 and snap_on >= $2::date`,
      [orgId, since],
    ),
    q.query<{ external_id: string; product_ext: string; returned_on: string; units: number; reason: string; reason_raw: string | null }>(
      `select external_id, product_ext, returned_on::text returned_on, units, reason, reason_raw from fcd.v_sales_returns_current where org_id = $1 and returned_on >= $2::date`,
      [orgId, since],
    ),
  ]);
  return {
    products: products.map((p) => ({ ext: p.external_id, name: p.name, optionName: p.option_name, listPrice: p.list_price == null ? null : Number(p.list_price), skuId: p.sku_id })),
    orders: orders.map((o) => ({ ext: o.external_id, productExt: o.product_ext, on: o.ordered_on, units: Number(o.units), amount: Number(o.amount), orders: Number(o.order_count), cancelled: o.cancelled })),
    inventory: inventory.map((s) => ({ productExt: s.product_ext, on: s.snap_on, onHand: Number(s.on_hand), inbound: s.inbound_units == null ? null : Number(s.inbound_units) })),
    returns: returns.map((r) => ({ ext: r.external_id, productExt: r.product_ext, on: r.returned_on, units: Number(r.units), reason: r.reason as SalesDataset['returns'][number]['reason'], reasonRaw: r.reason_raw })),
  };
}

interface SkuFact {
  id: string;
  name: string;
  hs_category: string;
  units: number;
  cartons: number;
  kg: number;
  cbm: number;
  goods_value: number;
  goods_currency: Currency;
  traits: string[];
}

interface ShipFact {
  sku_id: string;
  shipment_id: string;
  shipment_no: string;
  units: number;
  origin_hub: string;
  port: string;
  mode: string;
  goods_value: number;
  goods_currency: Currency;
  hs_category: string;
  logistics: number;
  amounts: Record<string, number | null>;
  stage: number;
  delivered_on: string | null;
  partner: string;
}

async function skuFacts(q: Queryable, orgId: string, skuIds: string[]) {
  if (!skuIds.length) return { skus: [] as SkuFact[], ships: [] as ShipFact[] };
  const skus = (
    await q.query<SkuFact>(`select id, name, hs_category, units, cartons, kg, cbm, goods_value, goods_currency, traits from fcd.skus where org_id = $1 and id = any($2::uuid[])`, [orgId, skuIds])
  ).map((s) => ({ ...s, units: Number(s.units), cartons: Number(s.cartons), kg: Number(s.kg), cbm: Number(s.cbm), goods_value: Number(s.goods_value) }));
  const ships = (
    await q.query<ShipFact>(
      `select r.sku_id, s.id shipment_id, s.shipment_no, s.units, s.origin_hub, s.port, s.mode, r.goods_value, r.goods_currency, r.hs_category,
              coalesce(i.total, b.total) logistics, b.amounts, s.stage, (s.delivered_at at time zone 'Asia/Seoul')::date::text delivered_on, o.name partner
         from fcd.shipments s
         join fcd.bookings bk on bk.id = s.booking_id
         join fcd.quote_requests r on r.id = bk.request_id
         join fcd.bids b on b.id = bk.bid_id
         join fcd.orgs o on o.id = s.partner_org_id
         left join lateral (select v.total from fcd.v_invoices_current v where v.shipment_id = s.id order by v.issued_on desc, v.created_at desc limit 1) i on true
        where s.shipper_org_id = $1 and r.sku_id = any($2::uuid[])
        order by s.created_at desc`,
      [orgId, skuIds],
    )
  ).map((s) => ({ ...s, units: Number(s.units), goods_value: Number(s.goods_value), logistics: Number(s.logistics), stage: Number(s.stage) }));
  return { skus, ships };
}

function dutyRate(s: AppSettings, cat: string): number {
  return s.dutyRates.find((d) => d.category === cat)?.rate_bp ?? s.dutyRates.find((d) => d.category === 'general')?.rate_bp ?? 0;
}

function actualCost(s: AppSettings, x: ShipFact): ActualShipmentCost {
  const goodsKrw = goodsValueKrw({ units: x.units, cartons: 1, kg: 1, cbm: 1, goodsValue: x.goods_value, goodsCurrency: x.goods_currency }, s.fx);
  const toPort = SEGMENTS_TO_KR_PORT.reduce((a, k) => a + Number(x.amounts?.[k] ?? 0), 0);
  const duty = estimateDutyVat({ goodsKrw, freightToPortKrw: toPort, insuranceBp: s.insuranceBp, dutyRateBp: dutyRate(s, x.hs_category), vatRateBp: s.vatRateBp }).duty;
  return { units: x.units, logistics: x.logistics, goodsKrw, duty };
}

/** 구간 시세로 한 SKU 개당 원가 — 공개 도구와 같은 집계(중간값). 요금표가 없으면 null */
async function marketCost(q: Queryable, s: AppSettings, sku: SkuFact, lane: { hub: string; port: string; mode: string | null }, today: string): Promise<MarketCost | null> {
  const cargo = { units: sku.units, cartons: sku.cartons, kg: sku.kg, cbm: sku.cbm, goodsValue: sku.goods_value, goodsCurrency: sku.goods_currency };
  const r = await compare(q, { hub: lane.hub, port: lane.port, mode: lane.mode, cargo, traits: sku.traits ?? [] }, s, today);
  const ranked = rankOffers(r.offers, { sort: 'recommend', includeRelated: false }).list;
  const offers = ranked.length ? ranked : sortOffers(r.offers, 'recommend');
  if (!offers.length) return null;
  const sum = summarizeArrival(
    offers.map((o) => ({
      total: o.quote.total,
      toPort: o.quote.segments.filter((x) => SEGMENTS_TO_KR_PORT.includes(x.segment)).reduce((a, x) => a + (x.amount ?? 0), 0),
      segments: o.quote.segments.map((x) => ({ segment: x.segment, amount: x.amount })),
    })),
  );
  const goodsKrw = goodsValueKrw(cargo, s.fx);
  const duty = estimateDutyVat({ goodsKrw, freightToPortKrw: sum.toPortMedian, insuranceBp: s.insuranceBp, dutyRateBp: dutyRate(s, sku.hs_category), vatRateBp: s.vatRateBp }).duty;
  const u = Math.max(1, sku.units);
  return { goodsPerUnit: Math.round(goodsKrw / u), logisticsPerUnit: Math.round(sum.median / u), dutyPerUnit: Math.round(duty / u) };
}

async function laneTransit(q: Queryable, lane: { hub: string; port: string; mode: string | null }, today: string): Promise<TransitInfo> {
  const rows = await q.query<{ d: number }>(
    `select transit_days_max d from fcd.v_rate_cards_current
      where origin_hub = $1 and port = $2 and ($3::text is null or mode = $3) and status = 'active' and valid_from <= $4::date and valid_to >= $4::date`,
    [lane.hub, lane.port, lane.mode, today],
  );
  const label = `${lane.hub}→${lane.port}${lane.mode ? ` ${lane.mode}` : ''}`;
  const m = median(rows.map((r) => Number(r.d)));
  if (m != null) return { days: m, basis: 'market', lane: label };
  const modes = await q.query<{ d: number }>(`select days_max d from fcd.modes where ($1::text is null or code = $1)`, [lane.mode]);
  return { days: median(modes.map((r) => Number(r.d))) ?? 0, basis: 'mode', lane: label };
}

export interface SalesView {
  access: SalesAccess;
  /** 보이는 자료가 예시인가(데모 흉내·미리보기) */
  example: boolean;
  /** 미리보기(저장 안 함 — 연결이 없거나, 연결했지만 가져온 기록이 없음) */
  preview: boolean;
  conn: WingConnectionRow | null;
  enabled: boolean;
  rules: SalesRules;
  fee: CoupangFeeBasis;
  analysis: SalesAnalysis;
  runs: SyncRunRow[];
  today: string;
  periodDays: number;
  /** 상품 → 우리 SKU 화물 조건(「지금 견적 요청」) */
  skuCargo: Record<string, { id: string; units: number; cartons: number; kg: number; cbm: number; goods: number; cur: Currency; hub: string; port: string; mode: string | null; traits: string[] }>;
  settlementsVerified: number;
  /** 키 만료 D-N·만료 — 알림함에도 한 번 남긴다(발송 없음) */
  expiry: ExpiryAlert | null;
}

const PERIODS = [7, 30, 90] as const;
export function parsePeriod(v: string | undefined): number {
  const n = Number(v);
  return (PERIODS as readonly number[]).includes(n) ? n : 30;
}

/** 판매 분석 한 번(요청마다 한 번 — 화면 안 여러 칸이 같이 쓴다) */
export const loadSalesView = cache(async (v: Viewer, periodDays: number, enabled: boolean): Promise<SalesView> => {
  const today = todayKst();
  const view = await asUser(v, async (q) => {
    const s = await loadSettings(q);
    const wset = await wingSettings(q);
    const rules = await salesRules(q);
    const feeRow = await q.query<{ value: unknown }>(`select value from fcd.v_current_settings where key = 'tools.coupang_fee_basis'`);
    const fee = parseFeeBasis(feeRow[0]?.value, { saleFeeBp: s.saleFeeBp, fulfillmentPerUnit: s.fulfillmentPerUnit });
    const { access, conn } = await salesAccess(q, v.org);
    const since = new Date(Date.parse(`${today}T00:00:00Z`) - 200 * 86_400_000).toISOString().slice(0, 10);
    let ds: SalesDataset = access === 'none' ? { products: [], orders: [], inventory: [], returns: [] } : await loadDataset(q, v.org.id, since);
    const preview = ds.orders.length === 0;
    const arrival: Record<string, ArrivalPerUnit> = {};
    const transit: Record<string, TransitInfo> = {};
    const delivered: DeliveredShipment[] = [];
    const skuCargo: SalesView['skuCargo'] = {};
    if (preview) {
      // 저장하지 않는 예시 — 원가도 예시 값, 운송일은 기준 구간의 구간 시세
      ds = mockSales({ seed: PREVIEW_SALES_SEED, today, products: PREVIEW_PRODUCTS });
      const tr = await laneTransit(q, { hub: STANDARD_ROUTE.hub, port: STANDARD_ROUTE.port, mode: null }, today);
      ds.products.forEach((p, i) => {
        const e = PREVIEW_PRODUCTS[i].example;
        arrival[p.ext] = { basis: 'market', samples: 0, ...e, perUnit: e.goodsPerUnit + e.logisticsPerUnit + e.dutyPerUnit };
        transit[p.ext] = tr;
      });
    } else {
      const skuIds = [...new Set(ds.products.map((p) => p.skuId).filter((x): x is string => !!x))];
      const { skus, ships } = await skuFacts(q, v.org.id, skuIds);
      const skuBy = new Map(skus.map((x) => [x.id, x]));
      const laneCache = new Map<string, TransitInfo>();
      for (const p of ds.products) {
        const sku = p.skuId ? skuBy.get(p.skuId) : undefined;
        const mine = p.skuId ? ships.filter((x) => x.sku_id === p.skuId) : [];
        const last = mine[0];
        const lane = last ? { hub: last.origin_hub, port: last.port, mode: last.mode } : { hub: STANDARD_ROUTE.hub, port: STANDARD_ROUTE.port, mode: null };
        const key = `${lane.hub}|${lane.port}|${lane.mode ?? ''}`;
        if (!laneCache.has(key)) laneCache.set(key, await laneTransit(q, lane, today));
        transit[p.ext] = laneCache.get(key)!;
        const actual = mine.map((x) => actualCost(s, x));
        const market = actual.length || !sku ? null : await marketCost(q, s, sku, lane, today);
        arrival[p.ext] = arrivalPerUnit(actual, market, rules.actualShipments);
        for (const x of mine) if (x.stage >= 9 && x.delivered_on) delivered.push({ productExt: p.ext, shipmentId: x.shipment_id, shipmentNo: x.shipment_no, deliveredOn: x.delivered_on, units: x.units, partner: x.partner });
        if (sku) skuCargo[p.ext] = { id: sku.id, units: sku.units, cartons: sku.cartons, kg: sku.kg, cbm: sku.cbm, goods: sku.goods_value, cur: sku.goods_currency, hub: lane.hub, port: lane.port, mode: lane.mode, traits: sku.traits ?? [] };
      }
    }
    const analysis = analyzeSales(ds, { today, periodDays, rules, fee, vatRateBp: s.vatRateBp, arrival, transit, delivered });
    const runs = access === 'none' ? [] : await syncRuns(q, v.org.id);
    const settlementsVerified = access === 'none' ? 0 : (await q.query<{ n: number }>(`select count(*)::int n from fcd.sales_settlements where org_id = $1 and verified`, [v.org.id]))[0].n;
    return { access, example: access === 'example' || preview, preview, conn, enabled, rules, fee, analysis, runs, today, periodDays, skuCargo, settlementsVerified, wset };
  });
  const { wset, ...rest } = view;
  const expiry = await ensureKeyExpiryAlert(v.org.id, view.conn, wset, today);
  return { ...rest, expiry };
});
