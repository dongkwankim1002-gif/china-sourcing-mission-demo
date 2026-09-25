'use client';
import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import type { ColumnDef } from '@tanstack/react-table';
import { toast } from 'sonner';
import { CalendarPlus, CalendarX, Plus, Upload } from 'lucide-react';
import { DataTable } from '@/components/data-table';
import { Button, Chip, EmptyState, Input } from '@/components/ui/core';
import { Dialog, DialogContent } from '@/components/ui/radix';
import { reviseCards } from '@/app/actions/partner';
import { dateKo } from '@/lib/format';

export interface CardListRow {
  id: string;
  card_no: string;
  version: number;
  lane: string;
  mode: string;
  valid_from: string;
  valid_to: string;
  state: 'valid' | 'soon' | 'expired' | 'withdrawn';
  is_public_price: boolean;
  certainty: string;
  included: number;
  created_at: string;
}

export function RatesTable({ rows, today }: { rows: CardListRow[]; today: string }) {
  const t = useTranslations('p.rates');
  const router = useRouter();
  const [extend, setExtend] = React.useState<{ ids: string[]; clear: () => void } | null>(null);
  const [to, setTo] = React.useState(() => new Date(Date.parse(today) + 60 * 86400_000).toISOString().slice(0, 10));
  const [pending, start] = React.useTransition();
  const tone = { valid: 'ok', soon: 'caution', expired: 'stamp', withdrawn: 'neutral' } as const;
  const cols: ColumnDef<CardListRow, unknown>[] = [
    { id: 'card', header: '#', accessorKey: 'card_no', cell: ({ row }) => <Link href={`/partner/rates/${row.original.id}`} className="font-semibold hover:underline">{row.original.card_no} <span className="text-2xs text-muted">v{row.original.version}</span></Link> },
    { id: 'lane', header: '⇄', accessorKey: 'lane' },
    { id: 'state', header: '●', accessorKey: 'state', cell: ({ row }) => <Chip tone={tone[row.original.state]}>{t(row.original.state === 'valid' ? 'valid' : row.original.state === 'soon' ? 'soon' : row.original.state === 'expired' ? 'expired' : 'withdrawn')}</Chip> },
    { id: 'valid', header: '📅', accessorKey: 'valid_to', cell: ({ row }) => <span className="tnum text-xs">{dateKo(row.original.valid_from, { dow: false })} ~ {dateKo(row.original.valid_to, { dow: false })}</span> },
    { id: 'incl', header: '9', accessorKey: 'included', meta: { align: 'right' }, cell: ({ row }) => `${row.original.included}/9` },
    { id: 'pub', header: t('public'), accessorKey: 'is_public_price', cell: ({ row }) => (row.original.is_public_price ? <Chip tone="info">{t('public')}</Chip> : null) },
  ];
  const act = (ids: string[], kind: 'expire' | 'withdraw', clear: () => void) =>
    start(async () => {
      const r = await reviseCards(ids, { kind });
      clear();
      if (!r.ok) return void toast.error(r.error ?? '');
      toast.success(`${r.data?.n ?? 0} — ${kind === 'expire' ? t('expire') : t('withdraw')}`);
      router.refresh();
    });
  return (
    <>
      <DataTable
        data={rows}
        columns={cols}
        getId={(r) => r.id}
        searchText={(r) => `${r.card_no} ${r.lane}`}
        facets={[{ id: 'state', label: '●', options: (['valid', 'soon', 'expired', 'withdrawn'] as const).map((k) => ({ value: k, label: t(k) })), get: (r) => r.state }]}
        toolbarExtra={
          <>
            <Button asChild size="sm" variant="secondary"><Link href="/partner/rates/upload"><Upload aria-hidden /> {t('upload')}</Link></Button>
            <Button asChild size="sm" variant="primary"><Link href="/partner/rates/new"><Plus aria-hidden /> {t('add')}</Link></Button>
          </>
        }
        bulk={(sel, clear) => (
          <>
            <Button size="sm" variant="primary" onClick={() => setExtend({ ids: sel.map((s) => s.id), clear })}><CalendarPlus aria-hidden /> {t('extend')}</Button>
            <Button size="sm" variant="onInk" disabled={pending} onClick={() => act(sel.map((s) => s.id), 'expire', clear)}><CalendarX aria-hidden /> {t('expire')}</Button>
          </>
        )}
        csvName="rate-cards"
        csvRow={(r) => ({ card: r.card_no, version: r.version, lane: r.lane, from: r.valid_from, to: r.valid_to, state: r.state, included: r.included })}
        onRowHref={(r) => `/partner/rates/${r.id}`}
        mobileCard={(r) => (
          <Link href={`/partner/rates/${r.id}`} className="block">
            <div className="flex items-center justify-between"><b className="tnum">{r.card_no} v{r.version}</b><Chip tone={tone[r.state]}>{t(r.state)}</Chip></div>
            <p className="mt-1 text-sm">{r.lane}</p>
            <p className="text-xs text-muted tnum">{r.valid_from} ~ {r.valid_to} · {r.included}/9</p>
          </Link>
        )}
        empty={<EmptyState title={t('title')} body={t('sub')} action={<Button asChild variant="primary"><Link href="/partner/rates/new">{t('add')}</Link></Button>} />}
      />
      <Dialog open={!!extend} onOpenChange={(o) => !o && setExtend(null)}>
        <DialogContent title={t('extend')} description={t('sub')}>
          <form
            className="grid gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (!extend) return;
              start(async () => {
                const r = await reviseCards(extend.ids, { kind: 'extend', validTo: to });
                extend.clear();
                setExtend(null);
                if (!r.ok) return void toast.error(r.error ?? '');
                toast.success(`${r.data?.n} — ${t('extend')}`);
                router.refresh();
              });
            }}
          >
            <label className="grid gap-1.5 text-sm font-semibold" htmlFor="ext-to">{t('extendTo')}<Input id="ext-to" type="date" min={today} value={to} onChange={(e) => setTo(e.target.value)} /></label>
            <Button type="submit" variant="primary" disabled={pending}>{t('extend')} ({extend?.ids.length})</Button>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
