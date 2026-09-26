import 'server-only';
/**
 * 원스톱 대행형 구역(v2 4차 onestop) — 설정·주문·단계 읽기와 서버 견적.
 * 가격 하나·9구간 차이·개당 도착원가는 money/onestop 순수 함수. 9구간 합계는 소싱 시뮬과 같은 규칙으로 모은다
 * (같은 화물의 구간 시세 중간값 — 업체가 적으면 플랫폼 참고치). 업체별 금액은 싣지 않는다.
 */
import type { Queryable } from '../db';
import { env } from '../env';
import type { Currency, OnestopInspection } from '../money';
import { buildArrivalResponse } from '../tools-arrival';
import { effectiveStage, readOnestopConfig, type OnestopConfig, type OnestopEventStage, type OnestopStage } from '../onestop/settings';
import { buildOnestopSnapshot, orderCargo, referenceNine, type OnestopOrderInput, type OnestopQuoteSnapshot, type SnapshotResult } from '../onestop/snapshot';
import type { Cargo } from '../money';
import { compare } from './compare';
import { loadSettings, type AppSettings } from './settings';
import { loadArrivalRule } from './tools';

export type { OnestopOrderInput, OnestopQuoteSnapshot } from '../onestop/snapshot';

export async function loadOnestopConfig(q: Queryable): Promise<OnestopConfig> {
  const rows = await q.query<{ key: string; value: unknown }>(`select key, value from fcd.v_current_settings where key like 'onestop.%'`);
  return readOnestopConfig(new Map(rows.map((r) => [r.key, r.value])));
}

// ─── 견적 ─────────────────────────────────────────────────────────────

/** 같은 화물의 9구간 합계 — 구간 시세 중간값(업체가 적으면 플랫폼 참고치)과 도착항까지 운임 */
export async function nineBaseline(q: Queryable, s: AppSettings, i: { hub: string; port: string; mode: string; fc: string; cargo: Cargo }, today: string) {
  const reference = referenceNine(s.referenceLines, i.cargo, s.quoteParams);
  const cmp = await compare(q, { hub: i.hub, port: i.port, mode: i.mode, cargo: i.cargo, traits: [], fc: i.fc }, s, today);
  const rule = await loadArrivalRule(q);
  const arr = buildArrivalResponse(cmp, {
    okOrg: (p) => (p.status === 'official' || p.status === 'pending_verification') && (env.demoMode || !p.is_demo),
    units: i.cargo.units,
    rule,
    reference,
  });
  const useRef = arr.count === 0;
  return {
    basis: (useRef ? 'reference' : arr.basis) as 'market' | 'reference',
    offers: arr.count,
    total: useRef ? reference.total : arr.median,
    toPort: useRef ? reference.toPort : arr.toPortMedian,
  };
}

/** 주문 하나의 가격 하나 — 보낸 금액을 믿지 않고 서버가 지금 요금표·구간 시세로 다시 셈한다 */
export async function serverQuote(q: Queryable, i: OnestopOrderInput, today: string, pre?: { s: AppSettings; config: OnestopConfig }): Promise<SnapshotResult> {
  const s = pre?.s ?? (await loadSettings(q));
  const config = pre?.config ?? (await loadOnestopConfig(q));
  const lane = config.tariff.lanes.find((l) => l.hub === i.hub && l.mode === i.mode);
  if (!lane) return { ok: false, error: '이 허브·방식은 원스톱 요금표에 없습니다 — 요금표에서 고를 수 있는 길을 골라 주세요' };
  const nine = await nineBaseline(q, s, { hub: i.hub, port: lane.port, mode: i.mode, fc: i.fc, cargo: orderCargo(i) }, today);
  const duty = s.dutyRates.find((d) => d.category === i.category) ?? s.dutyRates.find((d) => d.category === 'general');
  return buildOnestopSnapshot({ by: 'server', tariff: config.tariff, fx: s.fx, input: i, nine, dutyRateBp: duty?.rate_bp ?? 0, vatRateBp: s.vatRateBp, insuranceBp: s.insuranceBp });
}

// ─── 주문 읽기 ──────────────────────────────────────────────────────────

