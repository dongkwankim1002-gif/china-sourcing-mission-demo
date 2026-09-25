import 'server-only';
/**
 * 세션 — 서버가 서명한 쿠키 하나(fcd_session). 브라우저는 Supabase 토큰을 받지 않는다.
 * 비밀값은 SESSION_SECRET 환경변수에만. 없으면(로컬) 프로세스마다 임시 비밀을 만든다.
 */
import { cookies } from 'next/headers';
import { SignJWT, jwtVerify } from 'jose';
import { randomBytes } from 'node:crypto';
import { env } from '../env';

const COOKIE = 'fcd_session';
const MAX_AGE = 14 * 24 * 3600;

type G = typeof globalThis & { __fcdEphemeralSecret?: Uint8Array; __fcdWarned?: boolean };
const g = globalThis as G;

function secret(): Uint8Array {
  const s = env.sessionSecret;
  if (s) return new TextEncoder().encode(s);
  if (!g.__fcdEphemeralSecret) {
    g.__fcdEphemeralSecret = randomBytes(32);
    if (!g.__fcdWarned && process.env.NODE_ENV === 'production') {
      g.__fcdWarned = true;
      console.warn('[fcdochak] SESSION_SECRET 이 없어 임시 비밀로 세션을 서명합니다. 재시작하면 모두 로그아웃됩니다.');
    }
  }
  return g.__fcdEphemeralSecret;
}

export async function createSession(userId: string) {
  const token = await new SignJWT({ sub: userId })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE}s`)
    .sign(secret());
  const jar = await cookies();
  jar.set(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production' && env.siteUrl.startsWith('https'),
    path: '/',
    maxAge: MAX_AGE,
  });
}

export async function destroySession() {
  const jar = await cookies();
  jar.delete(COOKIE);
  jar.delete('fcd_org');
}

export async function readSession(): Promise<{ userId: string } | null> {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret(), { algorithms: ['HS256'] });
    return typeof payload.sub === 'string' ? { userId: payload.sub } : null;
  } catch {
    return null;
  }
}
