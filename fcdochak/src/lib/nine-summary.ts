/**
 * 9구간 막대의 대체 글 — 아홉 칸을 한 줄에 다 읽히면 화면 읽기 프로그램·요약 도구가 중간에서 자른다.
 * 대체 글은 짧은 요약 한 문장(합계 · 가장 큰 구간 · 확정도 칸 수)만 싣고, 구간별 숫자는 표(NineTable)로 따로 둔다.
 * 순수 함수 — 막대 컴포넌트와 시험이 같이 쓴다.
 */
import { SEGMENTS, SEGMENT_LABEL_KO, SEGMENT_LABEL_ZH, type Segment } from './money/segments';

export interface SummarySegment {
  segment: Segment;
  amount: number | null;
  certainty: 'confirmed' | 'estimated' | 'extra_possible' | null;
  filled?: boolean;
}

export type BarUnit = 'won' | 'permille';

const nf = new Intl.NumberFormat('ko-KR');

export function formatBarValue(v: number, unit: BarUnit): string {
  return unit === 'permille' ? `${(Math.round(v) / 10).toFixed(1).replace(/\.0$/, '')}%` : `${nf.format(Math.round(v))}원`;
}

export function nineBarSummary(segments: SummarySegment[], opts: { unit?: BarUnit; locale?: 'ko' | 'zh'; label?: string } = {}): string {
  const unit = opts.unit ?? 'won';
  const zh = opts.locale === 'zh';
  const names = zh ? SEGMENT_LABEL_ZH : SEGMENT_LABEL_KO;
  const by = new Map(segments.map((s) => [s.segment, s]));
  const ordered = SEGMENTS.map((seg) => by.get(seg) ?? { segment: seg, amount: null, certainty: null });
  const present = ordered.filter((s) => s.amount != null && s.amount > 0);
  const total = present.reduce((a, s) => a + (s.amount ?? 0), 0);
  const biggest = present.reduce<SummarySegment | null>((m, s) => (!m || (s.amount ?? 0) > (m.amount ?? 0) ? s : m), null);
  const share = biggest && total > 0 ? Math.round(((biggest.amount ?? 0) / total) * 100) : 0;
  const filled = present.filter((s) => s.filled).length;
  const confirmed = present.filter((s) => !s.filled && s.certainty === 'confirmed').length;
  const estimated = present.length - filled - confirmed;
  const excluded = SEGMENTS.length - present.length;
  const head = opts.label ? `${opts.label}. ` : '';
  if (zh) {
    const t = unit === 'won' ? `合计 ${nf.format(total)}韩元` : '九段占比';
    return `${head}${t}，最大 ${biggest ? `${names[biggest.segment]} ${share}%` : '—'}。确定 ${confirmed} · 预估 ${estimated} · 参考 ${filled} · 不含 ${excluded}。明细见表。`;
  }
  const t = unit === 'won' ? `9구간 합계 ${nf.format(total)}원` : '9구간 비중';
  return `${head}${t}, 가장 큰 구간 ${biggest ? `${names[biggest.segment]} ${share}%` : '없음'}. 확정 ${confirmed}칸 · 예상 ${estimated}칸 · 참고치 ${filled}칸 · 제외 ${excluded}칸. 구간별 금액은 표로 봅니다.`;
}
