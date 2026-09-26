'use client';
import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { addInvoice, openException, resolveException, updateStage } from '@/app/actions/partner';
import { NumberField } from '@/components/number-field';
import { Button, Field, Input, NativeSelect, Textarea } from '@/components/ui/core';
import { SEGMENTS, SEGMENT_LABEL_KO, SEGMENT_LABEL_ZH } from '@/lib/money/segments';
import { EXCEPTION_LABEL, STAGES, STAGES_ZH } from '@/lib/terms';
import { num, won } from '@/lib/format';

function localNow() {
  const d = new Date(Date.now() + 9 * 3600_000);
  return d.toISOString().slice(0, 16);
}

export function StageForm({ shipmentId, stage, units, zh }: { shipmentId: string; stage: number; units: number; zh: boolean }) {
  const t = useTranslations('p.ship');
  const router = useRouter();
  const [next, setNext] = React.useState(Math.min(9, stage + 1));
  const [raw, setRaw] = React.useState('');
  const [note, setNote] = React.useState('');
  const [when, setWhen] = React.useState(localNow);
  const [returned, setReturned] = React.useState<number | null>(0);
  const [pending, start] = React.useTransition();
  const names = zh ? STAGES_ZH : STAGES;
  // 갱신 뒤 새 단계가 들어오면 「다음 단계」도 그 다음으로
  React.useEffect(() => setNext(Math.min(9, stage + 1)), [stage]);
  if (stage >= 9) return <p className="text-sm text-ok">{names[9]}</p>;
  return (
    <form
      className="grid gap-3 md:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await updateStage({ shipmentId, stage: next, raw: raw || undefined, note: note || undefined, occurredAt: new Date(when + ':00+09:00').toISOString(), returned: next === 9 ? (returned ?? 0) : undefined });
          if (!r.ok) return void toast.error(r.error ?? '');
          toast.success(t('updated'));
          setRaw('');
          setNote('');
          router.refresh();
        });
      }}
    >
      <Field label={t('nextStage')} htmlFor="st-next">
        <NativeSelect id="st-next" value={next} onChange={(e) => setNext(Number(e.target.value))}>
          {Array.from({ length: 9 - stage + 1 }, (_, i) => stage + i).filter((n) => n >= 1).map((n) => (
            <option key={n} value={n}>{n}. {names[n]}{n === stage ? (zh ? '（补充记录）' : ' (메모만 더하기)') : ''}</option>
          ))}
        </NativeSelect>
      </Field>
      <Field label={t('when')} htmlFor="st-when"><Input id="st-when" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} /></Field>
      <Field label={t('raw')} htmlFor="st-raw" hint={zh ? '例：已装船、放行' : '예: 본선 적재, 수리 — 쓰시는 말 그대로'}><Input id="st-raw" value={raw} onChange={(e) => setRaw(e.target.value)} maxLength={60} /></Field>
      {next === 9 ? (
        <Field label={t('returned')} htmlFor="st-ret" hint={`0 ~ ${num(units)}`}><NumberField id="st-ret" value={returned} onValueChange={setReturned} unit={zh ? '件' : '개'} min={0} max={units} /></Field>
      ) : (
        <Field label={zh ? '备注' : '메모'} htmlFor="st-note"><Input id="st-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} /></Field>
      )}
      <div className="flex justify-end md:col-span-2"><Button type="submit" variant="primary" disabled={pending}>{t('update')}</Button></div>
    </form>
  );
}

export function ExceptionForm({ shipmentId, zh }: { shipmentId: string; zh: boolean }) {
  const t = useTranslations('p.ship');
  const router = useRouter();
  const [kind, setKind] = React.useState<keyof typeof EXCEPTION_LABEL>('customs_hold');
  const [note, setNote] = React.useState('');
  const [pending, start] = React.useTransition();
  const ZH: Record<string, string> = { customs_hold: '清关暂扣', inspection: '海关查验', fc_rejected: 'FC拒收', ferry_cancelled: '客滚船停航', billing_deviation: '账单偏差' };
  return (
    <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); start(async () => { const r = await openException({ shipmentId, kind: kind as never, note }); if (!r.ok) return void toast.error(r.error ?? ''); toast.success(t('exception')); setNote(''); router.refresh(); }); }}>
      <Field label={t('exception')} htmlFor="ex-kind"><NativeSelect id="ex-kind" value={kind} onChange={(e) => setKind(e.target.value as never)}>{Object.entries(EXCEPTION_LABEL).map(([k, l]) => <option key={k} value={k}>{zh ? ZH[k] : l}</option>)}</NativeSelect></Field>
      <Field label={zh ? '说明' : '무슨 일'} htmlFor="ex-note" className="min-w-0 flex-1"><Input id="ex-note" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      <Button type="submit" variant="danger" disabled={pending}>{t('exception')}</Button>
    </form>
  );
}

