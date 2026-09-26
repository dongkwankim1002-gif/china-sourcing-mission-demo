/**
 * 확정가·보장 — 참고 계산(순수 함수). 실제 계약·결제는 하지 않는다.
 *
 * 확정가 = 기준 총액(같은 조건 요금표 총액의 중간값) + 초과 위험 프리미엄.
 *   초과 위험 = 신뢰수준 분위(경험 분위와 정규 근사 z·표준편차 중 큰 쪽) − 중간값.
 *   표본이 적으면 경험 분위가 꼬리를 덜 잡으므로 정규 근사와 「표본 적음」 최소 프리미엄으로 받친다.
 *   분산이 0 이면 초과 위험은 0 이고 최소 프리미엄만 붙는다.
 *   프리미엄이 상한(기준 대비)을 넘으면 확정가를 내지 않는다(offerable = false).
 *
 * 회송 보장료 = 보장 금액 × 회송 확률(업체 실측과 시장 기본값의 신뢰도 가중) × (1 + 부가율).
 *   신뢰도 = 물량 ÷ (물량 + K) — 물량이 적으면 시장 기본값 쪽으로 당긴다.
 *
 * 요율·기준치는 fcd.settings 의 v2.* 키에서 읽어 넘긴다. 원 단위 계산은 BigInt 로 하고 올림한다.
 */
import { BP, divRoundHalfUp, toNumber } from './decimal';
import type { Segment } from './segments';

export interface FirmPriceRates {
  /** 신뢰수준(bp) — 9000 = 90% */
  confidenceBp: number;
  /** 초과 위험에 곱하는 배수(bp) — 10000 = 1배 */
  loadingBp: number;
  /** 기준 총액 대비 최소 프리미엄(bp) */
  minPremiumBp: number;
  /** 이 개수 미만이면 「표본 적음」 */
  smallSampleMin: number;
  /** 표본이 적을 때 최소 프리미엄(bp) */
  smallSamplePremiumBp: number;
  /** 프리미엄 상한(bp) — 넘으면 확정가를 내지 않는다 */
  maxPremiumBp: number;
  /** 확정가 올림 단위(원) */
  roundTo: number;
  /** 확정가 유효 일수 */
  validDays: number;
}

export interface TotalsStats {
  n: number;
  min: number;
  max: number;
  mean: number;
  median: number;
  /** 표본 분산(n−1). 원² 단위라 크다 — 표시·판단용 */
  variance: number;
  stdev: number;
  /** 신뢰수준 경험 분위(선형 보간, 올림) */
  upper: number;
  /** 변동계수(bp) = 표준편차 ÷ 평균 */
  cvBp: number;
}

export type FirmPriceBasis = 'risk' | 'minimum' | 'small_sample';

export type FirmPriceResult =
  | { ok: false; reason: 'no_sample' }
  | {
      ok: true;
      stats: TotalsStats;
      confidenceBp: number;
      /** 기준 총액 = 중간값 */
      base: number;
      /** 초과 위험(원) = max(경험 분위, 정규 근사) − 기준 */
      excess: number;
      /** z·표준편차(원) */
      parametricExcess: number;
      premium: number;
      premiumBp: number;
      firmPrice: number;
      basis: FirmPriceBasis;
      lowSample: boolean;
      /** 프리미엄이 상한 안이면 true */
      offerable: boolean;
    };

const assertTotals = (xs: number[]) => {
  for (const x of xs) if (!Number.isSafeInteger(x) || x < 0) throw new RangeError(`총액은 0 이상의 원 단위 정수여야 합니다: ${x}`);
};

const ceilDiv = (a: bigint, b: bigint) => {
  if (b <= 0n) throw new RangeError('0 이하로 나눌 수 없습니다');
  if (a <= 0n) return -(-a / b);
  return (a + b - 1n) / b;
};

/** step 원 단위로 올림(step ≤ 1 이면 그대로) */
export function ceilTo(v: number, step: number): number {
  if (!Number.isSafeInteger(v)) throw new RangeError(`정수가 아닙니다: ${v}`);
  if (!step || step <= 1) return v;
  const s = BigInt(Math.round(step));
  return toNumber(ceilDiv(BigInt(v), s) * s);
}

/** 정수 제곱근(반올림) */
function isqrtRound(n: bigint): bigint {
  if (n < 0n) throw new RangeError('음수의 제곱근');
  if (n < 2n) return n;
  let x = BigInt(Math.floor(Math.sqrt(Number(n))));
  while (x * x > n) x -= 1n;
  while ((x + 1n) * (x + 1n) <= n) x += 1n;
  // x ≤ √n < x+1 — 반올림: (x+0.5)² = x² + x + 0.25 ≤ n 이면 올림
  return n - x * x > x ? x + 1n : x;
}

/**
 * 분위(선형 보간, R type 7). p 는 bp. mode 가 up 이면 올림, 아니면 반올림.
 * 정렬된 정수 배열을 받는다.
 */
