'use client';
import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { reportBilling, submitReview } from '@/app/actions/shipper';
import { Button, Field, Textarea } from '@/components/ui/core';
import { Switch } from '@/components/ui/radix';
import { cn } from '@/lib/cn';
import { ACTION } from '@/lib/terms';

export function ReviewForm({ shipmentId, defaultOnTime, defaultBilling }: { shipmentId: string; defaultOnTime: boolean; defaultBilling: boolean }) {
  const router = useRouter();
  const [rating, setRating] = React.useState(0);
  const [onTime, setOnTime] = React.useState(defaultOnTime);
  const [billing, setBilling] = React.useState(defaultBilling);
  const [body, setBody] = React.useState('');
  const [err, setErr] = React.useState<string | null>(null);
  const [pending, start] = React.useTransition();
  return (
    <form
      className="grid gap-4 rounded-md border border-line bg-surface p-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!rating) return setErr('점수를 고르세요');
        start(async () => {
          const r = await submitReview({ shipmentId, rating, onTimeOk: onTime, billingOk: billing, body });
          if (!r.ok) return setErr(r.error ?? '남기지 못했습니다');
          toast.success('평가를 남겼습니다', { description: '업체 공개 페이지의 후기와 점수에 반영됩니다.' });
          router.refresh();
        });
      }}
    >
      <fieldset>
        <legend className="mb-2 text-sm font-semibold">점수</legend>
        <div className="flex gap-1.5" role="radiogroup" aria-label="점수">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={rating === n}
              onClick={() => setRating(n)}
              className={cn('display grid size-11 place-items-center rounded-xs border-2 text-lg', rating >= n ? (n >= 4 ? 'border-ok text-ok' : n === 3 ? 'border-caution text-caution' : 'border-stamp text-stamp') : 'border-line text-muted')}
            >
              {n}
            </button>
          ))}
        </div>
      </fieldset>
      <div className="flex flex-wrap gap-6 text-sm">
        <label className="flex items-center gap-2"><Switch checked={onTime} onCheckedChange={setOnTime} /> 약속한 날 FC 입고</label>
        <label className="flex items-center gap-2"><Switch checked={billing} onCheckedChange={setBilling} /> 견적대로 청구</label>
      </div>
      <Field label="한 줄 후기" htmlFor="rv-body" hint="공개 페이지에 회사 이름 없이 「화주 · 구간」으로 실립니다" error={err ?? undefined}>
        <Textarea id="rv-body" value={body} onChange={(e) => setBody(e.target.value)} maxLength={600} />
      </Field>
      <div className="flex justify-end">
        <Button type="submit" variant="primary" disabled={pending}>{pending ? '남기는 중…' : ACTION.review}</Button>
      </div>
    </form>
  );
}

export function ReportBilling({ shipmentId }: { shipmentId: string }) {
  const router = useRouter();
  const [note, setNote] = React.useState('');
  const [pending, start] = React.useTransition();
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await reportBilling(shipmentId, note);
          if (!r.ok) return void toast.error(r.error ?? '보내지 못했습니다');
          toast.success('물류사에 청구 확인을 요청했습니다');
          setNote('');
          router.refresh();
        });
      }}
    >
      <Field label="청구가 견적과 다르면" htmlFor="rb-note" className="min-w-0 flex-1">
        <Textarea id="rb-note" value={note} onChange={(e) => setNote(e.target.value)} className="min-h-10" placeholder="예: 항만 비용이 응찰보다 3만 원 많습니다. 근거를 보내 주세요." />
      </Field>
      <Button type="submit" variant="danger" disabled={pending}>청구 확인 요청</Button>
    </form>
  );
}
