'use server';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { createSession, destroySession } from '@/lib/auth/session';
import { verifyCredentials } from '@/lib/auth/provider';
import { asSystem } from '@/lib/db';
import { env } from '@/lib/env';
import { getViewer, homeOf } from '@/lib/server/viewer';

export interface LoginState {
  error?: string;
  email?: string;
}

const LoginSchema = z.object({
  email: z.string().trim().email('이메일 형식이 아닙니다'),
  password: z.string().min(1, '비밀번호를 넣어 주세요'),
  next: z.string().optional(),
});

async function isDemoUser(userId: string) {
  const r = await asSystem((q) =>
    q.query<{ d: boolean }>('select o.is_demo d from fcd.profiles p join fcd.orgs o on o.id = p.home_org_id where p.id = $1', [userId]),
  );
  return r[0]?.d ?? false;
}

function safeNext(next: string | undefined | null) {
  return next && next.startsWith('/') && !next.startsWith('//') ? next : null;
}

export async function login(_: LoginState, form: FormData): Promise<LoginState> {
  const parsed = LoginSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0].message, email: String(form.get('email') ?? '') };
  const { email, password, next } = parsed.data;
  const id = await verifyCredentials(email, password);
  if (!id) return { error: '이메일 또는 비밀번호가 맞지 않습니다. 대소문자와 한/영 전환을 확인해 주세요.', email };
  if (!env.demoMode && (await isDemoUser(id))) {
    return { error: '예시 데이터를 걷어낸 뒤라 데모 계정으로는 들어갈 수 없습니다.', email };
  }
  await createSession(id);
  const v = await getViewer();
  redirect(safeNext(next) ?? (v ? homeOf(v) : '/'));
}

export async function demoLogin(form: FormData) {
  const as = String(form.get('as') ?? 'shipper') as 'shipper' | 'partner' | 'admin';
  if (!env.demoMode) redirect('/login?demo=off');
  const pw = env.demoPassword;
  if (!pw) redirect('/login?demo=nopass');
  const { DEMO_ACCOUNTS } = await import('@seed/demo');
  const acct = DEMO_ACCOUNTS[as] ?? DEMO_ACCOUNTS.shipper;
  const id = await verifyCredentials(acct.email, pw);
  if (!id) redirect('/login?demo=missing');
  await createSession(id);
  const jar = await cookies();
  jar.delete('fcd_org');
  redirect(as === 'partner' ? '/partner' : as === 'admin' ? '/admin' : '/app');
}

export async function logout() {
  await destroySession();
  redirect('/');
}

export async function switchOrg(form: FormData) {
  const id = String(form.get('org') ?? '');
  const v = await getViewer();
  const org = v?.orgs.find((o) => o.id === id);
  if (!v || !org) return;
  const jar = await cookies();
  jar.set('fcd_org', org.id, { path: '/', httpOnly: true, sameSite: 'lax' });
  redirect(org.kind === 'shipper' ? '/app' : org.kind === 'partner' ? '/partner' : '/admin');
}

export async function setLocale(locale: 'ko' | 'zh') {
  const jar = await cookies();
  jar.set('fcd_locale', locale === 'zh' ? 'zh' : 'ko', { path: '/', sameSite: 'lax', maxAge: 365 * 24 * 3600 });
}
