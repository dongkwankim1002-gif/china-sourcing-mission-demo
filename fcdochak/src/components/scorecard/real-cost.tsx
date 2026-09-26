/**
 * 비교 화면의 「실질 비용」 칸(v2 6차 scorecard) — 견적가 + 예상 지연 비용, 「평소」·「늦을 때」 두 값.
 * 식은 src/lib/money/realcost.ts(순수 함수). 판매량·마진은 GET 폼(셀러가 넣는 값) — 저장하지 않는다.
 */
import Link from 'next/link';
import { Info } from 'lucide-react';
import { Button, Field, Input, Panel, PanelHead } from '@/components/ui/core';
import type { RealCostResult } from '@/lib/money';
import { won } from '@/lib/format';

export function RealCostPanel({
  hidden,
  perDay,
  margin,
  basis,
  baseline,
  portName,
  rows,
  sortHref,
}: {
  hidden: [string, string][];
  perDay: number | null;
  margin: number | null;
  basis: 'input' | 'sales' | null;
  baseline: { days: number; basis: 'fastest' | 'overall' } | null;
  portName: string;
  rows: { id: string; name: string; mode: string; quote: number; real: RealCostResult | null }[];
  /** 「실질 비용순으로 보기」 주소(이미 그 순서면 null) */
  sortHref?: string | null;
}) {
  const measured = rows.filter((r) => r.real?.usual);
  return (
    <Panel className="mt-3" data-testid="real-cost-panel">
      <PanelHead
        title="실질 비용 = 견적가 + 예상 지연 비용"
        action={sortHref && measured.length ? <Link href={sortHref} scroll={false} className="text-xs font-semibold underline underline-offset-4">실질 비용순으로 줄 세우기</Link> : null}
        sub={
          baseline
            ? `예상 지연일 = 그 업체 통관 실측(${portName} · 이 방식, 보통 p50 · 늦을 때 p90) − ${baseline.basis === 'fastest' ? `후보 중 가장 빠른 보통 ${baseline.days}일` : `같은 항구·방식 전체 중앙값 ${baseline.days}일`} · 한국 영업일`
            : '통관 실측이 표본 기준을 넘는 후보가 없어 지연을 셈하지 않습니다'
        }
      />
      <form action="/app/compare" method="get" className="grid gap-3 border-b border-line-2 p-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end" aria-label="판매량·마진 넣기">
        {hidden.map(([k, v]) => (
          <input key={k} type="hidden" name={k} value={v} />
        ))}
        <Field label="하루 판매량(개)" htmlFor="rc-ds" hint={basis === 'sales' ? '판매 분석(고른 SKU 의 최근 30일)에서 가져왔습니다' : '판매 분석과 이은 SKU 를 고르면 자동으로'}>
          <Input id="rc-ds" name="ds" inputMode="decimal" defaultValue={perDay ?? ''} placeholder="예: 40" />
        </Field>
        <Field label="개당 마진(원)" htmlFor="rc-mg" hint={basis === 'sales' ? '판매손익의 개당 이익' : '판매가 − 원가·수수료 등(부가세 제외)'}>
          <Input id="rc-mg" name="mg" inputMode="numeric" defaultValue={margin ?? ''} placeholder="예: 3000" />
        </Field>
        <Button type="submit" variant="secondary">실질 비용 셈하기</Button>
      </form>
      {measured.length ? (
        <ul className="divide-y divide-line-2 border-t border-line-2 text-sm tnum md:hidden" aria-label="업체별 실질 비용">
          {rows.map((r) => (
            <li key={r.id} className="px-4 py-3">
              <div className="flex items-baseline justify-between gap-3">
                <span className="min-w-0 font-semibold">{r.name}<span className="ml-1 text-2xs font-normal text-muted">{r.mode}</span></span>
                <span className="shrink-0 text-xs text-muted">견적 {won(r.quote)}</span>
              </div>
              {r.real?.usual ? (
                <dl className="mt-1.5 grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <dt className="text-2xs text-muted">평소(p50)</dt>
                    <dd className="font-semibold">{r.real.usual.total != null ? won(r.real.usual.total) : `지연 ${r.real.usual.delayDays}일`}<span className="block text-2xs font-normal text-muted">{r.real.usual.cost != null ? `+${won(r.real.usual.cost)} · ` : ''}지연 {r.real.usual.delayDays}일</span></dd>
                  </div>
                  <div>
                    <dt className="text-2xs text-muted">늦을 때(p90)</dt>
                    <dd className="font-semibold">{r.real.late?.total != null ? won(r.real.late.total) : `지연 ${r.real.late?.delayDays}일`}<span className="block text-2xs font-normal text-muted">{r.real.late?.cost != null ? `+${won(r.real.late.cost)} · ` : ''}지연 {r.real.late?.delayDays}일</span></dd>
                  </div>
                </dl>
              ) : (
                <p className="mt-1 text-xs text-muted">실측 없음(표본 부족)</p>
              )}
            </li>
          ))}
        </ul>
      ) : null}
      {measured.length ? (
        <div className="hidden overflow-x-auto md:block">
          <table className="w-full min-w-[620px] whitespace-nowrap text-sm tnum">
            <caption className="sr-only">업체별 실질 비용</caption>
            <thead className="text-left text-xs text-muted">
              <tr className="border-b border-line-2">
                <th scope="col" className="px-4 py-2">업체</th>
                <th scope="col" className="px-4 py-2 text-right">견적가</th>
                <th scope="col" className="px-4 py-2 text-right">평소(p50)</th>
                <th scope="col" className="px-4 py-2 text-right">늦을 때(p90)</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-line-2 last:border-0">
                  <th scope="row" className="px-4 py-2 text-left font-semibold">
                    {r.name}
                    <span className="block text-2xs font-normal text-muted">{r.mode}</span>
                  </th>
                  <td className="px-4 py-2 text-right">{won(r.quote)}</td>
                  {r.real?.usual ? (
                    <>
                      <td className="px-4 py-2 text-right">{r.real.usual.total != null ? won(r.real.usual.total) : `지연 ${r.real.usual.delayDays}일`}<span className="block text-2xs text-muted">{r.real.usual.cost != null ? `+${won(r.real.usual.cost)} · ` : ''}지연 {r.real.usual.delayDays}일</span></td>
                      <td className="px-4 py-2 text-right">{r.real.late?.total != null ? won(r.real.late.total) : `지연 ${r.real.late?.delayDays}일`}<span className="block text-2xs text-muted">{r.real.late?.cost != null ? `+${won(r.real.late.cost)} · ` : ''}지연 {r.real.late?.delayDays}일</span></td>
                    </>
                  ) : (
                    <td colSpan={2} className="px-4 py-2 text-right text-muted">실측 없음(표본 부족)</td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      <p className="flex items-start gap-2 px-4 py-3 text-2xs text-muted">
        <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        지연 비용 = 하루 판매량 × 개당 마진 × 예상 지연일. 「늦을 때」는 열 번 중 한 번쯤은 그보다 더 늦는다는 뜻입니다. 영업일 기준이라 주말을 끼면 실제 판매 손실은 더 클 수 있습니다. 판매량·마진을 넣지 않으면 지연 일수만 보입니다(금액을 지어내지 않습니다). 넣은 값은 저장하지 않습니다.
      </p>
    </Panel>
  );
}
