import { NextIntlClientProvider } from 'next-intl';
import { getLocale, getMessages } from 'next-intl/server';
import { AppShell } from '@/components/shell/app-shell';
import { requireViewer } from '@/lib/server/viewer';
import { env } from '@/lib/env';

export const dynamic = 'force-dynamic';

export default async function PartnerLayout({ children }: { children: React.ReactNode }) {
  const v = await requireViewer('partner', '/partner');
  const locale = (await getLocale()) as 'ko' | 'zh';
  const messages = await getMessages();
  return (
    <NextIntlClientProvider locale={locale} messages={messages}>
      <AppShell area="partner" locale={locale} demo={env.demoMode} viewer={{ name: v.name, email: v.email, unread: v.unread, org: v.org, orgs: v.orgs }}>
        {children}
      </AppShell>
    </NextIntlClientProvider>
  );
}
