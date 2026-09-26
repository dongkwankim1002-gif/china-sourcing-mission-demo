/**
 * 화주 대시보드(/app)의 원스톱 주문 카드 — v2 화면과 닿는 세 곳 중 하나(docs/onestop-plan.md 3절).
 * 진행 중인 원스톱 주문 셋까지와 「맡기기」 링크만. 읽기가 실패해도 대시보드는 그대로 그린다.
 */
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { asUser } from '@/lib/db';
import { myOrders } from '@/lib/server/onestop';
import type { Viewer } from '@/lib/server/viewer';
import { Chip, Panel, PanelHead } from '@/components/ui/core';
import { num, won } from '@/lib/format';
import { ONESTOP_ACTION } from '@/lib/terms';
import { StageChip } from './parts';

export async function OnestopDashboardCard({ viewer }: { viewer: Viewer }) {
  let orders: Awaited<ReturnType<typeof myOrders>> = [];
  try {
    orders = await asUser(viewer, (q) => myOrders(q, viewer.org.id, 20));
  } catch (e) {
    console.error(`[onestop] 대시보드 카드 읽기 실패: ${(e as Error).message}`);
    return null;
  }
  const open = orders.filter((o) => o.shown !== 'fc_received' && o.shown !== 'cancelled');
  return (
    <Panel className="mt-6" aria-labelledby="os-card-h" data-testid="onestop-card">
      <PanelHead
        id="os-card-h"
        title={
          <span className="flex flex-wrap items-center gap-2">
            원스톱 주문 <Chip tone="caution">미리보기</Chip>
          </span>
        }
        sub={open.length ? `진행 중 ${open.length}건` : '소량이면 사입부터 FC 입고까지 가격 하나로 맡길 수 있습니다'}
        action={
          <Link href={orders.length ? '/onestop/orders' : '/onestop'} className="text-sm font-semibold underline underline-offset-4">
            {orders.length ? ONESTOP_ACTION.orders : ONESTOP_ACTION.entrust}
          </Link>
        }
      />
      {open.length ? (
        <ul className="divide-y divide-line-2">
          {open.slice(0, 3).map((o) => (
            <li key={o.root}>
              <Link href={`/onestop/orders/${o.root}`} className="flex min-w-0 items-center gap-3 px-4 py-3 hover:bg-surface-2">
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <b className="min-w-0 break-words text-sm">{o.product_name}</b>
                    <StageChip stage={o.shown} />
                  </span>
                  <span className="block text-xs text-muted tnum">
                    {o.order_no} · {num(o.cbm, 2)} CBM · {won(o.total_krw)}
                  </span>
                </span>
                <ArrowRight aria-hidden className="size-4 shrink-0 text-muted" />
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </Panel>
  );
}
