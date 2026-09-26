/**
 * 소싱 후보의 도착원가·개당 마진 — 순수 함수(v2 3차 sourcing, docs/sourcing-plan.md 3·7절).
 *
 * 새 손익 식을 만들지 않는다. 후보의 단가 구간에서 발주 수량의 단가를 고르고, 화물(수량 × 개당 무게·부피)을 만들어
 * 9구간 물류비(구간 시세 — 서버가 compare 로 셈)와 함께 판매손익 sellerPnl 에 그대로 넘긴다.
 * 소싱 대행 수수료(가정치, 설정 sourcing.fees)는 「추가비용」 칸에 얹는다.
 */
import { BP, divRoundHalfUp, toNumber } from './decimal';
import { goodsValueKrw, type Cargo, type Currency } from './quote';
import { sellerPnl, type SellerPnlResult } from './seller';

export interface PriceTier {
  /** 이 수량부터 */
  minQty: number;
  /** 개당 단가(후보 통화) */
  unitPrice: number;
}

/** 단가 구간 정리 — 수량 오름차순, 같은 수량은 뒤의 값, 잘못된 줄은 오류 */
export function normalizeTiers(tiers: readonly PriceTier[]): PriceTier[] {
  if (!tiers.length) throw new RangeError('단가 구간이 비었습니다');
  const m = new Map<number, number>();
  for (const t of tiers) {
    if (!Number.isInteger(t.minQty) || t.minQty < 1) throw new RangeError(`구간 수량이 올바르지 않습니다: ${t.minQty}`);
    if (!Number.isFinite(t.unitPrice) || t.unitPrice <= 0) throw new RangeError(`구간 단가가 올바르지 않습니다: ${t.unitPrice}`);
    m.set(t.minQty, Math.round(t.unitPrice * 100) / 100);
  }
  return [...m].sort((a, b) => a[0] - b[0]).map(([minQty, unitPrice]) => ({ minQty, unitPrice }));
}

/**
 * 「100:12.5, 500:11.8, 1000:11」 같은 글 → 단가 구간. 운영 화면 입력용.
 * 쉼표·줄바꿈으로 가르고, 각 줄은 「수량:단가」(콜론·공백·= 모두 허용).
 */
export function parseTierText(s: string): PriceTier[] {
  const parts = s.split(/[,\n;]+/).map((x) => x.trim()).filter(Boolean);
  const out: PriceTier[] = [];
  for (const p of parts) {
    const m = p.replace(/[개件pcs]/gi, '').match(/^(\d[\d_]*)\s*[:=\s]\s*(\d+(?:\.\d+)?)$/);
    if (!m) throw new RangeError(`「${p}」를 읽지 못했습니다 — 「수량:단가」로 적어 주세요`);
    out.push({ minQty: Number(m[1].replace(/_/g, '')), unitPrice: Number(m[2]) });
  }
  return normalizeTiers(out);
}

/** 발주 수량의 단가 — 수량 이하인 가장 큰 구간. 첫 구간보다 적으면 첫 구간 단가(최소 주문량 미달 표시는 따로) */
export function unitPriceAt(tiers: readonly PriceTier[], qty: number): PriceTier {
  const t = normalizeTiers(tiers);
  let pick = t[0];
  for (const x of t) if (qty >= x.minQty) pick = x;
  return pick;
}

export interface CandidateCargoInput {
  qty: number;
  unitKg: number;
  unitCbm: number;
  unitsPerCarton: number;
  unitPrice: number;
  currency: Currency;
}

/** 후보 × 수량 → 9구간 견적에 넣을 화물(무게 0.1kg · 부피 0.01CBM 단위 올림, 박스는 올림) */
export function candidateCargo(i: CandidateCargoInput): Cargo {
  if (!Number.isInteger(i.qty) || i.qty < 1) throw new RangeError('수량은 1 이상 정수');
  if (!(i.unitKg > 0) || !(i.unitCbm > 0) || !(i.unitsPerCarton >= 1)) throw new RangeError('개당 무게·부피·박스 입수가 올바르지 않습니다');
  const kg = Math.max(0.1, Math.ceil(i.qty * i.unitKg * 10 - 1e-9) / 10);
  const cbm = Math.max(0.01, Math.ceil(i.qty * i.unitCbm * 100 - 1e-9) / 100);
  return {
    units: i.qty,
    cartons: Math.max(1, Math.ceil(i.qty / Math.floor(i.unitsPerCarton))),
    kg,
    cbm,
    goodsValue: Math.round(i.qty * i.unitPrice * 100) / 100,
    goodsCurrency: i.currency,
  };
}

