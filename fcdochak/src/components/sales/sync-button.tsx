'use client';
/** 판매 기록 가져오기(v2 3차 sales) — 데모는 흉내 어댑터, 실제는 스위치 꺼짐이면 「시험 모드」 */
import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { RefreshCw } from 'lucide-react';
import { syncSales } from '@/app/actions/sales';
import { Button } from '@/components/ui/core';
import { SALES_ACTION } from '@/lib/terms';

export function SalesSyncButton() {
  const router = useRouter();
  const [pending, start] = React.useTransition();
  return (
    <Button
      variant="secondary"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const r = await syncSales();
          if (r.ok) {
            const d = r.data;
            toast.success('판매 기록을 가져왔습니다', { description: d ? `새로·바뀜 — 주문 ${d.orders} · 재고 ${d.inventory} · 반품 ${d.returns} · 그대로 ${d.skipped}` : undefined });
          } else toast.error(r.error ?? '가져오지 못했습니다');
          router.refresh();
        })
      }
    >
      <RefreshCw aria-hidden className={pending ? 'animate-spin motion-reduce:animate-none' : undefined} /> {SALES_ACTION.sync}
    </Button>
  );
}
