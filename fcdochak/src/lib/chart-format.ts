import { num, pct, won, wonShort } from './format';

export type Fmt = 'won' | 'num' | 'pct' | 'hours';
export function fmt(v: number | null | undefined, f: Fmt) {
  if (v == null) return '—';
  return f === 'won' ? wonShort(v) : f === 'pct' ? pct(v, 1) : f === 'hours' ? `${num(v, 1)}시간` : num(v);
}
export function fmtFull(v: number | null | undefined, f: Fmt) {
  if (v == null) return '—';
  return f === 'won' ? won(v) : fmt(v, f);
}
