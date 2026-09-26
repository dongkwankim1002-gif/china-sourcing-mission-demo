import Link from 'next/link';
import { asUser, todayKst } from '@/lib/db';
import { requireViewer } from '@/lib/server/viewer';
import { loadSourcingConfig, myRequests } from '@/lib/server/sourcing';
import { sourcingSeeds } from '@/lib/sourcing/seeds';
import { dueState } from '@/lib/sourcing/settings';
import { SourcingPreviewNotice } from '@/components/sourcing/preview';
import { SourcingRequestForm } from '@/components/sourcing/request-form';
import { Chip, EmptyState, PageTitle, Panel, PanelHead } from '@/components/ui/core';
import { SOURCING_STATUS_LABEL } from '@/lib/terms';
import { dateKo, num, won } from '@/lib/format';

export const metadata = { title: '소싱처 찾기(미리보기)' };

export default async function SourcingHome({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const v = await requireViewer('app', '/app/sourcing');
  const today = todayKst();
  const d = await asUser(v, async (q) => ({
    config: await loadSourcingConfig(q),
    requests: await myRequests(q, v.org.id),
    seeds: await sourcingSeeds(q, v.org.id),
    categories: await q.query<{ category: string; name_ko: string }>(`select category, name_ko from fcd.v_current_duty_rates order by category`),
    hubs: await q.query<{ code: string; name_ko: string }>(`select code, name_ko from fcd.hubs order by ord`),
  }));
  return (
    <>
      <PageTitle
        eyebrow={<Link href="/family/sourcing" className="underline underline-offset-4">FC도착 패밀리 · 소싱(가칭)</Link>}
        title="소싱처 찾기"
        sub="잘 팔리는 내 상품과 비슷한 상품을 만들 중국 공급처를 찾고, 후보마다 쿠팡 FC 도착원가와 개당 마진을 같은 엔진으로 셈합니다."
      />
      <SourcingPreviewNotice on={d.config.on} />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
        <Panel aria-labelledby="sr-h" className="min-w-0">
          <PanelHead id="sr-h" title="유사상품 조건" sub={`처리 기한 ${d.config.rules.slaDays}일 · 열린 요청은 ${d.config.rules.maxOpenPerOrg}건까지`} />
          <SourcingRequestForm seeds={d.seeds} categories={d.categories} hubs={d.hubs} initialRef={sp.from ?? null} />
        </Panel>
        <Panel aria-labelledby="sl-h" className="min-w-0 self-start">
          <PanelHead id="sl-h" title={`내 소싱 요청 ${d.requests.length}건`} />
          {d.requests.length ? (
            <ul className="divide-y divide-line-2" data-testid="sourcing-list">
              {d.requests.map((r) => {
                const due = dueState(r.due_on, today, r.status);
                return (
                  <li key={r.id} className="px-4 py-3">
                    <Link href={`/app/sourcing/${r.id}`} className="block min-w-0 rounded-sm hover:bg-surface-2">
                      <span className="flex flex-wrap items-center gap-2">
                        <b className="min-w-0 break-words">{r.product_name}</b>
                        <Chip tone={r.status === 'candidates_ready' ? 'ok' : r.status === 'cancelled' ? 'neutral' : 'info'}>{SOURCING_STATUS_LABEL[r.status]}</Chip>
                        {r.preview ? <Chip tone="caution">미리보기</Chip> : null}
                      </span>
                      <span className="mt-0.5 block text-xs text-muted tnum">
                        {r.request_no} · 후보 {num(r.candidates)}곳{r.target_price ? ` · 목표 ${won(r.target_price)}` : ''} ·{' '}
                        {due === 'overdue' ? <span className="text-stamp">기한 지남 {dateKo(r.due_on, { dow: false })}</span> : due === 'done' ? '처리됨' : `기한 ${dateKo(r.due_on, { dow: false })}`}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          ) : (
            <EmptyState title="아직 소싱 요청이 없습니다" body="왼쪽에서 잘 팔리는 상품을 고르거나 직접 적어 요청을 남기세요. 담당이 후보를 넣기 전에도 예시 후보로 도착원가를 미리 볼 수 있습니다." />
          )}
        </Panel>
      </div>
    </>
  );
}
