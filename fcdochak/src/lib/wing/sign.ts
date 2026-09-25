/**
 * 쿠팡 오픈 API 서명(HMAC-SHA256, 「CEA」) — 순수 함수. 시계·환경변수·네트워크를 읽지 않는다.
 *
 *   signed-date = UTC yyMMdd'T'HHmmss'Z'
 *   message     = signed-date + METHOD + PATH + QUERY   (QUERY 는 '?' 없이, 없으면 빈 문자열)
 *   signature   = hex(HMAC-SHA256(secretKey utf-8, message utf-8))
 *   Authorization: CEA algorithm=HmacSHA256, access-key=…, signed-date=…, signature=…
 *
 * 출처: 쿠팡 Open API 「Creating HMAC Signature」·「Python Example」(docs/wing-plan.md §2.3).
 * 쿠팡 문서의 입력→서명 예시 값은 찾지 못했다(확인 필요) — 시험은 RFC 4231 시험값과 규칙으로 고정한다.
 */
import { createHmac } from 'node:crypto';

const pad = (n: number) => String(n).padStart(2, '0');

/** UTC 기준 yyMMdd'T'HHmmss'Z' */
export function wingSignedDate(d: Date): string {
  if (Number.isNaN(d.getTime())) throw new RangeError('시각이 올바르지 않습니다');
  return (
    pad(d.getUTCFullYear() % 100) +
    pad(d.getUTCMonth() + 1) +
    pad(d.getUTCDate()) +
    'T' +
    pad(d.getUTCHours()) +
    pad(d.getUTCMinutes()) +
    pad(d.getUTCSeconds()) +
    'Z'
  );
}

export const SIGNED_DATE_RE = /^\d{6}T\d{6}Z$/;

export interface SignInput {
  method: string;
  /** 호스트 없는 경로 — '/v2/providers/…' */
  path: string;
  /** '?' 없는 쿼리 문자열. 보낼 때와 같은 문자열을 넘긴다 */
  query?: string;
  signedDate: string;
}

export function wingMessage(i: SignInput): string {
  if (!SIGNED_DATE_RE.test(i.signedDate)) throw new RangeError(`signed-date 모양이 아닙니다: ${i.signedDate}`);
  if (!i.path.startsWith('/') || /[?#]/.test(i.path)) throw new RangeError('경로는 / 로 시작하고 ? 나 # 가 없어야 합니다');
  const q = i.query ?? '';
  if (q.startsWith('?')) throw new RangeError('쿼리는 ? 없이 넘깁니다');
  return i.signedDate + i.method.toUpperCase() + i.path + q;
}

/** HMAC-SHA256 16진(소문자) */
export function hmacSha256Hex(key: string | Buffer, data: string | Buffer): string {
  return createHmac('sha256', key).update(data).digest('hex');
}

export function wingSignature(i: SignInput & { secretKey: string }): string {
  if (!i.secretKey) throw new RangeError('secret key 가 비었습니다');
  return hmacSha256Hex(Buffer.from(i.secretKey, 'utf8'), Buffer.from(wingMessage(i), 'utf8'));
}

export function wingAuthorization(i: SignInput & { secretKey: string; accessKey: string }): string {
  if (!i.accessKey || /[\s,]/.test(i.accessKey)) throw new RangeError('access key 가 올바르지 않습니다');
  return `CEA algorithm=HmacSHA256, access-key=${i.accessKey}, signed-date=${i.signedDate}, signature=${wingSignature(i)}`;
}