export interface CandidateSimInput {
  qty: number;
  /** 부가세 포함 판매가(원) */
  price: number;
  tiers: readonly PriceTier[];
  currency: Currency;
  moq: number;
  unitKg: number;
  unitCbm: number;
  unitsPerCarton: number;
  fx: Record<Currency, number>;
  /** 9구간 합계(전체, 원) — 서버가 같은 화물로 구간 시세에서 셈 */
  logisticsTotal: number;
  /** 도착항까지 운임(전체, 원) — 관세 과세가격 */
  freightToPortKrw: number;
  dutyRateBp: number;
  vatRateBp: number;
  insuranceBp: number;
  saleFeeBp: number;
  adBp: number;
  inboundPerUnit: number;
  shippingPerUnit: number;
  /** 소싱 대행 수수료(bp, 상품가 기준 — 가정치). 0 이면 빼고 셈 */
  agentFeeBp: number;
}

export interface CandidateSimResult {
  qty: number;
  tier: PriceTier;
  belowMoq: boolean;
  cargo: Cargo;
  goodsKrw: number;
  agentFee: number;
  pnl: SellerPnlResult;
  /** 개당 도착원가(상품 + 9구간 물류 + 대행 수수료 + 관세 참고) */
  arrivalPerUnit: number;
  profitPerUnit: number;
  marginBp: number;
  totalProfit: number;
}

export function candidateSim(i: CandidateSimInput): CandidateSimResult {
  const tier = unitPriceAt(i.tiers, i.qty);
  const cargo = candidateCargo({ qty: i.qty, unitKg: i.unitKg, unitCbm: i.unitCbm, unitsPerCarton: i.unitsPerCarton, unitPrice: tier.unitPrice, currency: i.currency });
  const goodsKrw = goodsValueKrw(cargo, i.fx);
  if (!Number.isInteger(i.agentFeeBp) || i.agentFeeBp < 0) throw new RangeError('대행 수수료율이 올바르지 않습니다');
  const agentFee = toNumber(divRoundHalfUp(BigInt(goodsKrw) * BigInt(i.agentFeeBp), BP));
  const pnl = sellerPnl({
    units: i.qty,
    price: i.price,
    goodsKrw,
    logisticsTotal: i.logisticsTotal,
    freightToPortKrw: i.freightToPortKrw,
    extraCostTotal: agentFee,
    dutyRateBp: i.dutyRateBp,
    vatRateBp: i.vatRateBp,
    insuranceBp: i.insuranceBp,
    saleFeeBp: i.saleFeeBp,
    adBp: i.adBp,
    inboundPerUnit: i.inboundPerUnit,
    shippingPerUnit: i.shippingPerUnit,
  });
  return {
    qty: i.qty,
    tier,
    belowMoq: i.qty < i.moq,
    cargo,
    goodsKrw,
    agentFee,
    pnl,
    arrivalPerUnit: pnl.arrivalPerUnit,
    profitPerUnit: pnl.pnl.profit,
    marginBp: pnl.pnl.marginBp,
    totalProfit: pnl.totalProfit,
  };
}

/** 샘플 한 번의 참고 비용 — 공급처 샘플비(원 환산) + 샘플 처리 가정치. 국제 배송비는 빼고 적는다 */
export function sampleCostKrw(sampleFee: number | null, currency: Currency, fx: Record<Currency, number>, handlingKrw: number): number {
  const fee = sampleFee == null ? 0 : goodsValueKrw({ units: 1, cartons: 1, kg: 1, cbm: 1, goodsValue: sampleFee, goodsCurrency: currency }, fx);
  return fee + Math.max(0, Math.round(handlingKrw));
}

/** 기대 매입가(원) = 목표 판매가 × 비율 — 유사도의 가격대 기준 */
export function expectedUnitCostKrw(targetPrice: number, targetCostShareBp: number): number {
  return toNumber(divRoundHalfUp(BigInt(Math.round(targetPrice)) * BigInt(targetCostShareBp), BP));
}
