'use client';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import * as React from 'react';
import { RefreshCw } from 'lucide-react';
import { cn } from '@/lib/cn';

export function PeriodPicker({ value, options = [7, 30, 90] }: { value: number; options?: number[] }) {
  const pathname = usePathname();
  const sp = useSearchParams();
  return (
    <div className="inline-flex rounded-sm border border-line bg-surface p-0.5" role="group" aria-label="기간">
      {options.map((o) => {
        const p = new URLSearchParams(sp.toString());
        p.set('p', String(o));
        return (
          <Link
            key={o}
            href={`${pathname}?${p}`}
            scroll={false}
            aria-current={value === o ? 'true' : undefined}
            className={cn('h-8 rounded-[4px] px-3 text-sm font-semibold leading-8 tnum', value === o ? 'bg-ink text-on-ink' : 'text-muted hover:text-text')}
          >
            {o}일
          </Link>
        );
      })}
    </div>
  );
}

/** 「마지막 갱신 N분 전」 — 1분마다 글자만 바뀌고, 누르면 다시 불러온다 */
export function Freshness({ at }: { at: string }) {
  const router = useRouter();
  const [now, setNow] = React.useState(() => Date.now());
  const [pending, start] = React.useTransition();
  React.useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  const min = Math.max(0, Math.floor((now - new Date(at).getTime()) / 60_000));
  return (
    <button
      type="button"
      onClick={() => start(() => router.refresh())}
      className="inline-flex items-center gap-1.5 rounded-sm px-2 py-1 text-xs text-muted hover:bg-surface-2 hover:text-text"
      aria-label="지금 다시 불러오기"
    >
      <RefreshCw className={cn('size-3.5', pending && 'animate-spin')} aria-hidden />
      마지막 갱신 {min < 1 ? '방금' : `${min}분 전`}
    </button>
  );
}
