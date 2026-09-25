import { Suspense } from 'react';
import { getLocale, getTranslations } from 'next-intl/server';
import { asUser, todayKst } from '@/lib/db';
import { requireViewer } from '@/lib/server/viewer';
import { myCards } from '@/lib/server/partner';
import { loadSettings } from '@/lib/server/settings';
import { getReference, nameOf } from '@/lib/server/reference';
import { daysUntil } from '@/lib/money';
import { PageTitle, Skeleton } from '@/components/ui/core';
import { RatesTable, type CardListRow } from './table';

export const metadata = { title: '요금표' };

export default async function RatesPage() {
  const v = await requireViewer('partner');
  const t = await getTranslations('p.rates');
  const zh = (await getLocale()) === 'zh';
  const today = todayKst();
  const [ref, { cards, s }] = await Promise.all([getReference(), asUser(v, async (q) => ({ cards: await myCards(q, v.org.id), s: await loadSettings(q) }))]);
  const rows: CardListRow[] = cards.map((c) => ({
    id: c.id,
    card_no: c.card_no,
    version: c.version,
    lane: `${nameOf(ref, 'hub', c.origin_hub, zh)} → ${nameOf(ref, 'port', c.port, zh)} · ${nameOf(ref, 'mode', c.mode, zh)}`,
    mode: c.mode,
    valid_from: c.valid_from,
    valid_to: c.valid_to,
    state: c.status === 'withdrawn' ? 'withdrawn' : c.valid_to < today ? 'expired' : daysUntil(c.valid_to, today) <= s.expiringDays ? 'soon' : 'valid',
    is_public_price: c.is_public_price,
    certainty: c.certainty,
    included: c.included?.length ?? 0,
    created_at: c.created_at,
  }));
  return (
    <>
      <PageTitle title={t('title')} sub={t('sub')} />
      <Suspense fallback={<Skeleton className="h-96" />}>
        <RatesTable rows={rows} today={today} />
      </Suspense>
    </>
  );
}
