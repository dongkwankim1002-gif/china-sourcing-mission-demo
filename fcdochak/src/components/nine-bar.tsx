'use client';
/**
 * 9구간 막대 — 이 서비스만의 한 가지.
 * 폭 = 금액 비중 · 색 = 길의 순서(남색 한 색상 단계) · 무늬 = 확정도 · 빈칸 = 업체가 맡지 않는 구간.
 * 공개 첫 화면·비교 목록·견적 상세·청구 대조가 모두 이 컴포넌트 하나를 쓴다.
 */
import * as React from 'react';
import { SEGMENTS, SEGMENT_LABEL_KO, SEGMENT_LABEL_ZH, type Segment } from '@/lib/money/segments';
import { cn } from '@/lib/cn';
import { won, pct } from '@/lib/format';

export interface BarSegment {
  segment: Segment;
  amount: number | null;
  certainty: 'confirmed' | 'estimated' | 'extra_possible' | null;
  filled?: boolean;
  /** 청구 대조: 응찰 대비 차액 */
  delta?: number | null;
}

const CERT_KO = { confirmed: '확정', estimated: '예상', extra_possible: '추가비용 가능' } as const;
const CERT_ZH = { confirmed: '确定', estimated: '预估', extra_possible: '可能加收' } as const;

export function NineBar({
  segments,
  size = 'md',
  scaleMax,
  ticks = false,
  label,
  locale = 'ko',
  className,
  interactive = true,
}: {
  segments: BarSegment[];
  size?: 'hero' | 'md' | 'thin';
  /** 여러 막대를 같은 척도로 — 가장 큰 합계 */
  scaleMax?: number;
  ticks?: boolean;
  label?: string;
  locale?: 'ko' | 'zh';
  className?: string;
  interactive?: boolean;
}) {
  const names = locale === 'zh' ? SEGMENT_LABEL_ZH : SEGMENT_LABEL_KO;
  const cert = locale === 'zh' ? CERT_ZH : CERT_KO;
  const bySeg = new Map(segments.map((s) => [s.segment, s]));
  const ordered = SEGMENTS.map((seg) => bySeg.get(seg) ?? { segment: seg, amount: null, certainty: null });
  const total = ordered.reduce((s, x) => s + (x.amount ?? 0), 0);
  const scale = Math.max(scaleMax ?? total, 1);
  const [active, setActive] = React.useState<number | null>(null);
  const h = size === 'hero' ? 'h-11' : size === 'md' ? 'h-5' : 'h-3';
  const summary =
    label ??
    `${locale === 'zh' ? '九段费用' : '9구간 금액'} ${won(total)}: ` +
      ordered.map((s) => `${names[s.segment]} ${s.amount == null ? (locale === 'zh' ? '不含' : '제외') : won(s.amount)}`).join(', ');

  return (
    <div className={cn('relative w-full min-w-0', className)}>
      <div
        role="img"
        aria-label={summary}
        className={cn('flex w-full gap-[2px] overflow-visible', h)}
        onPointerLeave={() => setActive(null)}
      >
        {ordered.map((s, i) => {
          if (s.amount == null || s.amount <= 0) return null;
          const w = (s.amount / scale) * 100;
          const isActive = active === i;
          return (
            <span
              key={s.segment}
              data-seg={s.segment}
              tabIndex={interactive && size === 'hero' ? 0 : -1}
              aria-hidden={size !== 'hero'}
              onPointerEnter={interactive ? () => setActive(i) : undefined}
              onFocus={interactive ? () => setActive(i) : undefined}
              onBlur={interactive ? () => setActive(null) : undefined}
              className={cn(
                'relative block h-full min-w-[3px] transition-[width,filter] duration-200 first:rounded-l-[3px] last:rounded-r-[3px]',
                s.filled && 'bg-transparent',
                s.certainty === 'estimated' && !s.filled && 'hatch',
                isActive && 'z-10 outline-2 outline-offset-1 outline-label',
              )}
              style={{
                width: `${w}%`,
                backgroundColor: s.filled ? undefined : `var(--seg-${i + 1})`,
                border: s.filled ? `1.5px dashed var(--seg-${i + 1})` : undefined,
                boxShadow: !s.filled && s.certainty === 'extra_possible' ? 'inset 0 0 0 2px var(--caution)' : undefined,
              }}
            >
              {s.delta != null && s.delta > 0 ? (
                <span className="absolute -top-1.5 right-0 size-2.5 rounded-full border-2 border-surface bg-stamp" aria-hidden />
              ) : null}
            </span>
          );
        })}
        {total < scale ? <span className="block h-full flex-1" aria-hidden /> : null}
      </div>

      {active != null && ordered[active].amount != null ? (
        <div
          role="status"
          className="pointer-events-none absolute left-0 top-full z-20 mt-2 w-max max-w-[260px] rounded-sm border border-line bg-surface px-3 py-2 text-xs shadow-2"
          style={{ left: `clamp(0px, ${offsetPct(ordered, active, scale)}% - 40px, calc(100% - 220px))` }}
        >
          <div className="text-sm font-bold tnum text-text">{won(ordered[active].amount)}</div>
          <div className="text-muted">
            {active + 1}. {names[ordered[active].segment]} · {pct((ordered[active].amount ?? 0) / Math.max(total, 1), 0)}
            {ordered[active].certainty ? ` · ${cert[ordered[active].certainty!]}` : ''}
            {ordered[active].filled ? (locale === 'zh' ? ' · 平台参考价' : ' · 플랫폼 참고치') : ''}
          </div>
          {ordered[active].delta ? (
            <div className="mt-0.5 font-semibold text-stamp">
              {locale === 'zh' ? '差额' : '차액'} {ordered[active].delta! > 0 ? '+' : ''}
              {won(ordered[active].delta)}
            </div>
          ) : null}
        </div>
      ) : null}

      {ticks ? (
        <ol className="mt-2 grid grid-cols-9 gap-[2px] text-2xs leading-4 text-muted" aria-hidden>
          {ordered.map((s, i) => (
            <li key={s.segment} className="min-w-0">
              <span
                className={cn('mb-1 block h-1 rounded-[1px]', s.amount == null && 'opacity-30')}
                style={{ backgroundColor: `var(--seg-${i + 1})` }}
              />
              <span className="hidden truncate md:block">
                {i + 1} {names[s.segment]}
              </span>
              <span className="md:hidden">{i + 1}</span>
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}

function offsetPct(ordered: BarSegment[], idx: number, scale: number) {
  let x = 0;
  for (let i = 0; i < idx; i++) x += ordered[i].amount ?? 0;
  return (x / scale) * 100;
}

/** 범례 — 무늬 뜻 */
export function NineBarLegend({ locale = 'ko', className }: { locale?: 'ko' | 'zh'; className?: string }) {
  const t =
    locale === 'zh'
      ? { c: '确定', e: '预估', x: '可能加收', f: '平台参考价', n: '不含（空白）' }
      : { c: '확정', e: '예상', x: '추가비용 가능', f: '참고치로 채움', n: '제외(빈칸)' };
  return (
    <ul className={cn('flex flex-wrap items-center gap-x-4 gap-y-1 text-2xs text-muted', className)}>
      <li className="flex items-center gap-1.5">
        <span className="inline-block h-3 w-5 rounded-[2px]" style={{ background: 'var(--seg-4)' }} />
        {t.c}
      </li>
      <li className="flex items-center gap-1.5">
        <span className="hatch inline-block h-3 w-5 rounded-[2px]" style={{ backgroundColor: 'var(--seg-4)' }} />
        {t.e}
      </li>
      <li className="flex items-center gap-1.5">
        <span className="inline-block h-3 w-5 rounded-[2px]" style={{ background: 'var(--seg-4)', boxShadow: 'inset 0 0 0 2px var(--caution)' }} />
        {t.x}
      </li>
      <li className="flex items-center gap-1.5">
        <span className="inline-block h-3 w-5 rounded-[2px]" style={{ border: '1.5px dashed var(--seg-4)' }} />
        {t.f}
      </li>
      <li className="flex items-center gap-1.5">
        <span className="inline-block h-3 w-5 rounded-[2px] border border-dashed border-line" />
        {t.n}
      </li>
    </ul>
  );
}

/** 9구간 표 — 막대 아래 숫자(표 보기·접근성용) */
export function NineTable({ segments, locale = 'ko' }: { segments: BarSegment[]; locale?: 'ko' | 'zh' }) {
  const names = locale === 'zh' ? SEGMENT_LABEL_ZH : SEGMENT_LABEL_KO;
  const cert = locale === 'zh' ? CERT_ZH : CERT_KO;
  const bySeg = new Map(segments.map((s) => [s.segment, s]));
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] text-xs tnum">
        <thead>
          <tr className="text-muted">
            {SEGMENTS.map((s, i) => (
              <th key={s} scope="col" className="px-1 py-1 text-left font-semibold">
                <span className="mr-1 inline-block size-2 rounded-[1px] align-middle" style={{ background: `var(--seg-${i + 1})` }} />
                {names[s]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr>
            {SEGMENTS.map((s) => {
              const v = bySeg.get(s);
              return (
                <td key={s} className="px-1 py-1 align-top">
                  {v?.amount == null ? (
                    <span className="text-muted">{locale === 'zh' ? '不含' : '제외'}</span>
                  ) : (
                    <>
                      <span className="font-semibold text-text">{won(v.amount)}</span>
                      <span className={cn('block text-2xs', v.certainty === 'extra_possible' ? 'text-caution' : 'text-muted')}>
                        {v.filled ? (locale === 'zh' ? '参考' : '참고치') : v.certainty ? cert[v.certainty] : ''}
                      </span>
                    </>
                  )}
                </td>
              );
            })}
          </tr>
        </tbody>
      </table>
    </div>
  );
}
