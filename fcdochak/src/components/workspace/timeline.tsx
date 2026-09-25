/**
 * 선적 한눈 타임라인 — 견적 → 예약 → 출항 → 입항 → 통관 → FC 입고 → 청구.
 * 상태는 색만이 아니라 아이콘 + 글자로도 싣는다. 넓으면 가로 일곱 칸, 좁으면(390) 세로 목록.
 */
import { AlertTriangle, Check, Circle, CircleDot } from 'lucide-react';
import { cn } from '@/lib/cn';
import { dateKo } from '@/lib/format';
import { timelineSummary, type Milestone } from '@/lib/workspace/timeline';

const STATE_TEXT = { done: '끝남', current: '지금', todo: '아직', attention: '확인 필요' } as const;

export function ShipmentTimeline({ items }: { items: Milestone[] }) {
  return (
    <div data-testid="shipment-timeline">
      <p className="sr-only">{timelineSummary(items)}</p>
      <ol className="grid gap-0 lg:grid-cols-7 lg:gap-[2px]" aria-label="선적 한눈 타임라인">
        {items.map((m, i) => {
          const Icon = m.state === 'done' ? Check : m.state === 'attention' ? AlertTriangle : m.state === 'current' ? CircleDot : Circle;
          return (
            <li
              key={m.key}
              aria-current={m.state === 'current' || m.state === 'attention' ? 'step' : undefined}
              data-state={m.state}
              className="relative grid min-w-0 grid-cols-[28px_1fr] gap-x-2 pb-3 lg:block lg:pb-0"
            >
              {/* 세로(좁은 화면) 잇는 선 */}
              {i < items.length - 1 ? <span aria-hidden className={cn('absolute left-[13px] top-7 bottom-0 w-[2px] lg:hidden', m.state === 'done' ? 'bg-ok' : 'bg-line')} /> : null}
              <span
                aria-hidden
                className={cn(
                  'relative z-[1] grid size-7 place-items-center rounded-sm border-2 lg:hidden',
                  m.state === 'done' && 'border-ok bg-ok text-on-ink',
                  m.state === 'current' && 'border-label bg-label text-on-label',
                  m.state === 'attention' && 'border-stamp bg-stamp-bg text-stamp',
                  m.state === 'todo' && 'border-line bg-surface text-muted',
                )}
              >
                <Icon className="size-3.5" />
              </span>
              {/* 가로(넓은 화면) 띠 */}
              <span
                aria-hidden
                className={cn(
                  'hidden h-2 rounded-[2px] lg:block',
                  m.state === 'done' && 'bg-ok',
                  m.state === 'current' && 'bg-label',
                  m.state === 'attention' && 'bg-stamp',
                  m.state === 'todo' && 'bg-line',
                )}
              />
              <div className="min-w-0 lg:mt-1.5">
                <p className={cn('flex flex-wrap items-center gap-x-1 whitespace-nowrap text-sm font-bold lg:text-xs', m.state === 'todo' ? 'text-muted' : 'text-text')}>
                  <Icon aria-hidden className={cn('hidden size-3.5 shrink-0 lg:inline', m.state === 'done' ? 'text-ok' : m.state === 'attention' ? 'text-stamp' : 'text-muted')} />
                  {m.label}
                  <span className={cn('ml-1 text-2xs font-semibold lg:ml-0', m.state === 'attention' ? 'text-stamp' : m.state === 'done' ? 'text-ok' : 'text-muted')}>{STATE_TEXT[m.state]}</span>
                </p>
                <p className="text-2xs text-muted tnum">{m.at ? dateKo(m.at, { dow: false }) : m.state === 'done' ? '기록 없음' : '—'}</p>
                {m.note ? <p className="truncate text-2xs text-muted" title={m.note}>{m.note}</p> : null}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
