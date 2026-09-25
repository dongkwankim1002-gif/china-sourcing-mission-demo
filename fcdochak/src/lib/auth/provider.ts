import 'server-only';
/**
 * 누구인지 확인하는 곳 — Supabase Auth(환경변수가 있으면) 또는 로컬 비밀번호 해시.
 * Supabase 호출은 서버에서만 한다. 가입 확인 메일은 보내지 않는다(email_confirm: true) —
 * 밖으로 나가는 것은 OUTBOUND_ENABLED 스위치 뒤에 둔다.
 */
import { randomUUID } from 'node:crypto';
import { env } from '../env';
import { asSystem, type Queryable } from '../db';
import { hashPassword, verifyPassword } from './password';

export async function verifyCredentials(email: string, password: string): Promise<string | null> {
  const e = email.trim().toLowerCase();
  if (env.usingSupabaseAuth) {
    const r = await fetch(`${env.supabaseUrl}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { apikey: env.supabaseAnonKey!, 'content-type': 'application/json' },
      body: JSON.stringify({ email: e, password }),
      cache: 'no-store',
    });
    if (!r.ok) return null;
    const j = (await r.json()) as { user?: { id?: string } };
    return j.user?.id ?? null;
  }
  const rows = await asSystem((q) =>
    q.query<{ id: string; password_hash: string }>(
      `select p.id, c.password_hash from fcd.profiles p join fcd.local_credentials c on c.user_id = p.id where lower(p.email) = $1`,
      [e],
    ),
  );
  if (!rows[0]) {
    await hashPassword(password); // 시간 차로 계정 유무가 새지 않게
    return null;
  }
  return (await verifyPassword(password, rows[0].password_hash)) ? rows[0].id : null;
}

/** 계정 만들기 — 반환값은 사용자 id(= fcd.profiles.id) */
export async function createAuthUser(email: string, password: string, q?: Queryable, id?: string): Promise<string> {
  const e = email.trim().toLowerCase();
  if (env.usingSupabaseAuth) {
    const r = await fetch(`${env.supabaseUrl}/auth/v1/admin/users`, {
      method: 'POST',
      headers: {
        apikey: env.supabaseServiceKey!,
        authorization: `Bearer ${env.supabaseServiceKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ id, email: e, password, email_confirm: true }),
      cache: 'no-store',
    });
    if (!r.ok) {
      const t = await r.text();
      throw new Error(r.status === 422 ? '이미 가입된 이메일입니다.' : `계정을 만들지 못했습니다(${r.status}). ${t.slice(0, 120)}`);
    }
    const j = (await r.json()) as { id: string };
    return j.id;
  }
  return id ?? randomUUID();
}

/** 로컬 방식일 때만 비밀번호 해시를 저장 */
export async function storeLocalPassword(q: Queryable, userId: string, password: string) {
  if (env.usingSupabaseAuth) return;
  await q.query(`insert into fcd.local_credentials (user_id, password_hash) values ($1, $2)`, [userId, await hashPassword(password)]);
}
