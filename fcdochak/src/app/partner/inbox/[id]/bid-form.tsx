'use client';
import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { NineBar, type BarSegment } from '@/components/nine-bar';
import { NumberField } from '@/components/number-field';
import { Button, Field, NativeSelect, Textarea } from '@/components/ui/core';
import { submitBid, withdrawBid } from '@/app/actions/partner';
import { SEGMENTS, SEGMENT_LABEL_KO, SEGMENT_LABEL_ZH } from '@/lib/money/segments';
import { num, won } from '@/lib/format';
import { cn } from '@/lib/cn';

export function BidForm({
  requestId,
  auto,
  mine,
  locale,
  canBid,
}: {
  requestId: string;
  auto: { segments: BarSegment[]; total: number };
  mine: { total: number; status: string; amounts: Record<string, number | null> } | null;
  locale: 'ko' | 'zh';
  canBid: boolean;
}) {
  const t = useTranslations('p');
  const router = useRouter();
  const zh = locale === 'zh';
  const names = zh ? SEGMENT_LABEL_ZH : SEGMENT_LABEL_KO;
  const [adjust, setAdjust] = React.useState(false);
  const [amounts, setAmounts] = React.useState<Record<string, number | null>>(() => Object.fromEntries(auto.segments.map((s) => [s.segment, s.amount])));
  const [days, setDays] = React.useState(7);
  const [note, setNote] = React.useState('');
  const [pending, start] = React.useTransition();
  const total = SEGMENTS.reduce((a, s) => a + (amounts[s] ?? 0), 0);
  const segs: BarSegment[] = adjust ? auto.segments.map((s) => ({ ...s, amount: amounts[s.segment] ?? null })) : auto.segments;

  const send = (kind: 'auto' | 'adjusted') =>
    start(async () => {
      const r = await submitBid({ requestId, kind, amounts: kind === 'adjusted' ? amounts : undefined, validDays: days, note: note || undefined });
      if (!r.ok) return void toast.error(r.error ?? '');
      toast.success(t('inbox.sent'));
      setAdjust(false);
      router.refresh();
    });

  return (
    <div className="grid gap-4">
      <div className="rounded-md border border-line bg-surface p-4">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <p className="text-xs font-semibold text-muted">{adjust ? t('inbox.bidAdj') : t('inbox.auto')}</p>
            <p className="display text-3xl tnum">{won(adjust ? total : auto.total)}</p>
          </div>
          {mine ? (
            <p className="text-sm">
              {t('inbox.mine')}: <b className="tnum">{won(mine.total)}</b> {mine.status === 'withdrawn' ? <span className="text-stamp">({t('inbox.withdraw')})</span> : null}
            </p>
          ) : null}
        </div>
        <div className="mt-3"><NineBar segments={segs} size="md" locale={locale} /></div>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[480px] text-sm tnum">
            <tbody>
              {SEGMENTS.map((s, i) => {
                const a = auto.segments.find((x) => x.segment === s);
                return (
                  <tr key={s} className="border-t border-line-2">
                    <th scope="row" className="py-1.5 pr-2 text-left font-semibold">
                      <span className="mr-1.5 inline-block size-2 rounded-[1px]" style={{ background: `var(--seg-${i + 1})` }} />
                      {names[s]}
                    </th>
                    <td className="py-1.5 text-right text-muted">{a?.amount == null ? '—' : num(a.amount)}</td>
                    <td className="w-44 py-1.5 pl-3">
                      {adjust ? (
                        <NumberField ariaLabel={names[s]} value={amounts[s] ?? null} onValueChange={(x) => setAmounts((m) => ({ ...m, [s]: x }))} inputClassName="h-8" unit="원" />
                      ) : (
                        <span className={cn('block text-right text-2xs', a?.certainty === 'extra_possible' ? 'text-caution' : 'text-muted')}>{a?.certainty ? (zh ? { confirmed: '确定', estimated: '预估', extra_possible: '可能加收' }[a.certainty] : { confirmed: '확정', estimated: '예상', extra_possible: '추가비용 가능' }[a.certainty]) : ''}</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {adjust ? <p className="mt-2 text-2xs text-muted">{t('inbox.segHint')}</p> : null}
        </div>
      </div>
      {canBid ? (
        <div className="grid gap-3 rounded-md border border-line bg-surface p-4 md:grid-cols-[160px_1fr]">
          <Field label={t('inbox.validDays')} htmlFor="b-days">
            <NativeSelect id="b-days" value={days} onChange={(e) => setDays(Number(e.target.value))}>
              {[3, 5, 7, 10, 14].map((d) => <option key={d} value={d}>{d}{t('common.days')}</option>)}
            </NativeSelect>
          </Field>
          <Field label={t('inbox.note')} htmlFor="b-note">
            <Textarea id="b-note" value={note} onChange={(e) => setNote(e.target.value)} className="min-h-10" maxLength={300} />
          </Field>
          <div className="flex flex-wrap justify-end gap-2 md:col-span-2">
            {mine && mine.status === 'submitted' ? (
              <Button variant="danger" disabled={pending} onClick={() => start(async () => { const r = await withdrawBid(requestId); if (!r.ok) toast.error(r.error ?? ''); else { toast(t('inbox.withdraw')); router.refresh(); } })}>{t('inbox.withdraw')}</Button>
            ) : null}
            {adjust ? (
              <>
                <Button variant="ghost" onClick={() => setAdjust(false)}>{t('common.cancel')}</Button>
                <Button variant="primary" disabled={pending} onClick={() => send('adjusted')}>{mine ? t('inbox.revise') : t('inbox.bidAdj')}</Button>
              </>
            ) : (
              <>
                <Button variant="secondary" onClick={() => setAdjust(true)}>{t('inbox.bidAdj')}</Button>
                <Button variant="primary" disabled={pending} onClick={() => send('auto')}>{mine ? t('inbox.revise') : t('inbox.bidAsIs')}</Button>
              </>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
