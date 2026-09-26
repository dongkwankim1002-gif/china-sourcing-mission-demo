import Link from 'next/link';
import { env } from '@/lib/env';
import { requireViewer } from '@/lib/server/viewer';
import { loadSalesView, parsePeriod } from '@/lib/server/sales';
import { SalesFrame } from '@/components/sales/frame';
import { StatTile } from '@/components/stat';
import { DailyBars, DailyLine } from '@/components/charts';
import { Chip, Panel, PanelHead } from '@/components/ui/core';
import { dateKo, num, won } from '@/lib/format';

export const metadata = { title: '판매 분석' };

const bp = (v: number | null) => (v == null ? null : v / 10_000);

export default async function SalesOverview({ searchParams }: { searchParams: Promise<{ p?: string; by?: string }> }) {
  const sp = await searchParams;
  const v = await requireViewer('app');
  const view = await loadSalesView(v, parsePeriod(sp.p), env.wingEnabled);
  const a = view.analysis;
  const by = sp.by === 'month' ? 'month' : 'week';
  const trend = (by === 'month' ? a.monthly : a.weekly).map((x) => ({ d: by === 'month' ? `${Number(x.d.slice(5, 7))}월` : x.d.slice(5).replace('-', '/'), v: x.amount }));
  const soon = a.products.filter((p) => p.reorderState === 'late' || p.reorderState === 'soon').slice(0, 5);
  const days = view.periodDays;
  return (
    <SalesFrame view={view} active="/app/sales" title="판매 분석" sub={`최근 ${days}일(${dateKo(a.period.cur.from, { dow: false })} ~ ${dateKo(a.period.cur.to, { dow: false })}) · 지난 ${days}일과 비교`}>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="sales-tiles">
        <StatTile label="매출(부가세 포함)" value={a.totals.amount} prev={a.totals.prevAmount} format="won" trend={a.daily.slice(-days).map((x) => x.amount)} />
        <StatTile label="판매량" value={a.totals.units} prev={a.totals.prevUnits} suffix="개" trend={a.daily.slice(-days).map((x) => x.units)} />
        <StatTile label="추정 순이익" value={a.profit.cur} prev={a.profit.prev} format="won" hint={a.profit.excluded ? `원가 없는 상품 ${a.profit.excluded}개 뺌` : '도착원가·수수료 뺀 값'} />
        <StatTile label="반품률" value={bp(a.returnRate.curBp)} prev={bp(a.returnRate.prevBp)} format="pct" good="down" />
      </div>
      <p className="mt-2 text-2xs text-muted">
        추정 순이익 = 상품별 (부가세 뺀 실판매가 − 쿠팡 수수료·광고 − 개당 도착원가 − 로켓그로스 비용) × 판매량. 쿠팡 비용은 {view.fee.example ? '예시 기준값' : '확인한 기준값'}
        {view.fee.checkedOn ? `(확인일 ${view.fee.checkedOn})` : '(확인일 없음)'} · 관세는 참고 추정 · 정산 대조는 {view.settlementsVerified ? `${view.settlementsVerified}건` : '아직 없음(정산 API 확인 필요)'}.
      </p>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <Panel aria-labelledby="sd-h">
          <PanelHead id="sd-h" title="일별 매출" sub={`최근 ${a.daily.length}일`} />
          <div className="p-3">
            <DailyBars data={a.daily.map((x) => ({ d: x.d.slice(5).replace('-', '/'), v: x.amount }))} f="won" name="매출" />
          </div>
        </Panel>
        <Panel aria-labelledby="st-h">
          <PanelHead
            id="st-h"
            title={by === 'month' ? '월별 추이' : '주별 추이'}
            sub={a.firstDay ? `${dateKo(a.firstDay, { dow: false })}부터` : undefined}
            action={
              <div className="inline-flex rounded-sm border border-line p-0.5 text-xs font-semibold" role="group" aria-label="묶음">
                {(['week', 'month'] as const).map((k) => (
                  <Link key={k} href={`/app/sales?${new URLSearchParams({ ...(sp.p ? { p: sp.p } : {}), by: k })}`} aria-current={by === k ? 'true' : undefined} className={by === k ? 'rounded-[4px] bg-ink px-2 py-1 text-on-ink' : 'px-2 py-1 text-muted hover:text-text'}>
                    {k === 'week' ? '주' : '월'}
                  </Link>
                ))}
              </div>
            }
          />
          <div className="p-3">
            <DailyLine data={trend} f="won" name={by === 'month' ? '월 매출' : '주 매출'} area />
          </div>
        </Panel>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <Panel aria-labelledby="stop-h">
          <PanelHead id="stop-h" title="매출 상위" action={<Link className="text-xs font-semibold hover:underline" href="/app/sales/products">상품별 전체</Link>} />
          <ol className="divide-y divide-line-2">
            {a.products.slice(0, 5).map((p) => (
              <li key={p.ext} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-4 py-2 text-sm">
                <span className="flex min-w-0 items-center gap-2">
                  <span className="w-5 shrink-0 text-xs text-muted tnum">{p.rank}</span>
                  <Chip tone={p.abc === 'A' ? 'ink' : p.abc === 'B' ? 'info' : 'neutral'}>{p.abc}</Chip>
                  <span className="min-w-0 truncate font-semibold">{p.name}</span>
                </span>
                <span className="text-xs text-muted tnum">
                  {won(p.amount)} · {num(p.units)}개
                </span>
              </li>
            ))}
          </ol>
        </Panel>
        <Panel aria-labelledby="ssoon-h">
          <PanelHead id="ssoon-h" title="재입고 챙길 상품" sub={`권장일이 지났거나 ${view.rules.lowStockDays}일 안`} />
          {soon.length ? (
            <ul className="divide-y divide-line-2" data-testid="sales-reorder-soon">
              {soon.map((p) => (
                <li key={p.ext} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-4 py-2 text-sm">
                  <span className="min-w-0 truncate font-semibold">{p.name}</span>
                  <span className="flex items-center gap-2 text-xs tnum">
                    {p.reorderState === 'late' ? <Chip tone="stamp">늦음</Chip> : <Chip tone="caution">곧</Chip>}
                    권장일 {p.reorder ? dateKo(p.reorder, { dow: false }) : '—'} · 품절 {p.stockout ? dateKo(p.stockout, { dow: false }) : '—'}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-4 py-4 text-sm text-muted">지금 서둘러 들여올 상품이 없습니다.</p>
          )}
        </Panel>
      </div>
    </SalesFrame>
  );
}
