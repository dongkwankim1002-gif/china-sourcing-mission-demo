'use client';
import Link from 'next/link';
import type { ColumnDef } from '@tanstack/react-table';
import { DataTable } from '@/components/data-table';
import { Deadline, RequestStatusChip, Won } from '@/components/badges';
import { Button, EmptyState } from '@/components/ui/core';
import { dateKo, num } from '@/lib/format';
import { ACTION, REQUEST_STATUS } from '@/lib/terms';
import type { RequestRow } from '@/lib/server/shipper';

export function RequestsTable({ rows, hubs }: { rows: RequestRow[]; hubs: Record<string, string> }) {
  const cols: ColumnDef<RequestRow, unknown>[] = [
    { id: 'req_no', header: '번호', accessorKey: 'req_no', cell: ({ row }) => <Link href={`/app/requests/${row.original.id}`} className="font-semibold hover:underline">{row.original.req_no}</Link> },
    { id: 'title', header: '화물', accessorKey: 'title', cell: ({ row }) => <span className="block max-w-72 truncate">{row.original.title}</span> },
    { id: 'lane', header: '구간', accessorFn: (r) => `${hubs[r.origin_hub]}→${r.port}`, cell: ({ row }) => `${hubs[row.original.origin_hub] ?? row.original.origin_hub} → ${row.original.port === 'ICN' ? '인천' : '평택'}` },
    { id: 'status', header: '상태', accessorKey: 'display_status', cell: ({ row }) => <RequestStatusChip status={row.original.display_status} /> },
    { id: 'bids', header: '응찰', accessorKey: 'bid_count', meta: { align: 'right' }, cell: ({ row }) => `${row.original.bid_count}건` },
    { id: 'min', header: '최저 응찰', accessorKey: 'min_total', meta: { align: 'right' }, cell: ({ row }) => <Won v={row.original.min_total} short /> },
    { id: 'cbm', header: 'CBM', accessorKey: 'cbm', meta: { align: 'right' }, cell: ({ row }) => num(row.original.cbm, 2) },
    { id: 'deadline', header: '마감', accessorKey: 'bid_deadline', cell: ({ row }) => <Deadline at={row.original.bid_deadline} /> },
    { id: 'created', header: '올린 날', accessorKey: 'created_at', cell: ({ row }) => dateKo(row.original.created_at, { dow: false }) },
  ];
  return (
    <DataTable
      data={rows}
      columns={cols}
      getId={(r) => r.id}
      searchText={(r) => `${r.req_no} ${r.title}`}
      searchPlaceholder="번호·화물 이름"
      facets={[
        { id: 'status', label: '상태', options: Object.entries(REQUEST_STATUS).map(([value, s]) => ({ value, label: s.label })), get: (r) => r.display_status },
        { id: 'hub', label: '출발', options: Object.entries(hubs).map(([value, label]) => ({ value, label })), get: (r) => r.origin_hub },
      ]}
      initialHidden={['cbm']}
      csvName="견적요청"
      csvRow={(r) => ({ 번호: r.req_no, 화물: r.title, 출발: hubs[r.origin_hub] ?? r.origin_hub, 도착항: r.port, 상태: REQUEST_STATUS[r.display_status]?.label ?? r.display_status, 응찰: r.bid_count, 최저응찰: r.min_total, CBM: r.cbm, 마감: r.bid_deadline, 올린날: r.created_at })}
      onRowHref={(r) => `/app/requests/${r.id}`}
      mobileCard={(r) => (
        <Link href={`/app/requests/${r.id}`} className="block">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-bold tnum">{r.req_no}</span>
            <RequestStatusChip status={r.display_status} />
          </div>
          <p className="mt-1 truncate text-sm">{r.title}</p>
          <div className="mt-2 flex items-center justify-between text-xs text-muted">
            <span>응찰 {r.bid_count}건{r.min_total ? ` · 최저 ${Math.round(r.min_total / 10000).toLocaleString('ko-KR')}만 원` : ''}</span>
            <Deadline at={r.bid_deadline} />
          </div>
        </Link>
      )}
      empty={<EmptyState title="아직 올린 견적 요청이 없습니다" body="화물 조건을 넣고 올리면 이 구간을 맡는 업체들이 9구간으로 응찰합니다." action={<Button asChild variant="primary"><Link href="/app/requests/new">{ACTION.newRequest}</Link></Button>} />}
    />
  );
}
