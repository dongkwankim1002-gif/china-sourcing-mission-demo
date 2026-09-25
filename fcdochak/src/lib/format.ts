/** 숫자·날짜 표기 — 원화 천 단위, 만·억 요약, 한국식 날짜, 남은 시간. */

const nf = new Intl.NumberFormat('ko-KR');

export function won(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  // −0(예: 0 에 음수 부호를 붙인 칸)은 「-0원」이 아니라 「0원」
  return `${nf.format(Math.round(n) || 0)}원`;
}

export function num(n: number | null | undefined, digits = 0): string {
  if (n == null || !Number.isFinite(n)) return '—';
  // 표시 자릿수에서 0 이 되는 값(−0, −0.3 등)은 부호 없이 0
  const v = Math.abs(n) < 0.5 * 10 ** -digits ? 0 : n;
  return new Intl.NumberFormat('ko-KR', { maximumFractionDigits: digits, minimumFractionDigits: 0 }).format(v);
}

/** 1,284만 원 / 3.2억 원 — 큰 금액 요약. 1만 미만은 그대로. */
export function wonShort(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  const sign = n < 0 ? '−' : '';
  const a = Math.abs(n);
  if (a >= 100_000_000) {
    const v = a / 100_000_000;
    return `${sign}${v >= 10 ? nf.format(Math.round(v)) : (Math.round(v * 10) / 10).toString()}억 원`;
  }
  if (a >= 10_000) return `${sign}${nf.format(Math.round(a / 10_000))}만 원`;
  return `${sign}${nf.format(Math.round(a))}원`;
}

export function pct(n: number | null | undefined, digits = 1, signed = false): string {
  if (n == null || !Number.isFinite(n)) return '—';
  const v = (n * 100).toFixed(digits);
  return `${signed && n > 0 ? '+' : ''}${v}%`;
}

const DOW = ['일', '월', '화', '수', '목', '금', '토'];

function kst(d: Date | string) {
  const t = typeof d === 'string' ? new Date(d.length === 10 ? d + 'T00:00:00+09:00' : d) : d;
  return new Date(t.getTime() + 9 * 3600_000);
}

/** 9월 25일(목) · 올해가 아니면 2025년 9월 25일 */
export function dateKo(d: Date | string | null | undefined, opts: { dow?: boolean; now?: Date } = {}): string {
  if (!d) return '—';
  const k = kst(d);
  const nowK = kst(opts.now ?? new Date());
  const y = k.getUTCFullYear();
  const base = `${k.getUTCMonth() + 1}월 ${k.getUTCDate()}일`;
  const dow = opts.dow === false ? '' : `(${DOW[k.getUTCDay()]})`;
  return y === nowK.getUTCFullYear() ? `${base}${dow}` : `${y}년 ${base}`;
}

export function dateTimeKo(d: Date | string | null | undefined): string {
  if (!d) return '—';
  const k = kst(d);
  return `${dateKo(d, { dow: false })} ${String(k.getUTCHours()).padStart(2, '0')}:${String(k.getUTCMinutes()).padStart(2, '0')}`;
}

export function ymdDots(d: string | null | undefined): string {
  if (!d) return '—';
  return d.slice(0, 10).replace(/-/g, '.');
}

/** 마감까지 5시간 · 2일 3시간 · 마감 지남 */
export function remaining(deadline: Date | string, now: Date = new Date()): { text: string; hours: number; past: boolean } {
  const ms = new Date(deadline).getTime() - now.getTime();
  const hours = ms / 3_600_000;
  if (ms <= 0) {
    const ago = -hours;
    return { text: ago < 24 ? `${Math.max(1, Math.round(ago))}시간 전 마감` : `${Math.round(ago / 24)}일 전 마감`, hours, past: true };
  }
  if (hours < 1) return { text: `마감까지 ${Math.max(1, Math.round(ms / 60_000))}분`, hours, past: false };
  if (hours < 24) return { text: `마감까지 ${Math.floor(hours)}시간`, hours, past: false };
  const d = Math.floor(hours / 24);
  const h = Math.floor(hours % 24);
  return { text: `마감까지 ${d}일${h ? ` ${h}시간` : ''}`, hours, past: false };
}

/** 3분 전 · 2시간 전 · 어제 · 9월 3일 */
export function ago(d: Date | string | null | undefined, now: Date = new Date()): string {
  if (!d) return '—';
  const s = (now.getTime() - new Date(d).getTime()) / 1000;
  if (s < 60) return '방금';
  if (s < 3600) return `${Math.floor(s / 60)}분 전`;
  if (s < 86400) return `${Math.floor(s / 3600)}시간 전`;
  if (s < 2 * 86400) return '어제';
  if (s < 7 * 86400) return `${Math.floor(s / 86400)}일 전`;
  return dateKo(d, { dow: false, now });
}

export function cbm(n: number | null | undefined) {
  return n == null ? '—' : `${num(n, 2)} CBM`;
}
export function kg(n: number | null | undefined) {
  return n == null ? '—' : `${num(n, 1)} kg`;
}

/**
 * 오늘(KST) 이후 날짜를 뺀다 — 후기·기록이 미래 날짜로 보이지 않게(쿼리에서도 막고 화면에서 한 번 더).
 * today 는 'YYYY-MM-DD'(KST). created_at 이 그날 KST 23:59:59 까지면 남긴다.
 */
export function notFuture<T extends { created_at: string | Date }>(rows: T[], today: string): T[] {
  const end = Date.parse(`${today}T00:00:00+09:00`) + 86_400_000;
  return rows.filter((r) => {
    const t = typeof r.created_at === 'string' ? Date.parse(r.created_at) : r.created_at.getTime();
    return Number.isFinite(t) && t < end;
  });
}
