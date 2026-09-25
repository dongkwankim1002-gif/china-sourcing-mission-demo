import { cn } from '@/lib/cn';
import { dateTimeKo } from '@/lib/format';

/** 활동 기록 — 오른쪽(데스크톱) / 맨 아래(모바일) */
export function ActivityLog({ items, title = '활동 기록' }: { items: { at: string; text: string; who?: string | null; tone?: 'stamp' | 'ok' | 'caution' }[]; title?: string }) {
  return (
    <section aria-labelledby="activity" className="rounded-md border border-line bg-surface">
      <h2 id="activity" className="border-b border-line-2 px-4 py-3 text-sm font-bold">{title}</h2>
      {items.length ? (
        <ol className="relative px-4 py-3">
          {items.map((it, i) => (
            <li key={i} className="relative pb-4 pl-5 last:pb-0">
              <span className={cn('absolute left-0 top-1.5 size-2 rounded-full', it.tone === 'stamp' ? 'bg-stamp' : it.tone === 'ok' ? 'bg-ok' : it.tone === 'caution' ? 'bg-caution' : 'bg-[var(--seg-5)]')} aria-hidden />
              {i < items.length - 1 ? <span className="absolute left-[3.5px] top-4 h-[calc(100%-10px)] w-px bg-line" aria-hidden /> : null}
              <p className="text-sm">{it.text}</p>
              <p className="text-2xs text-muted tnum">{dateTimeKo(it.at)}{it.who ? ` · ${it.who}` : ''}</p>
            </li>
          ))}
        </ol>
      ) : (
        <p className="px-4 py-6 text-sm text-muted">아직 기록이 없습니다.</p>
      )}
    </section>
  );
}

/** 상세 머리 — 번호 · 상태 칩 · 주 행동 */
export function DetailHead({ eyebrow, title, chips, actions, sub }: { eyebrow?: React.ReactNode; title: React.ReactNode; chips?: React.ReactNode; actions?: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        {eyebrow ? <div className="mb-1 text-xs font-semibold text-muted">{eyebrow}</div> : null}
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-bold tnum">{title}</h1>
          {chips}
        </div>
        {sub ? <p className="mt-0.5 text-sm text-muted">{sub}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </header>
  );
}
