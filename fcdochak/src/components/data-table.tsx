'use client';
/**
 * 표 — 정렬·필터·열 켜고 끄기·고정 머리·쪽 넘김·선택 후 일괄 작업·CSV 내보내기.
 * 필터·정렬·쪽은 URL 에 실려 링크로 공유된다. 모바일(<768)에서는 카드 목록으로 바뀐다.
 */
import * as React from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type RowSelectionState,
  type SortingState,
  type VisibilityState,
} from '@tanstack/react-table';
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Columns3, Download, Search, X } from 'lucide-react';
import { Button, EmptyState, Input, NativeSelect } from '@/components/ui/core';
import { Checkbox, Menu, MenuCheckbox, MenuContent, MenuLabel, MenuTrigger } from '@/components/ui/radix';
import { cn } from '@/lib/cn';
import { ACTION } from '@/lib/terms';

export interface Facet<T> {
  id: string;
  label: string;
  options: { value: string; label: string }[];
  get: (row: T) => string | string[] | null | undefined;
}

export interface DataTableProps<T> {
  data: T[];
  columns: ColumnDef<T, unknown>[];
  getId: (row: T) => string;
  /** URL 키 앞머리(한 화면에 표가 둘일 때) */
  urlKey?: string;
  searchPlaceholder?: string;
  searchText?: (row: T) => string;
  facets?: Facet<T>[];
  csvName?: string;
  csvRow?: (row: T) => Record<string, string | number | null>;
  bulk?: (rows: T[], clear: () => void) => React.ReactNode;
  mobileCard?: (row: T) => React.ReactNode;
  onRowHref?: (row: T) => string | null;
  empty?: React.ReactNode;
  pageSize?: number;
  initialHidden?: string[];
  dense?: boolean;
  toolbarExtra?: React.ReactNode;
  caption?: string;
}

function toCsv(rows: Record<string, string | number | null>[]) {
  if (rows.length === 0) return '';
  const heads = Object.keys(rows[0]);
  const esc = (v: unknown) => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return '﻿' + [heads.join(','), ...rows.map((r) => heads.map((h) => esc(r[h])).join(','))].join('\r\n');
}

