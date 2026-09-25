/**
 * 거래처 초대 링크 — 토큰은 32바이트 난수(base64url 43자). DB 에는 sha-256 16진만 둔다.
 * 링크는 만들 때 한 번만 화면에 보인다(발송은 꺼져 있으니 화주가 복사해 직접 보낸다).
 */
import { createHash, randomBytes } from 'node:crypto';

export const INVITE_TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

export function newInviteToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashInviteToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function isInviteToken(t: unknown): t is string {
  return typeof t === 'string' && INVITE_TOKEN_RE.test(t);
}

/** 만료 시각 — days 는 설정 workspace.invite_days 에서 */
export function inviteExpiry(now: Date, days: number): Date {
  if (!Number.isInteger(days) || days < 1 || days > 90) throw new RangeError(`초대 유효 일수가 올바르지 않습니다: ${days}`);
  return new Date(now.getTime() + days * 86_400_000);
}

export type InviteStatus = 'open' | 'used' | 'expired' | 'revoked';

export function inviteStatus(i: { expires_at: string | Date; revoked_at: string | Date | null; accepted: boolean }, now: Date = new Date()): InviteStatus {
  if (i.revoked_at) return 'revoked';
  if (i.accepted) return 'used';
  if (new Date(i.expires_at).getTime() <= now.getTime()) return 'expired';
  return 'open';
}

export const INVITE_STATUS_LABEL: Record<InviteStatus, string> = {
  open: '기다리는 중',
  used: '가입함',
  expired: '만료',
  revoked: '거둠',
};

export function inviteLink(origin: string, token: string): string {
  return `${origin.replace(/\/$/, '')}/join/partner?invite=${encodeURIComponent(token)}`;
}

/** accept_partner_invite() 가 돌려주는 까닭 → 사람 말 */
export const ACCEPT_RESULT_TEXT: Record<string, string> = {
  ok: '거래처로 연결했습니다',
  already: '이미 이 화주의 거래처입니다',
  used: '이미 쓰인 초대 링크입니다',
  expired: '기한이 지난 초대 링크입니다. 화주에게 새 링크를 부탁하세요',
  revoked: '화주가 거둔 초대 링크입니다',
  not_found: '초대 링크를 찾을 수 없습니다',
  not_partner_admin: '물류사 관리자 계정으로 들어와야 받을 수 있습니다',
};
