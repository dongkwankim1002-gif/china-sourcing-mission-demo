/**
 * 관세·부가세 「참고 추정」. 실제 세액은 수입신고 때 세관이 정한다.
 *
 * 판매용 수입이므로 일반 수입신고 기준(목록통관 없음).
 * 과세가격 = CIF(물품가 + 한국 도착항까지 운임 + 보험료)
 * 관세 = 과세가격 × 관세율 (원 미만 절사)
 * 부가세 = (과세가격 + 관세) × 부가세율 (원 미만 절사)
 */
import { BP, divFloor, toNumber } from './decimal';

export interface DutyInput {
  goodsKrw: number;
  /** 한국 도착항까지 운임(집하·중국 창고·수출통관·국제운송) */
  freightToPortKrw: number;
  /** 보험료 — 모르면 (물품가+운임) × insuranceBp */
  insuranceKrw?: number | null;
  insuranceBp: number;
  dutyRateBp: number;
  vatRateBp: number;
}

export interface DutyEstimate {
  customsValue: number;
  insurance: number;
  duty: number;
  vat: number;
  total: number;
  isEstimate: true;
}

export function estimateDutyVat(i: DutyInput): DutyEstimate {
  for (const [k, v] of Object.entries(i)) {
    if (v == null) continue;
    if (typeof v === 'number' && (!Number.isFinite(v) || v < 0)) throw new RangeError(`${k} 값이 올바르지 않습니다`);
  }
  const insurance =
    i.insuranceKrw ?? toNumber(divFloor(BigInt(i.goodsKrw + i.freightToPortKrw) * BigInt(i.insuranceBp), BP));
  const customsValue = i.goodsKrw + i.freightToPortKrw + insurance;
  const duty = toNumber(divFloor(BigInt(customsValue) * BigInt(i.dutyRateBp), BP));
  const vat = toNumber(divFloor(BigInt(customsValue + duty) * BigInt(i.vatRateBp), BP));
  return { customsValue, insurance, duty, vat, total: duty + vat, isEstimate: true };
}
