import { getLocale, getTranslations } from 'next-intl/server';
import { asUser, todayKst } from '@/lib/db';
import { requireViewer } from '@/lib/server/viewer';
import { myOrgFacts } from '@/lib/server/partner';
import { getReference } from '@/lib/server/reference';
import { PageTitle } from '@/components/ui/core';
import { NewCardForm } from './form';

export const metadata = { title: '요금표 추가' };

export default async function NewCard({ searchParams }: { searchParams: Promise<{ hub?: string; port?: string; mode?: string }> }) {
  const sp = await searchParams;
  const v = await requireViewer('partner');
  const t = await getTranslations('p.rates');
  const locale = (await getLocale()) as 'ko' | 'zh';
  const zh = locale === 'zh';
  const [ref, facts] = await Promise.all([getReference(), asUser(v, (q) => myOrgFacts(q, v.org.id))]);
  const hubs = ref.hubs.filter((h) => !facts.hubs.length || facts.hubs.includes(h.code) || h.code === sp.hub).map((h) => ({ code: h.code, name: zh ? h.name_zh : h.name_ko }));
  return (
    <>
      <PageTitle title={t('add')} sub={t('sub')} />
      <NewCardForm today={todayKst()} hubs={hubs} ports={ref.ports.map((p) => ({ code: p.code, name: zh ? p.name_zh : `${p.name_ko}항` }))} modes={ref.modes.map((m) => ({ code: m.code, name: zh ? m.name_zh : m.name_ko }))} locale={locale} init={sp} />
    </>
  );
}
