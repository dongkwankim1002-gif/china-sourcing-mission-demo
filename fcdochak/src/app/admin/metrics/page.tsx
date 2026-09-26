import { asUser, todayKst } from '@/lib/db';
import { requireViewer } from '@/lib/server/viewer';
import { loadSettings } from '@/lib/server/settings';
import { adminMetrics } from '@/lib/server/metrics';
import { EVENT_KIND_LABEL, monthLabel } from '@/lib/metrics';
import { StatTile } from '@/components/stat';
import { DailyBars, DailyLine } from '@/components/charts';
import { DemoToggle } from '@/components/demo-toggle';
import { Freshness } from '@/components/period-picker';
import { DemoChip } from '@/components/badges';
import { Chip, EmptyState, PageTitle, Panel, PanelHead } from '@/components/ui/core';
import { dateTimeKo, num, pct, won } from '@/lib/format';

export const metadata = { title: '운영 지표' };

export default async function AdminMetrics({ searchParams }: { searchParams: Promise<{ demo?: string }> }) {
  const sp = await searchParams;
  const include = sp.demo !== '0';
  const v = await requireViewer('admin');
  const today = todayKst();
  const m = await asUser(v, async (q) => adminMetrics(q, await loadSettings(q), today, include));
  const now = new Date().toISOString();
  const bill = m.billing.cur;
  return (
    <>
      <PageTitle
        title="운영 지표"
        sub={`최근 ${m.days}일 · 견적 요청 → 선택 → 선적 → 입고 → 청구 이벤트 기록에서 셉니다 · 화살표는 그 앞 ${m.days}일 대비`}
        actions={<><Freshness at={now} /><DemoToggle include={include} href={(x) => (x ? '/admin/metrics' : '/admin/metrics?demo=0')} /></>}
      />
      {m.totalEvents === 0 ? (
        <Panel className="mb-6">
          <EmptyState title="아직 쌓인 이벤트가 없습니다" body="견적 요청·응찰 선택·선적·청구가 일어나면 한 줄씩 쌓이고, 여기 숫자가 채워집니다." />
        </Panel>
      ) : null}
      <section aria-label="핵심 지표" className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7" data-testid="metrics-tiles">
        <StatTile label="월간 활성 셀러" value={m.activeSellers.cur} prev={m.activeSellers.prev} suffix="곳" hint="셀러가 걸린 이벤트가 있는 곳" />
        <StatTile label="관리 선적 수" value={m.managed.cur} prev={m.managed.prev} suffix="건" hint={`지금 진행 중 ${num(m.managed.inFlight)}건`} />
        <StatTile
          label="초대로 들어온 업체"
          value={m.invite.cur.ratio}
          prev={m.invite.prev.ratio}
          format="pct"
          good="up"
          hint={m.invite.cur.total ? `가입한 물류사 ${num(m.invite.cur.total)}곳 중 ${num(m.invite.cur.invited)}곳` : '이 기간 물류사 가입 없음'}
        />
        <StatTile label="재선적률" value={m.repeat.cur.rate} prev={m.repeat.prev.rate} format="pct" hint={`예약한 셀러 ${num(m.repeat.cur.sellers)}곳 중 ${num(m.repeat.cur.repeat)}곳`} />
        <StatTile label="견적 대비 청구 차이" value={bill.avgSigned} prev={m.billing.prev.avgSigned} format="pct" good="down" hint={bill.n ? `청구 ${num(bill.n)}건 · 절대값 평균 ${pct(bill.avgAbs, 1)}` : '청구 없음'} />
        <StatTile label="회송률" value={m.returns.cur.rate} prev={m.returns.prev.rate} format="pct" good="down" hint={`FC 입고 ${num(m.returns.cur.shipments)}건 중 회송 ${num(m.returns.cur.withReturn)}건`} />
        <StatTile label="선적당 매출(수수료 기준)" value={m.revenue.cur.perShipment} prev={m.revenue.prev.perShipment} format="won" hint={`요율 ${(m.revenue.rateBp / 100).toFixed(2)}% · 물류비 − 관세사 보수`} href="/admin/commission" />
      </section>
      <p className="mt-2 text-xs text-muted">초대로 들어온 업체 — 이 기간 가입한 물류사 중 화주의 거래처 초대 링크로 들어온 비율(초대는 물류사에게만 갑니다).</p>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Panel>
          <PanelHead title="월간 활성 셀러" sub="최근 6달 · 달마다 셀러가 걸린 이벤트가 있는 곳" />
          <div className="p-3"><DailyBars data={m.monthly.active.map((x) => ({ d: monthLabel(x.month), v: x.n }))} name="활성 셀러" height={180} /></div>
        </Panel>
        <Panel>
          <PanelHead title="관리 선적 수" sub="최근 6달 · 달마다 플랫폼에서 예약된 선적" />
          <div className="p-3"><DailyBars data={m.monthly.booked.map((x) => ({ d: monthLabel(x.month), v: x.n }))} name="선적" height={180} /></div>
        </Panel>
        <Panel>
          <PanelHead title="선적당 매출(수수료 기준)" sub="최근 6달 · 예약의 성사 수수료 ÷ 예약 수" />
          <div className="p-3"><DailyLine data={m.monthly.revenue.map((x) => ({ d: monthLabel(x.month), v: x.v }))} name="선적당 매출" f="won" height={180} /></div>
        </Panel>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[1fr_1fr]">
        <Panel>
          <PanelHead title="이벤트 흐름" sub={`최근 ${m.days}일 이벤트 수 · 앞 기간과 나란히`} />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[360px] text-sm tnum" data-testid="metrics-funnel">
              <thead className="bg-surface-2 text-xs text-muted">
                <tr>
                  <th scope="col" className="px-3 py-2 text-left font-semibold">이벤트</th>
                  <th scope="col" className="px-3 py-2 text-right font-semibold">최근 {m.days}일</th>
                  <th scope="col" className="px-3 py-2 text-right font-semibold">그 앞 {m.days}일</th>
                </tr>
              </thead>
              <tbody>
                {m.funnel.map((f) => (
                  <tr key={f.kind} className="border-t border-line-2">
                    <th scope="row" className="px-3 py-2 text-left font-semibold">{EVENT_KIND_LABEL[f.kind]}</th>
                    <td className="px-3 py-2 text-right">{num(f.cur)}</td>
                    <td className="px-3 py-2 text-right text-muted">{num(f.prev)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
        <Panel>
          <PanelHead title="최근 이벤트" sub="한 줄씩 쌓기만 합니다(고치거나 지우지 않음)" />
          {m.recent.length ? (
            <ul>
              {m.recent.map((e, i) => (
                <li key={i} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-line-2 px-4 py-2 text-sm last:border-0">
                  <span className="flex min-w-0 flex-wrap items-center gap-1.5">
                    <Chip tone="neutral">{EVENT_KIND_LABEL[e.kind]}</Chip>
                    <span className="min-w-0 break-keep">{e.org}{e.seller && e.seller !== e.org ? ` → ${e.seller}` : ''}</span>
                    {e.is_demo ? <DemoChip /> : null}
                  </span>
                  <span className="text-xs text-muted tnum">{dateTimeKo(e.occurred_at)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-4 py-6 text-sm text-muted">아직 이벤트가 없습니다.</p>
          )}
        </Panel>
      </div>
      <p className="mt-6 text-2xs text-muted">
        정의 — 월간 활성 셀러: 기간 안 셀러가 걸린 이벤트가 있는 곳 · 관리 선적: 플랫폼에서 예약된 선적 · 재선적률: 기간 안 예약한 셀러 중 그 전에도 예약한 적이 있는 곳 ·
        견적 대비 청구 차이: 선적마다 최신 청구서 합계와 고른 응찰 합계의 차이 ÷ 응찰 합계의 평균 · 회송률: FC 입고 선적의 회송 수량 ÷ 선적 수량 · 선적당 매출: 성사 수수료(물류비 − 관세사 보수) × 요율 ÷ 예약 수. 1차에는 대금을 받지 않아 수수료는 기준 매출입니다. 예: {won(1_000_000)} 기준 × {(m.revenue.rateBp / 100).toFixed(2)}%.
      </p>
    </>
  );
}
