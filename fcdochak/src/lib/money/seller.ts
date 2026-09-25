/**
 * 공개 판매손익 계산기(/tools/pnl) — 도착원가 + 관부가세 참고 추정 + 쿠팡 판매 비용 → 개당 마진·손익분기.
 *
 * 개당 손익 식은 pnl.ts(unitPnl·breakEvenPrice·sensitivity)를 그대로 쓴다. 여기서는
 *  - 광고비(판매가 × 광고비율)를 판매 수수료와 같은 「판매가 비례 비용」으로 묶어 넘기고,
 *  - 로켓그로스 입출고비·배송비를 개당 풀필먼트로 묶고,
 *  - 화물 특성 때문에 드는 추가비용(전체 금액)을 물류비에 얹는다.
 * 요율·기준값은 설정 표(fcd.settings)에서 읽어 넘긴다 — 여기에 박지 않는다.
 */
import { BP, divRoundHalfUp, toNumber } from './decimal';
import { estimateDutyVat, type DutyEstimate } from './duty';
import { breakEvenPrice, sensitivity, unitPnl, type PnlInput, type PnlResult } from './pnl';

export interface SellerPnlInput {
  units: number;
  /** 부가세 포함 판매가(원) */
  price: number;
  /** 물품가 전체(원 환산) */
  goodsKrw: number;
  /** 9구간 합계(전체, 원) — 공장에서 쿠팡 FC 입고까지 */
  logisticsTotal: number;
  /** 한국 도착항까지 운임(전체) — 관세 과세가격(CIF)에 들어간다 */
  freightToPortKrw: number;
  /** 화물 특성·기타 추가비용(전체) — 알면 넣는다 */
  extraCostTotal: number;
  dutyRateBp: number;
  vatRateBp: number;
  insuranceBp: number;
  /** 쿠팡 판매 수수료(bp, 부가세 포함 판매가 기준) */
  saleFeeBp: number;
  /** 광고비율(bp, 부가세 포함 판매가 대비) */
  adBp: number;
  /** 로켓그로스 입출고비(개당) */
  inboundPerUnit: number;
  /** 로켓그로스 배송비(개당) */
  shippingPerUnit: number;
}

export interface SellerPnlResult {
  units: number;
  duty: DutyEstimate;
  /** unitPnl 에 넘긴 값(광고비는 판매 수수료에 합쳐 있음) */
  base: PnlInput;
  pnl: PnlResult;
  /** 개당 */
  goodsPerUnit: number;
  logisticsPerUnit: number;
  extraPerUnit: number;
  dutyPerUnit: number;
  /** 개당 도착원가 = 상품 + 물류(9구간) + 추가비용 + 관세 */
  arrivalPerUnit: number;
  saleFee: number;
  adCost: number;
  inbound: number;
  shipping: number;
  breakEvenPrice: number;
  totalProfit: number;
}

function checkInput(i: SellerPnlInput) {
  for (const [k, v] of Object.entries(i)) {
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) throw new RangeError(`${k} 값이 올바르지 않습니다`);
  }
  if (i.units < 1) throw new RangeError('units 는 1 이상');
}

const per = (total: number, units: number) => Math.round(total / units);

export function sellerPnl(i: SellerPnlInput): SellerPnlResult {
  checkInput(i);
  const units = Math.round(i.units);
  const duty = estimateDutyVat({
    goodsKrw: Math.round(i.goodsKrw),
    freightToPortKrw: Math.round(i.freightToPortKrw),
    insuranceBp: i.insuranceBp,
    dutyRateBp: i.dutyRateBp,
    vatRateBp: i.vatRateBp,
  });
  const goodsPerUnit = per(i.goodsKrw, units);
  const logisticsPerUnit = per(i.logisticsTotal, units);
  const extraPerUnit = per(i.extraCostTotal, units);
  const dutyPerUnit = per(duty.duty, units);
  const base: PnlInput = {
    price: Math.round(i.price),
    goodsPerUnit,
    logisticsPerUnit: logisticsPerUnit + extraPerUnit,
    dutyPerUnit,
    saleFeeBp: Math.round(i.saleFeeBp + i.adBp),
    fulfillmentPerUnit: Math.round(i.inboundPerUnit + i.shippingPerUnit),
    vatRateBp: i.vatRateBp,
  };
  const pnl = unitPnl(base);
  // 판매 수수료와 광고비를 나눠 보인다 — 둘의 합이 unitPnl 의 수수료와 원 단위까지 같게(반올림 차이는 광고비 쪽에)
  const saleFee = toNumber(divRoundHalfUp(BigInt(base.price) * BigInt(Math.round(i.saleFeeBp)), BP));
  const adCost = pnl.saleFee - saleFee;
  return {
    units,
    duty,
    base,
    pnl,
    goodsPerUnit,
    logisticsPerUnit,
    extraPerUnit,
    dutyPerUnit,
    arrivalPerUnit: goodsPerUnit + logisticsPerUnit + extraPerUnit + dutyPerUnit,
    saleFee,
    adCost,
    inbound: Math.round(i.inboundPerUnit),
    shipping: Math.round(i.shippingPerUnit),
    breakEvenPrice: breakEvenPrice(base),
    totalProfit: pnl.profit * units,
  };
}

