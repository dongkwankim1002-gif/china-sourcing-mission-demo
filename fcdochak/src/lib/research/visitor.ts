/**
 * 청구서 점검 퍼널(실험 ②)의 기기 번호 — 이 브라우저에만 두는 무작위 값(사람·계정과 잇지 않는다).
 * 서버는 이 값을 sha-256 으로 바꿔서만 저장한다. 저장소를 못 쓰면(사생활 보호 모드) 쪽마다 새 번호.
 */
const KEY = 'fcd-vid';

export function visitorId(): string {
  const make = () => {
    const b = new Uint8Array(16);
    crypto.getRandomValues(b);
    return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  };
  try {
    const v = window.localStorage.getItem(KEY);
    if (v && /^[A-Za-z0-9_-]{16,64}$/.test(v)) return v;
    const n = make();
    window.localStorage.setItem(KEY, n);
    return n;
  } catch {
    return make();
  }
}
