import Link from 'next/link';
import { env } from '@/lib/env';
import { requireViewer } from '@/lib/server/viewer';
import { loadSalesView, parsePeriod } from '@/lib/server/sales';
import { SalesFrame } from '@/components/sales/frame';
import { DailyBars } from '@/components/charts';
import { Chip, EmptyState, Panel, PanelHead } from '@/components/ui/core';
import { dateKo, num } from '@/lib/format';

export const metadata = { title: '판매 분석 · 입고 성과' };

/** 선적별 목록에 먼저 보이는 줄 수 — 나머지는 접어 둔다 */
const SHOW = 20;

export default async function SalesInbound({ searchParams }: { searchParams: Promise<{ p?: string }> }) {
  const sp = await searchParams;
  const v = await requireViewer('app');
  const view = await loadSalesView(v, parsePeriod(sp.p), env.wingEnabled);
  const a = view.analysis;
  const byPartner = new Map<string, number[]>();
  for (const x of a.inbound) if (x.reflectDays != null) (byPartner.get(x.partner) ?? byPartner.set(x.partner, []).get(x.partner)!).push(x.reflectDays);
  const partners = [...byPartner.entries()].map(([name, d]) => ({ name, n: d.length, avg: Math.round((d.reduce((s, x) => s + x, 0) / d.length) * 10) / 10 })).sort((x, y) => x.avg - y.avg);
  const row = (x: (typeof a.inbound)[number]) => (
    <li key={x.shipmentId} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-4 py-2 text-sm">
      <span className="min-w-0">
        <Link className="font-semibold hover:underline" href={`/app/shipments/${x.shipmentId}`}>
          {x.shipmentNo}
        </Link>
        <span className="block truncate text-2xs text-muted">
          {x.productName} · {x.partner} · {num(x.units)}개
        </span>
      </span>
      <span className="flex items-center gap-2 text-xs tnum">
        FC 입고 {dateKo(x.deliveredOn, { dow: false })}
        {x.reflectDays == null ? <Chip tone="neutral">반영 못 찾음</Chip> : <Chip tone={x.reflectDays <= 2 ? 'ok' : x.reflectDays <= 4 ? 'info' : 'caution'}>{x.reflectDays}일</Chip>}
      </span>
    </li>
  );
  return (
    <SalesFrame
      view={view}
      active="/app/sales/inbound"
      title="입고 성과"
      sub={`FC도착 선적이 FC 에 입고된 날 → 쿠팡 재고에 그 수량의 ${view.rules.inboundReflectBp / 100}% 이상이 반영된 첫날까지`}
    >
      {a.inbound.length ? (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3">
            <div className="rounded-md border border-line bg-surface p-4">
              <p className="text-xs font-semibold text-muted">반영까지 중간값</p>
              <p className="display mt-1.5 text-[26px] leading-none tnum" data-testid="sales-inbound-median">
                {a.inboundMedianDays == null ? '—' : `${a.inboundMedianDays}일`}
              </p>
            </div>
            <div className="rounded-md border border-line bg-surface p-4">
              <p className="text-xs font-semibold text-muted">반영까지 평균</p>
              <p className="display mt-1.5 text-[26px] leading-none tnum" data-testid="sales-inbound-avg">
                {a.inboundAvgDays == null ? '—' : `${a.inboundAvgDays}일`}
              </p>
            </div>
            <div className="col-span-2 rounded-md border border-line bg-surface p-4 md:col-span-1">
              <p className="text-xs font-semibold text-muted">입고 끝난 선적</p>
              <p className="display mt-1.5 text-[26px] leading-none tnum">{num(a.inbound.length)}건</p>
            </div>
          </div>
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
            <Panel aria-labelledby="ib-h">
              <PanelHead id="ib-h" title="선적별" />
              <ul className="divide-y divide-line-2" data-testid="sales-inbound">
                {a.inbound.slice(0, SHOW).map(row)}
              </ul>
              {a.inbound.length > SHOW ? (
                <details className="border-t border-line-2">
                  <summary className="cursor-pointer px-4 py-2.5 text-sm font-semibold text-muted hover:text-text">나머지 {num(a.inbound.length - SHOW)}건 더 보기</summary>
                  <ul className="divide-y divide-line-2 border-t border-line-2">{a.inbound.slice(SHOW).map(row)}</ul>
                </details>
              ) : null}
            </Panel>
            <Panel aria-labelledby="ip-h">
              <PanelHead id="ip-h" title="물류사별 평균" sub="반영을 찾은 선적만" />
              {partners.length ? (
                <div className="p-3">
                  <DailyBars data={partners.map((p) => ({ d: p.name, v: p.avg }))} name="반영까지(일)" height={180} intTicks />
                  <ul className="mt-2 grid gap-1 text-xs">
                    {partners.map((p) => (
                      <li key={p.name} className="flex justify-between gap-2">
                        <span className="truncate">{p.name}</span>
                        <span className="text-muted tnum">
                          평균 {p.avg}일 · {p.n}건
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <p className="px-4 py-4 text-sm text-muted">아직 없습니다.</p>
              )}
            </Panel>
          </div>
          <p className="mt-2 text-2xs text-muted">한 상품에 입고가 몰리면 재고 증가를 먼저 들어온 입고부터 차례로 나눠 셉니다(선입선출). 쿠팡 재고 스냅숏이 하루 한 번이라 하루 단위로 셉니다. 추천 점수에는 아직 넣지 않았습니다(다음 단계).</p>
        </>
      ) : (
        <Panel>
          <EmptyState
            title={view.preview ? '예시에는 FC도착 선적이 없습니다' : '입고 끝난 선적이 아직 없습니다'}
            body="판매 기록의 상품을 저장한 SKU 와 잇고(상품별 화면의 「SKU 잇기」), 그 SKU 로 올린 견적 요청이 선적돼 FC 에 입고되면 여기에 보입니다."
            action={
              view.preview ? undefined : (
                <Link className="text-sm font-semibold underline underline-offset-4" href="/app/sales/products">
                  상품별 화면에서 SKU 잇기
                </Link>
              )
            }
          />
        </Panel>
      )}
    </SalesFrame>
  );
}
