'use client';
import * as React from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import type { ColumnDef } from '@tanstack/react-table';
import { toast } from 'sonner';
import { Archive, Pencil, Plus, Scale, Upload } from 'lucide-react';
import { DataTable } from '@/components/data-table';
import { ExcelImport, type ParsedRow } from '@/components/excel-import';
import { NumberField } from '@/components/number-field';
import { Button, Chip, EmptyState, Field, Input, NativeSelect } from '@/components/ui/core';
import { Dialog, DialogContent } from '@/components/ui/radix';
import { importSkus, saveSku, setSkuArchived, type SkuInputT } from '@/app/actions/shipper';
import type { SkuRow } from '@/lib/server/shipper';
import { cn } from '@/lib/cn';
import { num } from '@/lib/format';
import { ACTION } from '@/lib/terms';

const blank: SkuInputT = { name: '', units: 1000, cartons: 30, kg: 300, cbm: 2, goods: 10000, cur: 'RMB', traits: [], hsCategory: 'general', targetPrice: null };

export function SkusClient({ rows, traits, duty }: { rows: SkuRow[]; traits: { code: string; name_ko: string }[]; duty: { category: string; name_ko: string }[] }) {
  const router = useRouter();
  const sp = useSearchParams();
  const [edit, setEdit] = React.useState<SkuInputT | null>(sp.get('new') ? blank : null);
  const [importing, setImporting] = React.useState(false);
  const [hidden, setHidden] = React.useState<Set<string>>(new Set());
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [pending, start] = React.useTransition();
  const traitName = (c: string) => traits.find((t) => t.code === c)?.name_ko ?? c;
  const visible = rows.filter((r) => !hidden.has(r.id) && !r.archived);

  const archive = (ids: string[], clear?: () => void) => {
    setHidden((h) => new Set([...h, ...ids])); // 낙관적 갱신
    clear?.();
    start(async () => {
      await setSkuArchived(ids, true);
      toast(`${ids.length}개를 보관했습니다`, {
        action: {
          label: ACTION.undo,
          onClick: async () => {
            setHidden((h) => new Set([...h].filter((x) => !ids.includes(x))));
            await setSkuArchived(ids, false);
            router.refresh();
          },
        },
      });
      router.refresh();
    });
  };

  const cols: ColumnDef<SkuRow, unknown>[] = [
    { id: 'name', header: '상품', accessorKey: 'name', cell: ({ row }) => <span className="font-semibold">{row.original.name}</span> },
    { id: 'units', header: '수량', accessorKey: 'units', meta: { align: 'right' }, cell: ({ row }) => `${num(row.original.units)}개` },
    { id: 'cartons', header: '박스', accessorKey: 'cartons', meta: { align: 'right' }, cell: ({ row }) => num(row.original.cartons) },
    { id: 'kg', header: 'kg', accessorKey: 'kg', meta: { align: 'right' }, cell: ({ row }) => num(row.original.kg, 1) },
    { id: 'cbm', header: 'CBM', accessorKey: 'cbm', meta: { align: 'right' }, cell: ({ row }) => num(row.original.cbm, 2) },
    { id: 'goods', header: '물품가', accessorKey: 'goods_value', meta: { align: 'right' }, cell: ({ row }) => `${num(row.original.goods_value)} ${row.original.goods_currency}` },
    { id: 'traits', header: '특성', accessorFn: (r) => r.traits.join(','), cell: ({ row }) => <span className="flex flex-wrap gap-1">{row.original.traits.map((t) => <Chip key={t} tone="caution">{traitName(t)}</Chip>)}</span> },
    { id: 'price', header: '판매가', accessorKey: 'target_price', meta: { align: 'right' }, cell: ({ row }) => (row.original.target_price ? `${num(row.original.target_price)}원` : '—') },
    {
      id: 'act',
      header: '',
      enableSorting: false,
      enableHiding: false,
      cell: ({ row }) => (
        <span className="flex justify-end gap-1">
          <Button asChild size="sm" variant="ghost"><Link href={`/app/compare?units=${row.original.units}&cartons=${row.original.cartons}&kg=${row.original.kg}&cbm=${row.original.cbm}&goods=${row.original.goods_value}&cur=${row.original.goods_currency}&traits=${row.original.traits.join(',')}&sku=${row.original.id}&hub=YIW&port=ICN&mode=ANY`}><Scale aria-hidden /> 비교</Link></Button>
          <Button size="iconSm" variant="ghost" aria-label="고치기" onClick={() => setEdit({ id: row.original.id, name: row.original.name, units: row.original.units, cartons: row.original.cartons, kg: row.original.kg, cbm: row.original.cbm, goods: row.original.goods_value, cur: row.original.goods_currency as 'RMB', traits: row.original.traits, hsCategory: row.original.hs_category, targetPrice: row.original.target_price })}><Pencil /></Button>
        </span>
      ),
    },
  ];

  const save = () => {
    if (!edit) return;
    start(async () => {
      const r = await saveSku(edit);
      if (!r.ok) {
        setErrors(r.path ? { [r.path]: r.error ?? '' } : { name: r.error ?? '' });
        return;
      }
      toast.success(edit.id ? 'SKU 를 고쳤습니다' : 'SKU 를 저장했습니다');
      setEdit(null);
      router.refresh();
    });
  };

  return (
    <>
      <div className="mb-3 flex flex-wrap justify-end gap-2">
        <Button variant="secondary" onClick={() => setImporting(true)}><Upload aria-hidden /> 엑셀로 올리기</Button>
        <Button variant="primary" onClick={() => { setErrors({}); setEdit(blank); }}><Plus aria-hidden /> {ACTION.saveSku}</Button>
      </div>
      <DataTable
        data={visible}
        columns={cols}
        getId={(r) => r.id}
        searchText={(r) => r.name}
        searchPlaceholder="상품 이름"
        facets={[{ id: 'trait', label: '특성', options: traits.map((t) => ({ value: t.code, label: t.name_ko })), get: (r) => r.traits }]}
        bulk={(sel, clear) => (
          <Button size="sm" variant="primary" onClick={() => archive(sel.map((s) => s.id), clear)}>
            <Archive aria-hidden /> 보관
          </Button>
        )}
        csvName="SKU"
        csvRow={(r) => ({ 상품: r.name, 수량: r.units, 박스: r.cartons, kg: r.kg, CBM: r.cbm, 물품가: r.goods_value, 통화: r.goods_currency, 특성: r.traits.map(traitName).join('·'), 판매가: r.target_price })}
        mobileCard={(r) => (
          <div>
            <div className="flex items-center justify-between gap-2">
              <b className="truncate">{r.name}</b>
              <Button size="iconSm" variant="ghost" aria-label="고치기" onClick={() => setEdit({ id: r.id, name: r.name, units: r.units, cartons: r.cartons, kg: r.kg, cbm: r.cbm, goods: r.goods_value, cur: r.goods_currency as 'RMB', traits: r.traits, hsCategory: r.hs_category, targetPrice: r.target_price })}><Pencil /></Button>
            </div>
            <p className="text-xs text-muted tnum">{num(r.units)}개 · {r.cartons}박스 · {num(r.kg, 1)} kg · {num(r.cbm, 2)} CBM · {num(r.goods_value)} {r.goods_currency}</p>
          </div>
        )}
        empty={<EmptyState title="저장한 SKU 가 없습니다" body="자주 보내는 상품의 수량·무게·부피·물품가를 저장해 두면 비교·요청·손익에서 한 번에 불러옵니다." action={<Button variant="primary" onClick={() => setEdit(blank)}>{ACTION.saveSku}</Button>} />}
      />

      <Dialog open={!!edit} onOpenChange={(o) => !o && setEdit(null)}>
        {edit ? (
          <DialogContent title={edit.id ? 'SKU 고치기' : ACTION.saveSku} description="한 번 선적 분량(기본 수량) 기준으로 적어 주세요." wide>
            <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); save(); }} noValidate>
              <Field label="상품 이름" htmlFor="s-name" required error={errors.name}>
                <Input id="s-name" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} aria-invalid={!!errors.name || undefined} />
              </Field>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <Field label="수량" htmlFor="s-u"><NumberField id="s-u" value={edit.units} onValueChange={(v) => setEdit({ ...edit, units: v ?? 0 })} unit="개" /></Field>
                <Field label="박스" htmlFor="s-c"><NumberField id="s-c" value={edit.cartons} onValueChange={(v) => setEdit({ ...edit, cartons: v ?? 0 })} unit="박스" /></Field>
                <Field label="무게" htmlFor="s-k"><NumberField id="s-k" value={edit.kg} onValueChange={(v) => setEdit({ ...edit, kg: v ?? 0 })} unit="kg" decimals={1} /></Field>
                <Field label="부피" htmlFor="s-v"><NumberField id="s-v" value={edit.cbm} onValueChange={(v) => setEdit({ ...edit, cbm: v ?? 0 })} unit="CBM" decimals={2} /></Field>
                <Field label="물품가" htmlFor="s-g" className="col-span-2">
                  <div className="flex gap-2">
                    <NumberField id="s-g" value={edit.goods} onValueChange={(v) => setEdit({ ...edit, goods: v ?? 0 })} unit={edit.cur} className="flex-1" />
                    <NativeSelect aria-label="통화" value={edit.cur} onChange={(e) => setEdit({ ...edit, cur: e.target.value as 'RMB' })} className="w-24"><option>RMB</option><option>USD</option><option>KRW</option></NativeSelect>
                  </div>
                </Field>
                <Field label="판매가(원)" htmlFor="s-p"><NumberField id="s-p" value={edit.targetPrice} onValueChange={(v) => setEdit({ ...edit, targetPrice: v })} unit="원" /></Field>
                <Field label="관세 분류" htmlFor="s-h">
                  <NativeSelect id="s-h" value={edit.hsCategory} onChange={(e) => setEdit({ ...edit, hsCategory: e.target.value })}>
                    {duty.map((d) => <option key={d.category} value={d.category}>{d.name_ko}</option>)}
                  </NativeSelect>
                </Field>
              </div>
              <fieldset>
                <legend className="mb-1.5 text-sm font-semibold">화물 특성</legend>
                <div className="flex flex-wrap gap-1.5">
                  {traits.map((t) => {
                    const on = edit.traits.includes(t.code);
                    return (
                      <button key={t.code} type="button" aria-pressed={on} onClick={() => setEdit({ ...edit, traits: on ? edit.traits.filter((x) => x !== t.code) : [...edit.traits, t.code] })} className={cn('h-8 rounded-xs border px-2.5 text-xs font-semibold', on ? 'border-ink bg-ink text-on-ink' : 'border-line hover:border-muted/60')}>
                        {t.name_ko}
                      </button>
                    );
                  })}
                </div>
              </fieldset>
              <div className="mt-2 flex justify-end gap-2">
                <Button variant="ghost" onClick={() => setEdit(null)}>닫기</Button>
                <Button type="submit" variant="primary" disabled={pending}>{pending ? '저장하는 중…' : ACTION.saveSku}</Button>
              </div>
            </form>
          </DialogContent>
        ) : null}
      </Dialog>

      <Dialog open={importing} onOpenChange={setImporting}>
        <DialogContent title="엑셀로 SKU 올리기" description="양식을 받아 채우거나, 쓰던 표를 그대로 올리세요. 줄마다 확인한 뒤 확정합니다." wide>
          <ExcelImport
            templateName="SKU-양식"
            columns={[
              { key: 'name', label: '상품', aliases: ['상품명', '품명', 'name', '品名', '商品'], type: 'string', required: true },
              { key: 'units', label: '수량', aliases: ['qty', 'units', '数量'], type: 'number', required: true },
              { key: 'cartons', label: '박스', aliases: ['박스수', 'ctn', 'cartons', '箱数'], type: 'number', required: true },
              { key: 'kg', label: 'kg', aliases: ['무게', '중량', 'weight', '重量', '毛重'], type: 'number', required: true },
              { key: 'cbm', label: 'CBM', aliases: ['부피', 'volume', '体积', '方数'], type: 'number', required: true },
              { key: 'goods', label: '물품가', aliases: ['금액', 'value', '货值', '金额'], type: 'number', required: true },
              { key: 'cur', label: '통화', aliases: ['currency', '币种'], type: 'string' },
              { key: 'hs', label: '관세분류', aliases: ['분류', 'category', '类别'], type: 'string' },
              { key: 'price', label: '판매가', aliases: ['price', '售价'], type: 'number' },
            ]}
            validate={(r: ParsedRow) => {
              if ((r.units as number) < 1) return '수량은 1 이상';
              if ((r.cbm as number) <= 0) return '부피는 0보다 커야 합니다';
              if ((r.kg as number) <= 0) return '무게는 0보다 커야 합니다';
              return null;
            }}
            onConfirm={async (rows) => {
              const r = await importSkus(rows as never);
              if (r.ok) router.refresh();
              return { ok: r.ok, error: r.error, created: r.data?.created };
            }}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
