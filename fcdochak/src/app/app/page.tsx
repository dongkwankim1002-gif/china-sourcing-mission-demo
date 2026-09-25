import Link from 'next/link';
import { AlertTriangle, ArrowRight, Clock, MessageSquareText, Scale } from 'lucide-react';
import { asUser } from '@/lib/db';
import { requireViewer } from '@/lib/server/viewer';
import { shipperDashboard, shortDay } from '@/lib/server/shipper';
import { StatTile } from '@/components/stat';
import { DailyBars } from '@/components/charts';
import { Freshness, PeriodPicker } from '@/components/period-picker';
import { ExceptionChip, StageTrack, Won } from '@/components/badges';
import { Button, EmptyState, PageTitle, Panel, PanelHead } from '@/components/ui/core';
import { dateKo, pct } from '@/lib/format';
import { ACTION, EXCEPTION_LABEL, STAGES } from '@/lib/terms';

export const metadata = { title: '대시보드' };

export default async function ShipperDashboard({ searchParams }: { searchParams: Promise<{ p?: string; welcome?: string }> }) {
  const sp = await searchParams;
  const period = [7, 30, 90].includes(Number(sp.p)) ? Number(sp.p) : 30;
  const v = await requireViewer('app');
  const d = await asUser(v, (q) => shipperDashboard(q, v.org.id, period));
  const now = new Date().toISOString();
  const nothing = d.spend === 0 && d.counts.active === 0 && d.counts.open_reqs === 0 && d.shipments.length === 0;

  return (
    <>
      <PageTitle
        title="대시보드"
        sub={`${v.org.name} · ${dateKo(now)}`}
        actions={
          <>
            <Freshness at={now} />
            <PeriodPicker value={period} />
            <Button asChild variant="primary">
              <Link href="/app/requests/new">{ACTION.newRequest}</Link>
            </Button>
          </>
        }
      />
      {sp.welcome ? (
        <div className="mb-4 rounded-md border border-label bg-label/15 p-4 text-sm">
          <b>가입을 마쳤습니다.</b> 먼저 <Link className="font-semibold underline" href="/app/compare">같은 조건 비교</Link>로 시세를 보고, 마음에 드는 곳이 있으면 견적 요청을 올려 응찰을 받으세요.
        </div>
      ) : null}

      <section aria-label="지표" className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        <StatTile label="이번 달 물류비" value={d.month.cur} prev={d.month.prev} format="won" good="none" trend={d.spendSeries.map((x) => x.v)} />
        <StatTile label={`개당 평균 · ${period}일`} value={d.perUnit} prev={d.perUnitPrev} format="won" good="down" suffix="" />
        <StatTile label="진행 선적" value={d.counts.active} suffix="건" hint={d.counts.exceptions ? `예외 ${d.counts.exceptions}건` : '예외 없음'} href="/app/shipments?stage=active" />
        <StatTile label="응찰 받는 요청" value={d.counts.open_reqs} suffix="건" hint={d.counts.closing ? `마감 임박 ${d.counts.closing}건` : undefined} href="/app/requests?status=bidding" />
        <StatTile label={`평균 청구 편차 · ${period}일`} value={d.devCur} prev={d.devPrev} format="pct" good="down" trend={d.devSeries} />
        <StatTile label="평가 대기" value={d.counts.review_wait} suffix="건" hint="FC 입고 끝난 선적" href="/app/shipments?review=wait" />
      </section>

      {nothing ? (
        <Panel className="mt-6">
          <EmptyState
            icon={<Scale />}
            title="아직 진행 중인 선적이 없습니다"
            body="화물 조건을 넣고 같은 조건으로 비교해 보세요. 마음에 드는 곳이 있으면 견적 요청을 올려 응찰을 받습니다."
            action={
              <>
                <Button asChild variant="primary"><Link href="/app/compare">{ACTION.compare}</Link></Button>
                <Button asChild variant="secondary"><Link href="/app/skus?new=1">{ACTION.saveSku}</Link></Button>
              </>
            }
          />
        </Panel>
      ) : (
        <div className="mt-6 grid gap-6 xl:grid-cols-[1fr_380px]">
          <Panel>
            <PanelHead title={`일별 물류비 · 최근 ${period}일`} sub="예약으로 전환한 응찰 합계" />
            <div className="p-4">
              <DailyBars data={d.spendSeries.map((x) => ({ d: shortDay(x.d), v: x.v }))} f="won" name="물류비" />
            </div>
          </Panel>
          <Panel>
            <PanelHead title="할 일" sub="지금 손이 가야 하는 것" />
            {d.todo.length ? (
              <ul>
                {d.todo.map((t) => {
                  const [ek, en] = t.kind === 'exception' ? t.sub.split(':') : [null, null];
                  return (
                    <li key={t.kind + t.id} className="border-b border-line-2 last:border-0">
                      <Link href={t.href} className="flex items-start gap-3 px-4 py-3 hover:bg-surface-2">
                        {t.kind === 'exception' ? <AlertTriangle className="mt-0.5 size-4 text-stamp" aria-hidden /> : t.kind === 'closing' ? <Clock className="mt-0.5 size-4 text-caution" aria-hidden /> : t.kind === 'review' ? <MessageSquareText className="mt-0.5 size-4 text-muted" aria-hidden /> : <Scale className="mt-0.5 size-4 text-ok" aria-hidden />}
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-semibold">
                            {t.kind === 'comparable' ? '응찰 비교 가능' : t.kind === 'closing' ? '마감 임박' : t.kind === 'exception' ? EXCEPTION_LABEL[ek ?? ''] ?? '예외' : '평가 대기'} · <span className="tnum">{t.title}</span>
                          </span>
                          <span className="block truncate text-xs text-muted">{en ?? t.sub}</span>
                        </span>
                        <ArrowRight className="mt-0.5 size-4 text-muted" aria-hidden />
                      </Link>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <EmptyState title="지금 할 일이 없습니다" body="응찰이 오거나 예외가 생기면 여기에 뜹니다." />
            )}
          </Panel>
          <Panel className="xl:col-span-2">
            <PanelHead title="진행 선적" action={<Button asChild size="sm" variant="secondary"><Link href="/app/shipments">모두 보기</Link></Button>} />
            {d.shipments.length ? (
              <ul>
                {d.shipments.map((s) => (
                  <li key={s.id} className="border-b border-line-2 last:border-0">
                    <Link href={`/app/shipments/${s.id}`} className="grid gap-2 px-4 py-3 hover:bg-surface-2 lg:grid-cols-[160px_minmax(0,1fr)_200px_110px] lg:items-center">
                      <span>
                        <span className="block text-sm font-bold tnum">{s.shipment_no}</span>
                        <span className="block truncate text-xs text-muted">{s.partner_name}</span>
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-sm">{s.title}</span>
                        <span className="mt-1 flex flex-wrap items-center gap-2">
                          <StageTrack stage={s.stage} compact />
                          <span className="text-xs text-muted">{s.stage}. {STAGES[s.stage]}</span>
                          {(s.exception_kinds ?? []).map((k) => <ExceptionChip key={k} kind={k} />)}
                        </span>
                      </span>
                      <span className="text-xs text-muted">{s.fc_name} · 도착 예정 {dateKo(s.eta_fc, { dow: false })}</span>
                      <Won v={s.bid_total} short className="text-right text-sm font-bold" />
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState title="진행 중인 선적이 없습니다" />
            )}
          </Panel>
        </div>
      )}
      <p className="mt-6 text-2xs text-muted">청구 편차 = (청구 합계 − 응찰 합계) ÷ 응찰 합계. {d.devCur != null ? `이번 기간 ${pct(d.devCur, 1, true)}.` : ''}</p>
    </>
  );
}
