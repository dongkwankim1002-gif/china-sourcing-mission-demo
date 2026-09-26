/**
 * 원스톱 주문 타임라인 — 접수 → 사입 대금 확인 → 중국 창고 입고 → 검품 → 바코드 → 혼적 출항 → 통관 → FC 입고.
 * 모바일 우선: 좁으면 세로 목록, 넓으면(lg) 가로 여덟 칸. 상태는 아이콘 + 글자로도(끝남·지금·건너뜀·아직).
 * 이은 선적이 더 앞서면 출항·통관·FC 입고는 「선적 기록에서」로 따라온다.
 */
import { AlertTriangle, Check, Circle, CircleDot, Minus } from 'lucide-react';
import { cn } from '@/lib/cn';
import { dateKo, dateTimeKo } from '@/lib/format';
import { ONESTOP_STAGES, stageRank, type OnestopStage } from '@/lib/onestop/settings';
import { ONESTOP_STAGE_LABEL } from '@/lib/terms';

export interface TimelineEvent {
  id: string;
  stage: OnestopStage | 'cancelled' | 'issue';
  note: string | null;
  occurred_at: string;
  actor_name?: string | null;
}

type State = 'done' | 'current' | 'skipped' | 'todo';
const STATE_TEXT: Record<State, string> = { done: '끝남', current: '지금', skipped: '건너뜀', todo: '아직' };

export function OnestopTimeline({
  receivedAt,
  events,
  shown,
  fromShipment,
  shipmentNo,
}: {
  receivedAt: string;
  events: TimelineEvent[];
  shown: OnestopStage | 'cancelled';
  fromShipment: boolean;
  shipmentNo: string | null;
}) {
  const at = new Map<string, TimelineEvent>();
  for (const e of events) if (e.stage !== 'issue' && e.stage !== 'cancelled') at.set(e.stage, e);
  const cancelled = shown === 'cancelled';
  const cur = cancelled ? Math.max(0, ...events.filter((e) => e.stage !== 'issue' && e.stage !== 'cancelled').map((e) => stageRank(e.stage as OnestopStage))) : stageRank(shown);
  const items = ONESTOP_STAGES.map((s) => {
    const r = stageRank(s);
    const ev = s === 'received' ? { occurred_at: receivedAt, note: null } : at.get(s);
    let state: State = r < cur ? (ev ? 'done' : 'skipped') : r === cur ? (cancelled ? 'done' : 'current') : 'todo';
    if (r === cur && s === 'fc_received') state = 'done';
    const viaShipment = !ev && fromShipment && r <= cur && r >= stageRank('departed');
    if (viaShipment) state = r === cur && s !== 'fc_received' ? 'current' : 'done';
    return { s, state, at: ev?.occurred_at ?? null, note: viaShipment ? `선적 ${shipmentNo ?? ''} 기록에서` : (ev?.note ?? null) };
  });
  const summary = cancelled ? '취소한 주문입니다.' : `지금 단계: ${ONESTOP_STAGE_LABEL[shown]} (${cur + 1}/${ONESTOP_STAGES.length}).`;
  const issues = events.filter((e) => e.stage === 'issue' || e.stage === 'cancelled');
  return (
    <div data-testid="onestop-timeline">
      <p className="sr-only">{summary}</p>
      <ol className="grid gap-0 lg:grid-cols-8 lg:gap-[2px]" aria-label="원스톱 주문 단계">
        {items.map((m, i) => {
          const Icon = m.state === 'done' ? Check : m.state === 'current' ? CircleDot : m.state === 'skipped' ? Minus : Circle;
          return (
            <li key={m.s} data-state={m.state} aria-current={m.state === 'current' ? 'step' : undefined} className="relative grid min-w-0 grid-cols-[28px_1fr] gap-x-2 pb-3 lg:block lg:pb-0">
              {i < items.length - 1 ? <span aria-hidden className={cn('absolute left-[13px] top-7 bottom-0 w-[2px] lg:hidden', m.state === 'done' || m.state === 'skipped' ? 'bg-ok' : 'bg-line')} /> : null}
              <span
                aria-hidden
                className={cn(
                  'relative z-[1] grid size-7 place-items-center rounded-sm border-2 lg:hidden',
                  m.state === 'done' && 'border-ok bg-ok text-on-ink',
                  m.state === 'current' && 'border-label bg-label text-on-label',
                  m.state === 'skipped' && 'border-line bg-surface-2 text-muted',
                  m.state === 'todo' && 'border-line bg-surface text-muted',
                )}
              >
                <Icon className="size-3.5" />
              </span>
              <span aria-hidden className={cn('hidden h-2 rounded-[2px] lg:block', m.state === 'done' && 'bg-ok', m.state === 'current' && 'bg-label', m.state === 'skipped' && 'bg-line', m.state === 'todo' && 'bg-line')} />
              <div className="min-w-0 lg:mt-1.5">
                <p className={cn('flex flex-wrap items-center gap-x-1 text-sm font-bold lg:text-xs', m.state === 'todo' || m.state === 'skipped' ? 'text-muted' : 'text-text')}>
                  <Icon aria-hidden className={cn('hidden size-3.5 shrink-0 lg:inline', m.state === 'done' ? 'text-ok' : 'text-muted')} />
                  {ONESTOP_STAGE_LABEL[m.s]}
                  <span className={cn('ml-1 text-2xs font-semibold lg:ml-0', m.state === 'done' ? 'text-ok' : 'text-muted')}>{STATE_TEXT[m.state]}</span>
                </p>
                <p className="text-2xs text-muted tnum">{m.at ? dateKo(m.at, { dow: false }) : '—'}</p>
                {m.note ? <p className="break-words text-2xs text-muted lg:truncate" title={m.note}>{m.note}</p> : null}
              </div>
            </li>
          );
        })}
      </ol>
      {issues.length ? (
        <ul className="mt-3 grid gap-1.5" aria-label="문제·취소 기록" data-testid="onestop-issues">
          {issues.map((e) => (
            <li key={e.id} className={cn('flex items-start gap-2 rounded-sm border px-3 py-2 text-sm', e.stage === 'issue' ? 'border-stamp/40 bg-stamp-bg/50' : 'border-line bg-surface-2')}>
              <AlertTriangle aria-hidden className={cn('mt-0.5 size-4 shrink-0', e.stage === 'issue' ? 'text-stamp' : 'text-muted')} />
              <span className="min-w-0">
                <b>{ONESTOP_STAGE_LABEL[e.stage]}</b> · <span className="tnum text-muted">{dateTimeKo(e.occurred_at)}</span>
                {e.note ? <span className="block break-words">{e.note}</span> : null}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
