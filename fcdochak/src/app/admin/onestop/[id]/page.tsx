import Link from 'next/link';
import { notFound } from 'next/navigation';
import { asUser, todayKst } from '@/lib/db';
import { requireViewer } from '@/lib/server/viewer';
import { loadOnestopConfig, orderByRoot, orderEvents, orderNames, orderVersions, shipmentsForOrg } from '@/lib/server/onestop';
import { canCancelAsPlatform, nextStages } from '@/lib/onestop/settings';
import { OnestopNotice, StageChip } from '@/components/onestop/parts';
import { OrderBody } from '@/components/onestop/order-view';
import { ReviseForm, StageForm } from '@/components/onestop/actions';
import { DemoChip } from '@/components/badges';
import { Panel, PanelHead } from '@/components/ui/core';
import { dateKo } from '@/lib/format';

export const metadata = { title: '원스톱 주문' };

export default async function OnestopAdminDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const v = await requireViewer('admin', `/admin/onestop/${id}`);
  const d = await asUser(v, async (q) => {
    const o = await orderByRoot(q, id);
    if (!o) return null;
    return {
      o,
      config: await loadOnestopConfig(q),
      events: await orderEvents(q, o.root),
      versions: await orderVersions(q, o.root),
      names: await orderNames(q, o),
      shipments: await shipmentsForOrg(q, o.org_id),
    };
  });
  if (!d) notFound();
  const { o } = d;
  const cancelled = o.stage === 'cancelled';
  return (
    <>
      <p className="mb-2 text-sm">
        <Link href="/admin/onestop" className="font-semibold underline underline-offset-4">
          ← 원스톱 주문 대기열
        </Link>
      </p>
      <div className="mb-4 min-w-0">
        <p className="flex flex-wrap items-center gap-2 text-xs font-semibold text-muted tnum">
          {o.org_name} {o.is_demo ? <DemoChip /> : null} · {o.order_no} · 접수 {dateKo(o.received_at)}
        </p>
        <h1 className="flex flex-wrap items-center gap-2 text-xl font-bold tracking-tight">
          <span className="min-w-0 break-words">{o.product_name}</span>
          <StageChip stage={o.shown} />
        </h1>
      </div>
      <OnestopNotice on={d.config.on} />
      {!cancelled ? (
        <div className="mb-6 grid gap-6 lg:grid-cols-2">
          <Panel aria-labelledby="st-h">
            <PanelHead id="st-h" title="단계 남기기 · 更新阶段" sub="기록은 쌓이기만 합니다 — 되돌리기 없음" />
            <div className="p-4">
              <StageForm key={`${o.shown}-${d.events.length}`} orderId={o.root} next={nextStages(o.shown)} canCancel={canCancelAsPlatform(o.shown)} today={todayKst()} />
            </div>
          </Panel>
          <Panel aria-labelledby="rv-h">
            <PanelHead id="rv-h" title="주문 새 판 · 实测/关联货件" sub="실측·선적 잇기 — 앞 판은 그대로 남고 요금은 다시 셉니다" />
            <div className="p-4">
              <ReviseForm
                key={o.id}
                orderId={o.root}
                initial={{ units: o.units, cartons: o.cartons, cbm: o.cbm, kg: o.kg, measured: o.measured, shipmentNo: o.shipment_no }}
                shipments={d.shipments.map((s) => ({ shipment_no: s.shipment_no, stage: s.stage }))}
              />
            </div>
          </Panel>
        </div>
      ) : null}
      <OrderBody o={o} events={d.events} versions={d.versions} area="admin" {...d.names} />
    </>
  );
}
