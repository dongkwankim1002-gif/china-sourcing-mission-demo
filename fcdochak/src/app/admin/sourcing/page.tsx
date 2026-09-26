import Link from 'next/link';
import { asUser, todayKst } from '@/lib/db';
import { requireViewer } from '@/lib/server/viewer';
import { loadSourcingConfig, requestQueue } from '@/lib/server/sourcing';
import { dueState } from '@/lib/sourcing/settings';
import { SourcingPreviewNotice } from '@/components/sourcing/preview';
import { DemoChip } from '@/components/badges';
import { Chip, EmptyState, PageTitle, Panel, PanelHead } from '@/components/ui/core';
import { SOURCING_STATUS_LABEL } from '@/lib/terms';
import { dateKo, num, won } from '@/lib/format';

export const metadata = { title: '소싱 요청 대기열' };

export default async function SourcingAdmin() {
  const v = await requireViewer('admin');
  const today = todayKst();
  const d = await asUser(v, async (q) => ({
    config: await loadSourcingConfig(q),
    rows: await requestQueue(q),
    samples: (await q.query<{ n: number }>(`select count(*)::int n from fcd.sourcing_sample_interests`))[0]?.n ?? 0,
  }));
  const open = d.rows.filter((r) => r.status === 'requested' || r.status === 'researching');
  const overdue = open.filter((r) => dueState(r.due_on, today, r.status) === 'overdue');
  return (
    <>
      <PageTitle
        title="소싱 요청 대기열"
        sub="화주가 남긴 유사상품 소싱 요청 — 담당 배정·후보 넣기·상태. 모두 새 기록으로 쌓이고, 앱은 공급처·화주에게 연락하지 않습니다."
        actions={<Link href="/admin/settings" className="text-sm font-semibold underline underline-offset-4">스위치·규칙 바꾸기(sourcing.*)</Link>}
      />
      <SourcingPreviewNotice on={d.config.on} />
      <ul className="mb-6 grid grid-cols-2 gap-3 xl:grid-cols-4" aria-label="요약">
        <li className="rounded-md border border-line bg-surface p-4">
          <p className="text-sm font-bold">처리할 요청</p>
          <p className="mt-1 text-xl font-bold tnum">{num(open.length)}건</p>
        </li>
        <li className="rounded-md border border-line bg-surface p-4">
          <p className="text-sm font-bold">기한 지남</p>
          <p className={`mt-1 text-xl font-bold tnum ${overdue.length ? 'text-stamp' : ''}`}>{num(overdue.length)}건</p>
          <p className="text-2xs text-muted">처리 기한 = 접수 + {d.config.rules.slaDays}일</p>
        </li>
        <li className="rounded-md border border-line bg-surface p-4">
          <p className="text-sm font-bold">샘플 요청(관심 등록)</p>
          <p className="mt-1 text-xl font-bold tnum">{num(d.samples)}건</p>
        </li>
        <li className="rounded-md border border-line bg-surface p-4">
          <p className="flex flex-wrap items-center gap-2 text-sm font-bold">
            스위치 <Chip tone={d.config.on ? 'ok' : 'neutral'}>{d.config.on ? '켜짐' : '꺼짐'}</Chip>
          </p>
          <p className="mt-2 text-2xs text-muted">사람이 정할 일: 현지 소싱 담당·약관(책임의 선)·지식재산 운영 규칙 — docs/sourcing-plan.md 12절</p>
        </li>
      </ul>
      <Panel>
        <PanelHead title={`요청 ${d.rows.length}건`} sub="처리할 것 → 후보 있음 → 끝난 것 순, 같은 무리 안에서는 기한 순" />
        {d.rows.length ? (
          <>
            <p className="px-4 pt-2 text-2xs text-muted md:hidden">표를 옆으로 넘기면 상태·담당·기한·후보 칸이 더 있습니다.</p>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-sm" data-testid="sourcing-queue">
                <caption className="sr-only">소싱 요청 대기열</caption>
                <thead className="bg-surface-2 text-left text-xs text-muted">
                  <tr>
                    <th scope="col" className="px-4 py-2 font-semibold">요청</th>
                    <th scope="col" className="px-4 py-2 font-semibold">화주</th>
                    <th scope="col" className="px-4 py-2 font-semibold">상태</th>
                    <th scope="col" className="px-4 py-2 font-semibold">담당</th>
                    <th scope="col" className="px-4 py-2 font-semibold">기한</th>
                    <th scope="col" className="px-4 py-2 text-right font-semibold">후보</th>
                  </tr>
                </thead>
                <tbody>
                  {d.rows.map((r) => {
                    const due = dueState(r.due_on, today, r.status);
                    return (
                      <tr key={r.id} className="border-t border-line-2">
                        <td className="px-4 py-2">
                          <Link href={`/admin/sourcing/${r.id}`} className="font-semibold underline-offset-4 hover:underline">{r.product_name}</Link>
                          <span className="block text-2xs text-muted tnum">{r.request_no}{r.target_price ? ` · 목표 ${won(r.target_price)}` : ''}{r.needs_cert ? ' · 인증 필요' : ''}</span>
                        </td>
                        <td className="px-4 py-2">
                          <span className="flex flex-wrap items-center gap-1.5">{r.org_name}{r.is_demo ? <DemoChip /> : null}</span>
                        </td>
                        <td className="px-4 py-2">
                          <span className="flex flex-wrap gap-1">
                            <Chip tone={r.status === 'candidates_ready' ? 'ok' : r.status === 'cancelled' || r.status === 'closed' ? 'neutral' : 'info'}>{SOURCING_STATUS_LABEL[r.status]}</Chip>
                            {r.preview ? <Chip tone="caution">미리보기</Chip> : null}
                          </span>
                        </td>
                        <td className="px-4 py-2 text-xs">{r.assignee_name ?? <span className="text-muted">없음</span>}</td>
                        <td className="px-4 py-2 text-xs tnum">
                          {due === 'overdue' ? <Chip tone="stamp">기한 지남 {dateKo(r.due_on, { dow: false })}</Chip> : due === 'done' ? <span className="text-muted">—</span> : dateKo(r.due_on, { dow: false })}
                        </td>
                        <td className="px-4 py-2 text-right tnum">{num(r.candidates)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <EmptyState title="소싱 요청이 없습니다" body="화주가 「소싱처 찾기」에서 요청을 남기면 여기에 쌓입니다." />
        )}
      </Panel>
    </>
  );
}
