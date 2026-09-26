import { env } from '@/lib/env';
import { requireViewer } from '@/lib/server/viewer';
import { loadSalesView, parsePeriod } from '@/lib/server/sales';
import { SalesFrame } from '@/components/sales/frame';
import { DailyBars } from '@/components/charts';
import { Chip, Panel, PanelHead } from '@/components/ui/core';
import { num } from '@/lib/format';
import { SALES_RETURN_REASON_LABEL } from '@/lib/terms';

export const metadata = { title: '판매 분석 · 반품' };

const rate = (bp: number | null) => (bp == null ? '—' : `${(bp / 100).toFixed(1)}%`);

export default async function SalesReturns({ searchParams }: { searchParams: Promise<{ p?: string }> }) {
  const sp = await searchParams;
  const v = await requireViewer('app');
  const view = await loadSalesView(v, parsePeriod(sp.p), env.wingEnabled);
  const a = view.analysis;
  const rows = [...a.products].sort((x, y) => (y.returnRateBp ?? -1) - (x.returnRateBp ?? -1));
  const max = Math.max(1, ...a.reasons.map((r) => r.units));
  return (
    <SalesFrame view={view} active="/app/sales/returns" title="반품" sub={`최근 ${view.periodDays}일 반품률 ${rate(a.returnRate.curBp)} · 지난 기간 ${rate(a.returnRate.prevBp)}`}>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Panel aria-labelledby="rr-h">
          <PanelHead id="rr-h" title="상품별 반품률" sub="반품 수량 ÷ 판매 수량(같은 기간)" />
          <ul className="divide-y divide-line-2" data-testid="sales-returns">
            {rows.map((p) => (
              <li key={p.ext} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 px-4 py-2 text-sm">
                <span className="min-w-0 truncate font-semibold">{p.name}</span>
                <span className="flex items-center gap-2 text-xs tnum">
                  {p.returnRateBp != null && p.returnRateBp >= 500 ? <Chip tone="caution">높음</Chip> : null}
                  <b>{rate(p.returnRateBp)}</b>
                  <span className="text-muted">
                    {num(p.returned)} / {num(p.units)}개
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </Panel>
        <Panel aria-labelledby="rs-h">
          <PanelHead id="rs-h" title="반품 사유" sub="우리 분류 — 쿠팡 사유 코드와의 대응은 확인 필요" />
          {a.reasons.length ? (
            <ol className="grid gap-2 p-4" data-testid="sales-reasons">
              {a.reasons.map((r) => (
                <li key={r.reason} className="grid gap-1 text-xs">
                  <span className="flex justify-between gap-2">
                    <span className="font-semibold">{SALES_RETURN_REASON_LABEL[r.reason]}</span>
                    <span className="text-muted tnum">
                      {num(r.units)}개 · {(r.shareBp / 100).toFixed(0)}%
                    </span>
                  </span>
                  <span className="h-2 rounded-xs bg-surface-2">
                    <span className="block h-2 rounded-xs bg-[var(--chart-1)]" style={{ width: `${(r.units / max) * 100}%` }} />
                  </span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="px-4 py-4 text-sm text-muted">이 기간 반품이 없습니다.</p>
          )}
        </Panel>
      </div>
      <Panel aria-labelledby="rw-h" className="mt-4">
        <PanelHead id="rw-h" title="주별 반품 수량" />
        <div className="p-3">
          <DailyBars data={a.returnsWeekly.map((x) => ({ d: x.d.slice(5).replace('-', '/'), v: x.units }))} name="반품" />
        </div>
      </Panel>
      <p className="mt-2 text-2xs text-muted">로켓그로스 반품 조회 API 는 찾지 못했습니다(확인 필요). 연동이 켜지기 전에는 데모 예시만 보입니다.</p>
    </SalesFrame>
  );
}
