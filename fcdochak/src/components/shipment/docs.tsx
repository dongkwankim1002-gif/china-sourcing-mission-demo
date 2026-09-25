'use client';
import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { FileText, UploadCloud } from 'lucide-react';
import { uploadDocument } from '@/app/actions/docs';
import { Button, EmptyState, NativeSelect } from '@/components/ui/core';
import { DOC_LABEL } from '@/lib/terms';
import { cn } from '@/lib/cn';
import { dateTimeKo } from '@/lib/format';

export function DocsPanel({
  shipmentId,
  docs,
  zh,
}: {
  shipmentId: string;
  docs: { id: string; kind: string; file_name: string; size_bytes: number | null; created_at: string; storage_path: string | null; org_name: string }[];
  zh?: boolean;
}) {
  const router = useRouter();
  const [kind, setKind] = React.useState('commercial_invoice');
  const [drag, setDrag] = React.useState(false);
  const [pending, start] = React.useTransition();
  const input = React.useRef<HTMLInputElement>(null);
  const send = (file: File) => {
    const fd = new FormData();
    fd.set('shipmentId', shipmentId);
    fd.set('kind', kind);
    fd.set('file', file);
    start(async () => {
      const r = await uploadDocument(fd);
      if (r.ok) {
        toast.success(zh ? '已上传' : '서류를 올렸습니다', { description: file.name });
        router.refresh();
      } else toast.error(r.error ?? '올리지 못했습니다');
    });
  };
  return (
    <div className="grid gap-4">
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
        <p className="min-w-0 flex-1 text-sm text-muted">{zh ? '把文件拖到这里，或' : '파일을 여기에 끌어놓거나'}</p>
        <NativeSelect aria-label={zh ? '文件类型' : '서류 종류'} value={kind} onChange={(e) => setKind(e.target.value)} className="h-9 w-auto text-sm">
          {Object.entries(DOC_LABEL).map(([k, l]) => (
            <option key={k} value={k}>{l}</option>
          ))}
        </NativeSelect>
        <input ref={input} type="file" className="sr-only" aria-label="파일 고르기" onChange={(e) => e.target.files?.[0] && send(e.target.files[0])} />
        <Button size="sm" variant="secondary" disabled={pending} onClick={() => input.current?.click()}>
          {pending ? (zh ? '上传中…' : '올리는 중…') : zh ? '选择文件' : '파일 고르기'}
        </Button>
      </div>
      {docs.length ? (
        <ul className="divide-y divide-line-2 rounded-md border border-line bg-surface">
          {docs.map((d) => (
            <li key={d.id} className="flex items-center gap-3 px-4 py-2.5">
              <FileText className="size-4 text-muted" aria-hidden />
              <a href={`/api/docs/${d.id}`} className="min-w-0 flex-1 truncate text-sm font-semibold hover:underline">{d.file_name}</a>
              <span className="text-xs text-muted">{DOC_LABEL[d.kind] ?? d.kind}</span>
              <span className="hidden text-xs text-muted sm:inline">{d.org_name} · {dateTimeKo(d.created_at)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState title={zh ? '还没有文件' : '아직 서류가 없습니다'} body={zh ? '商业发票、装箱单、提单等在此上传。' : '상업송장·포장명세서·B/L·수입신고필증을 여기서 주고받습니다.'} />
      )}
    </div>
  );
}
