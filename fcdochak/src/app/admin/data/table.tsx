'use client';
import Link from 'next/link';
import type { ColumnDef } from '@tanstack/react-table';
import { DataTable } from '@/components/data-table';
import { DemoChip, PartnerStatusChip, RelatedChip } from '@/components/badges';
import { Chip } from '@/components/ui/core';
import { dateKo } from '@/lib/format';
import { BIZ_TYPE_LABEL } from '@/lib/terms';

export interface OrgRow {
  id: string;
  name: string;
  kind: string;
  status: string;
  business_type: string | null;
  slug: string | null;
  is_demo: boolean;
  related_party_note: string | null;
  members: number;
  cards: number;
  requests: number;
  shipments: number;
  created_at: string;
}

const KIND: Record<string, string> = { shipper: '화주', partner: '물류사', platform: '운영' };

export function OrgTable({ rows }: { rows: OrgRow[] }) {
  const cols: ColumnDef<OrgRow, unknown>[] = [
    { id: 'name', header: '조직', accessorKey: 'name', cell: ({ row }) => <span className="flex items-center gap-1.5 font-semibold">{row.original.kind === 'partner' && row.original.slug ? <Link href={`/p/${row.original.slug}`} className="hover:underline">{row.original.name}</Link> : row.original.name}{row.original.is_demo ? <DemoChip /> : null}</span> },
    { id: 'kind', header: '종류', accessorKey: 'kind', cell: ({ row }) => KIND[row.original.kind] },
    { id: 'status', header: '상태', accessorKey: 'status', cell: ({ row }) => (row.original.kind === 'partner' ? <PartnerStatusChip status={row.original.status} /> : <Chip>{row.original.status}</Chip>) },
    { id: 'type', header: '업종', accessorKey: 'business_type', cell: ({ row }) => BIZ_TYPE_LABEL[row.original.business_type ?? ''] ?? '' },
    { id: 'rel', header: '특수관계', accessorKey: 'related_party_note', cell: ({ row }) => (row.original.related_party_note ? <RelatedChip note={row.original.related_party_note} /> : null) },
    { id: 'members', header: '사람', accessorKey: 'members', meta: { align: 'right' } },
    { id: 'cards', header: '요금표', accessorKey: 'cards', meta: { align: 'right' } },
    { id: 'requests', header: '요청', accessorKey: 'requests', meta: { align: 'right' } },
    { id: 'shipments', header: '선적', accessorKey: 'shipments', meta: { align: 'right' } },
    { id: 'created', header: '가입', accessorKey: 'created_at', cell: ({ row }) => dateKo(row.original.created_at, { dow: false }) },
  ];
  return (
    <DataTable
      data={rows}
      columns={cols}
      getId={(r) => r.id}
      searchText={(r) => `${r.name} ${r.slug}`}
      searchPlaceholder="조직 이름"
      facets={[
        { id: 'kind', label: '종류', options: Object.entries(KIND).map(([value, label]) => ({ value, label })), get: (r) => r.kind },
        { id: 'status', label: '상태', options: ['active', 'public_info', 'pending_verification', 'official', 'deletion_requested', 'deleted'].map((v) => ({ value: v, label: v })), get: (r) => r.status },
        { id: 'demo', label: '예시', options: [{ value: 'demo', label: '예시' }, { value: 'real', label: '실제' }], get: (r) => (r.is_demo ? 'demo' : 'real') },
      ]}
      csvName="orgs"
      csvRow={(r) => ({ 조직: r.name, 종류: KIND[r.kind], 상태: r.status, 업종: r.business_type, 예시: r.is_demo ? 'Y' : '', 사람: r.members, 요금표: r.cards, 요청: r.requests, 선적: r.shipments })}
      mobileCard={(r) => (
        <div>
          <div className="flex items-center justify-between gap-2"><b className="truncate">{r.name}</b>{r.is_demo ? <DemoChip /> : null}</div>
          <p className="text-xs text-muted">{KIND[r.kind]} · {r.status} · 요금표 {r.cards} · 선적 {r.shipments}</p>
        </div>
      )}
    />
  );
}
