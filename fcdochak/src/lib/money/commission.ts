/**
 * 성사 수수료 기준 — 법적 선.
 *
 * 기준 = 물류비 합계 − 관세사 보수.
 * 관세·부가세는 애초에 물류비가 아니므로 들어오지 않는다.
 * 관세사 보수를 기준에서 빼는 이유: 관세사법 제3조 제2·3항 — 관세사가 아닌 자가
 * 통관 대리의 대가를 나눠 받는 구조를 만들지 않는다. 플랫폼은 관세사에게서도,
 * 관세사 보수에 비례해서도 아무것도 받지 않는다.
 *
 * 1차에는 플랫폼이 대금을 받지 않는다. 이 값은 「수수료 기준 매출」 산정용이다.
 */
import { BP, divRoundHalfUp, toNumber } from './decimal';
import { SEGMENTS, type Segment } from './segments';

export type SegmentAmounts = Partial<Record<Segment, number | null>>;

export function commissionBase(amounts: SegmentAmounts): number {
  let base = 0;
  for (const s of SEGMENTS) {
    if (s === 'broker') continue;
    const v = amounts[s];
    if (v == null) continue;
    if (!Number.isSafeInteger(v) || v < 0) throw new RangeError(`구간 금액이 올바르지 않습니다: ${s}=${v}`);
    base += v;
  }
  return base;
}

/** 수수료(원) = 기준 × 요율(bp). 요율은 설정 표에서 읽어 넘긴다. */
export function commissionAmount(amounts: SegmentAmounts, rateBp: number): number {
  if (!Number.isInteger(rateBp) || rateBp < 0 || rateBp > 3000) {
    throw new RangeError(`수수료 요율이 범위를 벗어났습니다(0~30%): ${rateBp}bp`);
  }
  return toNumber(divRoundHalfUp(BigInt(commissionBase(amounts)) * BigInt(rateBp), BP));
}
