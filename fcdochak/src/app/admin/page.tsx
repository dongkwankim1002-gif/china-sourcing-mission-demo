import Link from 'next/link';
import { asUser } from '@/lib/db';
import { env } from '@/lib/env';
import { requireViewer } from '@/lib/server/viewer';
import { loadSettings } from '@/lib/server/settings';
import { adminDashboard } from '@/lib/server/admin';
import { shortDay } from '@/lib/server/shipper';
import { getReference, nameOf } from '@/lib/server/reference';
import { StatTile } from '@/components/stat';
import { DailyBars, DailyLine, HeatGrid } from '@/components/charts';
import { DemoToggle } from '@/components/demo-toggle';
import { Freshness } from '@/components/period-picker';
import { DemoChip, FcReadyChip, RelatedChip } from '@/components/badges';
import { PageTitle, Panel, PanelHead } from '@/components/ui/core';
import { pct } from '@/lib/format';

export const metadata = { title: '운영 대시보드' };

export default async function AdminHome({ searchParams }: { searchParams: Promise<{ demo?: string }> }) {
  const sp = await searchParams;
  const include = sp.demo !== '0';
  const v = await requireViewer('admin');
  const [ref, d] = await Promise.all([getReference(), asUser(v, async (q) => adminDashboard(q, await loadSettings(q), include))]);
  const now = new Date().toISOString();
  const lanes = [...new Set(d.heat.map((h) => h.lane))].sort((a, b) => d.heat.filter((h) => h.lane === b).reduce((t, x) => t + x.n, 0) - d.heat.filter((h) => h.lane === a).reduce((t, x) => t + x.n, 0)).slice(0, 10);
  const weeks = Array.from({ length: 12 }, (_, i) => 11 - i);
  const laneLabel = (l: string) => {
    const [h, p] = l.split('→');
    return `${nameOf(ref, 'hub', h)}→${nameOf(ref, 'port', p)}`;
  };
  return (
    <>
      <PageTitle
        title="운영 대시보드"
        sub={`최근 30일 · ${env.demoMode ? 'DEMO_MODE 켜짐' : 'DEMO_MODE 꺼짐(공개·워크스페이스에서 예시 안 보임)'}`}
        actions={<><Freshness at={now} /><DemoToggle include={include} href={(x) => (x ? '/admin' : '/admin?demo=0')} /></>}
      />
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        <StatTile label="견적 요청" value={d.totals.requests} prev={d.prev.requests} suffix="건" trend={d.daily.map((x) => x.requests)} />
        <StatTile label="예약" value={d.totals.bookings} prev={d.prev.bookings} suffix="건" trend={d.daily.map((x) => x.bookings)} />
        <StatTile label="거래액(응찰 합계)" value={d.totals.gmv} prev={d.prev.gmv} format="won" trend={d.daily.map((x) => x.gmv)} />
        <StatTile label="수수료 기준 매출" value={d.commission} prev={d.commissionPrev} format="won" hint="물류비 − 관세사 보수" href="/admin/commission" />
        <StatTile label="평균 청구 편차" value={d.devRet.dev} prev={d.devRet.dev_prev} format="pct" good="down" />
        <StatTile label="30일 FC 회송률" value={d.devRet.ret} prev={d.devRet.ret_prev} format="pct" good="down" />
      </section>
      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Panel><PanelHead title="일별 견적 요청" /><div className="p-3"><DailyBars data={d.daily.map((x) => ({ d: shortDay(x.d), v: x.requests }))} name="요청" height={180} /></div></Panel>
        <Panel><PanelHead title="일별 예약" /><div className="p-3"><DailyBars data={d.daily.map((x) => ({ d: shortDay(x.d), v: x.bookings }))} name="예약" height={180} /></div></Panel>
        <Panel><PanelHead title="일별 거래액" /><div className="p-3"><DailyLine data={d.daily.map((x) => ({ d: shortDay(x.d), v: x.gmv }))} name="거래액" f="won" height={180} area /></div></Panel>
      </div>
      <div className="mt-6 grid gap-6 xl:grid-cols-[1fr_360px]">
        <Panel>
          <PanelHead title="구간 주간 열지도" sub="최근 12주 견적 요청 수 · 오른쪽이 이번 주" />
          <div className="p-4">
            <HeatGrid rows={lanes.map(laneLabel)} cols={weeks.map((w) => (w === 0 ? '이번 주' : `${w}주 전`))} values={lanes.map((l) => weeks.map((w) => d.heat.find((h) => h.lane === l && h.w === w)?.n ?? 0))} caption="구간별 주간 요청 수" />
          </div>
        </Panel>
        <Panel>
          <PanelHead title="처리 대기" action={<Link href="/admin/queues" className="text-sm font-semibold underline">열기</Link>} />
          <ul>
            {[
              ['담당자 인증 요청', d.queues.verify, '/admin/queues?tab=verify'],
              ['게시 삭제 요청', d.queues.deletion, '/admin/queues?tab=deletion'],
              ['청구 편차(열림)', d.queues.billing, '/admin/queues?tab=billing'],
              ['모든 예외(열림)', d.queues.exceptions, '/admin/queues?tab=billing'],
            ].map(([k, n, h]) => (
              <li key={k as string} className="border-b border-line-2 last:border-0">
                <Link href={h as string} className="flex items-center justify-between px-4 py-3 text-sm hover:bg-surface-2">
                  <span>{k}</span>
                  <span className={`display text-xl tnum ${(n as number) > 0 ? 'text-caution' : 'text-muted'}`}>{n}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Panel>
      </div>
      <Panel className="mt-6">
        <PanelHead title="업체 점수 순위" sub="정시 입고 30 · 청구 편차 25 · FC 회송률 25 · 가격확정도 20 — 광고·특수관계는 점수 밖" />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm tnum">
            <thead className="bg-surface-2 text-xs text-muted">
              <tr>{['', '업체', '추천', '정시 입고', '청구 편차', '30일 회송률', '완료', ''].map((h, i) => <th key={i} scope="col" className={`px-3 py-2 font-semibold ${i >= 2 && i <= 6 ? 'text-right' : 'text-left'}`}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {d.ranked.slice(0, 15).map((r, i) => (
                <tr key={r.id} className="border-t border-line-2">
                  <td className="px-3 py-2 text-muted">{i + 1}</td>
                  <th scope="row" className="px-3 py-2 text-left font-semibold"><Link href={`/admin/data?org=${r.id}`} className="hover:underline">{r.name}</Link></th>
                  <td className="px-3 py-2 text-right font-bold">{r.score}</td>
                  <td className="px-3 py-2 text-right">{r.shipments_done ? pct(r.on_time_rate, 0) : '—'}</td>
                  <td className="px-3 py-2 text-right">{r.invoiced_count ? pct(r.avg_deviation, 1) : '—'}</td>
                  <td className="px-3 py-2 text-right">{r.done_30d ? pct(r.return_rate_30d, 1) : '—'}</td>
                  <td className="px-3 py-2 text-right">{r.shipments_done}</td>
                  <td className="flex gap-1 px-3 py-2">{r.is_demo ? <DemoChip /> : null}{r.fcReady ? <FcReadyChip /> : null}{r.related_party_note ? <RelatedChip note={r.related_party_note} /> : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </>
  );
}
