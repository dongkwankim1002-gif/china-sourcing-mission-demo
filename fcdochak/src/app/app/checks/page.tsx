import Link from 'next/link';
import { ChevronRight, ClipboardCheck } from 'lucide-react';
import { requireViewer } from '@/lib/server/viewer';
import { listMyChecks } from '@/lib/server/invoice-check';
import { getReference, nameOf } from '@/lib/server/reference';
import { Button, Chip, EmptyState, PageTitle, Panel } from '@/components/ui/core';
import { bpText } from '@/lib/check-text';
import { dateTimeKo, won } from '@/lib/format';
import { CHECK_ACTION } from '@/lib/terms';

export const metadata = { title: '청구서 점검' };

export default async function ChecksPage() {
  const v = await requireViewer('app');
  const [rows, ref] = await Promise.all([listMyChecks(v), getReference()]);
  return (
    <>
      <PageTitle
        title={CHECK_ACTION.list}
        sub="보관한 점검은 나만 봅니다. 고쳐서 다시 보관하면 이전 판은 그대로 두고 새 판이 쌓입니다."
        actions={
          <Button asChild variant="primary">
            <Link href="/check">{CHECK_ACTION.start}</Link>
          </Button>
        }
      />
      <Panel>
        {rows.length ? (
          <ul aria-label="보관한 점검" data-testid="checks-list" className="divide-y divide-line-2">
            {rows.map((c) => {
              const over = c.over_median_bp;
              return (
                <li key={c.id}>
                  <Link href={`/app/checks/${c.id}`} className="grid gap-2 px-4 py-3 hover:bg-surface-2 sm:grid-cols-[minmax(0,1fr)_auto_20px] sm:items-center">
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-bold">{c.title}</span>
                      <span className="block text-xs text-muted">
                        {nameOf(ref, 'hub', c.origin_hub)} → {nameOf(ref, 'port', c.port)} · {c.mode ? nameOf(ref, 'mode', c.mode) : '방식 상관없음'} · {dateTimeKo(c.created_at)}
                        {c.version > 1 ? ` · ${c.version}판` : ''}
                      </span>
                    </span>
                    <span className="flex flex-wrap items-center gap-1.5 text-sm tnum sm:justify-end">
                      <b>{won(c.invoice_total)}</b>
                      {over != null ? <span className={over > 0 ? 'text-stamp' : 'text-ok'}>중간값 {over > 0 ? '+' : '−'}{bpText(over)}</span> : <span className="text-muted">표본 부족</span>}
                      {c.high_count ? <Chip tone="stamp">과함 {c.high_count}</Chip> : null}
                      {c.missing_count ? <Chip tone="caution">빠짐 {c.missing_count}</Chip> : null}
                    </span>
                    <ChevronRight className="hidden size-4 text-muted sm:block" aria-hidden />
                  </Link>
                </li>
              );
            })}
          </ul>
        ) : (
          <EmptyState
            icon={<ClipboardCheck aria-hidden />}
            title="보관한 점검이 없습니다"
            body="받은 견적서·청구서를 점검하고 「이 결과 보관」을 누르면 여기에 쌓입니다."
            action={
              <Button asChild variant="secondary">
                <Link href="/check">{CHECK_ACTION.start}</Link>
              </Button>
            }
          />
        )}
      </Panel>
    </>
  );
}
