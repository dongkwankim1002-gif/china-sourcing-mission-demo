import { Suspense } from 'react';
import { getLocale, getTranslations } from 'next-intl/server';
import { asUser, todayKst } from '@/lib/db';
import { requireViewer } from '@/lib/server/viewer';
import { loadSettings } from '@/lib/server/settings';
import { inbox } from '@/lib/server/partner';
import { getReference, nameOf } from '@/lib/server/reference';
import { reasonText } from '@/lib/money';
import { PageTitle, Skeleton } from '@/components/ui/core';
import { InboxTable, type InboxRow } from './table';

export const metadata = { title: '견적 수신함' };

export default async function InboxPage() {
  const v = await requireViewer('partner');
  const t = await getTranslations('p.inbox');
  const zh = (await getLocale()) === 'zh';
  const today = todayKst();
  const [ref, items] = await Promise.all([getReference(), asUser(v, async (q) => inbox(q, v.org.id, await loadSettings(q), today, { includeClosed: true }))]);
  const rows: InboxRow[] = items.map((r) => ({
    id: r.id,
    req_no: r.req_no,
    lane: `${nameOf(ref, 'hub', r.origin_hub, zh)} → ${nameOf(ref, 'port', r.port, zh)} · ${r.mode ? nameOf(ref, 'mode', r.mode, zh) : zh ? '不限' : '방식 무관'}`,
    hub: r.origin_hub,
    cargo: `${r.units.toLocaleString('ko-KR')}${zh ? '件' : '개'} · ${r.cartons}${zh ? '箱' : '박스'} · ${r.kg} kg`,
    traits: r.traits.map((x) => ref.traits.find((y) => y.code === x)?.[zh ? 'name_zh' : 'name_ko'] ?? x).join('·'),
    display_status: r.display_status,
    bid_deadline: r.bid_deadline,
    auto_total: r.auto?.quote.total ?? null,
    my_bid_total: r.my_bid_status === 'submitted' ? r.my_bid_total : null,
    my_state: r.won ? 'won' : r.display_status === 'selected' ? 'lost' : r.my_bid_id && r.my_bid_status === 'submitted' ? 'bid' : ['waiting', 'bidding', 'closing_soon'].includes(r.display_status) ? 'none' : 'closed',
    blocked: r.blocked.length ? r.blocked.map(reasonText).join(', ') : null,
    cbm: r.cbm,
  }));
  return (
    <>
      <PageTitle title={t('title')} sub={t('sub')} />
      <Suspense fallback={<Skeleton className="h-96" />}>
        <InboxTable rows={rows} hubs={ref.hubs.map((h) => ({ value: h.code, label: zh ? h.name_zh : h.name_ko }))} />
      </Suspense>
    </>
  );
}
