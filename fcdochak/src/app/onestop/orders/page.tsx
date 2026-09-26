import Link from 'next/link';
import { ArrowRight, PackagePlus } from 'lucide-react';
import { asUser } from '@/lib/db';
import { requireViewer } from '@/lib/server/viewer';
import { loadOnestopConfig, myOrders } from '@/lib/server/onestop';
import { OnestopNotice, StageChip } from '@/components/onestop/parts';
import { buttonVariants, Chip, EmptyState, Panel } from '@/components/ui/core';
import { dateKo, num, won } from '@/lib/format';
import { ONESTOP_ACTION } from '@/lib/terms';

export const metadata = { title: '내 원스톱 주문' };

export default async function OnestopOrders() {
  const v = await requireViewer('app', '/onestop/orders');
  const d = await asUser(v, async (q) => ({ config: await loadOnestopConfig(q), orders: await myOrders(q, v.org.id) }));
  return (
    <>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-muted">{v.org.name}</p>
          <h1 className="text-xl font-bold tracking-tight">{ONESTOP_ACTION.orders}</h1>
        </div>
        <Link href="/onestop/order" className={buttonVariants({ variant: 'primary' })}>
          {ONESTOP_ACTION.entrust}
        </Link>
      </div>
      <OnestopNotice on={d.config.on} />
      <Panel>
        {d.orders.length ? (
          <ul className="divide-y divide-line-2" data-testid="onestop-orders">
            {d.orders.map((o) => (
              <li key={o.root}>
                <Link href={`/onestop/orders/${o.root}`} className="flex min-w-0 items-center gap-3 px-4 py-3 hover:bg-surface-2">
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <b className="min-w-0 break-words">{o.product_name}</b>
                      <StageChip stage={o.shown} />
                      {o.preview ? <Chip tone="caution">접수 기록만</Chip> : null}
                    </span>
                    <span className="mt-0.5 block text-xs text-muted tnum">
                      {o.order_no} · {num(o.units)}개 · {num(o.cbm, 2)} CBM · {won(o.total_krw)} · <span className="whitespace-nowrap">접수 {dateKo(o.received_at, { dow: false })}</span>
                    </span>
                  </span>
                  <ArrowRight aria-hidden className="size-4 shrink-0 text-muted" />
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState
            icon={<PackagePlus aria-hidden />}
            title="아직 원스톱 주문이 없습니다"
            body="상품과 수량·부피를 적으면 가격 하나가 나옵니다. 지금은 접수 기록만 남깁니다."
            action={
              <Link href="/onestop" className={buttonVariants({ variant: 'primary' })}>
                {ONESTOP_ACTION.entrust}
              </Link>
            }
          />
        )}
      </Panel>
    </>
  );
}
