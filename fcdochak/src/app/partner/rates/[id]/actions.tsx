'use client';
import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Button, Input } from '@/components/ui/core';
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/radix';
import { reviseCards } from '@/app/actions/partner';

export function CardActions({ id, today, validTo, current }: { id: string; today: string; validTo: string; current: boolean }) {
  const t = useTranslations('p.rates');
  const router = useRouter();
  const [to, setTo] = React.useState(() => new Date(Math.max(Date.parse(validTo), Date.parse(today)) + 45 * 86400_000).toISOString().slice(0, 10));
  const [pending, start] = React.useTransition();
  if (!current) return null;
  const run = (change: Parameters<typeof reviseCards>[1]) =>
    start(async () => {
      const r = await reviseCards([id], change);
      if (!r.ok) return void toast.error(r.error ?? '');
      toast.success(t('saved'));
      router.push('/partner/rates');
      router.refresh();
    });
  return (
    <div className="flex flex-wrap gap-2">
      <Dialog>
        <DialogTrigger asChild><Button variant="primary">{t('extend')}</Button></DialogTrigger>
        <DialogContent title={t('extend')} description={t('sub')}>
          <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); run({ kind: 'extend', validTo: to }); }}>
            <label htmlFor="cx-to" className="grid gap-1.5 text-sm font-semibold">{t('extendTo')}<Input id="cx-to" type="date" min={today} value={to} onChange={(e) => setTo(e.target.value)} /></label>
            <Button type="submit" variant="primary" disabled={pending}>{t('extend')}</Button>
          </form>
        </DialogContent>
      </Dialog>
      <Button variant="secondary" disabled={pending} onClick={() => run({ kind: 'expire' })}>{t('expire')}</Button>
      <Button variant="danger" disabled={pending} onClick={() => run({ kind: 'withdraw' })}>{t('withdraw')}</Button>
    </div>
  );
}
