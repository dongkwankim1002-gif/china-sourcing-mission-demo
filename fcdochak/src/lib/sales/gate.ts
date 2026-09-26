/**
 * 쿠팡을 실제로 부르기 전 문턱(v2 3차 sales) — 연결 시험·판매 기록 가져오기가 같이 쓴다. 순수 함수.
 * 지금 판 동의 → 키 저장 → 지금 암호화 키로 잠김 → 만료 안 됨, 이 순서로 처음 걸리는 까닭을 돌려준다(없으면 null = 불러도 됨).
 * 스위치(WING_ENABLED)는 부르는 쪽이 따로 본다.
 */
export type LiveBlock = 'no_consent' | 'no_key' | 'kek_mismatch' | 'key_expired';

export function liveCallBlock(o: { consent: boolean; hasKey: boolean; kekOk: boolean; expiry: 'unknown' | 'ok' | 'soon' | 'expired' }): LiveBlock | null {
  if (!o.consent) return 'no_consent';
  if (!o.hasKey) return 'no_key';
  if (!o.kekOk) return 'kek_mismatch';
  if (o.expiry === 'expired') return 'key_expired';
  return null;
}

export const LIVE_BLOCK_MESSAGE: Record<LiveBlock, string> = {
  no_consent: '먼저 「읽는 것·하지 않는 것」에 동의해 주세요 — 동의 없이는 쿠팡을 부르지 않습니다.',
  no_key: '먼저 키를 넣어 주세요.',
  kek_mismatch: '다른 암호화 키로 잠긴 기록입니다 — 키를 다시 넣어 주세요.',
  key_expired: '키가 만료됐습니다 — 새 키를 넣어 주세요.',
};
