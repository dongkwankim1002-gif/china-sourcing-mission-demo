import { AppShell } from '@/components/shell/app-shell';
import { requireViewer } from '@/lib/server/viewer';
import { env } from '@/lib/env';

export const dynamic = 'force-dynamic';

export default async function ShipperLayout({ children }: { children: React.ReactNode }) {
  const v = await requireViewer('app', '/app');
  return (
    <AppShell
      area="app"
      demo={env.demoMode}
      viewer={{ name: v.name, email: v.email, unread: v.unread, org: v.org, orgs: v.orgs }}
    >
      {children}
    </AppShell>
  );
}
