import Link from 'next/link';
import { getLocale, getTranslations } from 'next-intl/server';
import { ArrowRight } from 'lucide-react';
import { asUser, todayKst } from '@/lib/db';
import { requireViewer } from '@/lib/server/viewer';
import { loadSettings } from '@/lib/server/settings';
import { partnerDashboard } from '@/lib/server/partner';
import { fillDaily, shortDay } from '@/lib/server/shipper';
import { getReference, nameOf } from '@/lib/server/reference';
import { StatTile } from '@/components/stat';
import { DailyBars } from '@/components/charts';
import { Freshness } from '@/components/period-picker';
import { Deadline, FcReadyChip, PartnerStatusChip, Won } from '@/components/badges';
import { Button, Chip, EmptyState, PageTitle, Panel, PanelHead } from '@/components/ui/core';
import { dateKo, pct } from '@/lib/format';
import { isFcReady } from '@/lib/money';

export const metadata = { title: '물류사 콘솔' };

export default async function PartnerHome({ searchParams }: { searchParams: Promise<{ welcome?: string }> }) {
  const sp = await searchParams;
  const v = await requireViewer('partner');
  const t = await getTranslations('p');
  const zh = (await getLocale()) === 'zh';
  const today = todayKst();
  const [ref, d] = await Promise.all([getReference(), asUser(v, async (q) => { const s = await loadSettings(q); return { ...(await partnerDashboard(q, v.org.id, s, today)), s }; })]);
  const m = d.metrics as Record<string, number | null> | null;
  const fc = m ? isFcReady(m.shipments_done ?? 0, m.return_rate_30d, d.s.fcReadyRule) : false;
  const newOnes = d.items.filter((i) => !i.my_bid_id && i.blocked.length === 0 && i.auto);
  const closing = d.items.filter((i) => i.display_status === 'closing_soon' && !i.my_bid_id);
  const now = new Date().toISOString();
  return (
    <>
      <PageTitle
        title={t('dash.title')}
        sub={`${zh && v.org.name_zh ? v.org.name_zh : v.org.name} · ${t('dash.sub')}`}
        actions={<><Freshness at={now} /><Button asChild variant="primary"><Link href="/partner/inbox">{t('inbox.title')}</Link></Button></>}
      />
      {sp.welcome ? <div className="mb-4 rounded-md border border-label bg-label/15 p-4 text-sm">{t('dash.welcome')}</div> : null}
      {v.org.status === 'pending_verification' ? <div className="mb-4 flex items-center gap-2 rounded-md border border-line bg-surface p-4 text-sm"><PartnerStatusChip status="pending_verification" zh={zh} /> {t('dash.pending')}</div> : null}
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        <StatTile label={t('dash.newReqs')} value={newOnes.length} suffix={zh ? '条' : '건'} href="/partner/inbox" />
        <StatTile label={t('dash.closing')} value={closing.length} suffix={zh ? '条' : '건'} href="/partner/inbox?status=closing_soon" />
        <StatTile label={t('dash.won')} value={d.counts.won_sum} format="won" hint={t('dash.wonHint', { n: d.counts.won_month })} trend={fillDaily(d.daily, 30).map((x) => x.v)} />
        <StatTile label={t('dash.dev')} value={m?.avg_signed_deviation ?? null} format="pct" good="none" hint={m?.invoiced_count ? `${m.invoiced_count}${zh ? '张账单' : '건 기준'}` : t('common.none')} />
        <StatTile label={t('dash.expiring')} value={d.counts.expiring} suffix={zh ? '张' : '장'} href="/partner/rates?state=soon" />
        <StatTile label={t('dash.active')} value={d.counts.active} suffix={zh ? '单' : '건'} href="/partner/shipments?stage=active" />
      </section>
      <div className="mt-6 grid gap-6 xl:grid-cols-[1fr_380px]">
        <Panel>
          <PanelHead title={t('dash.inbox')} action={<Button asChild size="sm" variant="secondary"><Link href="/partner/inbox">{t('common.all')}</Link></Button>} />
          {d.items.length ? (
            <ul>
              {d.items.slice(0, 7).map((r) => (
                <li key={r.id} className="border-b border-line-2 last:border-0">
                  <Link href={`/partner/inbox/${r.id}`} className="grid gap-1 px-4 py-3 hover:bg-surface-2 sm:grid-cols-[1fr_auto] sm:items-center">
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold tnum">{r.req_no} · {nameOf(ref, 'hub', r.origin_hub, zh)} → {nameOf(ref, 'port', r.port, zh)}</span>
                      <span className="block truncate text-xs text-muted">{r.cbm} CBM · {r.kg} kg · {r.cartons}{zh ? '箱' : '박스'}{r.traits.length ? ` · ${r.traits.map((x) => ref.traits.find((y) => y.code === x)?.[zh ? 'name_zh' : 'name_ko']).join('·')}` : ''}</span>
                    </span>
                    <span className="flex items-center gap-3">
                      {r.my_bid_id ? <Chip tone="ok">{t('inbox.status.bid')}</Chip> : r.blocked.length ? <Chip tone="stamp">{t('inbox.blocked')}</Chip> : r.auto ? <Won v={r.auto.quote.total} short className="text-sm font-bold" /> : <Chip tone="neutral">{t('inbox.noCard')}</Chip>}
                      <Deadline at={r.bid_deadline} />
                      <ArrowRight className="size-4 text-muted" aria-hidden />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title={t('dash.empty')} />
          )}
        </Panel>
        <div className="grid content-start gap-6">
          <Panel>
            <PanelHead title={t('dash.score')} action={fc ? <FcReadyChip zh={zh} /> : null} />
            <dl className="grid grid-cols-2 gap-px bg-line-2">
              {[
                [t('dash.onTime'), m?.shipments_done ? pct(m.on_time_rate, 0) : '—'],
                [t('dash.dev'), m?.invoiced_count ? pct(m.avg_deviation, 1) : '—'],
                [t('dash.return'), m?.done_30d ? pct(m.return_rate_30d, 1) : '—'],
                [t('dash.done'), String(m?.shipments_done ?? 0)],
              ].map(([k, val]) => (
                <div key={k} className="bg-surface p-4"><dt className="text-xs text-muted">{k}</dt><dd className="display text-xl tnum">{val}</dd></div>
              ))}
            </dl>
          </Panel>
          <Panel>
            <PanelHead title={t('dash.expList')} action={<Button asChild size="sm" variant="secondary"><Link href="/partner/rates">{t('rates.title')}</Link></Button>} />
            {d.expiring.length ? (
              <ul>
                {d.expiring.map((c) => (
                  <li key={c.id} className="flex items-center justify-between gap-2 border-b border-line-2 px-4 py-2.5 text-sm last:border-0">
                    <Link href={`/partner/rates/${c.id}`} className="font-semibold hover:underline">{nameOf(ref, 'hub', c.origin_hub, zh)}→{nameOf(ref, 'port', c.port, zh)} · {nameOf(ref, 'mode', c.mode, zh)}</Link>
                    <span className={c.valid_to < today ? 'text-xs text-stamp' : 'text-xs text-caution'}>{dateKo(c.valid_to, { dow: false })}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState title={t('common.none')} />
            )}
          </Panel>
        </div>
        <Panel className="xl:col-span-2">
          <PanelHead title={zh ? '近30天订舱数' : '최근 30일 예약 수'} />
          <div className="p-4"><DailyBars data={fillDaily(d.daily, 30).map((x) => ({ d: shortDay(x.d), v: x.v }))} name={zh ? '订舱' : '예약'} /></div>
        </Panel>
      </div>
    </>
  );
}
