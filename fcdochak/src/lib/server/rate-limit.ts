import 'server-only';
/** 아주 단순한 창 방식 제한 — 공개 계산기가 가격 수집 도구가 되지 않게. 인스턴스별 메모리. */
type G = typeof globalThis & { __fcdRate?: Map<string, { n: number; t: number }> };
const g = globalThis as G;

export function allow(key: string, perMinute: number): boolean {
  const m = (g.__fcdRate ??= new Map());
  const now = Date.now();
  const e = m.get(key);
  if (!e || now - e.t > 60_000) {
    m.set(key, { n: 1, t: now });
    if (m.size > 5000) for (const [k, v] of m) if (now - v.t > 60_000) m.delete(k);
    return true;
  }
  e.n++;
  return e.n <= perMinute;
}
