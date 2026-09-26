import { cn } from '@/lib/cn';
import { BRAND } from '@/lib/brand';

/** 브랜드 — 라벨 노랑 조각 위 남색 두 글자 + 이름(Black Han Sans). 이름은 lib/brand.ts 에서. */
export function BrandMark({ className, compact = false, onInk = true }: { className?: string; compact?: boolean; onInk?: boolean }) {
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <span
        aria-hidden
        className="display relative grid h-7 w-9 place-items-center rounded-[3px] bg-label text-[15px] leading-none text-on-label"
      >
        {BRAND.markText}
        <span className="absolute -right-[3px] top-1/2 size-1.5 -translate-y-1/2 rounded-full bg-ink" />
      </span>
      {compact ? <span className="sr-only">{BRAND.name}</span> : (
        <span className={cn('display text-[19px] leading-none tracking-tight', onInk ? 'text-on-ink' : 'text-text')}>{BRAND.name}</span>
      )}
    </span>
  );
}

const PALETTE = ['#0e2340', '#214375', '#0e7c71', '#5a3d8a', '#7a4a12', '#2d5d2a', '#8a2d3a', '#35506b'];

function hash(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

/** 업체 이름 글자 마크 — 로고를 올리지 않은 업체용 */
export function LetterMark({ name, logo, size = 36, className }: { name: string; logo?: string | null; size?: number; className?: string }) {
  if (logo) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={logo}
        alt={`${name} 로고`}
        width={size}
        height={size}
        loading="lazy"
        decoding="async"
        className={cn('shrink-0 rounded-sm border border-line bg-surface object-contain', className)}
        style={{ width: size, height: size }}
      />
    );
  }
  const ch = [...name.replace(/[()（）\s]/g, '')][0] ?? '?';
  const bg = PALETTE[hash(name) % PALETTE.length];
  return (
    <span
      aria-hidden
      className={cn('grid shrink-0 place-items-center rounded-sm font-bold text-white', className)}
      style={{ width: size, height: size, background: bg, fontSize: Math.round(size * 0.44) }}
    >
      {ch}
    </span>
  );
}
