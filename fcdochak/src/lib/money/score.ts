/**
 * 추천 점수(0~100) — 정시 입고 30 · 청구 편차 25 · FC 회송률 25 · 가격 확실성 20.
 *
 * 광고·특수관계는 이 함수의 입력에 없다. 넣을 자리가 없으니 점수를 움직일 수 없다.
 * 실측이 아직 없는 업체(신규)는 해당 칸을 중립값(0.5)으로 본다 — 정직하게
 * 「실측 없음」을 화면에 함께 보여준다.
 */
export const SCORE_WEIGHTS = { onTime: 30, deviation: 25, fcReturn: 25, certainty: 20 } as const;

export interface ScoreInput {
  /** 정시 입고율 0~1 (실측 없으면 null) */
  onTimeRate: number | null;
  /** 평균 청구 편차(절댓값, 0.05 = 5%) */
  avgDeviation: number | null;
  /** FC 회송률 0~1 */
  fcReturnRate: number | null;
  /** 가격 확정도 0~1 — 확정 구간 금액 비중 */
  priceCertainty: number;
}

export interface ScoreCaps {
  /** 이 편차 이상이면 0점 (예: 0.10) */
  deviationCap: number;
  /** 이 회송률 이상이면 0점 (예: 0.10) */
  fcReturnCap: number;
}

const NEUTRAL = 0.5;

function clamp01(n: number) {
  return Math.min(1, Math.max(0, n));
}

export function scoreParts(i: ScoreInput, caps: ScoreCaps) {
  const onTime = i.onTimeRate == null ? NEUTRAL : clamp01(i.onTimeRate);
  const deviation = i.avgDeviation == null ? NEUTRAL : 1 - clamp01(Math.abs(i.avgDeviation) / caps.deviationCap);
  const fcReturn = i.fcReturnRate == null ? NEUTRAL : 1 - clamp01(i.fcReturnRate / caps.fcReturnCap);
  const certainty = clamp01(i.priceCertainty);
  return {
    onTime: onTime * SCORE_WEIGHTS.onTime,
    deviation: deviation * SCORE_WEIGHTS.deviation,
    fcReturn: fcReturn * SCORE_WEIGHTS.fcReturn,
    certainty: certainty * SCORE_WEIGHTS.certainty,
  };
}

export function recommendScore(i: ScoreInput, caps: ScoreCaps): number {
  const p = scoreParts(i, caps);
  return Math.round((p.onTime + p.deviation + p.fcReturn + p.certainty) * 10) / 10;
}

/** 청구 편차 = (청구 합계 − 응찰 합계) / 응찰 합계 */
export function billingDeviation(bidTotal: number, invoiceTotal: number): number {
  if (bidTotal <= 0) throw new RangeError('응찰 합계가 0 이하입니다');
  return (invoiceTotal - bidTotal) / bidTotal;
}

/** 확정 구간 금액 비중 */
export function priceCertaintyOf(confirmedTotal: number, total: number): number {
  return total > 0 ? confirmedTotal / total : 0;
}

export interface FcReadyRule {
  minFcInbound: number;
  maxReturnRate30d: number;
}

/** 「FC 입고 준비 인증」 — 기준은 설정 값 */
export function isFcReady(fcInboundCount: number, returnRate30d: number | null, rule: FcReadyRule): boolean {
  if (returnRate30d == null) return false;
  return fcInboundCount >= rule.minFcInbound && returnRate30d <= rule.maxReturnRate30d;
}
