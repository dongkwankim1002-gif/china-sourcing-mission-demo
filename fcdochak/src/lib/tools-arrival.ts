/**
 * 공개 판매손익 계산기의 「구간 시세로 도착원가」 응답 — 순수 함수.
 * 여러 업체 견적의 집계(중간값·최저·싼 쪽 4분의 1·구간별 중간값)만 싣고, 업체별 금액은 싣지 않는다.
 * 화물 특성 때문에 뺀 업체는 이름과 사유만(가격 없음).
 */
import type { CompareResult, Offer, PartnerBrief } from './server/compare';
import { SEGMENTS, SEGMENTS_TO_KR_PORT, type Segment } from './money/segments';
import { reasonText } from './money/eligibility';
import { groupExclusions, summarizeArrival, type ArrivalOfferLike } from './money/seller';

export interface ArrivalResponse {
  count: number;
  /** 요금표를 낸 업체 수(같은 업체의 요금표 여러 장은 한 곳) */
  partners: number;
  /** market = 업체 요금표 집계 · reference = 업체가 적어 플랫폼 참고치(한 업체 가격이 드러나지 않게) */
  basis: 'market' | 'reference';
  median: number;
  /** 표본이 적으면(tools.arrival_rule.minSpreadSamples 미만) 싣지 않는다 */
  min: number | null;
  q1: number | null;
  toPortMedian: number;
  perUnitMedian: number;
  segments: { segment: Segment; amount: number | null }[];
  segmentMedianSum: number;
  excluded: { name: string; mode: string; reasons: string[] }[];
  excludedGroups: { reason: string; count: number; names: string[] }[];
  verdicts: { code: string; name: string; text: string; requirement: string }[];
}

const TRAIT_KINDS = new Set(['capability', 'mode_blocked']);

/** 설정 tools.arrival_rule — 공개 도착원가의 최소 표본과 비로그인 분당 횟수 */
export interface ArrivalRule {
  /** 요금표를 낸 업체가 이보다 적으면 업체 집계 대신 플랫폼 참고치 */
  minSamples: number;
  /** 요금표가 이보다 적으면 최저·싼 쪽 4분의 1 을 싣지 않는다 */
  minSpreadSamples: number;
  /** 비로그인 IP 당 분당 횟수 */
  perMinute: number;
}

export function parseArrivalRule(v: unknown): ArrivalRule {
  const o = (v ?? {}) as Record<string, unknown>;
  for (const k of ['minSamples', 'minSpreadSamples', 'perMinute'] as const) {
    if (typeof o[k] !== 'number' || !Number.isInteger(o[k]) || (o[k] as number) < 1) {
      throw new Error(`설정 tools.arrival_rule.${k} 가 없거나 1 이상 정수가 아닙니다. 참조 시드를 올려 주세요.`);
    }
  }
  return { minSamples: o.minSamples as number, minSpreadSamples: o.minSpreadSamples as number, perMinute: o.perMinute as number };
}

export function buildArrivalResponse(
  result: Pick<CompareResult, 'offers' | 'excluded' | 'verdicts'>,
  opts: {
    okOrg: (p: PartnerBrief) => boolean;
    units: number;
    rule: Pick<ArrivalRule, 'minSamples' | 'minSpreadSamples'>;
    /** 플랫폼 참고치로 계산한 같은 화물 견적 — 업체가 적을 때 대신 싣는다 */
    reference: ArrivalOfferLike;
  },
): ArrivalResponse {
  const offers = (result.offers as Offer[]).filter((o) => opts.okOrg(o.partner));
  const partners = new Set(offers.map((o) => o.partner.id)).size;
  const likes: ArrivalOfferLike[] = offers.map((o) => ({
    total: o.quote.total,
    toPort: o.quote.segments.filter((x) => SEGMENTS_TO_KR_PORT.includes(x.segment)).reduce((a, x) => a + (x.amount ?? 0), 0),
    segments: o.quote.segments.map((x) => ({ segment: x.segment, amount: x.amount })),
  }));
  // 업체가 적으면 업체 집계를 내지 않는다 — 한 곳뿐이면 중간값 = 그 업체 총액, 구간별 중간값 = 그 업체 요금표가 된다
  const basis: ArrivalResponse['basis'] = offers.length > 0 && partners < Math.max(1, opts.rule.minSamples) ? 'reference' : 'market';
  const sum = summarizeArrival(basis === 'reference' ? [opts.reference] : likes);
  const spread = basis === 'market' && offers.length >= Math.max(1, opts.rule.minSpreadSamples, opts.rule.minSamples);
  // 화물 특성 때문에 빠진 업체만(만료·거둠은 도구에서 다루지 않는다). 한 업체·방식이 여러 요금표면 한 줄로.
  const byName = new Map<string, { name: string; mode: string; reasons: string[] }>();
  for (const o of result.excluded as Offer[]) {
    if (!opts.okOrg(o.partner)) continue;
    const rs = o.exclusions.filter((e) => TRAIT_KINDS.has(e.kind)).map(reasonText);
    if (!rs.length) continue;
    const k = `${o.partner.name}\u0000${o.mode}`;
    const prev = byName.get(k);
    if (prev) prev.reasons = [...new Set([...prev.reasons, ...rs])];
    else byName.set(k, { name: o.partner.name, mode: o.mode, reasons: rs });
  }
  const excluded = [...byName.values()].sort((a, b) => a.name.localeCompare(b.name, 'ko') || a.mode.localeCompare(b.mode));
  const units = Math.max(1, opts.units);
  return {
    count: offers.length,
    partners,
    basis,
    median: sum.median,
    min: spread ? sum.min : null,
    q1: spread ? sum.q1 : null,
    toPortMedian: sum.toPortMedian,
    perUnitMedian: sum.count ? Math.round(sum.median / units) : 0,
    segments: SEGMENTS.map((s) => ({ segment: s, amount: sum.count ? (sum.segmentMedians[s] ?? null) : null })),
    segmentMedianSum: sum.segmentMedianSum,
    excluded,
    excludedGroups: groupExclusions(excluded),
    verdicts: result.verdicts.map((v) => ({ code: v.code, name: v.name_ko, text: v.verdict_ko, requirement: v.requirement_ko })),
  };
}
