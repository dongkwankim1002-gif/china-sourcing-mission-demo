import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { asUser } from '@/lib/db';
import { requireViewer } from '@/lib/server/viewer';
import { shipmentDetail } from '@/lib/server/shipper';
import { getReference, nameOf } from '@/lib/server/reference';
import { ActivityLog, DetailHead } from '@/components/activity';
import { UrlTabs } from '@/components/url-tabs';
import { ExceptionChip, StageChip, StageTrack, Won } from '@/components/badges';
import { BillingCompare } from '@/components/shipment/billing';
import { DocsPanel } from '@/components/shipment/docs';
import { ReviewForm } from '@/components/shipment/review-form';
import { ShipmentTimeline } from '@/components/workspace/timeline';
import { InvoiceDecisionPanel } from '@/components/workspace/invoice-decision';
import { currentDecision, shipmentDecisions, shipmentTimelineFacts, workspaceSettings } from '@/lib/server/workspace';
import { buildTimeline } from '@/lib/workspace/timeline';
import { billingDiff } from '@/lib/money/billing-diff';
import { Button, Chip, DefList, EmptyState, Panel } from '@/components/ui/core';
import { dateKo, dateTimeKo, num, pct } from '@/lib/format';
import { EXCEPTION_LABEL, STAGES } from '@/lib/terms';

export const metadata = { title: '선적' };

