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

const ITEM_LABEL_ZH: Record<ScoreKey, string> = { onTime: '准时入库', deviation: '账单偏差', fcReturn: 'FC退回', certainty: '价格确定性' };

function measures(m: MetricsView | null, t: TrustView, certainty: number | null, zh = false): Record<ScoreKey, { text: string; measured: boolean }> {
  const dev = t.deviation;
  const none = zh ? '无实测(按中间值)' : '실측 없음(중립값)';
  const fail = [
    t.rejected ? (zh ? `拒收 ${num(t.rejected)}票` : `반려 ${num(t.rejected)}건`) : null,
    t.lost ? (zh ? `丢失·未到 ${num(t.lost)}票` : `분실·미도착 ${num(t.lost)}건`) : null,
  ]
    .filter(Boolean)
    .join(' · ');
  return {
    onTime: m?.shipments_done
      ? { text: zh ? `${pct(m.on_time_rate, 0)} · 入库 ${num(m.shipments_done)}票` : `${pct(m.on_time_rate, 0)} · 입고 ${num(m.shipments_done)}건`, measured: true }
      : { text: none, measured: false },
    deviation: dev.n
      ? {
          text: zh
            ? `平均 ${pct(dev.avgAbs, 1)} · 最差10%(${num(dev.worstCount)}票) 平均 ${pct(dev.worst10, 1, true)} · 账单 ${num(dev.n)}张`
            : `평균 ${pct(dev.avgAbs, 1)} · 나쁜 쪽 10%(${num(dev.worstCount)}건) 평균 ${pct(dev.worst10, 1, true)} · 청구 ${num(dev.n)}건`,
          measured: true,
        }
      : { text: none, measured: false },
    fcReturn: m?.done_30d
      ? {
          text: zh
            ? `30天退回率 ${pct(m.return_rate_30d, 1)} · 入库 ${num(m.done_30d)}票${fail ? ` · ${fail}` : ''}`
            : `30일 회송률 ${pct(m.return_rate_30d, 1)} · 입고 ${num(m.done_30d)}건${fail ? ` · ${fail}` : ''}`,
          measured: true,
        }
      : { text: `${none}${fail ? ` · ${fail}` : ''}`, measured: false },
    certainty: {
      text: certainty == null ? (zh ? '无确定区段占比' : '확정 구간 비중 없음') : zh ? `确定区段 ${pct(certainty, 0)}` : `확정 구간 ${pct(certainty, 0)}`,
      measured: certainty != null,
    },
  };
}

export function sampleSentence(s: SampleVerdict, zh = false) {
  return zh ? `最近 ${s.days} 天完成 ${num(s.n)} 票 · 评分标准 ${num(s.min)} 票` : `최근 ${s.days}일 끝난 선적 ${num(s.n)}건 · 점수 기준 ${num(s.min)}건`;
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
  zh = false,
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
  /** 물류사 콘솔에서 중국어를 고른 경우(항목 이름·잰 값·안내를 중국어로) */
  zh?: boolean;
}) {
  const ms = measures(metrics, trust, certainty, zh);
  const label = (k: ScoreKey, ko: string) => (zh ? ITEM_LABEL_ZH[k] : ko);
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
          <p className="display text-2xl text-caution">{zh ? `样本不足(${num(trust.sample.n)}票)` : `표본 부족(${num(trust.sample.n)}건)`}</p>
        )}
        <p className="text-2xs text-muted">{sampleSentence(trust.sample, zh)}</p>
      </div>
      {!enough ? (
        <p className="rounded-sm bg-caution-bg p-2 text-xs text-text">
          {zh ? '样本未达标准，不显示推荐分和分项分。以下为目前实测值。' : '표본이 기준에 못 미쳐 추천 점수와 항목 점수를 내지 않습니다. 아래는 지금까지 잰 값입니다.'}
        </p>
      ) : null}
      <ul className="grid gap-2.5">
        {items.map((it) => (
          <li key={it.key} className="grid gap-1 sm:grid-cols-[112px_minmax(0,1fr)_76px] sm:items-center sm:gap-3">
            <span className="text-sm font-semibold">{label(it.key, it.label)}</span>
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
        {zh
          ? '权重：准时入库 30 · 账单偏差 25 · FC退回 25 · 价格确定性 20。无实测的项目按一半(中间值)计算。广告·关联关系不计入评分。'
          : '가중치: 정시 입고 30 · 청구 편차 25 · FC 회송 25 · 가격 확실성 20. 실측이 없는 항목은 절반(중립값)으로 셉니다. 광고·특수관계는 점수에 들어가지 않습니다.'}
      </p>
    </div>
  );
}
