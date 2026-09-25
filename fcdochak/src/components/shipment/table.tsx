'use client';
import Link from 'next/link';
import type { ColumnDef } from '@tanstack/react-table';
import { DataTable } from '@/components/data-table';
import { ExceptionChip, StageTrack, Won } from '@/components/badges';
import { EmptyState } from '@/components/ui/core';
import { dateKo } from '@/lib/format';
import { EXCEPTION_LABEL, STAGES } from '@/lib/terms';
import type { ShipmentRow } from '@/lib/server/shipper';

export function ShipmentsTable({ rows, base, party, hubs, empty }: { rows: ShipmentRow[]; base: '/app' | '/partner'; party: 'partner' | 'shipper'; hubs: Record<string, string>; empty?: React.ReactNode }) {
  const cols: ColumnDef<ShipmentRow, unknown>[] = [
    { id: 'no', header: '선적 번호', accessorKey: 'shipment_no', cell: ({ row }) => <Link href={`${base}/shipments/${row.original.id}`} className="font-semibold hover:underline">{row.original.shipment_no}</Link> },
    { id: 'title', header: '화물', accessorKey: 'title', cell: ({ row }) => <span className="block max-w-64 truncate">{row.original.title}</span> },
    { id: 'party', header: party === 'partner' ? '물류사' : '화주', accessorFn: (r) => (party === 'partner' ? r.partner_name : r.shipper_name), cell: ({ getValue }) => <span className="block max-w-40 truncate">{String(getValue() ?? '')}</span> },
    {
      id: 'stage',
      header: '단계',
      accessorKey: 'stage',
      cell: ({ row }) => (
        <span className="flex items-center gap-2">
          <StageTrack stage={row.original.stage} compact />
          <span className="whitespace-nowrap text-xs">{row.original.stage}. {STAGES[row.original.stage]}</span>
        </span>
      ),
    },
    { id: 'exceptions', header: '예외', accessorKey: 'open_exceptions', cell: ({ row }) => <span className="flex gap-1">{(row.original.exception_kinds ?? []).map((k) => <ExceptionChip key={k} kind={k} />)}</span> },
    { id: 'fc', header: 'FC', accessorKey: 'fc_name' },
    { id: 'eta', header: '도착 예정', accessorKey: 'eta_fc', cell: ({ row }) => dateKo(row.original.eta_fc, { dow: false }) },
    { id: 'bid', header: '응찰', accessorKey: 'bid_total', meta: { align: 'right' }, cell: ({ row }) => <Won v={row.original.bid_total} short /> },
    { id: 'invoice', header: '청구', accessorKey: 'invoice_total', meta: { align: 'right' }, cell: ({ row }) => <Won v={row.original.invoice_total} short /> },
    { id: 'created', header: '예약일', accessorKey: 'created_at', cell: ({ row }) => dateKo(row.original.created_at, { dow: false }) },
  ];
  return (
    <DataTable
      data={rows}
      columns={cols}
      getId={(r) => r.id}
      searchText={(r) => `${r.shipment_no} ${r.req_no} ${r.title} ${r.partner_name} ${r.shipper_name ?? ''}`}
      searchPlaceholder="선적·요청 번호, 화물, 업체"
      facets={[
        { id: 'stage', label: '단계', options: [{ value: 'active', label: '진행 중' }, { value: 'done', label: 'FC 입고 완료' }, ...STAGES.slice(1).map((s, i) => ({ value: String(i + 1), label: `${i + 1}. ${s}` }))], get: (r) => [String(r.stage), r.stage < 9 ? 'active' : 'done'] },
        { id: 'exception', label: '예외', options: Object.entries(EXCEPTION_LABEL).map(([value, label]) => ({ value, label })), get: (r) => r.exception_kinds ?? [] },
        { id: 'review', label: '평가', options: [{ value: 'wait', label: '평가 대기' }, { value: 'done', label: '평가 완료' }], get: (r) => (r.stage === 9 ? (r.reviewed ? 'done' : 'wait') : null) },
        { id: 'hub', label: '출발', options: Object.entries(hubs).map(([value, label]) => ({ value, label })), get: (r) => r.origin_hub },
      ]}
      initialHidden={['created', 'fc']}
      csvName="선적"
      csvRow={(r) => ({ 선적번호: r.shipment_no, 요청번호: r.req_no, 화물: r.title, 물류사: r.partner_name, 화주: r.shipper_name, 단계: `${r.stage}. ${STAGES[r.stage]}`, FC: r.fc_name, 도착예정: r.eta_fc, 응찰: r.bid_total, 청구: r.invoice_total, 예약일: r.created_at })}
      onRowHref={(r) => `${base}/shipments/${r.id}`}
      mobileCard={(r) => (
        <Link href={`${base}/shipments/${r.id}`} className="block">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-bold tnum">{r.shipment_no}</span>
            <Won v={r.bid_total} short className="text-sm font-bold" />
          </div>
          <p className="mt-1 truncate text-sm">{r.title}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted">
            <StageTrack stage={r.stage} compact /> {r.stage}. {STAGES[r.stage]}
            {(r.exception_kinds ?? []).map((k) => <ExceptionChip key={k} kind={k} />)}
          </div>
          <p className="mt-1 text-2xs text-muted">{party === 'partner' ? r.partner_name : r.shipper_name} · {r.fc_name} · {dateKo(r.eta_fc, { dow: false })}</p>
        </Link>
      )}
      empty={empty ?? <EmptyState title="아직 선적이 없습니다" body="응찰을 골라 예약으로 전환하면 선적이 생깁니다." />}
    />
  );
}
