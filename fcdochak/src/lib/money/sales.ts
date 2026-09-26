/**
 * 판매 분석 계산 — 순수 함수(v2 3차 sales · docs/sales-plan.md 5절). 기준치는 설정 sales.rules 에서 넘겨받는다.
 *
 * 날짜는 모두 'YYYY-MM-DD'(KST 날짜) 문자열. 돈은 원 단위 정수. 비율은 bp(1/10000).
 * 판매 속도는 「하루 평균 판매량」이라 소수 둘째 자리까지(돈이 아니다).
 */
import { BP, divRoundHalfUp, toNumber } from './decimal';
import { unitPnl, type PnlResult } from './pnl';

const DAY = 86_400_000;
const YMD = /^\d{4}-\d{2}-\d{2}$/;

function t(ymd: string): number {
  if (!YMD.test(ymd)) throw new RangeError(`날짜 모양이 아닙니다: ${ymd}`);
  const v = Date.parse(`${ymd}T00:00:00Z`);
  if (Number.isNaN(v)) throw new RangeError(`날짜가 아닙니다: ${ymd}`);
  return v;
}
export function addDays(ymd: string, n: number): string {
  return new Date(t(ymd) + n * DAY).toISOString().slice(0, 10);
}
/** b − a (일) */
export function daysBetween(a: string, b: string): number {
  return Math.round((t(b) - t(a)) / DAY);
}

// ─── 합계 · 지난 기간 대비 ─────────────────────────────────────────

export interface OrderLike {
  on: string;
  units: number;
  amount: number;
  orders?: number;
  cancelled?: boolean;
}

export interface Range {
  from: string;
  to: string;
}

export interface Totals {
  units: number;
  amount: number;
  orders: number;
}

/** 기간 [from, to] 안의 취소 안 된 주문 합계 */
export function sumRange(rows: readonly OrderLike[], r: Range): Totals {
  const out: Totals = { units: 0, amount: 0, orders: 0 };
  for (const x of rows) {
    if (x.cancelled || x.on < r.from || x.on > r.to) continue;
    out.units += x.units;
    out.amount += x.amount;
    out.orders += x.orders ?? 1;
  }
  return out;
}

/** 끝나는 날(end, 포함)부터 거꾸로 days 일 · 그 바로 앞 같은 길이 */
export function periodWindows(end: string, days: number): { cur: Range; prev: Range } {
  if (!Number.isInteger(days) || days < 1) throw new RangeError('기간은 1일 이상');
  const curFrom = addDays(end, -(days - 1));
  return { cur: { from: curFrom, to: end }, prev: { from: addDays(curFrom, -days), to: addDays(curFrom, -1) } };
}

/** 지난 기간 대비 변화(bp). 지난 기간이 0 이면 null(「비교 없음」) */
export function changeBp(cur: number, prev: number): number | null {
  if (prev === 0) return null;
  return toNumber(divRoundHalfUp(BigInt(Math.round(cur - prev)) * BP, BigInt(Math.abs(Math.round(prev)))));
}

/** 일별 합(날짜 빠짐 없이 from~to) */
export function dailySeries(rows: readonly OrderLike[], r: Range): { d: string; units: number; amount: number }[] {
  const m = new Map<string, { units: number; amount: number }>();
  for (const x of rows) {
    if (x.cancelled || x.on < r.from || x.on > r.to) continue;
    const v = m.get(x.on) ?? { units: 0, amount: 0 };
    v.units += x.units;
    v.amount += x.amount;
    m.set(x.on, v);
  }
  const out: { d: string; units: number; amount: number }[] = [];
  for (let d = r.from; d <= r.to; d = addDays(d, 1)) out.push({ d, ...(m.get(d) ?? { units: 0, amount: 0 }) });
  return out;
}

/** 주(월요일 시작)·월 묶음 — 일별 합을 받아 묶는다 */
export function bucketSeries(daily: readonly { d: string; units: number; amount: number }[], by: 'week' | 'month'): { d: string; units: number; amount: number; days: number }[] {
  const key = (d: string) => {
    if (by === 'month') return d.slice(0, 7);
    const dow = (new Date(t(d)).getUTCDay() + 6) % 7; // 월 = 0
    return addDays(d, -dow);
  };
  const out: { d: string; units: number; amount: number; days: number }[] = [];
  for (const x of daily) {
    const k = key(x.d);
    const last = out[out.length - 1];
    if (last && last.d === k) {
      last.units += x.units;
      last.amount += x.amount;
      last.days++;
    } else out.push({ d: k, units: x.units, amount: x.amount, days: 1 });
  }
  return out;
}