export function ResolveButton({ id, shipmentId, zh }: { id: string; shipmentId: string; zh: boolean }) {
  const t = useTranslations('p.ship');
  const router = useRouter();
  const [text, setText] = React.useState('');
  const [pending, start] = React.useTransition();
  return (
    <form className="mt-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); start(async () => { const r = await resolveException(id, shipmentId, text); if (!r.ok) return void toast.error(r.error ?? ''); router.refresh(); }); }}>
      <Input aria-label={zh ? '解决方式' : '해결 내용'} placeholder={zh ? '怎么解决的' : '어떻게 해결했나요'} value={text} onChange={(e) => setText(e.target.value)} className="h-9" />
      <Button type="submit" size="sm" variant="secondary" disabled={pending}>{t('resolve')}</Button>
    </form>
  );
}

export function InvoiceForm({ shipmentId, bid, prev, today, zh }: { shipmentId: string; bid: Record<string, number | null>; prev: Record<string, number | null> | null; today: string; zh: boolean }) {
  const t = useTranslations('p.ship');
  const router = useRouter();
  const names = zh ? SEGMENT_LABEL_ZH : SEGMENT_LABEL_KO;
  const [amounts, setAmounts] = React.useState<Record<string, number | null>>(() => ({ ...(prev ?? bid) }));
  const [issued, setIssued] = React.useState(today);
  const [note, setNote] = React.useState('');
  const [pending, start] = React.useTransition();
  const total = SEGMENTS.reduce((a, s) => a + (amounts[s] ?? 0), 0);
  const bidTotal = SEGMENTS.reduce((a, s) => a + (bid[s] ?? 0), 0);
  const dev = (total - bidTotal) / Math.max(bidTotal, 1);
  return (
    <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); start(async () => { const r = await addInvoice({ shipmentId, amounts: Object.fromEntries(Object.entries(amounts).map(([k, v]) => [k, v == null ? null : Math.round(v)])), issuedOn: issued, note: note || undefined }); if (!r.ok) return void toast.error(r.error ?? ''); toast.success(t('issued')); router.refresh(); }); }}>
      <p className="text-xs text-muted">{t('invoiceHint')}</p>
      <div className="grid gap-2 sm:grid-cols-3">
        {SEGMENTS.map((s, i) => (
          <Field key={s} label={<span><span className="mr-1 inline-block size-2 rounded-[1px]" style={{ background: `var(--seg-${i + 1})` }} />{names[s]}</span>} htmlFor={`iv-${s}`} hint={bid[s] == null ? (zh ? '报价不含' : '응찰 제외') : `${zh ? '报价' : '응찰'} ${num(bid[s])}`}>
            <NumberField id={`iv-${s}`} value={amounts[s] ?? null} onValueChange={(v) => setAmounts((m) => ({ ...m, [s]: v }))} unit="원" />
          </Field>
        ))}
      </div>
      <div className="grid gap-3 sm:grid-cols-[180px_1fr]">
        <Field label={zh ? '开票日' : '발행일'} htmlFor="iv-date"><Input id="iv-date" type="date" value={issued} onChange={(e) => setIssued(e.target.value)} /></Field>
        <Field label={zh ? '备注' : '메모'} htmlFor="iv-note"><Textarea id="iv-note" value={note} onChange={(e) => setNote(e.target.value)} className="min-h-10" /></Field>
      </div>
      <div className="flex flex-wrap items-center justify-end gap-3">
        <span className={`text-sm font-semibold tnum ${Math.abs(dev) >= 0.05 ? 'text-stamp' : 'text-muted'}`}>{won(total)} · {(dev * 100).toFixed(1)}%</span>
        <Button type="submit" variant="primary" disabled={pending}>{prev ? t('invoiceNew') : t('invoice')}</Button>
      </div>
    </form>
  );
}
