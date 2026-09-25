/**
 * 순위 — 정렬 기준과 특수관계 업체 처리. 순수 함수(DB·시계를 읽지 않는다). 공개 계산기와 비교 화면이 같이 쓴다.
 *
 * 특수관계 업체(orgs.related_party_note 가 있는 곳)는 기본으로 순위에서 뺀다.
 * 「특수관계 포함」을 켜면 넣되, 그때 1위가 특수관계면 화면이 경고 띠를 띄운다(relatedTop).
 */
export type SortKey = 'recommend' | 'cheapest' | 'fastest' | 'deviation';

export const SORT_LABEL: Record<SortKey, string> = {
  cheapest: '가격순',
  recommend: '추천 점수순',
  fastest: '빠른 순',
  deviation: '청구 편차 적은 순',
};

export interface Rankable {
  score: number;
  quote: { total: number };
  transit: [number, number];
  metrics: { avg_deviation: number | null } | null;
  partner: { related_party_note: string | null };
}

export function isRelated(o: Pick<Rankable, 'partner'>): boolean {
  return !!o.partner.related_party_note?.trim();
}

export function parseSortKey(v: string | null | undefined, dflt: SortKey): SortKey {
  return v && v in SORT_LABEL ? (v as SortKey) : dflt;
}

export function sortOffers<T extends Rankable>(list: T[], key: SortKey): T[] {
  const a = [...list];
  switch (key) {
    case 'cheapest':
      return a.sort((x, y) => x.quote.total - y.quote.total || y.score - x.score);
    case 'fastest':
      return a.sort((x, y) => x.transit[0] - y.transit[0] || x.transit[1] - y.transit[1] || x.quote.total - y.quote.total);
    case 'deviation':
      return a.sort((x, y) => (x.metrics?.avg_deviation ?? 9) - (y.metrics?.avg_deviation ?? 9) || x.quote.total - y.quote.total);
    default:
      return a.sort((x, y) => y.score - x.score || x.quote.total - y.quote.total);
  }
}

export interface Ranked<T> {
  list: T[];
  sort: SortKey;
  includeRelated: boolean;
  /** 순위에서 뺀 특수관계 업체 수(포함을 켜면 0) */
  relatedHidden: number;
  /** 순위 안에 든 특수관계 업체 수 */
  relatedShown: number;
  /** 1위가 특수관계 업체인가 — 경고 띠 */
  relatedTop: boolean;
}

export function rankOffers<T extends Rankable>(list: T[], opts: { sort: SortKey; includeRelated: boolean }): Ranked<T> {
  const related = list.filter(isRelated);
  const pool = opts.includeRelated ? list : list.filter((o) => !isRelated(o));
  const sorted = sortOffers(pool, opts.sort);
  return {
    list: sorted,
    sort: opts.sort,
    includeRelated: opts.includeRelated,
    relatedHidden: opts.includeRelated ? 0 : related.length,
    relatedShown: opts.includeRelated ? related.length : 0,
    relatedTop: sorted.length > 0 && isRelated(sorted[0]),
  };
}

/** 「상위 N곳 총액」 제목 — 실제 개수에 따라 */
export function topTitle(n: number): string {
  if (n <= 0) return '맞는 업체 없음';
  if (n === 1) return '맞는 1곳 총액';
  return `상위 ${n}곳 총액`;
}
