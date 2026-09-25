import { asUser } from '@/lib/db';
import { requireViewer } from '@/lib/server/viewer';
import { DemoChip } from '@/components/badges';
import { EmptyState, PageTitle, Panel } from '@/components/ui/core';
import { dateTimeKo } from '@/lib/format';

export const metadata = { title: '감사 기록' };

export default async function Audit() {
  const v = await requireViewer('admin');
  const rows = await asUser(v, (q) =>
    q.query<{ id: string; action: string; target: string | null; detail: unknown; created_at: string; who: string | null; org: string | null; is_demo: boolean | null }>(
      `select a.id, a.action, a.target, a.detail, a.created_at, p.name who, o.name org, o.is_demo
         from fcd.audit_log a left join fcd.profiles p on p.id = a.actor_id left join fcd.orgs o on o.id = a.org_id order by a.created_at desc limit 500`,
    ),
  );
  return (
    <>
      <PageTitle title="감사 기록" sub="누가 언제 무엇을 했는지. 이 기록은 누구도 고치거나 지울 수 없습니다(권한 없음)." />
      <Panel className="overflow-hidden">
        {rows.length ? (
          <div className="max-h-[75vh] overflow-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="sticky top-0 bg-surface-2 text-xs text-muted"><tr>{['때', '누가', '무엇', '대상', '조직', '내용'].map((h) => <th key={h} scope="col" className="px-3 py-2 text-left font-semibold">{h}</th>)}</tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-t border-line-2 align-top">
                    <td className="whitespace-nowrap px-3 py-2 text-xs text-muted tnum">{dateTimeKo(r.created_at)}</td>
                    <td className="px-3 py-2 text-xs">{r.who ?? '시스템'}</td>
                    <td className="px-3 py-2 font-mono text-xs">{r.action}</td>
                    <td className="px-3 py-2 font-mono text-2xs text-muted">{r.target}</td>
                    <td className="px-3 py-2 text-xs"><span className="flex items-center gap-1">{r.org}{r.is_demo ? <DemoChip /> : null}</span></td>
                    <td className="max-w-72 truncate px-3 py-2 font-mono text-2xs text-muted" title={r.detail ? JSON.stringify(r.detail) : ''}>{r.detail ? JSON.stringify(r.detail) : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <EmptyState title="기록이 없습니다" />}
      </Panel>
    </>
  );
}