export function quantileBp(sorted: number[], pBp: number, mode: 'up' | 'round' = 'round'): number {
  if (!sorted.length) throw new RangeError('표본이 없습니다');
  if (pBp < 0 || pBp > 10000 || !Number.isInteger(pBp)) throw new RangeError(`분위는 0~10000bp: ${pBp}`);
  const idx = BigInt(sorted.length - 1) * BigInt(pBp);
  const lo = Number(idx / BP);
  const frac = idx % BP;
  if (frac === 0n || lo + 1 >= sorted.length) return sorted[lo];
  const a = BigInt(sorted[lo]);
  const b = BigInt(sorted[lo + 1]);
  const num = a * BP + (b - a) * frac;
  return toNumber(mode === 'up' ? ceilDiv(num, BP) : divRoundHalfUp(num, BP));
}

/** 총액 분포 — 중간값·평균·분산·표준편차·상위 분위 */
export function totalsStats(totals: number[], confidenceBp: number): TotalsStats | null {
  assertTotals(totals);
  if (!totals.length) return null;
  const s = [...totals].sort((a, b) => a - b);
  const n = BigInt(s.length);
  const sum = s.reduce((t, x) => t + BigInt(x), 0n);
  const sumSq = s.reduce((t, x) => t + BigInt(x) * BigInt(x), 0n);
  const mean = toNumber(divRoundHalfUp(sum, n));
  // 표본 분산 = (nΣx² − (Σx)²) / (n(n−1))
  const S = n * sumSq - sum * sum;
  const varExact = s.length > 1 ? divRoundHalfUp(S, n * (n - 1n)) : 0n;
  const stdev = toNumber(isqrtRound(varExact));
  return {
    n: s.length,
    min: s[0],
    max: s[s.length - 1],
    mean,
    median: quantileBp(s, 5000),
    variance: Number(varExact),
    stdev,
    upper: quantileBp(s, confidenceBp, 'up'),
    cvBp: mean > 0 ? toNumber(divRoundHalfUp(BigInt(stdev) * BP, BigInt(mean))) : 0,
  };
}

/**
 * 표준정규 역누적분포(Acklam 근사, 상대오차 < 1.2e-9). p 는 0~1.
 */
export function normalQuantile(p: number): number {
  if (!(p > 0 && p < 1)) throw new RangeError(`확률은 0 과 1 사이: ${p}`);
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const lowP = 0.02425;
  if (p < lowP) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p > 1 - lowP) return -normalQuantile(1 - p);
  const q = p - 0.5;
  const r = q * q;
  return ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

export function checkFirmRates(r: FirmPriceRates) {
  if (!Number.isInteger(r.confidenceBp) || r.confidenceBp < 5000 || r.confidenceBp > 9999) throw new RangeError('신뢰수준은 50%~99.99%');
  for (const k of ['loadingBp', 'minPremiumBp', 'smallSamplePremiumBp', 'maxPremiumBp', 'smallSampleMin', 'roundTo', 'validDays'] as const) {
    if (!Number.isInteger(r[k]) || r[k] < 0) throw new RangeError(`${k} 는 0 이상의 정수`);
  }
}

/** 확정가 — 같은 조건 요금표(또는 응찰) 총액들로 */
export function firmPrice(totals: number[], r: FirmPriceRates): FirmPriceResult {
  checkFirmRates(r);
  const stats = totalsStats(totals, r.confidenceBp);
  if (!stats) return { ok: false, reason: 'no_sample' };
  const base = stats.median;
  const empirical = Math.max(0, stats.upper - base);
  // 정규 근사 — 표본 둘 이상일 때만(하나면 분산을 모른다 → 표본 적음 최소 프리미엄이 받친다)
  const z = stats.n > 1 && r.confidenceBp > 5000 ? normalQuantile(r.confidenceBp / 10000) : 0;
  const parametricExcess = z > 0 && stats.stdev > 0 ? Math.ceil(z * stats.stdev - 1e-9) : 0;
  const excess = Math.max(empirical, parametricExcess);
  const risk = toNumber(ceilDiv(BigInt(excess) * BigInt(r.loadingBp), BP));
  const lowSample = stats.n < r.smallSampleMin;
  const floorBp = lowSample ? Math.max(r.minPremiumBp, r.smallSamplePremiumBp) : r.minPremiumBp;
  const floor = toNumber(ceilDiv(BigInt(base) * BigInt(floorBp), BP));
  const rawPremium = Math.max(risk, floor);
  const basis: FirmPriceBasis = risk >= floor && risk > 0 ? 'risk' : lowSample ? 'small_sample' : 'minimum';
  const cap = toNumber((BigInt(base) * BigInt(r.maxPremiumBp)) / BP);
  const firm = ceilTo(base + rawPremium, r.roundTo);
  const premium = firm - base;
  return {
    ok: true,
    stats,
    confidenceBp: r.confidenceBp,
    base,
    excess,
    parametricExcess,
    premium,
    premiumBp: base > 0 ? toNumber(divRoundHalfUp(BigInt(premium) * BP, BigInt(base))) : 0,
    firmPrice: firm,
    basis,
    lowSample,
    offerable: rawPremium <= cap,
  };
}

