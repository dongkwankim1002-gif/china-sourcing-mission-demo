import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { requireViewer } from '@/lib/server/viewer';
import { getMyCheck } from '@/lib/server/invoice-check';
import { CheckResultView } from '@/components/check/result';
import { Button, PageTitle, Panel, PanelHead } from '@/components/ui/core';
import { SEGMENT_LABEL_KO, isSegment } from '@/lib/money/segments';
import { dateTimeKo, num } from '@/lib/format';
import { CHECK_ACTION } from '@/lib/terms';

export const metadata = { title: '청구서 점검' };

export default async function CheckDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const v = await requireViewer('app');
  const c = await getMyCheck(v, id);
  if (!c) notFound();
  return (
    <>
      <PageTitle
        eyebrow={
          <Link href="/app/checks" className="inline-flex items-center gap-1 hover:underline">
            <ArrowLeft className="size-3.5" aria-hidden /> {CHECK_ACTION.list}
          </Link>
        }
        title={c.title}
        sub={`${dateTimeKo(c.created_at)} 보관 · ${c.version}판${c.supersedes_id ? ' (이전 판을 고친 것)' : ''} · 보관한 때의 요금표 기준`}
        actions={
          c.newer_id ? (
            <Button asChild variant="secondary">
              <Link href={`/app/checks/${c.newer_id}`}>새 판 보기</Link>
            </Button>
          ) : (
            <Button asChild variant="primary">
              <Link href={`/check?from=${c.id}`}>{CHECK_ACTION.again}</Link>
            </Button>
          )
        }
      />
      {c.newer_id ? (
        <p role="status" className="mb-4 rounded-sm border border-line bg-surface-2 p-3 text-sm">이 판 뒤에 고친 새 판이 있습니다. 이 판은 그대로 남아 있습니다.</p>
      ) : null}
      <div className="grid gap-4">
        <CheckResultView outcome={c.result} />
        <Panel aria-labelledby="ck-lines">
          <PanelHead id="ck-lines" title={`넣은 항목 ${c.lines.length}줄`} sub="보관한 그대로 — 고치려면 「고쳐서 다시 점검」" />
          <ul className="divide-y divide-line-2 text-sm">
            {c.lines.map((l, i) => (
              <li key={i} className="flex flex-wrap justify-between gap-x-3 gap-y-0.5 px-4 py-2">
                <span className="min-w-0">
                  {l.label}
                  <span className="ml-2 text-xs text-muted">{l.segment === 'tax' ? '관세·부가세' : isSegment(l.segment) ? SEGMENT_LABEL_KO[l.segment] : '구간 모름'}</span>
                </span>
                <span className="tnum">
                  {num(l.amount, 2)} {l.currency === 'KRW' ? '원' : l.currency}
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      </div>
    </>
  );
}
