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

/**
 * 제한 키로 쓸 접속 IP — 배포 플랫폼이 채우는 머리글을 먼저 본다(사용자가 보낸 x-forwarded-for 앞자리는 꾸밀 수 있다).
 * Vercel: x-vercel-forwarded-for · x-real-ip 는 플랫폼이 덮어쓴다. 없을 때만 x-forwarded-for 를 본다.
 */
export function clientIp(h: { get(name: string): string | null }): string {
  const first = (v: string | null) => v?.split(',')[0]?.trim() || null;
  return first(h.get('x-vercel-forwarded-for')) ?? first(h.get('x-real-ip')) ?? first(h.get('x-forwarded-for')) ?? 'local';
}
