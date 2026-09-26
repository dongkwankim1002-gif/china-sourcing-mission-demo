import Link from 'next/link';
import { notFound } from 'next/navigation';
import { asUser } from '@/lib/db';
import { requireViewer } from '@/lib/server/viewer';
import { loadOnestopConfig, orderByRoot, orderEvents, orderNames, orderVersions } from '@/lib/server/onestop';
import { OnestopNotice, StageChip } from '@/components/onestop/parts';
import { OrderBody } from '@/components/onestop/order-view';
import { CancelOrderButton } from '@/components/onestop/actions';
import { dateKo } from '@/lib/format';
import { ONESTOP_ACTION } from '@/lib/terms';

export const metadata = { title: '원스톱 주문' };

export default async function OnestopOrderDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const v = await requireViewer('app', `/onestop/orders/${id}`);
  const d = await asUser(v, async (q) => {
    const o = await orderByRoot(q, id);
    if (!o || o.org_id !== v.org.id) return null;
    return { o, config: await loadOnestopConfig(q), events: await orderEvents(q, o.root), versions: await orderVersions(q, o.root), names: await orderNames(q, o) };
  });
  if (!d) notFound();
  const { o } = d;
  return (
    <>
      <p className="mb-2 text-sm">
        <Link href="/onestop/orders" className="font-semibold underline underline-offset-4">
          ← {ONESTOP_ACTION.orders}
        </Link>
      </p>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-muted tnum">
            {o.order_no} · 접수 {dateKo(o.received_at)}
          </p>
          <h1 className="flex flex-wrap items-center gap-2 text-xl font-bold tracking-tight">
            <span className="min-w-0 break-words">{o.product_name}</span>
            <StageChip stage={o.shown} />
          </h1>
        </div>
        {o.stage === 'received' ? <CancelOrderButton orderId={o.root} /> : null}
      </div>
      <OnestopNotice on={d.config.on} />
      <OrderBody o={o} events={d.events} versions={d.versions} area="app" {...d.names} />
    </>
  );
}
