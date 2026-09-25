'use client';
import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/core';
import { Dialog, DialogClose, DialogContent, DialogTrigger } from '@/components/ui/radix';
import { cancelRequest, selectBid } from '@/app/actions/shipper';
import { won } from '@/lib/format';
import { ACTION } from '@/lib/terms';

export function SelectBidButton({ requestId, bidId, partner, total, disabled }: { requestId: string; bidId: string; partner: string; total: number; disabled?: boolean }) {
  const router = useRouter();
  const [pending, start] = React.useTransition();
  const [open, setOpen] = React.useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="primary" disabled={disabled}>
          {ACTION.toBooking}
        </Button>
      </DialogTrigger>
      <DialogContent title={`${partner} 응찰로 예약할까요?`} description="예약으로 전환하면 이 요청은 마감되고, 물류사에게 예약 확정 알림이 갑니다.">
        <div className="grid gap-3 text-sm">
          <p className="rounded-sm bg-surface-2 p-3">
            응찰 합계 <b className="tnum">{won(total)}</b>. 운송계약은 {partner}와 직접 맺습니다. 플랫폼은 대금을 받지 않습니다.
          </p>
          <div className="flex justify-end gap-2">
            <DialogClose asChild>
              <Button variant="ghost">그만두기</Button>
            </DialogClose>
            <Button
              variant="primary"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const r = await selectBid(requestId, bidId);
                  if (!r.ok) {
                    toast.error(r.error ?? '예약하지 못했습니다');
                    return;
                  }
                  setOpen(false);
                  toast.success('예약으로 전환했습니다', { description: '선적 화면에서 진행 상황을 봅니다.' });
                  router.push(`/app/shipments/${r.data!.shipmentId}`);
                })
              }
            >
              {pending ? '전환하는 중…' : ACTION.toBooking}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function CancelRequestButton({ id }: { id: string }) {
  const router = useRouter();
  const [pending, start] = React.useTransition();
  return (
    <Button
      variant="danger"
      disabled={pending}
      onClick={() =>
        start(async () => {
          if (!window.confirm('이 요청을 취소할까요? 들어온 응찰도 함께 닫힙니다.')) return;
          const r = await cancelRequest(id);
          if (!r.ok) toast.error(r.error ?? '취소하지 못했습니다');
          else {
            toast.success('요청을 취소했습니다');
            router.refresh();
          }
        })
      }
    >
      {ACTION.cancelRequest}
    </Button>
  );
}
