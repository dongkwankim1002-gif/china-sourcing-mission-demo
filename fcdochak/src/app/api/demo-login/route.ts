import { NextResponse, type NextRequest } from 'next/server';
import { createSession } from '@/lib/auth/session';
import { verifyCredentials } from '@/lib/auth/provider';
import { env } from '@/lib/env';
import { DEMO_ACCOUNTS } from '@seed/demo';

export const dynamic = 'force-dynamic';

/** 「데모로 둘러보기」의 폼 경로(자바스크립트 없이도 동작). DEMO_MODE 가 켜져 있고 DEMO_PASSWORD 가 있을 때만. */
export async function POST(req: NextRequest) {
  const as = (req.nextUrl.searchParams.get('as') ?? 'shipper') as keyof typeof DEMO_ACCOUNTS;
  const acct = DEMO_ACCOUNTS[as] ?? DEMO_ACCOUNTS.shipper;
  const back = (p: string) => NextResponse.redirect(new URL(p, req.url), 303);
  if (!env.demoMode) return back('/login?demo=off');
  if (!env.demoPassword) return back('/login?demo=nopass');
  const id = await verifyCredentials(acct.email, env.demoPassword);
  if (!id) return back('/login?demo=missing');
  await createSession(id);
  return back(as === 'partner' ? '/partner' : as === 'admin' ? '/admin' : '/app');
}
