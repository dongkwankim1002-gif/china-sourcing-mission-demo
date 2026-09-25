/**
 * 합계 나누기 — 「확정 합계」와 「참고치 포함 합계」를 따로 보인다.
 * 순수 함수. 견적 한 장의 9구간 금액을 세 덩어리로 가른다:
 *   확정(업체가 확정으로 준 칸) + 예상(업체가 예상·추가비용 가능으로 준 칸) + 참고치(업체가 맡지 않아 플랫폼 참고치로 채운 칸)
 *   = 참고치 포함 합계(= QuoteResult.total)
 */
import type { SegmentAmount } from './quote';

export interface TotalsBreakdown {
  /** 업체가 확정으로 준 칸만 */
  confirmed: number;
  /** 업체가 준 칸 중 예상·추가비용 가능 */
  estimated: number;
  /** 업체 금액 합(확정 + 예상) — 참고치를 뺀 합계 */
  partnerTotal: number;
  /** 플랫폼 참고치로 채운 칸 합 */
  reference: number;
  /** 참고치로 채운 칸 수 */
  referenceCount: number;
  /** 참고치 포함 합계 */
  withReference: number;
}

export function totalsBreakdown(segments: Pick<SegmentAmount, 'amount' | 'certainty' | 'filled'>[]): TotalsBreakdown {
  let confirmed = 0;
  let estimated = 0;
  let reference = 0;
  let referenceCount = 0;
  for (const s of segments) {
    if (s.amount == null) continue;
    if (!Number.isSafeInteger(s.amount)) throw new RangeError(`원 단위 정수가 아닙니다: ${s.amount}`);
    if (s.filled) {
      reference += s.amount;
      referenceCount++;
    } else if (s.certainty === 'confirmed') confirmed += s.amount;
    else estimated += s.amount;
  }
  return { confirmed, estimated, partnerTotal: confirmed + estimated, reference, referenceCount, withReference: confirmed + estimated + reference };
}