// ─── ABC ────────────────────────────────────────────────────────

export type AbcClass = 'A' | 'B' | 'C';

/**
 * 매출 큰 순으로 누적 비율을 셈한다. 앞 상품들까지의 누적이 aBp 보다 작으면(= 이 상품이 경계를 넘기는 상품이어도) A,
 * bBp 보다 작으면 B, 나머지 C. 매출 0 은 늘 C. 같은 매출이면 id 순(결정적).
 */
export function abcClassify<T extends { id: string; revenue: number }>(items: readonly T[], aBp: number, bBp: number): Map<string, { cls: AbcClass; shareBp: number; cumBp: number; rank: number }> {
  if (aBp > bBp) throw new RangeError('A 경계는 B 경계보다 작거나 같아야 합니다');
  const total = items.reduce((a, x) => a + Math.max(0, x.revenue), 0);
  const sorted = [...items].sort((a, b) => b.revenue - a.revenue || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const out = new Map<string, { cls: AbcClass; shareBp: number; cumBp: number; rank: number }>();
  let before = 0;
  sorted.forEach((x, i) => {
    const rev = Math.max(0, x.revenue);
    const beforeBp = total > 0 ? toNumber(divRoundHalfUp(BigInt(before) * BP, BigInt(total))) : 0;
    before += rev;
    const cumBp = total > 0 ? toNumber(divRoundHalfUp(BigInt(before) * BP, BigInt(total))) : 0;
    const shareBp = total > 0 ? toNumber(divRoundHalfUp(BigInt(rev) * BP, BigInt(total))) : 0;
    const cls: AbcClass = rev <= 0 ? 'C' : beforeBp < aBp ? 'A' : beforeBp < bBp ? 'B' : 'C';
    out.set(x.id, { cls, shareBp, cumBp, rank: i + 1 });
  });
  return out;
}

// ─── 판매 속도 · 재고 일수 · 품절 · 재입고 ──────────────────────────────

/** 최근 window 일(end 포함) 하루 평균 판매량 — 소수 둘째 자리. 판매 기록이 없던 날(품절 포함)도 0 으로 센다(보수적) */
export function velocity(rows: readonly OrderLike[], end: string, window: number): number {
  const { cur } = periodWindows(end, window);
  const u = sumRange(rows, cur).units;
  return Math.round((u * 100) / window) / 100;
}

/** 재고 일수 = 재고 ÷ 하루 판매량(내림). 판매가 없으면 null(「팔리지 않음」) */
export function daysOfStock(onHand: number, perDay: number): number | null {
  if (!(perDay > 0)) return null;
  if (onHand <= 0) return 0;
  return Math.floor(onHand / perDay);
}

export function stockoutOn(asOf: string, dos: number | null): string | null {
  return dos == null ? null : addDays(asOf, dos);
}

/** 재입고 권장일 = 품절 예상일 − (운송일 + 준비일) */
export function reorderOn(stockout: string | null, transitDays: number, prepDays: number): string | null {
  if (!stockout) return null;
  if (transitDays < 0 || prepDays < 0) throw new RangeError('운송일·준비일은 0 이상');
  return addDays(stockout, -(transitDays + prepDays));
}

export type ReorderState = 'late' | 'soon' | 'ok' | 'none';

/** late = 권장일이 오늘보다 앞 · soon = 오늘부터 lowDays 안 · ok · none = 판매 없음 */
export function reorderState(reorder: string | null, today: string, lowDays: number): ReorderState {
  if (!reorder) return 'none';
  const d = daysBetween(today, reorder);
  if (d < 0) return 'late';
  return d <= lowDays ? 'soon' : 'ok';
}

/**
 * 권장 수량 = 하루 판매량 × (운송+준비 동안 + 덮을 일수) − 지금 재고, roundTo 단위로 올림. 0 이하면 0.
 */
export function suggestUnits(perDay: number, leadDays: number, coverDays: number, onHand: number, roundTo: number): number {
  if (!(perDay > 0)) return 0;
  const need = Math.ceil(perDay * (leadDays + coverDays)) - Math.max(0, onHand);
  if (need <= 0) return 0;
  const r = Math.max(1, Math.round(roundTo));
  return Math.ceil(need / r) * r;
}

// ─── 개당 도착원가 · 마진 ──────────────────────────────────────────

export interface ActualShipmentCost {
  units: number;
  /** 9구간 합계(청구 현재 판, 없으면 응찰 합계) */
  logistics: number;
  goodsKrw: number;
  /** 관세 추정 */
  duty: number;
}

export interface MarketCost {
  logisticsPerUnit: number;
  goodsPerUnit: number;
  dutyPerUnit: number;
}

export interface ArrivalPerUnit {
  basis: 'actual' | 'market' | 'none';
  samples: number;
  goodsPerUnit: number;
  logisticsPerUnit: number;
  dutyPerUnit: number;
  /** 상품 + 물류 + 관세 */
  perUnit: number;
}

/** 실제 선적(최근 limit 건, 수량 가중)이 있으면 그것, 없으면 구간 시세, 둘 다 없으면 none */
export function arrivalPerUnit(actual: readonly ActualShipmentCost[], market: MarketCost | null, limit: number): ArrivalPerUnit {
  const use = actual.filter((a) => a.units > 0).slice(0, Math.max(1, limit));
  if (use.length) {
    const u = use.reduce((a, x) => a + x.units, 0);
    const per = (k: keyof Omit<ActualShipmentCost, 'units'>) => Math.round(use.reduce((a, x) => a + x[k], 0) / u);
    const goodsPerUnit = per('goodsKrw');
    const logisticsPerUnit = per('logistics');
    const dutyPerUnit = per('duty');
    return { basis: 'actual', samples: use.length, goodsPerUnit, logisticsPerUnit, dutyPerUnit, perUnit: goodsPerUnit + logisticsPerUnit + dutyPerUnit };
  }
  if (market) {
    const { goodsPerUnit, logisticsPerUnit, dutyPerUnit } = market;
    return { basis: 'market', samples: 0, goodsPerUnit, logisticsPerUnit, dutyPerUnit, perUnit: goodsPerUnit + logisticsPerUnit + dutyPerUnit };
  }
  return { basis: 'none', samples: 0, goodsPerUnit: 0, logisticsPerUnit: 0, dutyPerUnit: 0, perUnit: 0 };
}

export interface FeeLike {
  saleFeeBp: number;
  adBp: number;
  rgInboundPerUnit: number;
  rgShippingPerUnit: number;
}

/** 평균 실판매가(부가세 포함) = 매출 ÷ 판매량(반올림). 판매 0 이면 null */
export function avgPrice(amount: number, units: number): number | null {
  return units > 0 ? Math.round(amount / units) : null;
}

/**
 * SKU 개당 이익 — 판매손익 계산기와 같은 식(unitPnl): 부가세 뺀 매출 − (판매 수수료 + 광고비) − (상품 + 물류 + 관세) − 로켓그로스 비용.
 */
export function skuUnitPnl(price: number, a: ArrivalPerUnit, fee: FeeLike, vatRateBp: number): PnlResult {
  return unitPnl({
    price: Math.round(price),
    goodsPerUnit: a.goodsPerUnit,
    logisticsPerUnit: a.logisticsPerUnit,
    dutyPerUnit: a.dutyPerUnit,
    saleFeeBp: Math.round(fee.saleFeeBp + fee.adBp),
    fulfillmentPerUnit: Math.round(fee.rgInboundPerUnit + fee.rgShippingPerUnit),
    vatRateBp,
  });
}

// ─── 반품 · 입고 성과 ─────────────────────────────────────────────

/** 반품률(bp) = 반품 수량 ÷ 판매 수량. 판매 0 이면 null */
export function returnRateBp(returned: number, sold: number): number | null {
  if (sold <= 0) return null;
  return toNumber(divRoundHalfUp(BigInt(Math.max(0, returned)) * BP, BigInt(sold)));
}

/**
 * 입고 반영 일수 — FC 입고일(deliveredOn) 이후, 재고가 전날보다 (units × reflectBp) 이상 늘어난 첫날까지.
 * 전날 스냅숏이 없는 날은 건너뛴다. maxDays 안에 못 찾으면 null.
 */
export function inboundReflectDays(deliveredOn: string, units: number, snaps: readonly { on: string; onHand: number }[], reflectBp: number, maxDays = 30): number | null {
  if (units <= 0) return null;
  const need = Math.ceil((units * reflectBp) / 10_000);
  const by = new Map(snaps.map((s) => [s.on, s.onHand]));
  for (let k = 0; k <= maxDays; k++) {
    const d = addDays(deliveredOn, k);
    const cur = by.get(d);
    const prev = by.get(addDays(d, -1));
    if (cur == null || prev == null) continue;
    if (cur - prev >= need) return k;
  }
  return null;
}

/** 중간값(정수 반올림). 비면 null */
export function median(a: readonly number[]): number | null {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}
