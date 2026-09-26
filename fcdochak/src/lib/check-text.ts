/**
 * 청구서 점검 결과를 쓰는 사람 말로 — 화면·보관 목록·시험이 같은 문장을 쓴다. 순수 함수.
 */
import type { InvoiceCheckResult, SegmentCheck } from './money/invoice-check';
import { SEGMENT_LABEL_KO } from './money/segments';
import { won } from './format';

/** bp → 「34%」(부호 없이, 정수) */
export function bpText(bp: number): string {
  return `${Math.round(Math.abs(bp) / 100)}%`;
}

function basis(s: SegmentCheck) {
  return s.benchmark.source === 'reference' ? '플랫폼 참고치' : `요금표 ${s.benchmark.n}장 중간값`;
}

/** 구간 하나에 대한 한 문장. 시세 안이면 null */
export function segmentFinding(s: SegmentCheck): string | null {
  const name = SEGMENT_LABEL_KO[s.segment];
  switch (s.verdict) {
    case 'high': {
      const q3 = s.benchmark.source === 'market' && s.benchmark.q3 != null ? ` 비싼 쪽 25% 경계(${won(s.benchmark.q3)})도 넘습니다.` : '';
      return `${name} — ${basis(s)}보다 ${bpText(s.overMedianBp ?? 0)} 높습니다(+${won(s.diffFromMedian)}).${q3} 단가·수량 근거를 물어보세요.`;
    }
    case 'low':
      return `${name} — ${basis(s)}보다 ${bpText(s.overMedianBp ?? 0)} 낮습니다. 이 구간 일부가 다른 항목이나 나중 청구로 빠져 있지 않은지 확인하세요.`;
    case 'missing': {
      const cov = s.benchmark.source === 'market' && s.benchmark.coverageBp != null ? `같은 구간 요금표 ${bpText(s.benchmark.coverageBp)}가 이 구간을 맡습니다. ` : '';
      return `${name} — 청구서에 없습니다. ${cov}나중에 따로 약 ${won(s.expected)}이 청구될 수 있습니다.`;
    }
    case 'separate':
      return `${name} — 청구서에 없고, 이 구간은 보통 따로 맡깁니다. 따로 들 비용 참고치 약 ${won(s.expected)}.`;
    default:
      return null;
  }
}

/** 한 줄 요약 */
export function checkHeadline(r: InvoiceCheckResult): string {
  const parts: string[] = [];
  if (r.counts.high) parts.push(`과한 구간 ${r.counts.high}곳(중간값보다 +${won(r.highExcess)})`);
  if (r.counts.missing) parts.push(`빠진 구간 ${r.counts.missing}곳(나중 청구 위험 약 ${won(r.missingRisk)})`);
  if (r.counts.low) parts.push(`낮은 구간 ${r.counts.low}곳`);
  if (parts.length === 0) return '9구간 모두 시세 안이거나 비교 기준이 없습니다.';
  return parts.join(' · ');
}

/** 합계 비교 문장. 시장 표본이 모자라면 null */
export function totalFinding(r: InvoiceCheckResult): string | null {
  if (r.market.median == null || r.market.overMedianBp == null) return null;
  const dir = r.market.overMedianBp >= 0 ? '높습니다' : '낮습니다';
  const withMissing = r.missingRisk > 0 ? `빠진 구간 예상을 더한 ${won(r.projectedTotal)}은` : `물류비 합계 ${won(r.invoiceTotal)}은`;
  return `${withMissing} 같은 조건 요금표 ${r.market.cards}장 중간값 ${won(r.market.median)}보다 ${bpText(r.market.overMedianBp)} ${dir}.`;
}
