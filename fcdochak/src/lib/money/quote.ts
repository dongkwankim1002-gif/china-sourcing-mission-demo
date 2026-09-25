/**
 * 견적 합계 — 요금표 한 장 + 화물 하나 → 9구간 금액과 합계(원).
 * 순수 함수. DB·환경변수·시계를 읽지 않는다. 기준값은 인자로 받는다.
 */
import { BP, divRoundHalfUp, toNumber, toScaled } from './decimal';
import { SEGMENTS, type Segment } from './segments';

export type Currency = 'KRW' | 'RMB' | 'USD';
export type Certainty = 'confirmed' | 'estimated' | 'extra_possible';
export type Basis =
  | 'per_cbm'
  | 'per_rt'
  | 'per_kg'
  | 'per_chargeable_kg'
  | 'per_carton'
  | 'per_unit'
  | 'per_pallet'
  | 'per_container'
  | 'per_shipment'
  | 'percent_goods';

export interface Cargo {
  units: number;
  cartons: number;
  kg: number;
  cbm: number;
  goodsValue: number;
  goodsCurrency: Currency;
}

export interface RateLine {
  segment: Segment;
  included: boolean;
  basis: Basis;
  /** 통화 단위 단가. percent_goods 이면 퍼센트 값(0.3 = 0.3%). */
  unitPrice: number;
  currency: Currency;
  minCharge?: number | null;
  certainty: Certainty;
}

export interface RateTier {
  segment: Segment;
  /** 기준 수량(해당 줄의 basis 단위) 이상이면 적용 */
  minQty: number;
  discountBp: number;
}

export interface QuoteParams {
  /** 1 외화 = N 원. KRW 는 1. */
  fx: Record<Currency, number>;
  volumetricKgPerCbm: number;
  palletCbm: number;
  containerCbm: number;
}

export interface SegmentAmount {
  segment: Segment;
  included: boolean;
  /** 원. 포함 안 된 구간은 null */
  amount: number | null;
  certainty: Certainty | null;
  basis: Basis | null;
  qty: number | null;
  discountBp: number;
  minApplied: boolean;
  /** 플랫폼 참고치로 채운 칸 */
  filled: boolean;
}

export interface QuoteResult {
  segments: SegmentAmount[];
  total: number;
  confirmedTotal: number;
  estimatedTotal: number;
  extraPossible: Segment[];
  excluded: Segment[];
  filled: Segment[];
  perUnit: number;
}

export function chargeableQty(basis: Basis, cargo: Cargo, p: QuoteParams): number {
  switch (basis) {
    case 'per_cbm':
      return cargo.cbm;
    case 'per_rt':
      return Math.max(cargo.cbm, cargo.kg / 1000);
    case 'per_kg':
      return cargo.kg;
    case 'per_chargeable_kg':
      return Math.max(cargo.kg, cargo.cbm * p.volumetricKgPerCbm);
    case 'per_carton':
      return cargo.cartons;
    case 'per_unit':
      return cargo.units;
    case 'per_pallet':
      return Math.max(1, Math.ceil(round6(cargo.cbm / p.palletCbm)));
    case 'per_container':
      return Math.max(1, Math.ceil(round6(cargo.cbm / p.containerCbm)));
    case 'per_shipment':
      return 1;
    case 'percent_goods':
      return 1;
  }
}

/** 나눗셈 꼬리(1.0000000002)만 지우고 실제 초과(1.0004)는 남긴다 */
function round6(n: number) {
  return Math.round(n * 1e6) / 1e6;
}

export function goodsValueKrw(cargo: Cargo, fx: Record<Currency, number>): number {
  return toNumber(divRoundHalfUp(toScaled(cargo.goodsValue, 2) * toScaled(fx[cargo.goodsCurrency], 4), 1_000_000n));
}

function tierFor(segment: Segment, qty: number, tiers: RateTier[]): number {
  let best = 0;
  let bestMin = -1;
  for (const t of tiers) {
    if (t.segment === segment && qty >= t.minQty && t.minQty > bestMin) {
      best = t.discountBp;
      bestMin = t.minQty;
    }
  }
  return best;
}

