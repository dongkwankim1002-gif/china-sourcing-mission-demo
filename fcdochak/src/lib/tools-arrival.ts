/**
 * 공개 판매손익 계산기의 「구간 시세로 도착원가」 응답 — 순수 함수.
 * 여러 업체 견적의 집계(중간값·최저·싼 쪽 4분의 1·구간별 중간값)만 싣고, 업체별 금액은 싣지 않는다.
 * 화물 특성 때문에 뺀 업체는 이름과 사유만(가격 없음).
 */
import type { CompareResult, Offer, PartnerBrief } from './server/compare';
import { SEGMENTS, SEGMENTS_TO_KR_PORT, type Segment } from './money/segments';
import { reasonText } from './money/eligibility';
import { groupExclusions, summarizeArrival } from './money/seller';

export interface ArrivalResponse {
  count: number;
  median: number;
  min: number;
  q1: number;
  toPortMedian: number;
  perUnitMedian: number;
  segments: { segment: Segment; amount: number | null }[];
  segmentMedianSum: number;
  excluded: { name: string; mode: string; reasons: string[] }[];
  excludedGroups: { reason: string; count: number; names: string[] }[];
  verdicts: { code: string; name: string; text: string; requirement: string }[];
}

const TRAIT_KINDS = new Set(['capability', 'mode_blocked']);

export function buildArrivalResponse(
  result: Pick<CompareResult, 'offers' | 'excluded' | 'verdicts'>,
  opts: { okOrg: (p: PartnerBrief) => boolean; units: number },
): ArrivalResponse {
  const offers = (result.offers as Offer[]).filter((o) => opts.okOrg(o.partner));
  const sum = summarizeArrival(
    offers.map((o) => ({
      total: o.quote.total,
      toPort: o.quote.segments.filter((x) => SEGMENTS_TO_KR_PORT.includes(x.segment)).reduce((a, x) => a + (x.amount ?? 0), 0),
      segments: o.quote.segments.map((x) => ({ segment: x.segment, amount: x.amount })),
    })),
  );
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
    count: sum.count,
    median: sum.median,
    min: sum.min,
    q1: sum.q1,
    toPortMedian: sum.toPortMedian,
    perUnitMedian: sum.count ? Math.round(sum.median / units) : 0,
    segments: SEGMENTS.map((s) => ({ segment: s, amount: sum.count ? (sum.segmentMedians[s] ?? null) : null })),
    segmentMedianSum: sum.segmentMedianSum,
    excluded,
    excludedGroups: groupExclusions(excluded),
    verdicts: result.verdicts.map((v) => ({ code: v.code, name: v.name_ko, text: v.verdict_ko, requirement: v.requirement_ko })),
  };
}
