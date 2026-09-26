'use client';
/** 판매손익 — 돈 계산은 lib/money 의 순수 함수를 그대로 쓴다(서버 시험과 같은 식). */
import * as React from 'react';
import { breakEvenPrice, estimateDutyVat, goodsValueKrw, sensitivity, unitPnl } from '@/lib/money';
import { NumberField } from '@/components/number-field';
import { Field, NativeSelect, Panel, PanelHead } from '@/components/ui/core';
import { cn } from '@/lib/cn';
import { num, pct, won } from '@/lib/format';

export interface PnlSku {
  id: string;
  name: string;
  units: number;
  goods_value: number;
  goods_currency: 'RMB' | 'USD' | 'KRW';
  hs_category: string;
  target_price: number | null;
}

export function PnlCalc({
  skus,
  fx,
  vatRateBp,
  insuranceBp,
  saleFeeBp,
  fulfillmentPerUnit,
  duty,
  offer,
  initialSku,
}: {
  skus: PnlSku[];
  fx: Record<'KRW' | 'RMB' | 'USD', number>;
  vatRateBp: number;
  insuranceBp: number;
  saleFeeBp: number;
  fulfillmentPerUnit: number;
  duty: { category: string; name_ko: string; rate_bp: number }[];
  offer: { partner: string; total: number; toPort: number; units: number } | null;
  initialSku: string | null;
}) {
  const [skuId, setSkuId] = React.useState(initialSku ?? skus[0]?.id ?? '');
  const sku = skus.find((s) => s.id === skuId) ?? null;
  const [units, setUnits] = React.useState<number | null>(sku?.units ?? offer?.units ?? 1000);
  const [goods, setGoods] = React.useState<number | null>(sku?.goods_value ?? 20000);
  const [cur, setCur] = React.useState<'RMB' | 'USD' | 'KRW'>(sku?.goods_currency ?? 'RMB');
  const [price, setPrice] = React.useState<number | null>(sku?.target_price ?? 19900);
  const [logistics, setLogistics] = React.useState<number | null>(offer ? offer.total : 900000);
  const [toPort, setToPort] = React.useState<number | null>(offer ? offer.toPort : 500000);
  const [fee, setFee] = React.useState<number | null>(saleFeeBp / 100);
  const [fulfil, setFulfil] = React.useState<number | null>(fulfillmentPerUnit);
  const [cat, setCat] = React.useState(sku?.hs_category ?? 'general');

  React.useEffect(() => {
    if (!sku) return;
    setUnits(sku.units);
    setGoods(sku.goods_value);
    setCur(sku.goods_currency);
    if (sku.target_price) setPrice(sku.target_price);
    setCat(sku.hs_category);
  }, [skuId]); // eslint-disable-line react-hooks/exhaustive-deps

  const u = Math.max(1, units ?? 1);
  const goodsKrw = goodsValueKrw({ units: u, cartons: 1, kg: 1, cbm: 1, goodsValue: goods ?? 0, goodsCurrency: cur }, fx);
  const rate = duty.find((d) => d.category === cat)?.rate_bp ?? 800;
  const dv = estimateDutyVat({ goodsKrw, freightToPortKrw: toPort ?? 0, insuranceBp, dutyRateBp: rate, vatRateBp });
  const base = {
    price: price ?? 0,
    goodsPerUnit: Math.round(goodsKrw / u),
    logisticsPerUnit: Math.round((logistics ?? 0) / u),
    dutyPerUnit: Math.round(dv.duty / u),
    saleFeeBp: Math.round((fee ?? 0) * 100),
    fulfillmentPerUnit: fulfil ?? 0,
    vatRateBp,
  };
  const r = unitPnl(base);
  const be = breakEvenPrice(base);
  const sens = sensitivity(base);

  return (
    <div className="grid gap-6 xl:grid-cols-[380px_1fr]">
      <Panel className="p-4">
        <div className="grid gap-3">
          {skus.length ? (
            <Field label="SKU" htmlFor="p-sku">
              <NativeSelect id="p-sku" value={skuId} onChange={(e) => setSkuId(e.target.value)}>
                {skus.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </NativeSelect>
            </Field>
          ) : null}
          <div className="grid grid-cols-2 gap-3">
            <Field label="수량" htmlFor="p-units"><NumberField id="p-units" value={units} onValueChange={setUnits} unit="개" min={1} /></Field>
            <Field label="판매가(부가세 포함)" htmlFor="p-price"><NumberField id="p-price" value={price} onValueChange={setPrice} unit="원" /></Field>
          </div>
          <Field label="물품가(전체)" htmlFor="p-goods">
            <div className="flex gap-2">
              <NumberField id="p-goods" value={goods} onValueChange={setGoods} unit={cur} className="flex-1" />
              <NativeSelect aria-label="통화" value={cur} onChange={(e) => setCur(e.target.value as 'RMB')} className="w-24">
                <option>RMB</option><option>USD</option><option>KRW</option>
              </NativeSelect>
            </div>
          </Field>
          <Field label="물류비 9구간 합계(전체)" htmlFor="p-log" hint={offer ? `${offer.partner} 같은 조건 합계에서 가져왔습니다` : '비교 화면의 총액을 넣으세요'}>
            <NumberField id="p-log" value={logistics} onValueChange={setLogistics} unit="원" />
          </Field>
          <Field label="한국 도착항까지 운임(과세가격 산입)" htmlFor="p-port" hint="집하·창고 작업·수출통관·국제운송의 합">
            <NumberField id="p-port" value={toPort} onValueChange={setToPort} unit="원" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="판매 수수료" htmlFor="p-fee"><NumberField id="p-fee" value={fee} onValueChange={setFee} unit="%" decimals={2} /></Field>
            <Field label="개당 풀필먼트" htmlFor="p-ful"><NumberField id="p-ful" value={fulfil} onValueChange={setFulfil} unit="원" /></Field>
          </div>
          <Field label="관세율 분류(참고)" htmlFor="p-cat">
            <NativeSelect id="p-cat" value={cat} onChange={(e) => setCat(e.target.value)}>
              {duty.map((d) => (
                <option key={d.category} value={d.category}>{d.name_ko} · {(d.rate_bp / 100).toFixed(1)}%</option>
              ))}
            </NativeSelect>
          </Field>
          <p className="text-2xs text-muted">환율 1 RMB = {fx.RMB}원 · 1 USD = {fx.USD}원 (운영 설정 값)</p>
        </div>
      </Panel>
      <div className="grid min-w-0 content-start gap-6">
        <section aria-label="개당 손익" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[
            ['개당 이익', won(r.profit), r.profit >= 0 ? 'text-ok' : 'text-stamp'],
            ['이익률(부가세 뺀 매출 대비)', pct(r.marginBp / 10000, 1), r.marginBp >= 0 ? 'text-ok' : 'text-stamp'],
            ['손익분기 판매가', won(be), 'text-text'],
            ['전체 이익', won(r.profit * u), r.profit >= 0 ? 'text-ok' : 'text-stamp'],
          ].map(([k, v, c]) => (
            <div key={k} className="rounded-md border border-line bg-surface p-4">
              <p className="text-xs font-semibold text-muted">{k}</p>
              <p className={cn('display mt-1.5 whitespace-nowrap text-[clamp(18px,2vw,24px)] leading-none tnum', c)}>{v}</p>
            </div>
          ))}
        </section>
        <Panel>
          <PanelHead title="개당 원가 쪼개기" sub="매입 부가세는 공제 대상이라 원가에서 뺍니다" />
          <table className="w-full text-sm tnum">
            <tbody>
              {[
                ['판매가(부가세 포함)', base.price],
                ['부가세 뺀 매출', r.netRevenue],
                ['판매 수수료', -r.saleFee],
                ['상품 원가', -base.goodsPerUnit],
                ['물류비(9구간)', -base.logisticsPerUnit],
                ['관세(참고 추정)', -base.dutyPerUnit],
                ['풀필먼트', -base.fulfillmentPerUnit],
                ['개당 이익', r.profit],
              ].map(([k, v], i) => (
                <tr key={k as string} className={cn('border-t border-line-2', (i === 1 || i === 7) && 'font-bold')}>
                  <th scope="row" className="px-4 py-2 text-left font-normal">{k}</th>
                  <td className={cn('px-4 py-2 text-right', (v as number) < 0 && 'text-muted')}>{num(v as number)}원</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
        <Panel>
          <PanelHead title="관세·부가세 참고 추정" sub="판매용 수입 · 일반 수입신고 기준(목록통관 아님). 실제 세액은 수입신고 때 세관이 정합니다." />
          <div className="grid grid-cols-2 gap-px bg-line-2 sm:grid-cols-4">
            {[
              ['과세가격(CIF)', dv.customsValue],
              ['관세', dv.duty],
              ['부가세(수입)', dv.vat],
              ['합계', dv.total],
            ].map(([k, v]) => (
              <div key={k as string} className="bg-surface p-4">
                <p className="text-xs text-muted">{k}</p>
                <p className="text-md font-bold tnum">{won(v as number)}</p>
              </div>
            ))}
          </div>
        </Panel>
        <Panel>
          <PanelHead title="민감도표 — 개당 이익" sub="가로: 판매가 변화 · 세로: 물류비 변화" />
          <div className="overflow-x-auto p-4">
            <table className="w-full min-w-[520px] border-separate border-spacing-[2px] text-xs tnum">
              <thead>
                <tr>
                  <th scope="col" className="text-left font-semibold text-muted">물류비 \ 판매가</th>
                  {sens.priceSteps.map((p) => (
                    <th key={p} scope="col" className="font-semibold text-muted">{p > 0 ? '+' : ''}{p}% · {num(Math.round((base.price * (100 + p)) / 100))}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sens.logisticsSteps.map((l, i) => (
                  <tr key={l}>
                    <th scope="row" className="pr-2 text-left font-semibold text-muted">{l > 0 ? '+' : ''}{l}%</th>
                    {sens.profit[i].map((v, j) => (
                      <td
                        key={j}
                        className={cn('rounded-[3px] px-2 py-2 text-right font-semibold', v < 0 ? 'bg-stamp-bg text-stamp' : 'bg-ok-bg text-ok', l === 0 && sens.priceSteps[j] === 0 && 'outline outline-2 outline-label')}
                      >
                        {num(v)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-2 text-2xs text-muted">노랑 테두리 칸이 지금 조건입니다. 빨강은 손해.</p>
          </div>
        </Panel>
      </div>
    </div>
  );
}
