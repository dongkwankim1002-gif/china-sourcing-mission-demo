'use client';
import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Check } from 'lucide-react';
import { cancelSourcingRequest, registerSampleInterest } from '@/app/actions/sourcing';
import { Button } from '@/components/ui/core';
import { SOURCING_ACTION } from '@/lib/terms';

export function SampleButton({ requestId, candidateId, label, done: initial, qty, price }: { requestId: string; candidateId: string; label: string; done: boolean; qty: number; price: number | null }) {
  const [done, setDone] = React.useState(initial);
  const [pending, start] = React.useTransition();
  if (done)
    return (
      <Button size="sm" variant="secondary" disabled aria-label={`${label} ${SOURCING_ACTION.sampleDone}`}>
        <Check aria-hidden /> {SOURCING_ACTION.sampleDone}
      </Button>
    );
  return (
    <Button
      size="sm"
      variant="secondary"
      disabled={pending}
      aria-label={`${label} ${SOURCING_ACTION.sample}`}
      onClick={() =>
        start(async () => {
          const r = await registerSampleInterest({ requestId, candidateId, qty, price });
          if (!r.ok) return void toast.error(r.error ?? '샘플 요청을 남기지 못했습니다');
          setDone(true);
          toast.success(r.already ? '이미 샘플 요청을 남기셨습니다' : `${label} 샘플 요청(관심 등록)을 남겼습니다 — 연락은 가지 않습니다`);
        })
      }
    >
      {SOURCING_ACTION.sample}
    </Button>
  );
}

export function CancelRequestButton({ requestId }: { requestId: string }) {
  const router = useRouter();
  const [pending, start] = React.useTransition();
  return (
    <Button
      size="sm"
      variant="danger"
      disabled={pending}
      onClick={() => {
        if (!window.confirm('이 소싱 요청을 취소할까요? 기록은 남습니다.')) return;
        start(async () => {
          const r = await cancelSourcingRequest({ requestId });
          if (!r.ok) return void toast.error(r.error ?? '취소하지 못했습니다');
          toast.success('요청을 취소했습니다');
          router.refresh();
        });
      }}
    >
      {SOURCING_ACTION.cancel}
    </Button>
  );
}
