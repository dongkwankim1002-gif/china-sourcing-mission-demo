'use client';
/**
 * 단위 붙은 숫자 입력 — 천 단위 구분, 붙여넣기에 강함("1,200개", "3.6 cbm", "₩12,300", "１２００").
 * 커서 위치를 숫자 기준으로 되돌려 쉼표가 끼어도 입력이 튀지 않는다.
 */
import * as React from 'react';
import { cn } from '@/lib/cn';
import { inputClass } from '@/components/ui/core';

export function parseLooseNumber(s: string): number | null {
  const t = s
    .normalize('NFKC')
    .replace(/[,\s_']/g, '')
    .replace(/[^\d.\-]/g, '');
  if (t === '' || t === '-' || t === '.') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function format(n: number | null, decimals: number, rawTail = ''): string {
  if (n == null) return '';
  const [i, f] = n.toFixed(decimals).split('.');
  const int = Number(i).toLocaleString('en-US');
  if (decimals === 0) return int;
  const trimmed = (f ?? '').replace(/0+$/, '');
  return trimmed || rawTail ? `${int}.${rawTail || trimmed}` : int;
}

export interface NumberFieldProps {
  id?: string;
  name?: string;
  value: number | null;
  onValueChange: (n: number | null) => void;
  unit?: string;
  decimals?: number;
  min?: number;
  max?: number;
  placeholder?: string;
  className?: string;
  inputClassName?: string;
  invalid?: boolean;
  describedBy?: string;
  ariaLabel?: string;
  disabled?: boolean;
  size?: 'md' | 'lg';
  onInk?: boolean;
}

export function NumberField({
  id,
  name,
  value,
  onValueChange,
  unit,
  decimals = 0,
  min,
  max,
  placeholder,
  className,
  inputClassName,
  invalid,
  describedBy,
  ariaLabel,
  disabled,
  size = 'md',
  onInk,
}: NumberFieldProps) {
  const ref = React.useRef<HTMLInputElement>(null);
  const [text, setText] = React.useState(() => format(value, decimals));
  const focused = React.useRef(false);

  React.useEffect(() => {
    if (!focused.current) setText(format(value, decimals));
  }, [value, decimals]);

  const handle = (raw: string, caret: number) => {
    const digitsBefore = raw.slice(0, caret).replace(/[^\d.]/g, '').length;
    let cleaned = raw.normalize('NFKC').replace(/[^\d.]/g, '');
    if (decimals === 0) cleaned = cleaned.replace(/\./g, '');
    const parts = cleaned.split('.');
    if (parts.length > 2) cleaned = parts[0] + '.' + parts.slice(1).join('');
    const [ip, fp] = cleaned.split('.');
    const frac = fp != null ? fp.slice(0, decimals) : undefined;
    const n = cleaned === '' ? null : Number(ip || '0') + (frac ? Number('0.' + frac) : 0);
    const shown = ip === '' && frac == null ? '' : (Number(ip || '0').toLocaleString('en-US') + (frac != null ? '.' + frac : ''));
    setText(shown);
    onValueChange(n);
    requestAnimationFrame(() => {
      const el = ref.current;
      if (!el) return;
      let seen = 0;
      let pos = 0;
      while (pos < shown.length && seen < digitsBefore) {
        if (/[\d.]/.test(shown[pos])) seen++;
        pos++;
      }
      el.setSelectionRange(pos, pos);
    });
  };

  const out = value != null && ((min != null && value < min) || (max != null && value > max));
  return (
    <div className={cn('relative flex min-w-0 items-stretch', className)}>
      <input
        ref={ref}
        id={id}
        name={name}
        inputMode={decimals > 0 ? 'decimal' : 'numeric'}
        autoComplete="off"
        value={text}
        disabled={disabled}
        placeholder={placeholder}
        aria-label={ariaLabel}
        aria-invalid={invalid || out || undefined}
        aria-describedby={describedBy}
        onFocus={() => (focused.current = true)}
        onBlur={() => {
          focused.current = false;
          setText(format(value, decimals));
        }}
        onChange={(e) => handle(e.target.value, e.target.selectionStart ?? e.target.value.length)}
        onPaste={(e) => {
          const t = e.clipboardData.getData('text');
          const n = parseLooseNumber(t);
          if (n != null) {
            e.preventDefault();
            const v = Math.round(n * 10 ** decimals) / 10 ** decimals;
            onValueChange(v);
            setText(format(v, decimals));
          }
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            const step = e.shiftKey ? 10 : 1;
            const cur = value ?? 0;
            const next = Math.max(min ?? -Infinity, Math.min(max ?? Infinity, cur + (e.key === 'ArrowUp' ? step : -step)));
            onValueChange(next);
            setText(format(next, decimals));
          }
        }}
        className={cn(
          inputClass,
          'text-right',
          unit && 'pr-14',
          size === 'lg' && 'h-12 text-md font-semibold',
          onInk && 'border-white/20 bg-white/10 text-on-ink placeholder:text-on-ink-muted hover:border-white/40 focus-visible:border-label',
          inputClassName,
        )}
      />
      {unit ? (
        <span
          aria-hidden
          className={cn(
            'pointer-events-none absolute inset-y-0 right-0 flex w-12 items-center justify-start text-xs font-semibold',
            onInk ? 'text-on-ink-muted' : 'text-muted',
          )}
        >
          {unit}
        </span>
      ) : null}
    </div>
  );
}
