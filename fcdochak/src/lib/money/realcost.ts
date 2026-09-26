/**
 * 실질 비용 = 견적가 + 예상 지연 비용 — 순수 함수(v2 6차 scorecard, docs/scorecard-plan.md 6절).
 *
 *   예상 지연일(평소)    = max(0, 그 업체 p50 − 비교 기준)
 *   예상 지연일(늦을 때)  = max(0, 그 업체 p90 − 비교 기준)
 *   비교 기준           = 후보 중 가장 빠른 p50(없으면 같은 항구·방식 전체 중앙값)
 *   지연 비용           = 하루 판매량 × 개당 마진 × 예상 지연일 (원 단위 사사오입, 마진 0 이하·판매량 0 이하면 0)
 *
 * 곱셈은 BigInt(판매량·지연일 소수 둘째 자리까지)로 하고 마지막에 한 번 반올림한다.
 * 판매량·마진을 모르면 금액을 셈하지 않는다(지연 일수만) — 금액을 지어내지 않는다.
 */
import { divRoundHalfUp, toNumber, toScaled } from './decimal';

export interface DelayStat {
  p50: number;
  p90: number;
}

/** 비교 기준(영업일). fastest = 후보 p50 중 가장 작은 값, 후보가 없으면 전체 중앙값. 둘 다 없으면 null */
export function delayBaseline(candidates: readonly (DelayStat | null | undefined)[], overallP50: number | null): { days: number; basis: 'fastest' | 'overall' } | null {
  const ps = candidates.filter((c): c is DelayStat => !!c && Number.isFinite(c.p50)).map((c) => c.p50);
  if (ps.length) return { days: Math.min(...ps), basis: 'fastest' };
  if (overallP50 != null && Number.isFinite(overallP50)) return { days: overallP50, basis: 'overall' };
  return null;
}

const r2 = (v: number) => Math.round(v * 100) / 100;

/** 예상 지연일(영업일, 소수 둘째 자리) — 평소(p50) · 늦을 때(p90) */
export function expectedDelay(s: DelayStat, baselineDays: number): { usual: number; late: number } {
  if (!(s.p90 >= s.p50)) throw new RangeError('늦을 때(p90)는 평소(p50)보다 작을 수 없습니다');
  return { usual: r2(Math.max(0, s.p50 - baselineDays)), late: r2(Math.max(0, s.p90 - baselineDays)) };
}

/** 지연 비용(원) — 하루 판매량(개, 소수 가능) × 개당 마진(원) × 지연일 */
export function delayCost(perDay: number, marginPerUnit: number, delayDays: number): number {
  if (![perDay, marginPerUnit, delayDays].every(Number.isFinite)) throw new RangeError('숫자가 아닌 값');
  if (perDay <= 0 || marginPerUnit <= 0 || delayDays <= 0) return 0;
  const v = toScaled(perDay, 2) * BigInt(Math.round(marginPerUnit)) * toScaled(delayDays, 2);
  return toNumber(divRoundHalfUp(v, 10_000n));
}

export interface RealCostInput {
  /** 견적가(참고치 포함 합계, 원) */
  quote: number;
  stat: DelayStat | null;
  baselineDays: number | null;
  /** 하루 판매량·개당 마진 — 둘 다 있어야 금액을 셈한다 */
  perDay: number | null;
  marginPerUnit: number | null;
}

export interface RealCostCase {
  delayDays: number;
  /** 지연 비용 — 판매량·마진을 모르면 null */
  cost: number | null;
  total: number | null;
}

export interface RealCostResult {
  /** 실측이 없거나 비교 기준이 없으면 null */
  usual: RealCostCase | null;
  late: RealCostCase | null;
  priced: boolean;
}

export function realCost(i: RealCostInput): RealCostResult {
  if (!Number.isFinite(i.quote) || i.quote < 0) throw new RangeError('견적가는 0 이상');
  if (!i.stat || i.baselineDays == null) return { usual: null, late: null, priced: false };
  const d = expectedDelay(i.stat, i.baselineDays);
  const priced = i.perDay != null && i.marginPerUnit != null && Number.isFinite(i.perDay) && Number.isFinite(i.marginPerUnit);
  const one = (days: number): RealCostCase => {
    const cost = priced ? delayCost(i.perDay!, i.marginPerUnit!, days) : null;
    return { delayDays: days, cost, total: cost == null ? null : i.quote + cost };
  };
  return { usual: one(d.usual), late: one(d.late), priced };
}

/**
 * 실질 비용순(평소) — 판매량·마진이 있으면 견적가 + 지연 비용(평소), 없으면 예상 지연일(평소) → 견적가 순.
 * 실측이 없는 후보(usual = null)는 원래 순서대로 뒤에 둔다(모르는 지연을 0 으로 치지 않는다). 같으면 늦을 때 → 원래 순서.
 */
export function sortByRealCost<T>(items: readonly T[], of: (t: T) => { quote: number; real: RealCostResult | null }): T[] {
  const idx = new Map(items.map((t, i) => [t, i]));
  const key = (t: T): [number, number, number] | null => {
    const { quote, real } = of(t);
    if (!real?.usual) return null;
    if (real.priced && real.usual.total != null) return [real.usual.total, real.late?.total ?? real.usual.total, 0];
    return [real.usual.delayDays, real.late?.delayDays ?? real.usual.delayDays, quote];
  };
  return [...items].sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    if (!ka && !kb) return idx.get(a)! - idx.get(b)!;
    if (!ka) return 1;
    if (!kb) return -1;
    return ka[0] - kb[0] || ka[1] - kb[1] || ka[2] - kb[2] || idx.get(a)! - idx.get(b)!;
  });
}
