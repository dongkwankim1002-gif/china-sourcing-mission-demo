'use client';
import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Check } from 'lucide-react';
import { Button } from '@/components/ui/core';
import { registerInterest, saveFirmQuote } from '@/app/actions/assure';
import type { AssureKind } from '@/lib/assure-settings';
import { ASSURE_ACTION } from './labels';

export type AssureCtx = { source: 'compare'; query: string } | { source: 'request'; requestId: string };

export function InterestButton({ kind, label, ctx, shown, done: initialDone, pilot }: { kind: AssureKind; label: string; ctx: AssureCtx; shown?: number | null; done: boolean; pilot: boolean }) {
  const [done, setDone] = React.useState(initialDone);
  const [pending, start] = React.useTransition();
  if (done)
    return (
      <Button size="sm" variant="secondary" disabled aria-label={`${label} ${ASSURE_ACTION.interestDone}`}>
        <Check aria-hidden /> {ASSURE_ACTION.interestDone}
      </Button>
    );
  return (
    <Button
      size="sm"
      variant="secondary"
      disabled={pending}
      aria-label={`${label} ${pilot ? ASSURE_ACTION.pilotApply : ASSURE_ACTION.interest}`}
      onClick={() =>
        start(async () => {
          const r = await registerInterest({ kind, ctx, shown: shown ?? null });
          if (!r.ok) return void toast.error(r.error ?? '관심 등록을 하지 못했습니다');
          setDone(true);
          toast.success(r.already ? `${label} — 이미 관심 등록하셨습니다` : `${label} 관심 등록했습니다. 시범이 열리면 알려 드립니다.`);
        })
      }
    >
      {pilot ? ASSURE_ACTION.pilotApply : ASSURE_ACTION.interest}
    </Button>
  );
}

export function FirmQuoteButton({ ctx, again }: { ctx: AssureCtx; again: boolean }) {
  const router = useRouter();
  const [pending, start] = React.useTransition();
  return (
    <Button
      size="sm"
      variant="primary"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const r = await saveFirmQuote(ctx);
          if (!r.ok) return void toast.error(r.error ?? '확정가 견적을 만들지 못했습니다');
          toast.success(`시범 확정가 견적 ${r.quoteNo} 을 기록했습니다(계약·결제 없음)`);
          router.refresh();
        })
      }
    >
      {again ? ASSURE_ACTION.firmQuoteAgain : ASSURE_ACTION.firmQuote}
    </Button>
  );
}
