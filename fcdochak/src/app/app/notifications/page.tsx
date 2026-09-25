import { asUser } from '@/lib/db';
import { env } from '@/lib/env';
import { requireViewer } from '@/lib/server/viewer';
import { listNotifications, notificationPrefs } from '@/lib/server/shipper';
import { NotificationCenter } from '@/components/notifications/center';
import { PageTitle } from '@/components/ui/core';

export const metadata = { title: '알림' };

export default async function Notifications() {
  const v = await requireViewer('app');
  const { items, prefs } = await asUser(v, async (q) => ({ items: await listNotifications(q, v.id), prefs: await notificationPrefs(q, v.id) }));
  return (
    <>
      <PageTitle title="알림" sub="응찰 도착 · 마감 임박 · 예외 발생 · 청구서 도착" />
      <NotificationCenter items={items} prefs={prefs} outbound={env.outboundEnabled} />
    </>
  );
}