export interface OrderRow {
  id: string;
  root: string;
  order_no: string;
  org_id: string;
  org_name?: string;
  is_demo?: boolean;
  version: number;
  product_name: string;
  category: string;
  source_url: string | null;
  units: number;
  cartons: number;
  cbm: number;
  kg: number;
  unit_price: number | null;
  currency: Currency;
  hub: string;
  mode: 'LCL' | 'FERRY';
  port: string;
  fc_code: string;
  purchase: boolean;
  barcode: boolean;
  inspection: OnestopInspection;
  quote: OnestopQuoteSnapshot;
  total_krw: number;
  shipment_id: string | null;
  measured: boolean;
  preview: boolean;
  note: string | null;
  change_note: string | null;
  created_at: string;
  received_at: string;
  stage: OnestopStage | 'cancelled';
  stage_at: string | null;
  /** 이은 선적 */
  shipment_no: string | null;
  shipment_stage: number | null;
  /** 보이는 단계(이은 선적이 더 앞서면 그쪽) */
  shown: OnestopStage | 'cancelled';
  shownFromShipment: boolean;
}

const COLS = `o.id, o.root, o.order_no, o.org_id, o.version, o.product_name, o.category, o.source_url, o.units, o.cartons, o.cbm::float8 cbm, o.kg::float8 kg,
  o.unit_price::float8 unit_price, o.currency, o.hub, o.mode, o.port, o.fc_code, o.purchase, o.barcode, o.inspection, o.quote, o.total_krw, o.shipment_id,
  o.measured, o.preview, o.note, o.change_note, o.created_at, o.received_at, o.stage, o.stage_at,
  s.shipment_no, s.stage::int shipment_stage`;

type Raw = Omit<OrderRow, 'shown' | 'shownFromShipment'>;
const finish = (r: Raw): OrderRow => {
  const e = effectiveStage(r.stage, r.shipment_stage);
  return { ...r, shown: e.stage, shownFromShipment: e.fromShipment };
};

export async function myOrders(q: Queryable, orgId: string, limit = 50): Promise<OrderRow[]> {
  const rows = await q.query<Raw>(
    `select ${COLS} from fcd.v_onestop_orders_current o left join fcd.shipments s on s.id = o.shipment_id
      where o.org_id = $1 order by o.received_at desc limit $2`,
    [orgId, limit],
  );
  return rows.map(finish);
}

export async function orderByRoot(q: Queryable, root: string): Promise<(OrderRow & { org_name: string; is_demo: boolean }) | null> {
  const rows = await q.query<Raw & { org_name: string; is_demo: boolean }>(
    `select ${COLS}, g.name org_name, g.is_demo from fcd.v_onestop_orders_current o join fcd.orgs g on g.id = o.org_id
       left join fcd.shipments s on s.id = o.shipment_id where o.root = $1`,
    [root],
  );
  return rows[0] ? (finish(rows[0]) as OrderRow & { org_name: string; is_demo: boolean }) : null;
}

/**
 * 운영 대기열 — 모든 조직(운영자만 RLS 로 다 보인다). 끝난 것(FC 입고·취소)은 뒤로.
 * includeDemo 가 거짓이면 예시(데모) 조직 주문을 뺀다 — 운영은 RLS 에서 org_visible 을 건너뛰므로 여기서 거른다.
 */
export async function orderQueue(q: Queryable, includeDemo = env.demoMode): Promise<QueueRow[]> {
  const rows = await q.query<Raw & { org_name: string; is_demo: boolean; hub_name: string | null; fc_at: string | null }>(
    `select ${COLS}, g.name org_name, g.is_demo, h.name_ko hub_name,
            coalesce((select min(e.occurred_at) from fcd.onestop_order_events e where e.order_id = o.root and e.stage = 'fc_received'),
                     (select min(se.occurred_at) from fcd.shipment_events se where se.shipment_id = o.shipment_id and se.stage = 9)) fc_at
       from fcd.v_onestop_orders_current o join fcd.orgs g on g.id = o.org_id
       left join fcd.shipments s on s.id = o.shipment_id left join fcd.hubs h on h.code = o.hub
      where ($1::boolean or not g.is_demo)
      order by case when o.stage in ('fc_received','cancelled') then 1 else 0 end, fcd.onestop_stage_rank(o.stage), o.received_at
      limit 500`,
    [includeDemo],
  );
  return rows.map((r) => finish(r) as QueueRow);
}

export type QueueRow = OrderRow & { org_name: string; is_demo: boolean; hub_name: string | null; fc_at: string | null };

/**
 * 운영 요약 — 원스톱 쪽 지표(docs/onestop-plan.md 9절). 대기열과 같은 줄(보이는 단계 shown — 이은 선적 반영)로 센다.
 * 걸린 날 = 접수 → FC 입고(원스톱 「FC 입고」 기록, 없으면 이은 선적의 9단계 기록) — 뒤에 남긴 문제 기록은 넣지 않는다.
 */
