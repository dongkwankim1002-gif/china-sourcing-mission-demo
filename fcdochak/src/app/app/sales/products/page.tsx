import Link from 'next/link';
import { env } from '@/lib/env';
import { requireViewer } from '@/lib/server/viewer';
import { loadSalesView, parsePeriod } from '@/lib/server/sales';
import { SalesFrame } from '@/components/sales/frame';
import { Button, Chip, Panel, PanelHead, type Tone } from '@/components/ui/core';
import { dateKo, num, won } from '@/lib/format';
import { quoteRequestHref } from '@/lib/sales/quote-link';
import { SALES_ACTION } from '@/lib/terms';
import type { ReorderState } from '@/lib/money/sales';

export const metadata = { title: '판매 분석 · 상품별' };

const STATE: Record<ReorderState, { tone: Tone; label: string }> = {
  late: { tone: 'stamp', label: '늦음' },
  soon: { tone: 'caution', label: '곧' },
  ok: { tone: 'ok', label: '여유' },
  none: { tone: 'neutral', label: '판매 없음' },
};
const ABC_TONE: Record<'A' | 'B' | 'C', Tone> = { A: 'ink', B: 'info', C: 'neutral' };

export default async function SalesProducts({ searchParams }: { searchParams: Promise<{ p?: string }> }) {
  const sp = await searchParams;
  const v = await requireViewer('app');
  const view = await loadSalesView(v, parsePeriod(sp.p), env.wingEnabled);
  const a = view.analysis;
  const r = view.rules;
  return (
    <SalesFrame view={view} active="/app/sales/products" title="상품별" sub={`매출 순위 · ABC · 판매 속도(최근 ${r.velocityDays}일 평균) · 재고 일수 · 품절 예상일 · 재입고 권장일`}>
      <Panel aria-labelledby="sp-h">
        <PanelHead
          id="sp-h"
          title={`상품 ${a.products.length}개`}
          sub={`ABC = 누적 매출 ${r.abcABp / 100}% 까지 A · ${r.abcBBp / 100}% 까지 B · 나머지 C. 재입고 권장일 = 품절 예상일 − (구간 시세 운송일 + 준비 ${r.prepDays}일).`}
        />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] text-sm [&_.tnum]:whitespace-nowrap [&_th]:whitespace-nowrap" data-testid="sales-products">
            <thead className="bg-surface-2 text-left text-2xs font-semibold text-muted">
              <tr>
                <th className="px-3 py-2">순위</th>
                <th className="px-3 py-2">상품</th>
                <th className="px-3 py-2 text-right">매출</th>
                <th className="px-3 py-2 text-right">판매량</th>
                <th className="px-3 py-2 text-right">하루 판매</th>
                <th className="px-3 py-2 text-right">재고</th>
                <th className="px-3 py-2 text-right">재고 일수</th>
                <th className="px-3 py-2">품절 예상</th>
                <th className="px-3 py-2">재입고 권장</th>
                <th className="px-3 py-2 text-right">권장 수량</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-line-2">
              {a.products.map((p) => {
                const cargo = view.skuCargo[p.ext];
                const st = STATE[p.reorderState];
                return (
                  <tr key={p.ext} data-testid="sales-product" data-abc={p.abc}>
                    <td className="px-3 py-2 tnum">
                      <span className="flex items-center gap-1.5">
                        {p.rank}
                        <Chip tone={ABC_TONE[p.abc]}>{p.abc}</Chip>
                      </span>
                    </td>
                    <td className="max-w-[260px] px-3 py-2">
                      <p className="truncate font-semibold">{p.name}</p>
                      <p className="text-2xs text-muted">
                        <span className="font-mono">{p.ext}</span>
                        {p.optionName ? ` · ${p.optionName}` : ''}
                      </p>
                    </td>
                    <td className="px-3 py-2 text-right tnum">
                      {won(p.amount)}
                      {p.changeBp != null ? <span className={`block text-2xs ${p.changeBp >= 0 ? 'text-ok' : 'text-stamp'}`}>{p.changeBp >= 0 ? '▲' : '▼'} {Math.abs(p.changeBp / 100).toFixed(0)}%</span> : null}
                    </td>
                    <td className="px-3 py-2 text-right tnum">{num(p.units)}</td>
                    <td className="px-3 py-2 text-right tnum">{num(p.perDay, 2)}개</td>
                    <td className="px-3 py-2 text-right tnum">{p.onHand == null ? '—' : num(p.onHand)}</td>
                    <td className="px-3 py-2 text-right tnum">{p.daysOfStock == null ? '—' : `${num(p.daysOfStock)}일`}</td>
                    <td className="px-3 py-2 tnum">{p.stockout ? dateKo(p.stockout, { dow: false }) : '—'}</td>
                    <td className="px-3 py-2 tnum">
                      <span className="flex flex-wrap items-center gap-1.5">
                        <Chip tone={st.tone}>{st.label}</Chip>
                        {p.reorder ? dateKo(p.reorder, { dow: false }) : ''}
                      </span>
                      {p.transit ? (
                        <span className="block text-2xs text-muted">
                          운송 {p.transit.days}일({p.transit.basis === 'market' ? '구간 시세' : '방식 기준'} {p.transit.lane}) + 준비 {r.prepDays}일
                        </span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 text-right tnum">{p.suggestUnits ? `${num(p.suggestUnits)}개` : '—'}</td>
                    <td className="px-3 py-2 text-right">
                      {cargo && !view.preview ? (
                        <Button asChild size="sm" variant={p.reorderState === 'late' || p.reorderState === 'soon' ? 'primary' : 'secondary'}>
                          <Link href={quoteRequestHref(cargo, p.suggestUnits)} data-testid="sales-quote-link">
                            {SALES_ACTION.quote}
                          </Link>
                        </Button>
                      ) : (
                        <span className="text-2xs text-muted">{view.preview ? '예시' : 'SKU 연결 필요'}</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="border-t border-line-2 px-4 py-3 text-2xs text-muted">
          권장 수량 = 하루 판매 × (운송 + 준비 + {r.coverDays}일) − 지금 재고, {r.roundUnits}개 단위 올림. 「{SALES_ACTION.quote}」는 이 수량으로 SKU 의 박스·무게·부피를 늘려 견적 요청 화면에 채워 넘깁니다(올리기 전에 고칠 수 있습니다). 판매 속도는 품절이던 날도 0 으로 세어 보수적입니다.
        </p>
      </Panel>
    </SalesFrame>
  );
}
