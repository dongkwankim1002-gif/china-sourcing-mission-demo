/**
 * 점수·후기를 정직하게 — 순수 함수(DB·시계를 읽지 않는다).
 *
 *   scoreBreakdown   추천 점수(scoreParts)를 항목별로: 정시 입고 · 청구 편차 · FC 회송 · 가격 확실성
 *   sampleVerdict    표본이 기준(설정 score_min_sample) 미만이면 점수 대신 「표본 부족(N건)」
 *   deviationSummary 청구 편차 평균 + 나쁜 쪽 10%(청구가 가장 많이 늘어난 상위 10% 건의 평균) — 평균만 보면 한두 번의 큰 초과 청구가 묻힌다
 */
import { SCORE_WEIGHTS, type scoreParts } from './score';

export type ScoreKey = keyof typeof SCORE_WEIGHTS;
export type ScoreParts = ReturnType<typeof scoreParts>;

export const SCORE_ITEM_LABEL: Record<ScoreKey, string> = {
  onTime: '정시 입고',
  deviation: '청구 편차',
  fcReturn: 'FC 회송',
  certainty: '가격 확실성',
};

export interface ScoreItem {
  key: ScoreKey;
  label: string;
  /** 받은 점수(소수 한 자리) */
  points: number;
  /** 이 항목 만점 */
  max: number;
  /** points / max, 0~1 */
  ratio: number;
  /** 실측이 없어 중립값(만점의 절반)으로 채웠는가 */
  neutral: boolean;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** 항목 순서는 가중치 순서(정시 30 · 편차 25 · 회송 25 · 확실성 20) 그대로 */
export function scoreBreakdown(parts: ScoreParts, measured: Partial<Record<ScoreKey, boolean>> = {}): ScoreItem[] {
  return (Object.keys(SCORE_WEIGHTS) as ScoreKey[]).map((key) => {
    const max = SCORE_WEIGHTS[key];
    const points = parts[key];
    return {
      key,
      label: SCORE_ITEM_LABEL[key],
      points: round1(points),
      max,
      ratio: max > 0 ? Math.min(1, Math.max(0, points / max)) : 0,
      neutral: measured[key] === false,
    };
  });
}

export interface SampleRule {
  /** 최근 며칠 */
  days: number;
  /** 최소 건수 */
  count: number;
}

export interface SampleVerdict {
  enough: boolean;
  n: number;
  min: number;
  days: number;
}

export function sampleVerdict(n: number, rule: SampleRule): SampleVerdict {
  const safe = Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  return { enough: safe >= rule.count, n: safe, min: rule.count, days: rule.days };
}

/** 점수 자리에 쓸 글 — 표본이 모자라면 점수 대신 「표본 부족(N건)」 */
export function scoreLabel(score: number, v: SampleVerdict): string {
  return v.enough ? `추천 ${score}점` : `표본 부족(${v.n}건)`;
}

/**
 * 백분위수 — 선형 보간(Postgres percentile_cont 와 같은 정의).
 * 값이 작은 것부터 정렬된 배열을 받지 않아도 된다(안에서 정렬한다).
 */
export function percentile(values: number[], p: number): number | null {
  const a = values.filter((x) => Number.isFinite(x)).sort((x, y) => x - y);
  if (a.length === 0) return null;
  const q = Math.min(1, Math.max(0, p));
  const pos = q * (a.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return a[lo] + (a[hi] - a[lo]) * (pos - lo);
}

export interface DeviationSummary {
  /** 청구 건수 */
  n: number;
  /** 평균 편차(절댓값) — 점수에 쓰는 값 */
  avgAbs: number | null;
  /** 평균 편차(부호 있음, + = 응찰보다 더 청구) */
  avgSigned: number | null;
  /**
   * 나쁜 쪽 10% — 청구가 응찰보다 가장 많이 늘어난 상위 10% 건(최소 1건)의 평균(부호 있음).
   * 90번째 백분위수는 20건 중 2건이 크게 튀어도 그 사이 값으로 묻히므로 쓰지 않는다.
   */
  worst10: number | null;
  /** 나쁜 쪽 10% 에 드는 건수 = ceil(n × 0.1), 최소 1건 */
  worstCount: number;
  /** 가장 나빴던 한 건 */
  max: number | null;
}

/** devs: 청구마다 (청구 합계 − 응찰 합계) / 응찰 합계 */
export function deviationSummary(devs: number[]): DeviationSummary {
  const a = devs.filter((x) => Number.isFinite(x));
  const n = a.length;
  if (n === 0) return { n: 0, avgAbs: null, avgSigned: null, worst10: null, worstCount: 0, max: null };
  const sumAbs = a.reduce((s, x) => s + Math.abs(x), 0);
  const sum = a.reduce((s, x) => s + x, 0);
  const worstCount = Math.max(1, Math.ceil(n * 0.1));
  const worst = [...a].sort((x, y) => y - x).slice(0, worstCount);
  return {
    n,
    avgAbs: sumAbs / n,
    avgSigned: sum / n,
    worst10: worst.reduce((s, x) => s + x, 0) / worstCount,
    worstCount,
    max: worst[0],
  };
}

/** 후기가 어떤 끝으로 끝난 선적인가 — DB 의 fcd.outcome_of 와 같은 규칙 */
export type ReviewOutcome = 'delivered' | 'fc_returned' | 'fc_rejected' | 'lost';

export function outcomeOf(i: { stage: number; returnedUnits: number; rejected: boolean; etaFc: string | null; lostAfterDays: number | null; today: string }): ReviewOutcome | null {
  if (i.stage === 9) return i.returnedUnits > 0 ? 'fc_returned' : 'delivered';
  if (i.rejected) return 'fc_rejected';
  if (i.etaFc && i.lostAfterDays != null) {
    const due = Date.parse(i.etaFc + 'T00:00:00Z') + Math.round(i.lostAfterDays) * 86_400_000;
    if (due < Date.parse(i.today + 'T00:00:00Z')) return 'lost';
  }
  return null;
}