export interface CoverageRates {
  /** 실측이 없을 때 쓰는 시장 기본 회송률(bp) */
  priorReturnRateBp: number;
  /** 신뢰도 상수 K — 물량 ÷ (물량 + K) */
  credibilityK: number;
  /** 부가율(bp) — 운영비·변동 대비 */
  loadingBp: number;
  /** 최소 보장료(원) */
  minFee: number;
  /** 이 회송률(bp)을 넘으면 보장 대상이 아니다 */
  maxInsurableRateBp: number;
  /** 보장료 올림 단위(원) */
  roundTo: number;
}

export interface CoverageInput {
  /** 업체의 최근 회송 건수 */
  returns: number;
  /** 같은 기간 FC 입고(완료) 물량 */
  shipments: number;
  /** 회송되면 물어 줄 금액(원) — 보통 국내 창고 재작업 + FC 재운송 */
  coveredAmount: number;
}

export interface CoverageResult {
  /** 신뢰도 가중 회송률(bp, 반올림) */
  rateBp: number;
  /** 업체 실측에 둔 무게(bp) */
  credibilityBp: number;
  expectedLoss: number;
  fee: number;
  /** 보장 금액 대비 보장료(bp) */
  feeBp: number;
  lowSample: boolean;
  offerable: boolean;
}

/** 회송 보장 금액 — 회송되면 다시 드는 구간(국내 창고 재작업 + FC 운송) */
export const COVERAGE_SEGMENTS: readonly Segment[] = ['kr_warehouse', 'fc_delivery'];

export function coverageBase(segments: { segment: Segment; amount: number | null }[]): number {
  return segments.filter((s) => COVERAGE_SEGMENTS.includes(s.segment)).reduce((t, s) => t + (s.amount ?? 0), 0);
}

/** 회송률(0~1)과 물량으로 회송 건수(반올림) */
export function returnsFromRate(rate: number | null, shipments: number): number {
  if (rate == null || !shipments) return 0;
  return Math.min(shipments, Math.max(0, Math.round(rate * shipments)));
}

export function coverageFee(i: CoverageInput, r: CoverageRates): CoverageResult {
  for (const [k, v] of Object.entries(i)) if (!Number.isSafeInteger(v) || v < 0) throw new RangeError(`${k} 는 0 이상의 정수`);
  if (i.returns > i.shipments) throw new RangeError('회송 건수가 물량보다 많습니다');
  for (const [k, v] of Object.entries(r)) if (!Number.isSafeInteger(v) || v < 0) throw new RangeError(`${k} 는 0 이상의 정수`);
  const K = BigInt(r.credibilityK);
  const n = BigInt(i.shipments);
  // 회송률(bp) = (회송·BP + K·기본값) / (물량 + K) — 물량·K 가 모두 0 이면 기본값
  let num = BigInt(i.returns) * BP + K * BigInt(r.priorReturnRateBp);
  let den = n + K;
  if (den === 0n) {
    num = BigInt(r.priorReturnRateBp);
    den = 1n;
  }
  const rateBp = toNumber(divRoundHalfUp(num, den));
  const credibilityBp = n + K > 0n ? toNumber(divRoundHalfUp(n * BP, n + K)) : 0;
  const covered = BigInt(i.coveredAmount);
  const expectedLoss = toNumber(ceilDiv(covered * num, den * BP));
  let fee = 0;
  if (covered > 0n) {
    fee = toNumber(ceilDiv(BigInt(expectedLoss) * (BP + BigInt(r.loadingBp)), BP));
    fee = ceilTo(Math.max(fee, r.minFee), r.roundTo);
  }
  return {
    rateBp,
    credibilityBp,
    expectedLoss,
    fee,
    feeBp: covered > 0n ? toNumber(divRoundHalfUp(BigInt(fee) * BP, covered)) : 0,
    lowSample: i.shipments < r.credibilityK,
    offerable: num <= BigInt(r.maxInsurableRateBp) * den,
  };
}

export interface DeferredRates {
  /** 30일당 수수료(bp) */
  monthlyFeeBp: number;
  /** 후불 기간(일) */
  termDays: number;
  /** 한 건 한도(원) */
  maxAmount: number;
}

/** 물류비 후불 — 참고 수수료(기간 비례, 올림) */
export function deferredFee(amount: number, r: DeferredRates): { fee: number; due: number; termDays: number; withinLimit: boolean } {
  if (!Number.isSafeInteger(amount) || amount < 0) throw new RangeError('금액은 0 이상의 원 단위 정수');
  for (const [k, v] of Object.entries(r)) if (!Number.isSafeInteger(v) || v < 0) throw new RangeError(`${k} 는 0 이상의 정수`);
  const fee = toNumber(ceilDiv(BigInt(amount) * BigInt(r.monthlyFeeBp) * BigInt(r.termDays), BP * 30n));
  return { fee, due: amount + fee, termDays: r.termDays, withinLimit: amount <= r.maxAmount };
}
