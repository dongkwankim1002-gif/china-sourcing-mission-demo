import 'server-only';
import { cache } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { asUser } from '../db';
import { env } from '../env';
import { readSession } from '../auth/session';

export interface ViewerOrg {
  id: string;
  name: string;
  name_zh: string | null;
  kind: 'shipper' | 'partner' | 'platform';
  role: string;
  is_demo: boolean;
  status: string;
  slug: string | null;
  default_locale: 'ko' | 'zh';
}

export interface Viewer {
  id: string;
  name: string;
  email: string;
  locale: 'ko' | 'zh';
  orgs: ViewerOrg[];
  org: ViewerOrg;
  unread: number;
}

/** 로그인한 사람(없으면 null). 한 요청 안에서는 한 번만 읽는다. */
export const getViewer = cache(async (): Promise<Viewer | null> => {
  const s = await readSession();
  if (!s) return null;
  const rows = await asUser({ id: s.userId }, async (q) => {
    const p = await q.query<{ id: string; name: string; email: string; locale: 'ko' | 'zh' }>(
      'select id, name, email, locale from fcd.profiles where id = $1',
      [s.userId],
    );
    if (!p[0]) return null;
    const orgs = await q.query<ViewerOrg>(
      `select o.id, o.name, o.name_zh, o.kind, m.role, o.is_demo, o.status, o.slug, o.default_locale
       from fcd.memberships m join fcd.orgs o on o.id = m.org_id
       where m.user_id = $1 order by o.kind, o.name`,
      [s.userId],
    );
    const unread = await q.query<{ n: number }>(
      'select count(*)::int n from fcd.notifications where user_id = $1 and read_at is null',
      [s.userId],
    );
    return { p: p[0], orgs, unread: unread[0]?.n ?? 0 };
  });
  if (!rows || rows.orgs.length === 0) return null;
  // DEMO_MODE 가 꺼져 있으면 데모 조직 사람은 들어오지 못한다
  const orgs = env.demoMode ? rows.orgs : rows.orgs.filter((o) => !o.is_demo);
  if (orgs.length === 0) return null;
  const jar = await cookies();
  const want = jar.get('fcd_org')?.value;
  const org = orgs.find((o) => o.id === want) ?? orgs[0];
  return { ...rows.p, orgs, org, unread: rows.unread };
});

export type Area = 'app' | 'partner' | 'admin';
const KIND: Record<Area, ViewerOrg['kind']> = { app: 'shipper', partner: 'partner', admin: 'platform' };

export function homeOf(v: Viewer): string {
  return v.org.kind === 'shipper' ? '/app' : v.org.kind === 'partner' ? '/partner' : '/admin';
}

/** 그 면에 맞는 조직으로 들어왔는지. 아니면 로그인 또는 권한 없음 페이지로. */
export async function requireViewer(area: Area, next?: string): Promise<Viewer> {
  const v = await getViewer();
  if (!v) redirect(`/login${next ? `?next=${encodeURIComponent(next)}` : ''}`);
  const kind = KIND[area];
  if (v.org.kind !== kind) {
    const other = v.orgs.find((o) => o.kind === kind);
    if (other) return { ...v, org: other };
    redirect(`/forbidden?area=${area}`);
  }
  return v;
}