export function onestopSummary(rows: readonly QueueRow[]) {
  const live = rows.filter((r) => r.shown !== 'cancelled');
  const done = rows.filter((r) => r.shown === 'fc_received');
  const days = done.filter((r) => r.fc_at).map((r) => (Date.parse(r.fc_at!) - Date.parse(r.received_at)) / 86_400_000);
  const diffs = rows.map((r) => r.quote?.nine?.diffBp).filter((x): x is number => typeof x === 'number' && Number.isFinite(x));
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  const r1 = (x: number | null, k: number) => (x == null ? null : Math.round(x * k) / k);
  return {
    orders: rows.length,
    open: rows.length - done.length - (rows.length - live.length),
    done: done.length,
    cancelled: rows.length - live.length,
    avg_cbm: r1(avg(rows.map((r) => r.cbm)), 100),
    min_applied: rows.filter((r) => r.quote?.minApplied).length,
    avg_diff_bp: r1(avg(diffs), 1),
    avg_days: r1(avg(days), 10),
  };
}

/** 운영 요약 — 대기열을 읽어 onestopSummary 로 센다(예시 포함 여부도 대기열과 같게) */
export async function onestopMetrics(q: Queryable, includeDemo = env.demoMode) {
  return onestopSummary(await orderQueue(q, includeDemo));
}

export interface VersionRow {
  id: string;
  version: number;
  cbm: number;
  cartons: number;
  kg: number;
  total_krw: number;
  measured: boolean;
  shipment_no: string | null;
  change_note: string | null;
  created_at: string;
  by_name: string | null;
}

export async function orderVersions(q: Queryable, root: string): Promise<VersionRow[]> {
  return q.query(
    `select o.id, o.version, o.cbm::float8 cbm, o.cartons, o.kg::float8 kg, o.total_krw, o.measured, s.shipment_no, o.change_note, o.created_at, p.name by_name
       from fcd.onestop_orders o left join fcd.shipments s on s.id = o.shipment_id left join fcd.profiles p on p.id = o.created_by
      where coalesce(o.root_id, o.id) = $1 order by o.version desc`,
    [root],
  );
}

export interface EventRow {
  id: string;
  stage: OnestopEventStage;
  note: string | null;
  occurred_at: string;
  created_at: string;
  actor_name: string | null;
}

export async function orderEvents(q: Queryable, root: string): Promise<EventRow[]> {
  return q.query(
    `select e.id, e.stage, e.note, e.occurred_at, e.created_at, p.name actor_name
       from fcd.onestop_order_events e left join fcd.profiles p on p.id = e.actor_id
      where e.order_id = $1 order by e.occurred_at, e.created_at`,
    [root],
  );
}

/** 운영이 이을 수 있는 그 화주의 선적(최근 것부터) */
export async function shipmentsForOrg(q: Queryable, orgId: string) {
  return q.query<{ id: string; shipment_no: string; stage: number; hub: string; eta_fc: string | null }>(
    `select id, shipment_no, stage::int stage, origin_hub hub, eta_fc::text eta_fc from fcd.shipments where shipper_org_id = $1 order by created_at desc limit 30`,
    [orgId],
  );
}

/** 주문 화면에 적을 이름(허브·FC·분류) */
export async function orderNames(q: Queryable, o: Pick<OrderRow, 'hub' | 'fc_code' | 'category'>) {
  const r = await q.query<{ hub: string | null; fc: string | null; cat: string | null }>(
    `select (select name_ko from fcd.hubs where code = $1) hub, (select name from fcd.fc_centers where code = $2) fc,
            (select name_ko from fcd.v_current_duty_rates where category = $3 limit 1) cat`,
    [o.hub, o.fc_code, o.category],
  );
  return { hubName: r[0]?.hub ?? o.hub, fcName: r[0]?.fc ?? o.fc_code, categoryName: r[0]?.cat ?? o.category };
}

/** 맡기기 부품(EntrustForm)에 넘길 것 — 요금표·9구간 참고치·허브·FC·분류. 공개 화면도 같은 것(업체 금액 없음) */
export async function entrustProps(q: Queryable) {
  const s = await loadSettings(q);
  const config = await loadOnestopConfig(q);
  const hubs = await q.query<{ code: string; name_ko: string }>(`select code, name_ko from fcd.hubs order by ord`);
  const fcs = await q.query<{ code: string; name: string }>(`select code, name from fcd.fc_centers where kind = 'coupang_fc' order by name`);
  return {
    on: config.on,
    tariff: config.tariff,
    reference: { lines: s.referenceLines, params: s.quoteParams, vatRateBp: s.vatRateBp, insuranceBp: s.insuranceBp },
    hubs,
    fcs,
    categories: s.dutyRates,
  };
}
