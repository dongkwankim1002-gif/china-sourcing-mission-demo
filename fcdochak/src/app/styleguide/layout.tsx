import { AppShell } from '@/components/shell/app-shell';
import { requireViewer } from '@/lib/server/viewer';
import { env } from '@/lib/env';

export const dynamic = 'force-dynamic';

/** 스타일가이드 — 운영자만 */
export default async function StyleguideLayout({ children }: { children: React.ReactNode }) {
  const v = await requireViewer('admin', '/styleguide');
  return (
    <AppShell area="admin" demo={env.demoMode} viewer={{ name: v.name, email: v.email, unread: v.unread, org: v.org, orgs: v.orgs }}>
      {children}
    </AppShell>
  );
}
