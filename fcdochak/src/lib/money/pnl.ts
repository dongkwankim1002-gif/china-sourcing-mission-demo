/**
 * 판매손익 — 쿠팡 판매가(부가세 포함)에서 개당 남는 돈.
 *
 * 매입 부가세는 환급(매입세액 공제) 대상이라 원가에서 뺀다.
 * 판매 쪽은 판매가 ÷ (1+부가세율) 이 매출.
 * 판매 수수료는 부가세 포함 판매가에 요율을 곱한다(마켓 관행).
 * 요율·개당 풀필먼트 비용은 설정 표에서 읽어 넘긴다.
 */
import { BP, divRoundHalfUp, toNumber } from './decimal';

export interface PnlInput {
  /** 부가세 포함 판매가(원) */
  price: number;
  /** 개당 상품 원가(원) — 물품가 환산 */
  goodsPerUnit: number;
  /** 개당 물류비(원) — 9구간 합계 ÷ 수량 */
  logisticsPerUnit: number;
  /** 개당 관세(원) — 참고 추정 */
  dutyPerUnit: number;
  /** 판매 수수료율(bp) */
  saleFeeBp: number;
  /** 개당 풀필먼트(입출고·배송) 비용(원) */
  fulfillmentPerUnit: number;
  vatRateBp: number;
}

export interface PnlResult {
  netRevenue: number;
  saleFee: number;
  cost: number;
  profit: number;
  /** 매출 대비 이익률(bp) */
  marginBp: number;
  breakEvenPrice: number;
}

export function unitPnl(i: PnlInput): PnlResult {
  const vatDen = BP + BigInt(i.vatRateBp);
  const netRevenue = toNumber(divRoundHalfUp(BigInt(i.price) * BP, vatDen));
  const saleFee = toNumber(divRoundHalfUp(BigInt(i.price) * BigInt(i.saleFeeBp), BP));
  const cost = i.goodsPerUnit + i.logisticsPerUnit + i.dutyPerUnit + i.fulfillmentPerUnit;
  const profit = netRevenue - saleFee - cost;
  const marginBp = netRevenue > 0 ? toNumber(divRoundHalfUp(BigInt(profit) * BP, BigInt(netRevenue))) : 0;
  return { netRevenue, saleFee, cost, profit, marginBp, breakEvenPrice: breakEvenPrice(i) };
}

/**
 * 손익분기 판매가 — P/(1+v) − P·f = cost  →  P = cost / (1/(1+v) − f)
 * 10원 단위 올림(그 값에서 이익 ≥ 0 을 보장).
 */
export function breakEvenPrice(i: Omit<PnlInput, 'price'>): number {
  const cost = BigInt(i.goodsPerUnit + i.logisticsPerUnit + i.dutyPerUnit + i.fulfillmentPerUnit);
  const v = BigInt(i.vatRateBp);
  const f = BigInt(i.saleFeeBp);
  // 1/(1+v) − f = (BP − f(BP+v)/BP) / (BP+v) ; 전부 BP² 스케일로
  const denom = BP * BP - f * (BP + v); // × 1/(BP·(BP+v))
  if (denom <= 0n) return Number.POSITIVE_INFINITY;
  const num = cost * BP * (BP + v);
  let p = (num + denom - 1n) / denom; // 올림
  p = ((p + 9n) / 10n) * 10n;
  // 반올림 오차로 이익이 음수면 10원씩 올린다
  for (let k = 0; k < 5; k++) {
    const r = toNumber(p);
    const net = divRoundHalfUp(BigInt(r) * BP, BP + v);
    const fee = divRoundHalfUp(BigInt(r) * f, BP);
    if (net - fee - cost >= 0n) break;
    p += 10n;
  }
  return toNumber(p);
}

/** 민감도표 — 판매가 변화 × 물류비 변화(퍼센트) 격자의 개당 이익 */
export function sensitivity(
  base: PnlInput,
  priceSteps: number[] = [-20, -10, 0, 10, 20],
  logisticsSteps: number[] = [-20, -10, 0, 10, 20, 40],
): { priceSteps: number[]; logisticsSteps: number[]; profit: number[][] } {
  const profit = logisticsSteps.map((ls) =>
    priceSteps.map((ps) => {
      const price = Math.round((base.price * (100 + ps)) / 100);
      const logisticsPerUnit = Math.round((base.logisticsPerUnit * (100 + ls)) / 100);
      return unitPnl({ ...base, price, logisticsPerUnit }).profit;
    }),
  );
  return { priceSteps, logisticsSteps, profit };
}
