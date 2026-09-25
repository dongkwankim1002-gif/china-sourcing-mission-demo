/**
 * 추천 점수 항목별 보기(v2 trust) — 정시 입고 · 청구 편차 · FC 회송 · 가격 확실성.
 * 표본이 기준 미만이면 점수와 항목 점수를 싣지 않고 「표본 부족(N건)」과 잰 값만 보인다.
 * 서버·클라이언트 어디서나 그릴 수 있다(상태 없음).
 */
import { cn } from '@/lib/cn';
import { num, pct } from '@/lib/format';
import { scoreBreakdown, type DeviationSummary, type SampleVerdict, type ScoreKey, type ScoreParts } from '@/lib/money';

export interface TrustView {
  sample: SampleVerdict;
  deviation: DeviationSummary;
  returned: number;
  rejected: number;
  lost: number;
}

export interface MetricsView {
  shipments_done: number | null;
  on_time_rate: number | null;
  return_rate_30d: number | null;
  done_30d: number | null;
  invoiced_count: number | null;
}

function measures(m: MetricsView | null, t: TrustView, certainty: number | null): Record<ScoreKey, { text: string; measured: boolean }> {
  const dev = t.deviation;
  const fail = [t.rejected ? `반려 ${num(t.rejected)}건` : null, t.lost ? `분실·미도착 ${num(t.lost)}건` : null].filter(Boolean).join(' · ');
  return {
    onTime: m?.shipments_done
      ? { text: `${pct(m.on_time_rate, 0)} · 입고 ${num(m.shipments_done)}건`, measured: true }
      : { text: '실측 없음(중립값)', measured: false },
    deviation: dev.n
      ? { text: `평균 ${pct(dev.avgAbs, 1)} · 나쁜 쪽 10%(${num(dev.worstCount)}건) 평균 ${pct(dev.worst10, 1, true)} · 청구 ${num(dev.n)}건`, measured: true }
      : { text: '실측 없음(중립값)', measured: false },
    fcReturn: m?.done_30d
      ? { text: `30일 회송률 ${pct(m.return_rate_30d, 1)} · 입고 ${num(m.done_30d)}건${fail ? ` · ${fail}` : ''}`, measured: true }
      : { text: `실측 없음(중립값)${fail ? ` · ${fail}` : ''}`, measured: false },
    certainty: { text: certainty == null ? '확정 구간 비중 없음' : `확정 구간 ${pct(certainty, 0)}`, measured: certainty != null },
  };
}

export function sampleSentence(s: SampleVerdict) {
  return `최근 ${s.days}일 끝난 선적 ${num(s.n)}건 · 점수 기준 ${num(s.min)}건`;
}

export function ScoreBreakdown({
  parts,
  score,
  trust,
  metrics,
  certainty,
  certaintyNote,
  variant = 'full',
  className,
}: {
  parts: ScoreParts;
  score: number;
  trust: TrustView;
  metrics: MetricsView | null;
  /** 가격 확실성 잰 값(0~1) */
  certainty: number | null;
  certaintyNote?: string;
  variant?: 'full' | 'inline';
  className?: string;
}) {
  const ms = measures(metrics, trust, certainty);
  const items = scoreBreakdown(parts, { onTime: ms.onTime.measured, deviation: ms.deviation.measured, fcReturn: ms.fcReturn.measured });
  const enough = trust.sample.enough;

  if (variant === 'inline') {
    return (
      <p data-testid="score-breakdown" data-enough={enough ? 'yes' : 'no'} className={cn('text-2xs text-muted tnum', className)}>
        {enough ? (
          <>
            <b className="text-text">추천 {score}점</b>
            {items.map((it) => (
              <span key={it.key}>
                {' · '}
                {it.label} {it.points.toFixed(1)}/{it.max}
                {it.neutral ? '(실측 없음)' : ''}
              </span>
            ))}
          </>
        ) : (
          <>
            <b className="text-caution">표본 부족({num(trust.sample.n)}건)</b> — 점수를 내지 않습니다 · {sampleSentence(trust.sample)}
          </>
        )}
        {trust.deviation.n ? <span> · 청구 편차 평균 {pct(trust.deviation.avgAbs, 1)}, 나쁜 쪽 10%({num(trust.deviation.worstCount)}건) 평균 {pct(trust.deviation.worst10, 1, true)}</span> : null}
      </p>
    );
  }

  return (
    <div data-testid="score-breakdown" data-enough={enough ? 'yes' : 'no'} className={cn('grid gap-3 p-4', className)}>
      <div className="flex flex-wrap items-end justify-between gap-2">
        {enough ? (
          <p className="display text-3xl tnum">
            {score}
            <span className="ml-1 text-base text-muted">/ 100</span>
          </p>
        ) : (
          <p className="display text-2xl text-caution">표본 부족({num(trust.sample.n)}건)</p>
        )}
        <p className="text-2xs text-muted">{sampleSentence(trust.sample)}</p>
      </div>
      {!enough ? (
        <p className="rounded-sm bg-caution-bg p-2 text-xs text-text">
          표본이 기준에 못 미쳐 추천 점수와 항목 점수를 내지 않습니다. 아래는 지금까지 잰 값입니다.
        </p>
      ) : null}
      <ul className="grid gap-2.5">
        {items.map((it) => (
          <li key={it.key} className="grid gap-1 sm:grid-cols-[112px_minmax(0,1fr)_76px] sm:items-center sm:gap-3">
            <span className="text-sm font-semibold">{it.label}</span>
            <span className="min-w-0">
              {enough ? (
                <span className="block h-2 overflow-hidden rounded-xs bg-surface-2" aria-hidden>
                  <span className={cn('block h-full rounded-xs', it.neutral ? 'bg-muted/40' : 'bg-ink')} style={{ width: `${Math.round(it.ratio * 100)}%` }} />
                </span>
              ) : null}
              <span className="mt-1 block text-2xs text-muted">
                {ms[it.key].text}
                {it.key === 'certainty' && certaintyNote ? ` · ${certaintyNote}` : ''}
              </span>
            </span>
            <span className="text-sm font-bold tnum sm:text-right">{enough ? `${it.points.toFixed(1)} / ${it.max}` : `— / ${it.max}`}</span>
          </li>
        ))}
      </ul>
      <p className="text-2xs text-muted">
        가중치: 정시 입고 30 · 청구 편차 25 · FC 회송 25 · 가격 확실성 20. 실측이 없는 항목은 절반(중립값)으로 셉니다. 광고·특수관계는 점수에 들어가지 않습니다.
      </p>
    </div>
  );
}
