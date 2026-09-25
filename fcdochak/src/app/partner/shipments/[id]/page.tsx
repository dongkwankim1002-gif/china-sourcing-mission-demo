import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { getLocale, getTranslations } from 'next-intl/server';
import { asUser, todayKst } from '@/lib/db';
import { requireViewer } from '@/lib/server/viewer';
import { shipmentDetail } from '@/lib/server/shipper';
import { getReference, nameOf } from '@/lib/server/reference';
import { ActivityLog, DetailHead } from '@/components/activity';
import { UrlTabs } from '@/components/url-tabs';
import { ExceptionChip, StageChip, StageTrack, Won } from '@/components/badges';
import { BillingCompare } from '@/components/shipment/billing';
import { DocsPanel } from '@/components/shipment/docs';
import { DefList, EmptyState, Panel, PanelHead } from '@/components/ui/core';
import { ExceptionForm, InvoiceForm, ResolveButton, StageForm } from './forms';
import { dateKo, dateTimeKo, num } from '@/lib/format';
import { EXCEPTION_LABEL, STAGES, STAGES_ZH } from '@/lib/terms';

export const metadata = { title: '선적' };

export default async function PartnerShipment({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const v = await requireViewer('partner');
  const t = await getTranslations('p.ship');
  const zh = (await getLocale()) === 'zh';
  const [d, ref] = await Promise.all([asUser(v, (q) => shipmentDetail(q, id)), getReference()]);
  if (!d || d.s.partner_org_id !== v.org.id) notFound();
  const { s, events, exceptions, docs, invoices, bid, review } = d;
  const inv = invoices.find((i) => i.current) ?? null;
  const names = zh ? STAGES_ZH : STAGES;
  const activity = [
    ...events.map((e) => ({ at: e.occurred_at, text: `${e.stage}. ${names[e.stage]}${e.raw_status ? ` · 「${e.raw_status}」` : ''}${e.note ? ` — ${e.note}` : ''}`, who: e.who, tone: e.stage === 9 ? ('ok' as const) : undefined })),
    ...exceptions.map((e) => ({ at: e.opened_at, text: `${EXCEPTION_LABEL[e.kind]} — ${e.note}`, tone: 'stamp' as const })),
    ...invoices.map((i) => ({ at: i.created_at, text: `${i.invoice_no} v${i.version} · ${num(i.total)}`, tone: 'caution' as const })),
  ].sort((a, b) => b.at.localeCompare(a.at));
  return (
    <>
      <DetailHead
        eyebrow={<Link href="/partner/shipments" className="hover:underline">{t('title')}</Link>}
        title={s.shipment_no}
        chips={<><StageChip stage={s.stage} zh={zh} />{exceptions.filter((e) => !e.resolved_at).map((e) => <ExceptionChip key={e.id} kind={e.kind} />)}</>}
        sub={`${s.shipper_name ?? ''} · ${s.title}`}
      />
      <Panel className="mb-4 p-4"><StageTrack stage={s.stage} events={[...events].reverse()} zh={zh} /></Panel>
      <div className="grid gap-6 xl:grid-cols-[1fr_320px]">
        <div className="min-w-0">
          <Suspense>
            <UrlTabs
              tabs={[
                { value: 'status', label: t('update'), content: <Panel className="p-4"><StageForm shipmentId={s.id} stage={s.stage} units={s.units} zh={zh} /></Panel> },
                {
                  value: 'exceptions',
                  label: `${zh ? '异常' : '예외'} (${exceptions.length})`,
                  content: (
                    <div className="grid gap-3">
                      <Panel className="p-4"><ExceptionForm shipmentId={s.id} zh={zh} /></Panel>
                      {exceptions.map((e) => (
                        <div key={e.id} className={`rounded-md border p-4 ${e.resolved_at ? 'border-line bg-surface' : 'border-stamp/40 bg-stamp-bg/40'}`}>
                          <div className="flex items-center gap-2"><ExceptionChip kind={e.kind} resolved={!!e.resolved_at} /><span className="text-xs text-muted">{dateTimeKo(e.opened_at)}</span></div>
                          <p className="mt-2 text-sm">{e.note}</p>
                          {e.resolved_at ? <p className="mt-1 text-xs text-ok">{e.resolution}</p> : <ResolveButton id={e.id} shipmentId={s.id} zh={zh} />}
                        </div>
                      ))}
                    </div>
                  ),
                },
                { value: 'docs', label: `${zh ? '文件' : '서류'} (${docs.length})`, content: <DocsPanel shipmentId={s.id} docs={docs} zh={zh} /> },
                {
                  value: 'invoice',
                  label: t('invoice'),
                  content: (
                    <div className="grid gap-4">
                      {inv ? <BillingCompare bid={bid} invoice={inv} zh={zh} /> : null}
                      <Panel><PanelHead title={inv ? t('invoiceNew') : t('invoice')} /><div className="p-4"><InvoiceForm shipmentId={s.id} bid={bid.amounts} prev={inv?.amounts ?? null} today={todayKst()} zh={zh} /></div></Panel>
                    </div>
                  ),
                },
              ]}
            />
          </Suspense>
        </div>
        <div className="grid content-start gap-4">
          <Panel className="p-4">
            <DefList
              items={[
                [zh ? '线路' : '구간', `${nameOf(ref, 'hub', s.origin_hub, zh)} → ${nameOf(ref, 'port', s.port, zh)} → ${s.fc_name}`],
                [zh ? '货物' : '화물', `${num(s.units)} · ${s.cartons} · ${num(s.kg, 1)} kg · ${num(s.cbm, 2)} CBM`],
                [zh ? '预计到FC' : 'FC 도착 예정', dateKo(s.eta_fc)],
                [zh ? '报价' : '응찰', <Won key="b" v={bid.total} />],
                [zh ? '账单' : '청구', inv ? <Won key="i" v={inv.total} /> : '—'],
                [zh ? '评价' : '평가', review ? `${review.rating}/5` : '—'],
              ]}
            />
          </Panel>
          {activity.length ? <ActivityLog items={activity} title={zh ? '记录' : '활동 기록'} /> : <EmptyState title="—" />}
        </div>
      </div>
    </>
  );
}
