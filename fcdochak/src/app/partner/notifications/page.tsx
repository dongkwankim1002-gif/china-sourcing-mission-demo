import { getLocale, getTranslations } from 'next-intl/server';
import { asUser } from '@/lib/db';
import { env } from '@/lib/env';
import { requireViewer } from '@/lib/server/viewer';
import { listNotifications, notificationPrefs } from '@/lib/server/shipper';
import { NotificationCenter } from '@/components/notifications/center';
import { PageTitle } from '@/components/ui/core';

export const metadata = { title: '알림' };

export default async function PartnerNotifications() {
  const v = await requireViewer('partner');
  const t = await getTranslations('p.notif');
  const zh = (await getLocale()) === 'zh';
  const { items, prefs } = await asUser(v, async (q) => ({ items: await listNotifications(q, v.id), prefs: await notificationPrefs(q, v.id) }));
  return (
    <>
      <PageTitle title={t('title')} />
      <NotificationCenter items={items} prefs={prefs} outbound={env.outboundEnabled} zh={zh} />
    </>
  );
}