/** 한 줄의 금액(원). 할인 → 최저요금 순. */
export function lineAmount(line: RateLine, cargo: Cargo, p: QuoteParams, tiers: RateTier[] = []) {
  const qty = chargeableQty(line.basis, cargo, p);
  const fxS = toScaled(p.fx[line.currency], 4); // ×1e4
  let amount: bigint;
  let discountBp = 0;
  if (line.basis === 'percent_goods') {
    const goods = BigInt(goodsValueKrw(cargo, p.fx));
    // goods × pct / 100, pct 는 ×1e4 로
    amount = divRoundHalfUp(goods * toScaled(line.unitPrice, 4), 1_000_000n);
  } else {
    discountBp = tierFor(line.segment, qty, tiers);
    const qtyS = toScaled(qty, 3); // ×1e3
    const priceS = toScaled(line.unitPrice, 2); // ×1e2
    amount = divRoundHalfUp(qtyS * priceS * fxS * (BP - BigInt(discountBp)), 10_000_000_000_000n);
  }
  let minApplied = false;
  if (line.minCharge != null && line.minCharge > 0) {
    const min = divRoundHalfUp(toScaled(line.minCharge, 2) * fxS, 1_000_000n);
    if (min > amount) {
      amount = min;
      minApplied = true;
    }
  }
  return { qty, amount: toNumber(amount), discountBp, minApplied };
}

export function computeQuote(
  lines: RateLine[],
  cargo: Cargo,
  p: QuoteParams,
  tiers: RateTier[] = [],
): QuoteResult {
  const bySeg = new Map<Segment, RateLine[]>();
  for (const l of lines) {
    const arr = bySeg.get(l.segment) ?? [];
    arr.push(l);
    bySeg.set(l.segment, arr);
  }
  const segments: SegmentAmount[] = SEGMENTS.map((segment) => {
    const ls = (bySeg.get(segment) ?? []).filter((l) => l.included);
    if (ls.length === 0) {
      return {
        segment,
        included: false,
        amount: null,
        certainty: null,
        basis: null,
        qty: null,
        discountBp: 0,
        minApplied: false,
        filled: false,
      };
    }
    let amount = 0;
    let certainty: Certainty = 'confirmed';
    let minApplied = false;
    let discountBp = 0;
    let qty: number | null = null;
    for (const l of ls) {
      const r = lineAmount(l, cargo, p, tiers);
      amount += r.amount;
      minApplied ||= r.minApplied;
      discountBp = Math.max(discountBp, r.discountBp);
      qty ??= r.qty;
      certainty = weakerCertainty(certainty, l.certainty);
    }
    return {
      segment,
      included: true,
      amount,
      certainty,
      basis: ls[0].basis,
      qty,
      discountBp,
      minApplied,
      filled: false,
    };
  });
  return summarize(segments, cargo.units);
}

const CERTAINTY_ORDER: Certainty[] = ['confirmed', 'estimated', 'extra_possible'];
export function weakerCertainty(a: Certainty, b: Certainty): Certainty {
  return CERTAINTY_ORDER.indexOf(a) >= CERTAINTY_ORDER.indexOf(b) ? a : b;
}

export function summarize(segments: SegmentAmount[], units: number): QuoteResult {
  let total = 0;
  let confirmedTotal = 0;
  let estimatedTotal = 0;
  const extraPossible: Segment[] = [];
  const excluded: Segment[] = [];
  const filled: Segment[] = [];
  for (const s of segments) {
    if (s.amount == null) {
      excluded.push(s.segment);
      continue;
    }
    total += s.amount;
    if (s.filled) filled.push(s.segment);
    if (s.certainty === 'confirmed' && !s.filled) confirmedTotal += s.amount;
    else estimatedTotal += s.amount;
    if (s.certainty === 'extra_possible') extraPossible.push(s.segment);
  }
  return {
    segments,
    total,
    confirmedTotal,
    estimatedTotal,
    extraPossible,
    excluded,
    filled,
    perUnit: units > 0 ? perUnitCost(total, units) : 0,
  };
}

/** 개당 원가 — 원 단위 반올림 */
export function perUnitCost(total: number, units: number): number {
  if (units <= 0) throw new RangeError('수량은 1 이상이어야 합니다');
  return toNumber(divRoundHalfUp(BigInt(total), BigInt(units)));
}

/**
 * 같은 조건 비교 — 업체가 맡지 않는 구간을 플랫폼 참고치로 채운다.
 * 채운 칸은 filled=true, certainty='estimated' 로 표시되어 확정 합계에 들어가지 않는다.
 */
export function completeWithReference(
  result: QuoteResult,
  reference: Partial<Record<Segment, number>>,
  units: number,
): QuoteResult {
  const segments = result.segments.map((s) => {
    if (s.amount != null) return s;
    const ref = reference[s.segment];
    if (ref == null) return s;
    return { ...s, amount: ref, certainty: 'estimated' as const, filled: true };
  });
  return summarize(segments, units);
}

/** 두 스냅숏(원)의 합 — 응찰/청구 JSON 을 다시 셀 때 */
export function sumAmounts(amounts: Partial<Record<Segment, number | null>>): number {
  let t = 0;
  for (const s of SEGMENTS) {
    const v = amounts[s];
    if (v != null) {
      if (!Number.isSafeInteger(v)) throw new RangeError(`원 단위 정수가 아닙니다: ${s}=${v}`);
      t += v;
    }
  }
  return t;
}
