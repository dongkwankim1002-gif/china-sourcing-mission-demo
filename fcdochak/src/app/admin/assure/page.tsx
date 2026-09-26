import Link from 'next/link';
import { asUser } from '@/lib/db';
import { requireViewer } from '@/lib/server/viewer';
import { loadAssureConfig } from '@/lib/server/assure';
import { ASSURE_HUMAN_TODO, ASSURE_KINDS, ASSURE_KIND_LABEL, type AssureKind } from '@/lib/assure-settings';
import { DemoChip } from '@/components/badges';
import { Chip, EmptyState, PageTitle, Panel, PanelHead } from '@/components/ui/core';
import { dateKo, dateTimeKo, num } from '@/lib/format';

export const metadata = { title: '확정가·보장 관심 등록' };

const SOURCE: Record<string, string> = { compare: '비교', request: '견적 요청', other: '기타' };

export default async function AssureAdmin() {
  const v = await requireViewer('admin');
  const d = await asUser(v, async (q) => ({
    config: await loadAssureConfig(q),
    interests: await q.query<{ id: string; kind: AssureKind; source: string; detail: { shown?: number | null } | null; note: string | null; created_at: string; org_name: string; is_demo: boolean; user_name: string }>(
      `select i.id, i.kind, i.source, i.detail, i.note, i.created_at, o.name org_name, o.is_demo, p.name user_name
         from fcd.assure_interests i join fcd.orgs o on o.id = i.org_id join fcd.profiles p on p.id = i.user_id
        order by i.created_at desc limit 200`,
    ),
    counts: await q.query<{ kind: AssureKind; n: number; orgs: number }>(`select kind, count(*)::int n, count(distinct org_id)::int orgs from fcd.assure_interests group by kind`),
    quotes: await q.query<{ id: string; quote_no: string; version: number; firm_price: number; base_total: number; premium: number; sample_n: number; valid_until: string; created_at: string; org_name: string; source: string }>(
      `select f.id, f.quote_no, f.version, f.firm_price, f.base_total, f.premium, f.sample_n, f.valid_until, f.created_at, o.name org_name, f.source
         from fcd.firm_price_quotes f join fcd.orgs o on o.id = f.org_id
        where not exists (select 1 from fcd.firm_price_quotes n where n.supersedes_id = f.id)
        order by f.created_at desc limit 50`,
    ),
  }));
  const count = (k: AssureKind) => d.counts.find((c) => c.kind === k);
  return (
    <>
      <PageTitle
        title="확정가·보장 관심 등록"
        sub="확정가·회송 보장·물류비 후불·공동 혼적은 자리만 만들어 두었습니다. 화주가 누른 관심 등록과 시범 확정가 기록을 봅니다."
        actions={<Link href="/admin/settings#assure-switches" className="text-sm font-semibold underline underline-offset-4">시범 스위치·요율 바꾸기</Link>}
      />
      <ul className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="종류별">
        {ASSURE_KINDS.map((k) => (
          <li key={k} className="min-w-0 rounded-md border border-line bg-surface p-4" data-testid={`assure-count-${k}`}>
            <p className="flex flex-wrap items-center gap-2 text-sm font-bold">
              {ASSURE_KIND_LABEL[k]} <Chip tone={d.config.on[k] ? 'label' : 'neutral'}>{d.config.on[k] ? '시범 켜짐' : '꺼짐'}</Chip>
            </p>
            <p className="mt-1 text-xl font-bold tnum">{num(count(k)?.n ?? 0)}명</p>
            <p className="text-xs text-muted tnum">화주 {num(count(k)?.orgs ?? 0)}곳</p>
            <p className="mt-2 text-2xs text-muted">사람이 정할 일: {ASSURE_HUMAN_TODO[k]}</p>
          </li>
        ))}
      </ul>
      <p className="mb-6 rounded-md border border-caution/40 bg-caution-bg px-4 py-2.5 text-sm text-caution">
        스위치를 켜도 실제 계약·결제·보장은 없습니다. 사람이 정할 일: 주선업 등록·보험사·금융사 제휴.
      </p>

      <Panel className="mb-6">
        <PanelHead title={`관심 등록 ${d.interests.length}건`} sub="한 사람이 종류마다 한 번. 연락처를 밖으로 보내지 않습니다." />
        {d.interests.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <caption className="sr-only">관심 등록 목록</caption>
              <thead className="bg-surface-2 text-left text-xs text-muted">
                <tr>
                  <th scope="col" className="px-4 py-2 font-semibold">때</th>
                  <th scope="col" className="px-4 py-2 font-semibold">종류</th>
                  <th scope="col" className="px-4 py-2 font-semibold">화주</th>
                  <th scope="col" className="px-4 py-2 font-semibold">어디서</th>
                  <th scope="col" className="px-4 py-2 text-right font-semibold">그때 본 참고 금액</th>
                </tr>
              </thead>
              <tbody>
                {d.interests.map((i) => (
                  <tr key={i.id} className="border-t border-line-2">
                    <td className="px-4 py-2 text-xs text-muted tnum">{dateTimeKo(i.created_at)}</td>
                    <td className="px-4 py-2 font-semibold">{ASSURE_KIND_LABEL[i.kind]}</td>
                    <td className="px-4 py-2">
                      <span className="flex flex-wrap items-center gap-1.5">{i.org_name} <span className="text-xs text-muted">{i.user_name}</span>{i.is_demo ? <DemoChip /> : null}</span>
                    </td>
                    <td className="px-4 py-2 text-xs">{SOURCE[i.source] ?? i.source}</td>
                    <td className="px-4 py-2 text-right tnum">{i.detail?.shown != null ? `${num(i.detail.shown)}원` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState title="아직 관심 등록이 없습니다" body="화주의 비교·견적 요청 화면 아래 「확정가로 받기」 카드에서 누릅니다." />
        )}
      </Panel>

      <Panel>
        <PanelHead title={`시범 확정가 기록 ${d.quotes.length}건`} sub="스위치가 켜졌을 때만 쌓입니다. 고치지 않고 새 판으로 쌓입니다. 계약·결제가 아닙니다." />
        {d.quotes.length ? (
          <ul>
            {d.quotes.map((f) => (
              <li key={f.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-line-2 px-4 py-2.5 text-sm last:border-0">
                <b className="font-mono text-xs">{f.quote_no}{f.version > 1 ? ` v${f.version}` : ''}</b>
                <span>{f.org_name}</span>
                <span className="text-xs text-muted">{SOURCE[f.source] ?? f.source} · 표본 {f.sample_n}</span>
                <span className="flex-1" />
                <span className="tnum">{num(f.base_total)} + {num(f.premium)} = <b>{num(f.firm_price)}원</b></span>
                <span className="text-xs text-muted">{dateKo(f.valid_until, { dow: false })}까지</span>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title="시범 확정가 기록이 없습니다" />
        )}
      </Panel>
    </>
  );
}
