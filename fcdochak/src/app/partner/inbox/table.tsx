'use client';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { ColumnDef } from '@tanstack/react-table';
import { DataTable } from '@/components/data-table';
import { Deadline, RequestStatusChip, Won } from '@/components/badges';
import { Chip } from '@/components/ui/core';
import { num } from '@/lib/format';

export interface InboxRow {
  id: string;
  req_no: string;
  lane: string;
  hub: string;
  cargo: string;
  traits: string;
  display_status: string;
  bid_deadline: string;
  auto_total: number | null;
  my_bid_total: number | null;
  my_state: 'none' | 'bid' | 'won' | 'lost' | 'closed';
  blocked: string | null;
  cbm: number;
}

export function InboxTable({ rows, hubs }: { rows: InboxRow[]; hubs: { value: string; label: string }[] }) {
  const t = useTranslations('p.inbox');
  const state = (r: InboxRow) => (r.blocked ? <Chip tone="stamp" title={r.blocked}>{t('blocked')}</Chip> : <Chip tone={r.my_state === 'won' ? 'ok' : r.my_state === 'bid' ? 'info' : r.my_state === 'lost' ? 'neutral' : 'label'}>{t(`status.${r.my_state}`)}</Chip>);
  const cols: ColumnDef<InboxRow, unknown>[] = [
    { id: 'req_no', header: '#', accessorKey: 'req_no', cell: ({ row }) => <Link href={`/partner/inbox/${row.original.id}`} className="font-semibold hover:underline">{row.original.req_no}</Link> },
    { id: 'lane', header: t('lane'), accessorKey: 'lane' },
    { id: 'cargo', header: t('cargo'), accessorKey: 'cargo', cell: ({ row }) => <span className="block max-w-64 truncate">{row.original.cargo}</span> },
    { id: 'traits', header: '⚑', accessorKey: 'traits' },
    { id: 'cbm', header: 'CBM', accessorKey: 'cbm', meta: { align: 'right' }, cell: ({ row }) => num(row.original.cbm, 2) },
    { id: 'auto', header: t('auto'), accessorKey: 'auto_total', meta: { align: 'right' }, cell: ({ row }) => (row.original.auto_total ? <Won v={row.original.auto_total} short className="font-semibold" /> : <span className="text-xs text-muted">{t('noCard')}</span>) },
    { id: 'mine', header: t('mine'), accessorKey: 'my_bid_total', meta: { align: 'right' }, cell: ({ row }) => <Won v={row.original.my_bid_total} short /> },
    { id: 'state', header: '', accessorKey: 'my_state', cell: ({ row }) => state(row.original) },
    { id: 'deadline', header: t('deadline'), accessorKey: 'bid_deadline', cell: ({ row }) => <Deadline at={row.original.bid_deadline} /> },
  ];
  return (
    <DataTable
      data={rows}
      columns={cols}
      getId={(r) => r.id}
      searchText={(r) => `${r.req_no} ${r.lane} ${r.cargo}`}
      searchPlaceholder="RQ-…"
      facets={[
        { id: 'hub', label: t('lane'), options: hubs, get: (r) => r.hub },
        { id: 'mine', label: t('mine'), options: (['none', 'bid', 'won', 'lost', 'closed'] as const).map((k) => ({ value: k, label: t(`status.${k}`) })), get: (r) => r.my_state },
        { id: 'status', label: '⏱', options: [{ value: 'closing_soon', label: '24h' }], get: (r) => r.display_status },
      ]}
      csvName="inbox"
      csvRow={(r) => ({ no: r.req_no, lane: r.lane, cargo: r.cargo, auto: r.auto_total, mine: r.my_bid_total, deadline: r.bid_deadline })}
      onRowHref={(r) => `/partner/inbox/${r.id}`}
      mobileCard={(r) => (
        <Link href={`/partner/inbox/${r.id}`} className="block">
          <div className="flex items-center justify-between gap-2"><b className="tnum">{r.req_no}</b>{state(r)}</div>
          <p className="mt-1 text-sm">{r.lane}</p>
          <p className="truncate text-xs text-muted">{r.cargo}</p>
          <div className="mt-2 flex items-center justify-between"><Won v={r.auto_total} short className="text-sm font-bold" /><Deadline at={r.bid_deadline} /></div>
          <span className="hidden"><RequestStatusChip status={r.display_status} /></span>
        </Link>
      )}
    />
  );
}