export function DataTable<T>({
  data,
  columns,
  getId,
  urlKey = '',
  searchPlaceholder = '검색',
  searchText,
  facets = [],
  csvName,
  csvRow,
  bulk,
  mobileCard,
  onRowHref,
  empty,
  pageSize = 25,
  initialHidden = [],
  dense,
  toolbarExtra,
  caption,
}: DataTableProps<T>) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const k = (s: string) => (urlKey ? `${urlKey}.${s}` : s);

  const sortParam = sp.get(k('sort'));
  const [sorting, setSorting] = React.useState<SortingState>(() =>
    sortParam ? [{ id: sortParam.replace(/^-/, ''), desc: sortParam.startsWith('-') }] : [],
  );
  const [q, setQ] = React.useState(sp.get(k('q')) ?? '');
  const [facetVals, setFacetVals] = React.useState<Record<string, string>>(() =>
    Object.fromEntries(facets.map((f) => [f.id, sp.get(k(f.id)) ?? ''])),
  );
  const [page, setPage] = React.useState(Math.max(0, Number(sp.get(k('page')) ?? '1') - 1));
  const [visibility, setVisibility] = React.useState<VisibilityState>(() => {
    const hide = sp.get(k('hide'));
    const list = hide != null ? hide.split(',').filter(Boolean) : initialHidden;
    return Object.fromEntries(list.map((c) => [c, false]));
  });
  const [selection, setSelection] = React.useState<RowSelectionState>({});

  // URL 에 싣기 — 기록을 쌓지 않고 바꾼다
  const firstSync = React.useRef(true);
  React.useEffect(() => {
    if (firstSync.current) {
      firstSync.current = false;
      return;
    }
    const p = new URLSearchParams(sp.toString());
    const put = (key: string, v: string | null) => (v ? p.set(k(key), v) : p.delete(k(key)));
    put('sort', sorting[0] ? `${sorting[0].desc ? '-' : ''}${sorting[0].id}` : null);
    put('q', q || null);
    for (const f of facets) put(f.id, facetVals[f.id] || null);
    put('page', page > 0 ? String(page + 1) : null);
    const hidden = Object.entries(visibility).filter(([, v]) => v === false).map(([c]) => c);
    put('hide', hidden.join(',') === initialHidden.join(',') ? null : hidden.join(',') || '-');
    const next = p.toString();
    if (next !== sp.toString()) router.replace(`${pathname}${next ? `?${next}` : ''}`, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sorting, q, facetVals, page, visibility]);

  const filtered = React.useMemo(() => {
    const needle = q.trim().toLowerCase();
    return data.filter((row) => {
      if (needle && searchText && !searchText(row).toLowerCase().includes(needle)) return false;
      for (const f of facets) {
        const want = facetVals[f.id];
        if (!want) continue;
        const v = f.get(row);
        if (Array.isArray(v) ? !v.includes(want) : v !== want) return false;
      }
      return true;
    });
  }, [data, q, facetVals, facets, searchText]);

  const allColumns = React.useMemo<ColumnDef<T, unknown>[]>(
    () =>
      bulk
        ? [
            {
              id: '_select',
              enableSorting: false,
              enableHiding: false,
              header: ({ table }) => (
                <Checkbox
                  aria-label="이 쪽 모두 선택"
                  checked={table.getIsAllPageRowsSelected() ? true : table.getIsSomePageRowsSelected() ? 'indeterminate' : false}
                  onCheckedChange={(v) => table.toggleAllPageRowsSelected(!!v)}
                />
              ),
              cell: ({ row }) => (
                <Checkbox aria-label="선택" checked={row.getIsSelected()} onCheckedChange={(v) => row.toggleSelected(!!v)} onClick={(e) => e.stopPropagation()} />
              ),
              size: 36,
            },
            ...columns,
          ]
        : columns,
    [bulk, columns],
  );

  const table = useReactTable({
    data: filtered,
    columns: allColumns,
    getRowId: (r) => getId(r),
    state: { sorting, columnVisibility: visibility, rowSelection: selection, pagination: { pageIndex: page, pageSize } },
    onSortingChange: (u) => {
      setSorting(u);
      setPage(0);
    },
    onColumnVisibilityChange: setVisibility,
    onRowSelectionChange: setSelection,
    onPaginationChange: (u) => {
      const next = typeof u === 'function' ? u({ pageIndex: page, pageSize }) : u;
      setPage(next.pageIndex);
    },
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    enableRowSelection: !!bulk,
  });

  const selectedRows = table.getSelectedRowModel().rows.map((r) => r.original);
  const pageRows = table.getRowModel().rows;
  const pageCount = table.getPageCount();
  const active = q || Object.values(facetVals).some(Boolean);

  const exportCsv = () => {
    if (!csvRow) return;
    const rows = table.getSortedRowModel().rows.map((r) => csvRow(r.original));
    const blob = new Blob([toCsv(rows)], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${csvName ?? 'export'}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="min-w-0">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {searchText ? (
          <div className="relative min-w-0 flex-1 sm:max-w-72">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
            <Input
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setPage(0);
              }}
              placeholder={searchPlaceholder}
              aria-label={searchPlaceholder}
              className="h-9 pl-9"
            />
          </div>
        ) : null}
        {facets.map((f) => (
          <NativeSelect
            key={f.id}
            aria-label={f.label}
            value={facetVals[f.id]}
            onChange={(e) => {
              setFacetVals((s) => ({ ...s, [f.id]: e.target.value }));
              setPage(0);
            }}
            className="h-9 w-auto min-w-28 text-sm"
          >
            <option value="">{f.label}: 전체</option>
            {f.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </NativeSelect>
        ))}
        {active ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setQ('');
              setFacetVals(Object.fromEntries(facets.map((f) => [f.id, ''])));
              setPage(0);
            }}
          >
            <X aria-hidden /> 필터 지우기
          </Button>
        ) : null}
        <div className="flex-1" />
        {toolbarExtra}
        <Menu>
          <MenuTrigger asChild>
            <Button size="sm" variant="secondary" className="hidden md:inline-flex">
              <Columns3 aria-hidden /> 열
            </Button>
          </MenuTrigger>
          <MenuContent>
            <MenuLabel>보이는 열</MenuLabel>
            {table
              .getAllLeafColumns()
              .filter((c) => c.getCanHide())
              .map((c) => (
                <MenuCheckbox key={c.id} checked={c.getIsVisible()} onCheckedChange={(v) => c.toggleVisibility(!!v)} onSelect={(e) => e.preventDefault()}>
                  {typeof c.columnDef.header === 'string' ? c.columnDef.header : c.id}
                </MenuCheckbox>
              ))}
          </MenuContent>
        </Menu>
        {csvRow ? (
          <Button size="sm" variant="secondary" onClick={exportCsv}>
            <Download aria-hidden /> {ACTION.exportCsv}
          </Button>
        ) : null}
      </div>

      {bulk && selectedRows.length > 0 ? (
        <div className="sticky top-16 z-20 mb-2 flex flex-wrap items-center gap-2 rounded-sm border border-ink bg-ink px-3 py-2 text-sm text-on-ink">
          <b className="tnum">{selectedRows.length}건 선택</b>
          <span className="flex-1" />
          {bulk(selectedRows, () => setSelection({}))}
          <Button size="sm" variant="onInk" onClick={() => setSelection({})}>
            선택 풀기
          </Button>
        </div>
      ) : null}

      <p className="mb-2 text-xs text-muted" aria-live="polite">
        {filtered.length === data.length ? `${data.length.toLocaleString('ko-KR')}건` : `${data.length.toLocaleString('ko-KR')}건 중 ${filtered.length.toLocaleString('ko-KR')}건`}
      </p>

      {filtered.length === 0 ? (
        <div className="rounded-md border border-line bg-surface">
          {active ? (
            <EmptyState title="조건에 맞는 것이 없습니다" body="필터를 하나씩 풀어 보세요." />
          ) : (
            empty ?? <EmptyState title="아직 없습니다" />
          )}
        </div>
      ) : (
        <>
          {mobileCard ? (
            <ul className="flex flex-col gap-2 md:hidden">
              {pageRows.map((r) => (
                <li key={r.id} className={cn('rounded-md border bg-surface', r.getIsSelected() ? 'border-ink' : 'border-line')}>
                  {bulk ? (
                    <div className="flex items-start gap-3 p-3">
                      <Checkbox aria-label="선택" checked={r.getIsSelected()} onCheckedChange={(v) => r.toggleSelected(!!v)} className="mt-0.5" />
                      <div className="min-w-0 flex-1">{mobileCard(r.original)}</div>
                    </div>
                  ) : (
                    <div className="p-3">{mobileCard(r.original)}</div>
                  )}
                </li>
              ))}
            </ul>
          ) : null}
          <div className={cn('relative max-h-[70vh] overflow-auto rounded-md border border-line bg-surface', mobileCard && 'hidden md:block')}>
            <table className={cn('w-full border-separate border-spacing-0 text-sm tnum', dense && 'text-xs')}>
              {caption ? <caption className="sr-only">{caption}</caption> : null}
              <thead className="sticky top-0 z-10">
                {table.getHeaderGroups().map((hg) => (
                  <tr key={hg.id}>
                    {hg.headers.map((h) => {
                      const sorted = h.column.getIsSorted();
                      const can = h.column.getCanSort();
                      const align = (h.column.columnDef.meta as { align?: string } | undefined)?.align;
                      return (
                        <th
                          key={h.id}
                          scope="col"
                          aria-sort={sorted === 'asc' ? 'ascending' : sorted === 'desc' ? 'descending' : undefined}
                          className={cn(
                            'whitespace-nowrap border-b border-line bg-surface-2 px-3 py-2 text-left text-xs font-semibold text-muted',
                            align === 'right' && 'text-right',
                          )}
                          style={{ width: h.getSize() !== 150 ? h.getSize() : undefined }}
                        >
                          {h.isPlaceholder ? null : can ? (
                            <button
                              type="button"
                              onClick={h.column.getToggleSortingHandler()}
                              className={cn('inline-flex items-center gap-1 hover:text-text', align === 'right' && 'flex-row-reverse')}
                            >
                              {flexRender(h.column.columnDef.header, h.getContext())}
                              {sorted === 'asc' ? <ArrowUp className="size-3" /> : sorted === 'desc' ? <ArrowDown className="size-3" /> : <span className="size-3" />}
                            </button>
                          ) : (
                            flexRender(h.column.columnDef.header, h.getContext())
                          )}
                        </th>
                      );
                    })}
                  </tr>
                ))}
              </thead>
              <tbody>
                {pageRows.map((r) => {
                  const href = onRowHref?.(r.original) ?? null;
                  return (
                    <tr
                      key={r.id}
                      className={cn('group', href && 'cursor-pointer', r.getIsSelected() ? 'bg-label/10' : 'hover:bg-surface-2')}
                      onClick={
                        href
                          ? (e) => {
                              if ((e.target as HTMLElement).closest('a,button,input,[role=checkbox]')) return;
                              router.push(href);
                            }
                          : undefined
                      }
                    >
                      {r.getVisibleCells().map((c) => {
                        const align = (c.column.columnDef.meta as { align?: string } | undefined)?.align;
                        return (
                          <td
                            key={c.id}
                            className={cn('border-b border-line-2 px-3 align-middle', dense ? 'py-1.5' : 'py-2.5', align === 'right' && 'text-right')}
                          >
                            {flexRender(c.column.columnDef.cell, c.getContext())}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {pageCount > 1 ? (
            <nav className="mt-3 flex items-center justify-end gap-2 text-sm" aria-label="쪽 넘김">
              <span className="text-muted tnum">
                {page + 1} / {pageCount}쪽
              </span>
              <Button size="iconSm" variant="secondary" onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()} aria-label="앞 쪽">
                <ChevronLeft />
              </Button>
              <Button size="iconSm" variant="secondary" onClick={() => table.nextPage()} disabled={!table.getCanNextPage()} aria-label="다음 쪽">
                <ChevronRight />
              </Button>
            </nav>
          ) : null}
        </>
      )}
    </div>
  );
}
