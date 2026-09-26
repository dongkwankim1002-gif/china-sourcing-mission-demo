/**
 * 유사도 점수 — 순수 함수(docs/sourcing-plan.md 5절). 0~100점 + 항목별 까닭.
 *   낱말: 낱말 + 글자 두 개 묶음(한글·한자 붙여 쓴 말 대비)의 Dice 계수
 *   분류: 같은 관세 분류면 만점
 *   가격대: 후보 단가(원)가 기대 매입가(목표 판매가 × 비율)의 ±폭 안이면 만점, 두 배 폭까지 줄어 0
 *   이미지: 차후(가중치 자리만 — 지금은 셈하지 않는다)
 * 항목 자료가 없으면(목표 판매가·후보 분류·단가 없음) 그 항목을 빼고 나머지 비중으로 다시 나눈다.
 * 정렬·참고용이다 — 「같은 상품」 판정도, 지식재산 침해 판단도 아니다.
 */
import { expectedUnitCostKrw } from '../money/sourcing';
import type { SimilarityWeights } from './settings';

export interface SimilarityRequest {
  productName: string;
  keywords?: readonly string[];
  category: string;
  targetPrice: number | null;
}

export interface SimilarityCandidate {
  productTitle: string;
  category: string | null;
  /** 발주 수량 기준 개당 단가(원 환산) */
  unitPriceKrw: number | null;
}

export interface SimilarityRule {
  weights: SimilarityWeights;
  targetCostShareBp: number;
  priceBandBp: number;
}

export interface SimilarityResult {
  score: number;
  /** 항목별 0~100(셈하지 않은 항목은 null) */
  word: number | null;
  category: number | null;
  price: number | null;
  image: null;
  /** 겹친 낱말(보여 주기용, 최대 6개) */
  shared: string[];
  level: 'high' | 'mid' | 'low';
}

const CJK = /[\p{Script=Hangul}\p{Script=Han}]/u;

/** 낱말 나누기 — NFKC·소문자, 글자·숫자가 아닌 것으로 가른다 */
export function tokenize(s: string): string[] {
  return s
    .normalize('NFKC')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 0);
}

/** 비교할 조각 — 두 글자 이상 낱말 + 한글·한자 낱말의 두 글자 묶음. 한 글자 라틴·숫자는 뺀다 */
export function termSet(s: string, extra: readonly string[] = []): Set<string> {
  const out = new Set<string>();
  for (const t of [...tokenize(s), ...extra.flatMap((k) => tokenize(k))]) {
    if (t.length >= 2 || CJK.test(t)) out.add(t);
    if (CJK.test(t) && t.length > 2) for (let i = 0; i + 2 <= t.length; i++) out.add(`~${t.slice(i, i + 2)}`);
  }
  return out;
}

export function wordScore(a: Set<string>, b: Set<string>): { score: number; shared: string[] } {
  if (!a.size || !b.size) return { score: 0, shared: [] };
  const shared = [...a].filter((x) => b.has(x));
  const score = Math.round((200 * shared.length) / (a.size + b.size));
  return { score: Math.min(100, score), shared: shared.filter((x) => !x.startsWith('~')).slice(0, 6) };
}

/** 가격대 점수 — 기대 매입가와의 차이(bp)가 폭 이하면 100, 두 배 폭 이상이면 0 */
export function priceScore(unitPriceKrw: number, expectedKrw: number, bandBp: number): number {
  if (!(expectedKrw > 0) || !(unitPriceKrw > 0) || !(bandBp > 0)) return 0;
  const diffBp = (Math.abs(unitPriceKrw - expectedKrw) * 10000) / expectedKrw;
  if (diffBp <= bandBp) return 100;
  if (diffBp >= 2 * bandBp) return 0;
  return Math.round((100 * (2 * bandBp - diffBp)) / bandBp);
}

export function similarityScore(r: SimilarityRequest, c: SimilarityCandidate, rule: SimilarityRule): SimilarityResult {
  const w = rule.weights;
  const ws = wordScore(termSet(r.productName, r.keywords ?? []), termSet(c.productTitle));
  const category = c.category ? (c.category === r.category ? 100 : 0) : null;
  const price =
    r.targetPrice != null && r.targetPrice > 0 && c.unitPriceKrw != null && c.unitPriceKrw > 0
      ? priceScore(c.unitPriceKrw, expectedUnitCostKrw(r.targetPrice, rule.targetCostShareBp), rule.priceBandBp)
      : null;
  const parts: [number | null, number][] = [
    [ws.score, w.wordBp],
    [category, w.categoryBp],
    [price, w.priceBp],
  ];
  let num = 0;
  let den = 0;
  for (const [s, wt] of parts) {
    if (s == null || wt <= 0) continue;
    num += s * wt;
    den += wt;
  }
  const score = den > 0 ? Math.round(num / den) : 0;
  const level: SimilarityResult['level'] = score >= Math.max(w.minShow, 60) ? 'high' : score >= w.minShow ? 'mid' : 'low';
  return { score, word: ws.score, category, price, image: null, shared: ws.shared, level };
}

export const SIMILARITY_LEVEL_LABEL: Record<SimilarityResult['level'], string> = {
  high: '많이 비슷함',
  mid: '조금 비슷함',
  low: '비슷하지 않음',
};
