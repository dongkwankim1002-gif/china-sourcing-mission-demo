'use client';
/**
 * 서류 — 올리기와 서류함 칸(인보이스·패킹리스트·쿠팡 바코드 PDF·B/L·기타).
 * 선적 화면(한 선적)과 서류함 화면(전체, 선적을 골라 올림)이 같은 부품을 쓴다.
 */
import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { AlertTriangle, FileText, UploadCloud } from 'lucide-react';
import { uploadDocument } from '@/app/actions/docs';
import { Button, Chip, EmptyState, NativeSelect } from '@/components/ui/core';
import { DOC_LABEL } from '@/lib/terms';
import { cn } from '@/lib/cn';
import { dateTimeKo } from '@/lib/format';
import { SHELF_HINT, SHELF_LABEL, SHELF_LABEL_ZH, UPLOAD_OPTIONS, groupByShelf, missingShelves, type Shelf } from '@/lib/workspace/shelves';

export interface DocItem {
  id: string;
  kind: string;
  shelf?: string | null;
  file_name: string;
  size_bytes: number | null;
  created_at: string;
  storage_path: string | null;
  org_name: string;
  shipment_id?: string;
  shipment_no?: string;
}

export function DocUploader({
  shipmentId,
  shipments,
  zh,
  defaultShelf,
}: {
  shipmentId?: string;
  shipments?: { id: string; label: string }[];
  zh?: boolean;
  defaultShelf?: Shelf;
}) {
  const router = useRouter();
  const first = UPLOAD_OPTIONS.find((o) => o.shelf === (defaultShelf ?? 'invoice'))!.value;
  const [option, setOption] = React.useState(first);
  const [target, setTarget] = React.useState(shipmentId ?? shipments?.[0]?.id ?? '');
  const [drag, setDrag] = React.useState(false);
  const [pending, start] = React.useTransition();
  const input = React.useRef<HTMLInputElement>(null);
  const send = (file: File) => {
    if (!target) return void toast.error(zh ? '请选择货件' : '선적을 고르세요');
    const fd = new FormData();
    fd.set('shipmentId', target);
    fd.set('option', option);
    fd.set('file', file);
    start(async () => {
      const r = await uploadDocument(fd);
      if (r.ok) {
        toast.success(zh ? '已上传' : '서류를 올렸습니다', { description: file.name });
        if (input.current) input.current.value = '';
        router.refresh();
      } else toast.error(r.error ?? '올리지 못했습니다');
    });
  };
  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDrag(true);
      }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDrag(false);
        const f = e.dataTransfer.files[0];
        if (f) send(f);
      }}
      className={cn('flex flex-wrap items-center gap-3 rounded-md border-2 border-dashed p-4', drag ? 'border-label bg-label/10' : 'border-line bg-surface')}
    >
      <UploadCloud className="size-5 text-muted" aria-hidden />
      <p className="min-w-0 flex-1 basis-40 text-sm text-muted">{zh ? '把文件拖到这里，或' : '파일을 여기에 끌어놓거나'}</p>
      {shipments ? (
        <NativeSelect aria-label="올릴 선적" value={target} onChange={(e) => setTarget(e.target.value)} className="h-9 w-full text-sm sm:w-auto sm:max-w-64">
          {shipments.map((s) => (
            <option key={s.id} value={s.id}>{s.label}</option>
          ))}
        </NativeSelect>
      ) : null}
      <NativeSelect aria-label={zh ? '文件类型' : '서류 종류'} value={option} onChange={(e) => setOption(e.target.value)} className="h-9 w-full text-sm sm:w-auto">
        {UPLOAD_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>{zh ? o.labelZh : o.label}</option>
        ))}
      </NativeSelect>
      <input ref={input} type="file" className="sr-only" aria-label="파일 고르기" onChange={(e) => e.target.files?.[0] && send(e.target.files[0])} />
      <Button size="sm" variant="secondary" disabled={pending} onClick={() => input.current?.click()}>
        {pending ? (zh ? '上传中…' : '올리는 중…') : zh ? '选择文件' : '파일 고르기'}
      </Button>
    </div>
  );
}

export function ShelfList({ docs, zh, showShipment, need, max }: { docs: DocItem[]; zh?: boolean; showShipment?: boolean; need?: boolean; max?: number }) {
  const groups = groupByShelf(docs);
  const missing = need ? missingShelves(docs) : [];
  const names = zh ? SHELF_LABEL_ZH : SHELF_LABEL;
  return (
    <div className="grid gap-3">
      {missing.length ? (
        <p className="flex items-start gap-1.5 rounded-sm border border-caution/40 bg-caution-bg px-3 py-2 text-sm text-caution" data-testid="docs-missing">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>{zh ? '尚缺：' : '아직 없는 서류: '}{missing.map((m) => names[m]).join(' · ')}</span>
        </p>
      ) : null}
      {groups.map((g) => (
        <section key={g.shelf} aria-labelledby={`shelf-${g.shelf}`} className="rounded-md border border-line bg-surface" data-testid={`shelf-${g.shelf}`}>
          <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line-2 px-4 py-2.5">
            <h3 id={`shelf-${g.shelf}`} className="text-sm font-bold">
              {names[g.shelf]} <span className="tnum font-normal text-muted">{g.docs.length}</span>
            </h3>
            {!zh ? <p className="text-xs text-muted">{SHELF_HINT[g.shelf]}</p> : null}
          </div>
          {g.docs.length ? (
            <ul className="divide-y divide-line-2">
              {(max ? g.docs.slice(0, max) : g.docs).map((d) => (
                <li key={d.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5">
                  <FileText className="size-4 shrink-0 text-muted" aria-hidden />
                  <a href={`/api/docs/${d.id}`} className="min-w-0 flex-1 basis-40 truncate text-sm font-semibold hover:underline">{d.file_name}</a>
                  {g.shelf === 'other' && DOC_LABEL[d.kind] && d.kind !== 'other' ? <Chip>{DOC_LABEL[d.kind]}</Chip> : null}
                  {showShipment && d.shipment_id ? (
                    <Link href={`/app/shipments/${d.shipment_id}?tab=docs`} className="text-xs font-semibold text-text underline decoration-line underline-offset-4">{d.shipment_no}</Link>
                  ) : null}
                  <span className="text-xs text-muted">{d.org_name} · {dateTimeKo(d.created_at)}</span>
                </li>
              ))}
              {max && g.docs.length > max ? <li className="px-4 py-2 text-xs text-muted">최근 {max}건만 보입니다 · 모두 {g.docs.length}건 — 선적 화면의 서류 탭에서 나머지를 봅니다</li> : null}
            </ul>
          ) : (
            <p className="px-4 py-3 text-xs text-muted">{zh ? '没有文件' : '아직 없습니다'}</p>
          )}
        </section>
      ))}
    </div>
  );
}

/** 한 선적의 서류 — 올리기 + 칸별 목록 */
export function DocsPanel({ shipmentId, docs, zh }: { shipmentId: string; docs: DocItem[]; zh?: boolean }) {
  return (
    <div className="grid gap-4">
      <DocUploader shipmentId={shipmentId} zh={zh} />
      {docs.length ? (
        <ShelfList docs={docs} zh={zh} need />
      ) : (
        <>
          <EmptyState
            title={zh ? '还没有文件' : '아직 서류가 없습니다'}
            body={zh ? '发票、装箱单、Coupang 条码 PDF、提单等在此上传。' : '인보이스·패킹리스트·쿠팡 바코드 PDF·B/L 을 여기서 주고받습니다.'}
          />
        </>
      )}
    </div>
  );
}
