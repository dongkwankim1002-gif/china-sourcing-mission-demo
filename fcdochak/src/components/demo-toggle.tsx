import Link from 'next/link';
import { cn } from '@/lib/cn';

/** 운영 화면 — 예시 데이터를 숫자에 넣을지 */
export function DemoToggle({ include, href }: { include: boolean; href: (include: boolean) => string }) {
  return (
    <div className="inline-flex rounded-sm border border-line bg-surface p-0.5" role="group" aria-label="예시 데이터">
      {[true, false].map((v) => (
        <Link key={String(v)} href={href(v)} aria-current={include === v ? 'true' : undefined} className={cn('h-8 rounded-[4px] px-3 text-sm font-semibold leading-8', include === v ? 'bg-ink text-on-ink' : 'text-muted hover:text-text')}>
          {v ? '예시 포함' : '예시 빼고'}
        </Link>
      ))}
    </div>
  );
}
