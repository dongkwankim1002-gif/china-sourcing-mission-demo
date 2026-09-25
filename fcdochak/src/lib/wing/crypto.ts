/**
 * WING 키 암호화 — AES-256-GCM. 암호화 키 원문은 서버 환경변수 WING_KEY_ENCRYPTION_KEY(32자 이상)에만 있고,
 * 여기서는 인자로 받는다(환경변수를 읽지 않는다 — 시험하기 쉽게, 새어 나가기 어렵게).
 *
 *   암호문 = v1.<키 지문 8자>.<iv>.<tag>.<본문>   (base64url)
 *   AAD    = 'fcd-wing:' + 조직 id — 다른 조직 줄로 옮긴 암호문은 풀리지 않는다
 *
 * 평문으로 남기는 것은 업체 코드·access key 의 끝 4자리뿐(secret key 는 끝자리도 남기지 않는다).
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import type { WingCredentials } from './types';

export const MIN_KEK_LENGTH = 32;

export class WingKeyError extends Error {
  readonly code = 'wing_key';
}

function kek(secret: string | null | undefined): Buffer {
  if (!secret || secret.length < MIN_KEK_LENGTH) throw new WingKeyError('암호화 키가 설정되지 않았습니다(WING_KEY_ENCRYPTION_KEY, 32자 이상)');
  return createHash('sha256').update(`fcd-wing-kek:${secret}`, 'utf8').digest();
}

/** 어느 암호화 키로 잠갔는지 — 키 자체를 드러내지 않는 지문 8자 */
export function kekFingerprint(secret: string): string {
  return createHash('sha256').update(`fcd-wing-kid:${secret}`, 'utf8').digest('hex').slice(0, 8);
}

export function last4(s: string): string {
  const t = s.trim();
  return t.length <= 4 ? t : t.slice(-4);
}

export function encryptCredentials(c: WingCredentials, orgId: string, secret: string | null | undefined): string {
  const key = kek(secret);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(`fcd-wing:${orgId}`, 'utf8'));
  const body = Buffer.concat([cipher.update(JSON.stringify({ v: c.vendorId, a: c.accessKey, s: c.secretKey }), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ['v1', kekFingerprint(secret!), iv.toString('base64url'), tag.toString('base64url'), body.toString('base64url')].join('.');
}

export const BLOB_RE = /^v1\.[0-9a-f]{8}\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]+$/;

export function decryptCredentials(blob: string, orgId: string, secret: string | null | undefined): WingCredentials {
  const key = kek(secret);
  if (!BLOB_RE.test(blob)) throw new WingKeyError('암호문 모양이 아닙니다');
  const [, kid, iv, tag, body] = blob.split('.');
  if (kid !== kekFingerprint(secret!)) throw new WingKeyError('다른 암호화 키로 잠근 기록입니다');
  try {
    const d = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
    d.setAAD(Buffer.from(`fcd-wing:${orgId}`, 'utf8'));
    d.setAuthTag(Buffer.from(tag, 'base64url'));
    const j = JSON.parse(Buffer.concat([d.update(Buffer.from(body, 'base64url')), d.final()]).toString('utf8')) as { v: string; a: string; s: string };
    return { vendorId: j.v, accessKey: j.a, secretKey: j.s };
  } catch {
    // 까닭(키 틀림·조직 다름·변조)을 가르지 않는다
    throw new WingKeyError('암호문을 풀지 못했습니다');
  }
}
