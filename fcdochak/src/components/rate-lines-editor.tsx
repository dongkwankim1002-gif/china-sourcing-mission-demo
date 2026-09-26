'use client';
/**
 * 9구간 요금 줄 편집 — 줄마다 「포함 / 제외」를 반드시 고른다(비워 두면 저장 안 됨).
 * 포함이면 기준·단가·통화·최저요금·확정도를 넣는다. 모바일은 줄마다 카드.
 */
import * as React from 'react';
import { NumberField } from '@/components/number-field';
import { NativeSelect } from '@/components/ui/core';
import { cn } from '@/lib/cn';
import { BASIS_LABEL, CERTAINTY_LABEL } from '@/lib/terms';
import { BASES, type RateLineInputT } from '@/lib/schemas';
import { SEGMENT_LABEL_KO, SEGMENT_LABEL_ZH } from '@/lib/money/segments';

const ZH_BASIS: Record<string, string> = {
  per_cbm: '每CBM', per_rt: '每R/T', per_kg: '每kg', per_chargeable_kg: '每计费kg', per_carton: '每箱', per_unit: '每件', per_pallet: '每托', per_container: '每柜', per_shipment: '每票', percent_goods: '货值%',
};
const ZH_CERT: Record<string, string> = { confirmed: '确定', estimated: '预估', extra_possible: '可能加收' };

export function RateLinesEditor({
  lines,
  onChange,
  errors = {},
  locale = 'ko',
}: {
  lines: RateLineInputT[];
  onChange: (lines: RateLineInputT[]) => void;
  errors?: Record<number, string>;
  locale?: 'ko' | 'zh';
}) {
  const zh = locale === 'zh';
  const names = zh ? SEGMENT_LABEL_ZH : SEGMENT_LABEL_KO;
  const set = (i: number, patch: Partial<RateLineInputT>) => onChange(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  return (
    <fieldset className="min-w-0">
      <legend className="mb-2 text-sm font-bold">
        {zh ? '九段运费 — 每一段都要选「包含 / 不含」' : '9구간 요금 — 줄마다 「포함 / 제외」를 고르세요'}
      </legend>
      <ol className="flex flex-col gap-2">
        {lines.map((l, i) => {
          const err = errors[i];
          const off = l.included !== true;
          return (
            <li
              key={l.segment}
              className={cn(
                'grid gap-2 rounded-sm border bg-surface p-3 xl:grid-cols-[150px_150px_minmax(0,1fr)] xl:items-center',
                err ? 'border-stamp bg-stamp-bg/30' : 'border-line',
              )}
            >
              <div className="flex items-center gap-2">
                <span className="inline-block h-4 w-1.5 rounded-[1px]" style={{ background: `var(--seg-${i + 1})` }} aria-hidden />
                <span className="text-sm font-bold">
                  <span className="text-muted tnum">{i + 1}</span> {names[l.segment]}
                </span>
              </div>
              <div role="radiogroup" aria-label={`${names[l.segment]} ${zh ? '是否包含' : '포함 여부'}`} className="flex gap-1">
                {[
                  [true, zh ? '包含' : '포함'],
                  [false, zh ? '不含' : '제외'],
                ].map(([v, label]) => (
                  <button
                    key={String(v)}
                    type="button"
                    role="radio"
                    aria-checked={l.included === v}
                    onClick={() => set(i, { included: v as boolean })}
                    className={cn(
                      'h-9 flex-1 rounded-xs border text-sm font-semibold',
                      l.included === v ? (v ? 'border-ok bg-ok text-white' : 'border-ink bg-ink text-on-ink') : 'border-line bg-surface hover:border-muted/60',
                    )}
                  >
                    {label as string}
                  </button>
                ))}
              </div>
              <div className={cn('grid min-w-0 grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-[1.1fr_1fr_80px_1fr_1fr]', off && 'opacity-40')}>
                <NativeSelect aria-label={zh ? '计费方式' : '기준'} value={l.basis} disabled={off} onChange={(e) => set(i, { basis: e.target.value as RateLineInputT['basis'] })} className="h-9 text-sm">
                  {BASES.map((b) => (
                    <option key={b} value={b}>
                      {zh ? ZH_BASIS[b] : BASIS_LABEL[b]}
                    </option>
                  ))}
                </NativeSelect>
                <NumberField ariaLabel={zh ? '单价' : '단가'} value={l.unitPrice} onValueChange={(v) => set(i, { unitPrice: v })} decimals={2} disabled={off} unit={l.basis === 'percent_goods' ? '%' : undefined} inputClassName="h-9" invalid={!!err && !off} />
                <NativeSelect aria-label={zh ? '币种' : '통화'} value={l.currency} disabled={off} onChange={(e) => set(i, { currency: e.target.value as RateLineInputT['currency'] })} className="h-9 text-sm">
                  <option value="KRW">KRW</option>
                  <option value="RMB">RMB</option>
                  <option value="USD">USD</option>
                </NativeSelect>
                <NumberField ariaLabel={zh ? '最低收费' : '최저요금'} placeholder={zh ? '最低' : '최저요금'} value={l.minCharge} onValueChange={(v) => set(i, { minCharge: v })} decimals={2} disabled={off} inputClassName="h-9" />
                <NativeSelect aria-label={zh ? '确定程度' : '확정도'} value={l.certainty} disabled={off} onChange={(e) => set(i, { certainty: e.target.value as RateLineInputT['certainty'] })} className="h-9 text-sm">
                  {(['confirmed', 'estimated', 'extra_possible'] as const).map((c) => (
                    <option key={c} value={c}>
                      {zh ? ZH_CERT[c] : CERTAINTY_LABEL[c]}
                    </option>
                  ))}
                </NativeSelect>
              </div>
              {err ? (
                <p role="alert" className="text-xs text-stamp xl:col-span-3">
                  {err}
                </p>
              ) : null}
            </li>
          );
        })}
      </ol>
      {lines[5]?.included ? (
        <p className="mt-2 text-xs text-muted">{zh ? '报关行服务费不计入平台成交手续费基数。' : '관세사 보수는 성사 수수료 기준에서 빠집니다.'}</p>
      ) : null}
    </fieldset>
  );
}

/** 줄 오류를 줄 번호별로 */
export function lineErrors(issues: { path: (string | number)[]; message: string }[]): Record<number, string> {
  const out: Record<number, string> = {};
  for (const i of issues) {
    const k = i.path.indexOf('lines');
    if (k >= 0 && typeof i.path[k + 1] === 'number') out[i.path[k + 1] as number] ??= i.message;
  }
  return out;
}
