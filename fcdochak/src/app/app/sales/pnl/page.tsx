import Link from 'next/link';
import { env } from '@/lib/env';
import { requireViewer } from '@/lib/server/viewer';
import { loadSalesView, parsePeriod } from '@/lib/server/sales';
import { SalesFrame, basisChip } from '@/components/sales/frame';
import { Chip, Panel, PanelHead } from '@/components/ui/core';
import { num, won } from '@/lib/format';
import { basisLabel } from '@/lib/tools-settings';

export const metadata = { title: '판매 분석 · 손익' };

export default async function SalesPnl({ searchParams }: { searchParams: Promise<{ p?: string }> }) {
  const sp = await searchParams;
  const v = await requireViewer('app');
  const view = await loadSalesView(v, parsePeriod(sp.p), env.wingEnabled);
  const a = view.analysis;
  const f = view.fee;
  const rows = [...a.products].sort((x, y) => (x.pnl?.profit ?? Number.POSITIVE_INFINITY) - (y.pnl?.profit ?? Number.POSITIVE_INFINITY));
  return (
    <SalesFrame view={view} active="/app/sales/pnl" title="손익" sub="SKU 개당 도착원가(실제 선적·청구 → 없으면 구간 시세) → 쿠팡 수수료 → 실제 마진">
      {a.lossCount ? (
        <p className="mb-4 rounded-md border border-stamp/40 bg-stamp-bg px-4 py-3 text-sm font-semibold text-stamp" role="status" data-testid="sales-loss-alert">
          적자 SKU {a.lossCount}개 — 팔수록 손해입니다. 판매가·물류 구간·광고비를 다시 보세요.
        </p>
      ) : null}
      <Panel aria-labelledby="pp-h">
        <PanelHead
          id="pp-h"
          title="SKU 개당 손익"
          sub={`쿠팡 판매 수수료 ${num(f.saleFeeBp / 100, 2)}% · 광고 ${num(f.adBp / 100, 2)}% · 로켓그로스 입출고 ${won(f.rgInboundPerUnit)} + 배송 ${won(f.rgShippingPerUnit)} (${basisLabel(f)}) · 관세는 참고 추정`}
          action={
            <Link className="text-xs font-semibold hover:underline" href="/app/pnl">
              판매손익 계산기
            </Link>
          }
        />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[960px] text-sm [&_.tnum]:whitespace-nowrap [&_th]:whitespace-nowrap" data-testid="sales-pnl">
            <thead className="bg-surface-2 text-left text-2xs font-semibold text-muted">
              <tr>
                <th className="px-3 py-2">상품</th>
                <th className="px-3 py-2 text-right">실판매가</th>
                <th className="px-3 py-2">원가 근거</th>
                <th className="px-3 py-2 text-right">상품</th>
                <th className="px-3 py-2 text-right">물류(9구간)</th>
                <th className="px-3 py-2 text-right">관세</th>
                <th className="px-3 py-2 text-right">쿠팡 비용</th>
                <th className="px-3 py-2 text-right">개당 이익</th>
                <th className="px-3 py-2 text-right">마진</th>
                <th className="px-3 py-2 text-right">기간 이익</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line-2">
              {rows.map((p) => {
                const loss = !!p.pnl && p.pnl.profit < 0;
                const coupang = p.pnl ? p.pnl.saleFee + f.rgInboundPerUnit + f.rgShippingPerUnit : null;
                return (
                  <tr key={p.ext} data-testid="sales-pnl-row" data-loss={loss ? '1' : '0'} className={loss ? 'bg-stamp-bg/40' : undefined}>
                    <td className="max-w-[240px] px-3 py-2">
                      <p className="flex items-center gap-1.5 font-semibold">
                        <span className="truncate">{p.name}</span>
                        {loss ? <Chip tone="stamp">적자</Chip> : null}
                      </p>
                      <p className="text-2xs text-muted tnum">{num(p.units)}개 판매</p>
                    </td>
                    <td className="px-3 py-2 text-right tnum">{won(p.avgPrice)}</td>
                    <td className="px-3 py-2">{basisChip(p.arrival.basis, p.arrival.samples)}</td>
                    <td className="px-3 py-2 text-right tnum">{p.arrival.basis === 'none' ? '—' : won(p.arrival.goodsPerUnit)}</td>
                    <td className="px-3 py-2 text-right tnum">{p.arrival.basis === 'none' ? '—' : won(p.arrival.logisticsPerUnit)}</td>
                    <td className="px-3 py-2 text-right tnum">{p.arrival.basis === 'none' ? '—' : won(p.arrival.dutyPerUnit)}</td>
                    <td className="px-3 py-2 text-right tnum">{won(coupang)}</td>
                    <td className={`px-3 py-2 text-right font-semibold tnum ${loss ? 'text-stamp' : ''}`}>{p.pnl ? won(p.pnl.profit) : '—'}</td>
                    <td className="px-3 py-2 text-right tnum">{p.pnl ? `${num(p.pnl.marginBp / 100, 1)}%` : '—'}</td>
                    <td className={`px-3 py-2 text-right tnum ${loss ? 'text-stamp' : ''}`}>{p.periodProfit == null ? '—' : won(p.periodProfit)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="grid gap-1 border-t border-line-2 px-4 py-3 text-2xs text-muted">
          <p>개당 이익 = 부가세 뺀 실판매가 − 쿠팡 판매 수수료·광고(부가세 포함 판매가 기준) − (상품 + 물류 + 관세) − 로켓그로스 비용 — 판매손익 계산기와 같은 식입니다.</p>
          <p>「실제 N건」 = 이 SKU 로 올린 견적 요청의 선적 최근 {view.rules.actualShipments}건(청구서 현재 판, 없으면 고른 응찰) · 「구간 시세」 = 같은 화물로 비교한 업체들의 9구간 합계 중간값.</p>
          <p>
            정산: 쿠팡 정산 API 의 응답 모양(로켓그로스 포함 여부)은 <b>확인 필요</b>합니다. 확인 전에는 위 기준값으로 수수료를 추정하고, 정산과 맞춰 본 기록은{' '}
            {view.settlementsVerified ? `${view.settlementsVerified}건` : '아직 없습니다'}.
          </p>
        </div>
      </Panel>
    </SalesFrame>
  );
}
