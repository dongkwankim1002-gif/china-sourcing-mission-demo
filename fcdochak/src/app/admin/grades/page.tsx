import { asUser } from '@/lib/db';
import { requireViewer } from '@/lib/server/viewer';
import { loadSettings } from '@/lib/server/settings';
import { reevaluateGrades } from '@/app/actions/admin';
import { ConfirmAction } from '@/components/admin/confirm-action';
import { DemoChip } from '@/components/badges';
import { Chip, EmptyState, PageTitle, Panel, PanelHead } from '@/components/ui/core';
import { dateTimeKo, pct } from '@/lib/format';

export const metadata = { title: '등급 기록' };

export default async function Grades() {
  const v = await requireViewer('admin');
  const { rows, s } = await asUser(v, async (q) => ({
    s: await loadSettings(q),
    rows: await q.query<{ id: string; name: string; is_demo: boolean; granted: boolean; basis: { fcInbound?: number; returnRate30d?: number | null }; note: string | null; created_at: string; who: string | null }>(
      `select g.id, o.name, o.is_demo, g.granted, g.basis, g.note, g.created_at, p.name who from fcd.grade_records g join fcd.orgs o on o.id = g.org_id left join fcd.profiles p on p.id = g.created_by order by g.created_at desc limit 300`,
    ),
  }));
  return (
    <>
      <PageTitle
        title="등급 기록"
        sub={`「FC 입고 준비 인증」 — FC 입고 ${s.fcReadyRule.minFcInbound}건 이상 · 30일 회송률 ${pct(s.fcReadyRule.maxReturnRate30d, 1)} 이하(설정 값). 기록은 쌓이기만 합니다.`}
        actions={<ConfirmAction label="지금 재평가" variant="primary" title="실측으로 다시 판정" description="기준을 새로 넘었거나 떨어진 업체만 새 기록을 쌓습니다." action={reevaluateGrades} />}
      />
      <Panel>
        <PanelHead title={`기록 ${rows.length}건`} />
        {rows.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm tnum">
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-t border-line-2 first:border-0">
                    <th scope="row" className="px-4 py-2.5 text-left font-semibold"><span className="flex items-center gap-1.5">{r.name}{r.is_demo ? <DemoChip /> : null}</span></th>
                    <td className="px-4 py-2.5"><Chip tone={r.granted ? 'ok' : 'neutral'}>{r.granted ? '부여' : '미부여'}</Chip></td>
                    <td className="px-4 py-2.5 text-xs text-muted">입고 {r.basis?.fcInbound ?? '—'}건 · 회송 {pct(r.basis?.returnRate30d ?? null, 1)}</td>
                    <td className="px-4 py-2.5 text-xs">{r.note}</td>
                    <td className="px-4 py-2.5 text-right text-xs text-muted">{dateTimeKo(r.created_at)} · {r.who}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <EmptyState title="아직 등급 기록이 없습니다" body="「지금 재평가」를 누르면 실측으로 판정해 첫 기록을 남깁니다." />}
      </Panel>
    </>
  );
}
