import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Sparkline } from './charts';
import { fmt, type Fmt } from '@/lib/chart-format';
import { won } from '@/lib/format';

/**
 * 지표 칸 — 값 · 지난 기간 대비 · 추세선. 아이콘 없음.
 * good: 오르는 게 좋은지('up') 내리는 게 좋은지('down'). 색 = 방향 × 좋음.
 */
export function StatTile({
  label,
  value,
  format = 'num',
  prev,
  trend,
  good = 'up',
  hint,
  suffix,
  href,
}: {
  label: string;
  value: number | null;
  format?: Fmt;
  prev?: number | null;
  trend?: (number | null)[];
  good?: 'up' | 'down' | 'none';
  hint?: string;
  suffix?: string;
  href?: string;
}) {
  const delta = value != null && prev != null && prev !== 0 ? (format === 'pct' ? value - prev : (value - prev) / Math.abs(prev)) : null;
  const dir = delta == null || Math.abs(delta) < 0.0005 ? 0 : delta > 0 ? 1 : -1;
  const tone = good === 'none' || dir === 0 ? 'text-muted' : (dir > 0) === (good === 'up') ? 'text-ok' : 'text-stamp';
  const Icon = dir > 0 ? ArrowUpRight : dir < 0 ? ArrowDownRight : Minus;
  const body = (
    <>
      <p className="text-xs font-semibold text-muted">{label}</p>
      <p className="display mt-1.5 text-[26px] leading-none text-text tnum" title={format === 'won' && value != null ? won(value) : undefined}>
        {value == null ? '—' : fmt(value, format)}
        {suffix ? <span className="ml-1 font-sans text-sm font-semibold text-muted">{suffix}</span> : null}
      </p>
      <div className="mt-2 flex items-center justify-between gap-2">
        {delta != null ? (
          <span className={cn('inline-flex flex-wrap items-center gap-x-0.5 text-xs font-semibold tnum', tone)}>
            <Icon className="size-3.5" aria-hidden />
            {format === 'pct' ? `${dir === 0 || Number((delta * 100).toFixed(1)) === 0 ? '0.0' : (delta * 100).toFixed(1)}%p` : `${(Math.abs(delta) * 100).toFixed(0)}%`}
            <span className="whitespace-nowrap font-normal text-muted">지난 기간 대비</span>
          </span>
        ) : (
          <span className="text-xs text-muted">{hint ?? ' '}</span>
        )}
      </div>
      {trend && trend.length > 1 ? <Sparkline values={trend} className="mt-2" label={`${label} 추세`} /> : null}
    </>
  );
  const cls = 'block min-w-0 rounded-md border border-line bg-surface p-4';
  return href ? (
    <a href={href} className={cn(cls, 'hover:border-muted/60')}>
      {body}
    </a>
  ) : (
    <div className={cls}>{body}</div>
  );
}
