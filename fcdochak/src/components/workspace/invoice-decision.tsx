'use client';
/**
 * 청구 승인/이의 — 물류사가 낸 현재 판 청구서에 화주가 결정을 남긴다.
 * 결정은 고치지 않고 덧붙인다(바꾸면 새 판). 견적 대비 차이를 곁에 보인다.
 */
import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { AlertTriangle, CheckCircle2, MessageSquareWarning } from 'lucide-react';
import { decideInvoice } from '@/app/actions/workspace';
import { Button, Chip, Field, Panel, PanelHead, Textarea } from '@/components/ui/core';
import { SEGMENT_LABEL_KO } from '@/lib/money/segments';
import type { BillingDiff } from '@/lib/money/billing-diff';
import { cn } from '@/lib/cn';
import { dateTimeKo, num } from '@/lib/format';
import { ACTION } from '@/lib/terms';

export interface DecisionView {
  id: string;
  decision: 'approved' | 'disputed';
  reason: string | null;
  created_at: string;
  who: string | null;
  invoice_total: number;
  quote_total: number;
}

const bpText = (bp: number | null) => (bp == null ? '—' : `${bp > 0 ? '+' : bp < 0 ? '−' : ''}${(Math.abs(bp) / 100).toFixed(1)}%`);
const wonDelta = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${num(Math.abs(n))}원`;

export function DiffSummary({ diff, flagBp }: { diff: BillingDiff; flagBp: number }) {
  const inc = diff.rows.filter((r) => r.delta > 0).sort((a, b) => b.delta - a.delta);
  const dec = diff.rows.filter((r) => r.delta < 0);
  return (
    <div className="grid gap-2" data-testid="billing-diff">
      <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-3">
        <div className="min-w-0 rounded-sm bg-surface-2 p-2.5">
          <dt className="text-xs text-muted">견적(응찰)</dt>
          <dd className="font-bold tnum">{num(diff.quoteTotal)}원</dd>
        </div>
        <div className="min-w-0 rounded-sm bg-surface-2 p-2.5">
          <dt className="text-xs text-muted">청구</dt>
          <dd className="font-bold tnum">{num(diff.invoiceTotal)}원</dd>
        </div>
        <div className={cn('min-w-0 rounded-sm p-2.5', diff.flagged ? 'bg-stamp-bg' : 'bg-surface-2')}>
          <dt className="text-xs text-muted">견적 대비</dt>
          <dd className={cn('font-bold tnum', diff.flagged ? 'text-stamp' : diff.delta === 0 ? 'text-text' : 'text-ok')}>
            {wonDelta(diff.delta)} <span className="text-xs">({bpText(diff.deviationBp)})</span>
          </dd>
        </div>
      </dl>
      {diff.flagged ? (
        <p className="flex items-start gap-1.5 text-sm text-stamp">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          차이가 큽니다 — 기준 {(flagBp / 100).toFixed(1)}% 이상. 근거를 확인하고 결정하세요.
        </p>
      ) : null}
      {inc.length ? (
        <p className="text-sm">
          <span className="font-semibold">늘어난 구간</span>{' '}
          {inc.map((r) => `${SEGMENT_LABEL_KO[r.segment]} ${wonDelta(r.delta)}${r.added ? '(견적에 없던 칸)' : ''}`).join(' · ')}
        </p>
      ) : null}
      {dec.length ? (
        <p className="text-sm text-muted">줄어든 구간 {dec.map((r) => `${SEGMENT_LABEL_KO[r.segment]} ${wonDelta(r.delta)}`).join(' · ')}</p>
      ) : null}
    </div>
  );
}

export function InvoiceDecisionPanel({
  shipmentId,
  invoice,
  diff,
  flagBp,
  current,
  history,
}: {
  shipmentId: string;
  invoice: { id: string; invoice_no: string; version: number };
  diff: BillingDiff;
  flagBp: number;
  current: DecisionView | null;
  history: DecisionView[];
}) {
  const router = useRouter();
  const [mode, setMode] = React.useState<'idle' | 'dispute'>('idle');
  const [changing, setChanging] = React.useState(false);
  const [reason, setReason] = React.useState('');
  const [err, setErr] = React.useState<string | null>(null);
  const [pending, start] = React.useTransition();
  const open = !current || changing;

  const send = (decision: 'approved' | 'disputed') => {
    setErr(null);
    if (decision === 'disputed' && reason.trim().length < 5) return setErr('이의 사유를 다섯 글자 이상 적어 주세요');
    start(async () => {
      const r = await decideInvoice({ shipmentId, invoiceId: invoice.id, decision, reason: decision === 'disputed' ? reason : undefined, supersedesId: current?.id ?? null });
      if (!r.ok) return setErr(r.error ?? '남기지 못했습니다');
      toast.success(decision === 'approved' ? '청구를 승인했습니다' : '이의를 남겼습니다', { description: '물류사에 앱 안 알림으로 전했습니다.' });
      setMode('idle');
      setChanging(false);
      setReason('');
      router.refresh();
    });
  };

  return (
    <Panel data-testid="invoice-decision">
      <PanelHead
        title="청구 승인 · 이의"
        sub={`${invoice.invoice_no}${invoice.version > 1 ? ` v${invoice.version}` : ''} · 결정은 고치지 않고 기록으로 쌓입니다`}
        action={
          current ? (
            current.decision === 'approved' ? (
              <Chip tone="ok" icon={<CheckCircle2 aria-hidden />}>승인함</Chip>
            ) : (
              <Chip tone="stamp" icon={<MessageSquareWarning aria-hidden />}>이의 제기함</Chip>
            )
          ) : (
            <Chip tone="caution">결정 기다림</Chip>
          )
        }
      />
      <div className="grid gap-4 p-4">
        <DiffSummary diff={diff} flagBp={flagBp} />
        {current ? (
          <div className="rounded-sm border border-line-2 p-3 text-sm">
            <p className="font-semibold">
              {current.decision === 'approved' ? '이 청구서를 승인했습니다' : '이 청구서에 이의를 남겼습니다'}
              <span className="ml-2 text-xs font-normal text-muted">{current.who ? `${current.who} · ` : ''}{dateTimeKo(current.created_at)}</span>
            </p>
            {current.reason ? <p className="mt-1 whitespace-pre-wrap text-sm">사유: {current.reason}</p> : null}
            {!changing ? (
              <Button size="sm" variant="ghost" className="mt-2" onClick={() => setChanging(true)}>{ACTION.changeDecision}</Button>
            ) : null}
          </div>
        ) : null}
        {open ? (
          <div className="grid gap-3">
            {mode === 'dispute' ? (
              <Field label="이의 사유" htmlFor="dec-reason" hint="물류사가 이 글을 봅니다. 어느 구간이 왜 다른지 적어 주세요." error={err ?? undefined}>
                <Textarea id="dec-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} placeholder="예: 항만 비용이 응찰보다 3만 원 많습니다. 근거 자료를 보내 주세요." />
              </Field>
            ) : err ? (
              <p role="alert" className="text-sm text-stamp">{err}</p>
            ) : null}
            <div className="flex flex-wrap justify-end gap-2">
              {changing ? <Button variant="ghost" onClick={() => { setChanging(false); setMode('idle'); setErr(null); }}>그만두기</Button> : null}
              {mode === 'dispute' ? (
                <>
                  <Button variant="ghost" onClick={() => { setMode('idle'); setErr(null); }}>취소</Button>
                  <Button variant="danger" disabled={pending} onClick={() => send('disputed')}>{pending ? '남기는 중…' : ACTION.disputeInvoice}</Button>
                </>
              ) : (
                <>
                  {current?.decision !== 'disputed' ? <Button variant="danger" disabled={pending} onClick={() => setMode('dispute')}>{ACTION.disputeInvoice}</Button> : <Button variant="danger" disabled={pending} onClick={() => setMode('dispute')}>이의 다시 남기기</Button>}
                  {current?.decision !== 'approved' ? <Button variant="primary" disabled={pending} onClick={() => send('approved')}>{pending ? '남기는 중…' : ACTION.approveInvoice}</Button> : null}
                </>
              )}
            </div>
          </div>
        ) : null}
        {history.length > 1 ? (
          <details className="text-xs text-muted">
            <summary className="cursor-pointer">결정 기록 {history.length}건</summary>
            <ol className="mt-2 grid gap-1">
              {history.map((h) => (
                <li key={h.id}>
                  {dateTimeKo(h.created_at)} · {h.decision === 'approved' ? '승인' : '이의'}{h.reason ? ` — ${h.reason}` : ''} · 청구 {num(h.invoice_total)}원
                </li>
              ))}
            </ol>
          </details>
        ) : null}
      </div>
    </Panel>
  );
}