/** 민감도표 — 판매가 × 물류비(9구간+추가비용) 변화의 개당 이익. pnl.ts 의 sensitivity 그대로. */
export function sellerSensitivity(r: SellerPnlResult) {
  return sensitivity(r.base);
}

// ─── 도착원가 요약(구간 시세로 계산) ───────────────────────────────

export function medianOf(a: number[]): number {
  if (a.length === 0) return 0;
  const s = [...a].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}

export function quantileOf(a: number[], p: number): number {
  if (a.length === 0) return 0;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1) + 0.5))];
}

export interface ArrivalOfferLike {
  total: number;
  /** 한국 도착항까지(집하·창고 작업·수출통관·국제운송) */
  toPort: number;
  segments: { segment: string; amount: number | null }[];
}

export interface ArrivalSummary {
  count: number;
  /** 9구간 합계 중간값 — 계산기에 넣는 값 */
  median: number;
  min: number;
  q1: number;
  /** 도착항까지 운임의 중간값 — 관세 과세가격에 넣는 값 */
  toPortMedian: number;
  /** 구간별 중간값(합이 총액 중간값과 조금 다를 수 있다) */
  segmentMedians: Record<string, number>;
  segmentMedianSum: number;
}

/** 여러 업체의 같은 조건 견적 → 집계 숫자만. 업체별 금액은 내보내지 않는다. */
export function summarizeArrival(offers: ArrivalOfferLike[]): ArrivalSummary {
  const totals = offers.map((o) => o.total);
  const segs: Record<string, number[]> = {};
  for (const o of offers) for (const s of o.segments) (segs[s.segment] ??= []).push(s.amount ?? 0);
  const segmentMedians = Object.fromEntries(Object.entries(segs).map(([k, v]) => [k, medianOf(v)]));
  return {
    count: offers.length,
    median: medianOf(totals),
    min: totals.length ? Math.min(...totals) : 0,
    q1: quantileOf(totals, 0.25),
    toPortMedian: medianOf(offers.map((o) => o.toPort)),
    segmentMedians,
    segmentMedianSum: Object.values(segmentMedians).reduce((a, b) => a + b, 0),
  };
}

// ─── 화물 특성 → 추가비용 경고 ────────────────────────────────────

export interface TraitCostNote {
  trait: string;
  /** 생길 수 있는 비용 항목(금액 없이 글로) */
  items: string[];
}

export interface TraitWarning {
  trait: string;
  name: string;
  items: string[];
  /** 이 특성으로 못 쓰는 운송 방식 */
  blockedModes: string[];
  /** 취급 등록 업체만 받을 수 있다 */
  needsCapability: boolean;
}

/** 고른 특성마다 생길 수 있는 추가비용 항목. 표(설정)에 없는 특성도 방식 제한·등록 필요는 알린다. */
export function traitWarnings(
  selected: string[],
  rules: { code: string; name: string; needsCapability: boolean; blockedModes: readonly string[] }[],
  notes: TraitCostNote[],
): TraitWarning[] {
  const out: TraitWarning[] = [];
  for (const r of rules) {
    if (!selected.includes(r.code)) continue;
    const n = notes.find((x) => x.trait === r.code);
    const items = n?.items.filter((x) => typeof x === 'string' && x.trim()) ?? [];
    if (!items.length && !r.blockedModes.length && !r.needsCapability) continue;
    out.push({ trait: r.code, name: r.name, items, blockedModes: [...r.blockedModes], needsCapability: r.needsCapability });
  }
  return out;
}

/** 뺀 업체를 사유별로 묶는다 — 「배터리 취급 등록 없음 3곳」 */
export function groupExclusions(list: { name: string; reasons: string[] }[]): { reason: string; count: number; names: string[] }[] {
  const m = new Map<string, Set<string>>();
  for (const x of list) for (const r of x.reasons) (m.get(r) ?? m.set(r, new Set()).get(r)!).add(x.name);
  return [...m.entries()]
    .map(([reason, names]) => ({ reason, count: names.size, names: [...names].sort((a, b) => a.localeCompare(b, 'ko')) }))
    .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason, 'ko'));
}