export default async function ShipmentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const v = await requireViewer('app');
  const [d, ref] = await Promise.all([
    asUser(v, async (q) => {
      const base = await shipmentDetail(q, id);
      if (!base) return null;
      const [facts, decisions, ws] = await Promise.all([shipmentTimelineFacts(q, id), shipmentDecisions(q, id), workspaceSettings(q)]);
      return { ...base, facts, decisions, ws };
    }),
    getReference(),
  ]);
  if (!d || d.s.shipper_org_id !== v.org.id) notFound();
  const { s, events, exceptions, docs, invoices, bid, review, facts, decisions, ws } = d;
  const inv = invoices.find((i) => i.current) ?? null;
  const decision = currentDecision(decisions, inv?.id ?? null);
  const diff = inv ? billingDiff(bid.amounts, inv.amounts, ws.billingFlagBp) : null;
  const timeline = buildTimeline({
    requestAt: facts?.request_at ?? s.created_at,
    bidCount: facts?.bid_count,
    bookedAt: facts?.booked_at ?? s.created_at,
    stage: s.stage,
    events,
    invoice: inv ? { created_at: inv.created_at, total: inv.total, version: inv.version } : null,
    decision: decision ? { decision: decision.decision, created_at: decision.created_at } : null,
    exceptionOpen: exceptions.some((e) => !e.resolved_at && e.kind !== 'billing_deviation'),
  });
  const open = exceptions.filter((e) => !e.resolved_at);
  const late = s.delivered_at && s.eta_fc ? new Date(s.delivered_at).getTime() > Date.parse(s.eta_fc + 'T23:59:59+09:00') : false;
  const dev = inv ? (inv.total - bid.total) / bid.total : null;

  const activity = [
    ...events.map((e) => ({ at: e.occurred_at, text: `${e.stage}. ${STAGES[e.stage]}${e.raw_status ? ` · 「${e.raw_status}」` : ''}${e.note ? ` — ${e.note}` : ''}`, who: e.who, tone: e.stage === 9 ? ('ok' as const) : undefined })),
    ...exceptions.map((e) => ({ at: e.opened_at, text: `예외: ${EXCEPTION_LABEL[e.kind]} — ${e.note}`, tone: 'stamp' as const })),
    ...exceptions.filter((e) => e.resolved_at).map((e) => ({ at: e.resolved_at!, text: `해결: ${EXCEPTION_LABEL[e.kind]}${e.resolution ? ` — ${e.resolution}` : ''}`, tone: 'ok' as const })),
    ...invoices.map((i) => ({ at: i.created_at, text: `청구서 ${i.invoice_no} v${i.version} · ${num(i.total)}원${i.note ? ` — ${i.note}` : ''}`, tone: 'caution' as const })),
    ...decisions.map((x) => ({ at: x.created_at, text: `청구 ${x.decision === 'approved' ? '승인' : '이의'}${x.reason ? ` — ${x.reason}` : ''}`, who: x.who, tone: x.decision === 'approved' ? ('ok' as const) : ('stamp' as const) })),
  ].sort((a, b) => b.at.localeCompare(a.at));

  return (
    <>
      <DetailHead
        eyebrow={<Link href="/app/shipments" className="hover:underline">선적</Link>}
        title={s.shipment_no}
        chips={<><StageChip stage={s.stage} />{open.map((e) => <ExceptionChip key={e.id} kind={e.kind} />)}</>}
        sub={`${s.title} · ${s.partner_name}`}
        actions={
          <>
            <Button asChild variant="secondary"><Link href={`/app/requests/${s.req_id}`}>견적 요청 {s.req_no}</Link></Button>
            {s.stage === 9 && !review ? <Button asChild variant="primary"><Link href="?tab=review">평가 남기기</Link></Button> : null}
          </>
        }
      />
      <Panel className="mb-4 grid gap-4 p-4">
        <ShipmentTimeline items={timeline} />
        <details className="border-t border-line-2 pt-3">
          <summary className="cursor-pointer text-xs font-semibold text-muted">표준 9단계 자세히</summary>
          <div className="mt-3"><StageTrack stage={s.stage} events={[...events].reverse()} /></div>
        </details>
      </Panel>
      <div className="grid gap-6 xl:grid-cols-[1fr_320px]">
        <div className="min-w-0">
          <Suspense>
            <UrlTabs
              tabs={[
                {
                  value: 'progress',
                  label: '진행',
                  content: (
                    <Panel className="p-4">
                      <DefList
                        items={[
                          ['구간', `${nameOf(ref, 'hub', s.origin_hub)} → ${nameOf(ref, 'port', s.port)}항 → ${s.fc_name}`],
                          ['운송 방식', `${nameOf(ref, 'mode', s.mode)} · 응찰 기간 ${bid.transit_days_min}~${bid.transit_days_max}일`],
                          ['화물', `${num(s.units)}개 · ${num(s.cartons)}박스 · ${num(s.kg, 1)} kg · ${num(s.cbm, 2)} CBM`],
                          ['출항 예정', dateKo(s.etd)],
                          ['FC 도착 예정', dateKo(s.eta_fc)],
                          ['FC 입고', s.delivered_at ? `${dateTimeKo(s.delivered_at)}${late ? ' (늦음)' : ''}` : '—'],
                          ['FC 회송', s.fc_returned_units ? `${num(s.fc_returned_units)}개 (${pct(s.fc_returned_units / s.units, 1)})` : '없음'],
                          ['예약 번호', s.booking_no],
                          ['물류사', <Link key="p" href={`/p/${s.partner_slug}`} className="underline">{s.partner_name}</Link>],
                        ]}
                      />
                    </Panel>
                  ),
                },
                {
                  value: 'exceptions',
                  label: `예외 (${exceptions.length})`,
                  content: exceptions.length ? (
                    <ul className="grid gap-2">
                      {exceptions.map((e) => (
                        <li key={e.id} className={`rounded-md border p-4 ${e.resolved_at ? 'border-line bg-surface' : 'border-stamp/40 bg-stamp-bg/40'}`}>
                          <div className="flex flex-wrap items-center gap-2">
                            <ExceptionChip kind={e.kind} resolved={!!e.resolved_at} />
                            <span className="text-xs text-muted">{dateTimeKo(e.opened_at)}</span>
                          </div>
                          <p className="mt-2 text-sm">{e.note}</p>
                          {e.resolved_at ? <p className="mt-1 text-xs text-ok">해결 {dateTimeKo(e.resolved_at)} — {e.resolution}</p> : <p className="mt-1 text-xs text-muted">물류사가 처리하고 있습니다. 해결되면 알림이 옵니다.</p>}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <Panel><EmptyState title="예외 없이 가고 있습니다" body="통관 보류·검사 지정·FC 입고 반려·카페리 결항·청구 편차가 생기면 여기에 뜹니다." /></Panel>
                  ),
                },
                { value: 'docs', label: `서류 (${docs.length})`, content: <DocsPanel shipmentId={s.id} docs={docs} /> },
                {
                  value: 'billing',
                  label: decision ? '청구 대조' : inv ? '청구 대조 · 결정 기다림' : '청구 대조',
                  content: inv ? (
                    <div className="grid gap-4">
                      <InvoiceDecisionPanel
                        shipmentId={s.id}
                        invoice={{ id: inv.id, invoice_no: inv.invoice_no, version: inv.version }}
                        diff={diff!}
                        flagBp={ws.billingFlagBp}
                        current={decision}
                        history={decisions.filter((x) => x.invoice_id === inv.id)}
                      />
                      <BillingCompare bid={bid} invoice={inv} />
                      {invoices.length > 1 ? (
                        <p className="text-xs text-muted">청구서는 고치지 않고 새 판으로 쌓입니다: {invoices.map((i) => `v${i.version} ${num(i.total)}원${i.current ? '(현재)' : ''}`).join(' → ')}</p>
                      ) : null}
                    </div>
                  ) : (
                    <Panel><EmptyState title="아직 청구서가 오지 않았습니다" body="물류사가 청구서를 등록하면 응찰과 구간별로 견주어 보여 드립니다." /></Panel>
                  ),
                },
                {
                  value: 'review',
                  label: '평가',
                  content: review ? (
                    <Panel className="p-4">
                      <p className="display text-2xl">{review.rating} / 5</p>
                      <p className="mt-2 text-sm">“{review.body}”</p>
                      <div className="mt-2 flex gap-1.5">
                        <Chip tone={review.on_time_ok ? 'ok' : 'caution'}>{review.on_time_ok ? '정시 입고' : '늦은 입고'}</Chip>
                        <Chip tone={review.billing_ok ? 'ok' : 'caution'}>{review.billing_ok ? '견적대로 청구' : '청구 차이'}</Chip>
                      </div>
                      <p className="mt-2 text-xs text-muted">{dateKo(review.created_at)}에 남겼습니다. 평가는 고칠 수 없습니다.</p>
                    </Panel>
                  ) : s.stage === 9 ? (
                    <ReviewForm shipmentId={s.id} defaultOnTime={!late} defaultBilling={dev == null || Math.abs(dev) < 0.03} />
                  ) : (
                    <Panel><EmptyState title="FC 입고가 끝나면 평가할 수 있습니다" /></Panel>
                  ),
                },
              ]}
            />
          </Suspense>
        </div>
        <div className="grid content-start gap-4">
          <Panel className="p-4">
            <p className="text-xs text-muted">응찰 합계</p>
            <Won v={bid.total} className="display text-2xl" />
            {inv ? (
              <p className="mt-1 text-sm">
                청구 <Won v={inv.total} className="font-bold" /> · <span className={Math.abs(dev!) >= 0.03 ? 'font-semibold text-stamp' : 'text-ok'}>{pct(dev, 1, true)}</span>
              </p>
            ) : (
              <p className="mt-1 text-xs text-muted">청구 전</p>
            )}
          </Panel>
          <ActivityLog items={activity} />
        </div>
      </div>
    </>
  );
}
