/**
 * 목적지에 맞춘 마지막 구간(국내 운송) — 순수 함수.
 *
 * 업체 요금표의 「FC 운송」 줄은 쿠팡 FC 입고 운송·예약을 기준으로 받는다. 목적지가 쿠팡 FC 면 그대로 둔다(예전과 같다).
 * 목적지가 국내 3PL 창고·다른 쇼핑몰 물류센터면 그 줄을 쓰지 않고, 도착항에서 목적지까지의 거리로
 * 플랫폼 참고치를 계산해 바꿔 넣는다: 팔레트 수 × (팔레트당 기본 + km당 × 거리), 최저요금 적용.
 * 바꾼 칸은 참고치(filled, 예상)로 표시되어 확정 합계에 들어가지 않는다.
 * 기준값(팔레트당 기본·km당·최저)은 설정 표 destination_leg 에서 읽어 넘긴다.
 */
import { chargeableQty, summarize, type Cargo, type QuoteParams, type QuoteResult } from './quote';

export type DestinationKind = 'coupang_fc' | '3pl' | 'mall_wh';

export const DESTINATION_KINDS: DestinationKind[] = ['coupang_fc', '3pl', 'mall_wh'];

export const DESTINATION_KIND_LABEL: Record<DestinationKind, string> = {
  coupang_fc: '쿠팡 FC',
  '3pl': '국내 3PL 창고',
  mall_wh: '다른 쇼핑몰 물류센터',
};

export interface DestinationRef {
  code: string;
  kind: DestinationKind;
  km_incheon: number;
  km_pyeongtaek: number;
}

export interface LastLegRule {
  /** 팔레트당 기본(원) */
  perPalletBase: number;
  /** 팔레트당 km당(원) */
  perPalletPerKm: number;
  /** 최저요금(원) */
  minCharge: number;
}

export function isCoupangFc(d: Pick<DestinationRef, 'kind'> | null | undefined): boolean {
  return !d || d.kind === 'coupang_fc';
}

/** 도착항 → 목적지 도로 거리(km). 평택항이 아니면 인천항 기준. */
export function destinationKm(d: DestinationRef, port: string): number {
  return port === 'PTK' ? d.km_pyeongtaek : d.km_incheon;
}

function checkRule(rule: LastLegRule) {
  for (const [k, v] of Object.entries(rule)) {
    if (!Number.isSafeInteger(v) || v < 0) throw new RangeError(`마지막 구간 기준값이 올바르지 않습니다: ${k}=${v}`);
  }
}

/** 마지막 구간 참고치(원) — 팔레트 수 × (기본 + km × km당), 최저요금 */
export function lastLegAmount(cargo: Cargo, d: DestinationRef, port: string, rule: LastLegRule, p: QuoteParams) {
  checkRule(rule);
  const km = destinationKm(d, port);
  if (!Number.isFinite(km) || km < 0) throw new RangeError(`목적지 거리가 올바르지 않습니다: ${d.code}=${km}`);
  const pallets = chargeableQty('per_pallet', cargo, p);
  const perPallet = rule.perPalletBase + Math.round(km) * rule.perPalletPerKm;
  const raw = pallets * perPallet;
  const minApplied = raw < rule.minCharge;
  return { amount: minApplied ? rule.minCharge : raw, pallets, km: Math.round(km), perPallet, minApplied };
}

/**
 * 견적 결과에 목적지를 반영한다. 쿠팡 FC(또는 목적지·기준값을 모르면)는 그대로 돌려준다.
 * 그 밖이면 「FC 운송」 칸을 거리 기준 참고치로 바꾸고 합계를 다시 센다.
 */
export function applyDestination(
  result: QuoteResult,
  cargo: Cargo,
  d: DestinationRef | null | undefined,
  port: string,
  rule: LastLegRule | null | undefined,
  p: QuoteParams,
): QuoteResult {
  if (!d || isCoupangFc(d) || !rule) return result;
  const leg = lastLegAmount(cargo, d, port, rule, p);
  const segments = result.segments.map((s) =>
    s.segment === 'fc_delivery'
      ? { ...s, included: true, amount: leg.amount, certainty: 'estimated' as const, basis: 'per_pallet' as const, qty: leg.pallets, discountBp: 0, minApplied: leg.minApplied, filled: true }
      : s,
  );
  return summarize(segments, cargo.units);
}
