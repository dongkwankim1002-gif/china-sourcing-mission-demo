import Link from 'next/link';
import { Suspense } from 'react';
import { asUser } from '@/lib/db';
import { requireViewer } from '@/lib/server/viewer';
import { adminResolveException, decideDeletion, decideVerification } from '@/app/actions/admin';
import { ConfirmAction } from '@/components/admin/confirm-action';
import { UrlTabs } from '@/components/url-tabs';
import { DemoChip, ExceptionChip, PartnerStatusChip } from '@/components/badges';
import { EmptyState, PageTitle, Panel } from '@/components/ui/core';
import { ago, dateTimeKo } from '@/lib/format';

export const metadata = { title: '처리 대기' };

export default async function Queues() {
  const v = await requireViewer('admin');
  const d = await asUser(v, async (q) => ({
    verify: await q.query<{ id: string; org_id: string; org_name: string; org_slug: string; org_status: string; is_demo: boolean; requester_name: string; requester_email: string; requester_phone: string | null; message: string | null; created_at: string }>(
      `select r.id, r.org_id, o.name org_name, o.slug org_slug, o.status org_status, o.is_demo, r.requester_name, r.requester_email, r.requester_phone, r.message, r.created_at
         from fcd.verification_requests r join fcd.orgs o on o.id = r.org_id where r.status = 'pending' order by r.created_at`,
    ),
    deletion: await q.query<{ id: string; org_name: string; org_slug: string; is_demo: boolean; requester_name: string; requester_email: string; reason: string; created_at: string }>(
      `select r.id, o.name org_name, o.slug org_slug, o.is_demo, r.requester_name, r.requester_email, r.reason, r.created_at
         from fcd.deletion_requests r join fcd.orgs o on o.id = r.org_id where r.status = 'pending' order by r.created_at`,
    ),
    billing: await q.query<{ id: string; kind: string; note: string; opened_at: string; shipment_no: string; partner: string; shipper: string; is_demo: boolean }>(
      `select e.id, e.kind, e.note, e.opened_at, s.shipment_no, p.name partner, sh.name shipper, sh.is_demo
         from fcd.exceptions e join fcd.shipments s on s.id = e.shipment_id join fcd.orgs p on p.id = s.partner_org_id join fcd.orgs sh on sh.id = s.shipper_org_id
        where e.resolved_at is null order by (e.kind = 'billing_deviation') desc, e.opened_at limit 100`,
    ),
  }));
  const card = (children: React.ReactNode, key: string) => <li key={key} className="rounded-md border border-line bg-surface p-4">{children}</li>;
  return (
    <>
      <PageTitle title="처리 대기" sub="인증 · 게시 삭제 · 예외. 처리하면 감사 기록에 남습니다." />
      <Suspense>
        <UrlTabs
          tabs={[
            {
              value: 'verify',
              label: `담당자 인증 (${d.verify.length})`,
              content: d.verify.length ? (
                <ul className="grid gap-2">
                  {d.verify.map((r) =>
                    card(
                      <div className="flex flex-wrap items-start gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="flex flex-wrap items-center gap-2 font-bold"><Link href={`/p/${r.org_slug}`} className="hover:underline">{r.org_name}</Link><PartnerStatusChip status={r.org_status} />{r.is_demo ? <DemoChip /> : null}</p>
                          <p className="mt-1 text-sm">{r.requester_name} · {r.requester_email}{r.requester_phone ? ` · ${r.requester_phone}` : ''}</p>
                          {r.message ? <p className="mt-1 text-xs text-muted">“{r.message}”</p> : null}
                          <p className="mt-1 text-2xs text-muted">{dateTimeKo(r.created_at)} · {ago(r.created_at)}</p>
                        </div>
                        <div className="flex gap-2">
                          <ConfirmAction label="승인" variant="primary" needNote title={`${r.org_name} 공식 등록`} description="사업자등록증·업역 등록을 확인했으면 승인합니다. 업체가 「공식 등록」으로 바뀝니다." action={decideVerification.bind(null, r.id, true)} />
                          <ConfirmAction label="반려" variant="danger" needNote notePlaceholder="반려 사유" action={decideVerification.bind(null, r.id, false)} />
                        </div>
                      </div>,
                      r.id,
                    ),
                  )}
                </ul>
              ) : <Panel><EmptyState title="기다리는 인증 요청이 없습니다" /></Panel>,
            },
            {
              value: 'deletion',
              label: `게시 삭제 (${d.deletion.length})`,
              content: d.deletion.length ? (
                <ul className="grid gap-2">
                  {d.deletion.map((r) =>
                    card(
                      <div className="flex flex-wrap items-start gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="flex items-center gap-2 font-bold">{r.org_name}{r.is_demo ? <DemoChip /> : null}</p>
                          <p className="mt-1 text-sm">“{r.reason}”</p>
                          <p className="mt-1 text-2xs text-muted">{r.requester_name} · {r.requester_email} · {dateTimeKo(r.created_at)}</p>
                        </div>
                        <div className="flex gap-2">
                          <ConfirmAction label="게시 내리기" variant="danger" needNote title="게시를 내립니다" description="업체 상태가 「삭제」가 되어 공개 면에서 사라집니다. 기록 자체를 지우지는 않습니다." action={decideDeletion.bind(null, r.id, true)} />
                          <ConfirmAction label="되돌리기" needNote action={decideDeletion.bind(null, r.id, false)} />
                        </div>
                      </div>,
                      r.id,
                    ),
                  )}
                </ul>
              ) : <Panel><EmptyState title="기다리는 삭제 요청이 없습니다" /></Panel>,
            },
            {
              value: 'billing',
              label: `예외 (${d.billing.length})`,
              content: d.billing.length ? (
                <ul className="grid gap-2">
                  {d.billing.map((e) =>
                    card(
                      <div className="flex flex-wrap items-start gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="flex flex-wrap items-center gap-2 text-sm font-bold"><ExceptionChip kind={e.kind} /> {e.shipment_no}{e.is_demo ? <DemoChip /> : null}</p>
                          <p className="mt-1 text-sm">{e.note}</p>
                          <p className="mt-1 text-2xs text-muted">{e.shipper} ↔ {e.partner} · {ago(e.opened_at)}</p>
                        </div>
                        <ConfirmAction label="운영에서 닫기" needNote action={adminResolveException.bind(null, e.id)} />
                      </div>,
                      e.id,
                    ),
                  )}
                </ul>
              ) : <Panel><EmptyState title="열린 예외가 없습니다" /></Panel>,
            },
          ]}
        />
      </Suspense>
    </>
  );
}
