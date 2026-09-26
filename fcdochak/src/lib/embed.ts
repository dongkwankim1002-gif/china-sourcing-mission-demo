/**
 * 버전 비교실(/lab) 안에 끼워 보기.
 *
 *   FRAME_ANCESTORS — 이 사이트를 iframe 으로 담아도 되는 바깥 주소(쉼표로). 비어 있으면 같은 주소만.
 *   EMBED_COOKIES=on — 다른 주소의 비교실 안에서도 로그인이 유지되게 쿠키를 SameSite=None·Partitioned 로.
 *                      미리보기(v2·v3…) 가지에만 켠다. 운영은 비교실과 같은 주소라 켜지 않는다.
 */
/** https 주소, 또는 로컬 시험용 localhost */
const ORIGIN_RE = /^(https:\/\/[a-z0-9.-]+|http:\/\/(localhost|127\.0\.0\.1)(:\d+)?)$/i;

export function frameAncestors(): string[] {
  return (process.env.FRAME_ANCESTORS ?? '').split(/[\s,]+/).filter((s) => ORIGIN_RE.test(s));
}

export function embedCookieOptions(https: boolean): { sameSite: 'lax' | 'none'; secure: boolean; partitioned?: boolean } {
  if (process.env.EMBED_COOKIES === 'on' && https) return { sameSite: 'none', secure: true, partitioned: true };
  return { sameSite: 'lax', secure: https };
}

/** 비교실이 사는 주소 — 끼워진 화면이 지금 경로를 이 주소로만 알린다 */
export const LAB_ORIGIN = process.env.NEXT_PUBLIC_LAB_ORIGIN || 'https://fcdochak.vercel.app';
