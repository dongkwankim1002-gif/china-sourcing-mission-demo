/**
 * 공개 계산기 응답 — 첫 화면(서버 첫 칠)과 /api/quote 가 같은 모양을 같은 함수로 만든다.
 * 순수 함수. 비로그인(detail=false)이면 구간 금액 대신 비중(천분율)만 싣는다.
 */
import type { CompareResult, Offer } from './server/compare';
import type { Segment } from './money/segments';
import { totalsBreakdown, type TotalsBreakdown } from './money/totals';
import { isRelated, rankOffers, type SortKey } from './ranking';
import { reasonText } from './money/eligibility';

export type PublicSort = Extract<SortKey, 'cheapest' | 'recommend'>;

export interface QuoteTop {
  name: string;
  slug: string;
  status: string;
  logo: string | null;
  total: number;
  perUnit: number;
  mode: string;
  transit: [number, number];
  filled: number;
  related: boolean;
  relatedNote: string | null;
  score: number;
  totals: TotalsBreakdown;
  /** v2 trust — 표본이 기준 미만이면 점수 대신 「표본 부족(N건)」 */
  sampleEnough: boolean;
  sampleN: number;
}

export interface QuoteResponse {
  count: number;
  excluded: number;
  sort: PublicSort;
  includeRelated: boolean;
  relatedHidden: number;
  relatedTop: boolean;
  top: QuoteTop[];
  bar: { segment: Segment; amount: number | null; certainty: 'confirmed' | 'estimated' | 'extra_possible' | null; filled: boolean }[] | null;
  barUnit: 'won' | 'permille';
  verdicts: { code: string; name: string; text: string }[];
  /** v2 tools — 조건(화물 특성 등)이 안 맞아 뺀 업체의 이름과 사유(가격 없음) */
  excludedList: { name: string; mode: string; reasons: string[] }[];
  /** 쿠팡 FC 밖 목적지 — 「FC 운송」 칸을 거리 기준 참고치로 바꿔 계산했을 때만 */
  destination?: { code: string; name: string; kind: string } | null;
}

export function parsePublicSort(v: string | null | undefined): PublicSort {
  return v === 'recommend' ? 'recommend' : 'cheapest';
}

export function buildQuoteResponse(
  result: Pick<CompareResult, 'offers' | 'excluded' | 'verdicts'> & Partial<Pick<CompareResult, 'destination'>>,
  opts: { sort: PublicSort; includeRelated: boolean; detail: boolean; limit?: number },
): QuoteResponse {
  const ranked = rankOffers(result.offers as Offer[], { sort: opts.sort, includeRelated: opts.includeRelated });
  const top = ranked.list.slice(0, opts.limit ?? 5);
  const best = top[0];
  return {
    count: ranked.list.length,
    excluded: result.excluded.length,
    sort: opts.sort,
    includeRelated: opts.includeRelated,
    relatedHidden: ranked.relatedHidden,
    relatedTop: ranked.relatedTop,
    top: top.map((o) => ({
      name: o.partner.name,
      slug: o.partner.slug ?? '',
      status: o.partner.status,
      logo: o.partner.logo_path,
      total: o.quote.total,
      perUnit: o.quote.perUnit,
      mode: o.mode,
      transit: o.transit,
      filled: o.quote.filled.length,
      related: isRelated(o),
      relatedNote: isRelated(o) ? o.partner.related_party_note : null,
      score: o.score,
      totals: totalsBreakdown(o.quote.segments),
      sampleEnough: o.trust?.sample.enough ?? true,
      sampleN: o.trust?.sample.n ?? 0,
    })),
    bar: best
      ? best.quote.segments.map((s) => ({
          segment: s.segment,
          amount: s.amount == null ? null : opts.detail ? s.amount : Math.round((s.amount / Math.max(best.quote.total, 1)) * 1000),
          certainty: s.certainty,
          filled: s.filled,
        }))
      : null,
    barUnit: opts.detail ? 'won' : 'permille',
    verdicts: result.verdicts.map((v) => ({ code: v.code, name: v.name_ko, text: v.verdict_ko })),
    excludedList: (result.excluded as Offer[]).map((o) => ({ name: o.partner.name, mode: o.mode, reasons: o.exclusions.map(reasonText) })),
    destination: result.destination ? { code: result.destination.code, name: result.destination.name, kind: result.destination.kind } : null,
  };
}
