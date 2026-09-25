'use client';
/**
 * 공개 판매손익 계산기 — 돈 계산은 lib/money 순수 함수(sellerPnl → unitPnl·breakEvenPrice·sensitivity)를 그대로 쓴다.
 * 도착원가는 ① 구간 시세(9구간 합계 중간값, /api/tools/arrival) 또는 ② 직접 입력.
 */
import * as React from 'react';
import Link from 'next/link';
import { ArrowRight, Ban, Info, LockKeyhole, RotateCcw, TriangleAlert } from 'lucide-react';
import { goodsValueKrw, sellerPnl, sellerSensitivity, traitWarnings, type SellerPnlResult } from '@/lib/money';
import type { ArrivalResponse } from '@/lib/tools-arrival';
import { basisLabel } from '@/lib/tools-settings';
import type { ToolBasis } from '@/lib/server/tools';
import { STANDARD_CARGO } from '@/lib/standard-cargo';
import { SEGMENT_LABEL_KO } from '@/lib/money/segments';
import { NumberField } from '@/components/number-field';
import { NineBar } from '@/components/nine-bar';
import { Button, Chip, Field, NativeSelect, Panel, PanelHead } from '@/components/ui/core';
import { cn } from '@/lib/cn';
import { num, pct, won } from '@/lib/format';

export interface ToolLane {
  slug: string;
  hub: string;
  port: string;
  mode: string;
  label: string;
  hubName: string;
  cards: number;
}

interface TraitInfo {
  code: string;
  name: string;
  needsCapability: boolean;
  blockedModes: string[];
  verdict?: string;
}

type Source = 'lane' | 'direct';

const pctToBp = (v: number | null) => Math.round((v ?? 0) * 100);

export function PnlTool({
  lanes,
  initialLane,
  initialArrival,
  traits,
  modes,
  basis,
}: {
  lanes: ToolLane[];
  initialLane: string | null;
  initialArrival: ArrivalResponse | null;
  traits: TraitInfo[];
  modes: { code: string; name: string }[];
  basis: ToolBasis;
}) {
  const fee = basis.fee;
  const [source, setSource] = React.useState<Source>(lanes.length ? 'lane' : 'direct');
  const [lane, setLane] = React.useState<string>(initialLane ?? lanes[0]?.slug ?? '');
  const [units, setUnits] = React.useState<number | null>(STANDARD_CARGO.units);
  const [cartons, setCartons] = React.useState<number | null>(STANDARD_CARGO.cartons);
  const [kg, setKg] = React.useState<number | null>(STANDARD_CARGO.kg);
  const [cbm, setCbm] = React.useState<number | null>(STANDARD_CARGO.cbm);
  const [goods, setGoods] = React.useState<number | null>(STANDARD_CARGO.goodsValue);
  const [cur, setCur] = React.useState<'RMB' | 'USD' | 'KRW'>(STANDARD_CARGO.goodsCurrency);
  const [picked, setPicked] = React.useState<string[]>([]);
  const [arrival, setArrival] = React.useState<ArrivalResponse | null>(initialArrival);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [directTotal, setDirectTotal] = React.useState<number | null>(initialArrival?.count ? initialArrival.median : 1_000_000);
  const [directToPort, setDirectToPort] = React.useState<number | null>(initialArrival?.count ? initialArrival.toPortMedian : 550_000);
  const [extra, setExtra] = React.useState<number | null>(0);

  const [price, setPrice] = React.useState<number | null>(19_900);
  const [cat, setCat] = React.useState<string>(basis.dutyRates.find((d) => d.category === 'general')?.category ?? basis.dutyRates[0]?.category ?? '');
  const [saleFee, setSaleFee] = React.useState<number | null>(fee.saleFeeBp / 100);
  const [inbound, setInbound] = React.useState<number | null>(fee.rgInboundPerUnit);
  const [shipping, setShipping] = React.useState<number | null>(fee.rgShippingPerUnit);
  const [ad, setAd] = React.useState<number | null>(fee.adBp / 100);
  const resetFees = () => {
    setSaleFee(fee.saleFeeBp / 100);
    setInbound(fee.rgInboundPerUnit);
    setShipping(fee.rgShippingPerUnit);
    setAd(fee.adBp / 100);
  };

  // 홈 계산기·구간 화면에서 넘어오면 ?lane= 또는 ?hub·port·mode + 화물 값을 첫 값으로
  const [ready, setReady] = React.useState(false);
  React.useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const bySlug = lanes.find((l) => l.slug === q.get('lane'));
    const hub = q.get('hub')?.toUpperCase();
    const port = q.get('port')?.toUpperCase();
    const mode = q.get('mode')?.toUpperCase();
    const byParts =
      lanes.find((l) => l.hub === hub && l.port === port && l.mode === mode) ?? lanes.find((l) => l.hub === hub && l.port === port);
    const found = bySlug ?? (hub ? byParts : undefined);
    if (found) setLane(found.slug);
    const n = (k: string) => {
      const v = Number(q.get(k));
      return q.has(k) && Number.isFinite(v) && v > 0 ? v : null;
    };
    if (n('units')) setUnits(Math.round(n('units')!));
    if (n('cartons')) setCartons(Math.round(n('cartons')!));
    if (n('kg')) setKg(n('kg'));
    if (n('cbm')) setCbm(n('cbm'));
    if (q.has('goods') && Number.isFinite(Number(q.get('goods')))) setGoods(Math.max(0, Number(q.get('goods'))));
    const c = q.get('cur')?.toUpperCase();
    if (c === 'RMB' || c === 'USD' || c === 'KRW') setCur(c);
    const ts = (q.get('traits') ?? '').split(',').filter((t) => traits.some((x) => x.code === t));
    if (ts.length) setPicked(ts);
    if (n('price')) setPrice(Math.round(n('price')!));
    setReady(true);
  }, [lanes, traits]);

  const laneObj = lanes.find((l) => l.slug === lane) ?? null;
  const cargoOk = !!(units && cartons && kg && cbm && goods != null);
  const isInitial =
    lane === initialLane &&
    units === STANDARD_CARGO.units &&
    cartons === STANDARD_CARGO.cartons &&
    kg === STANDARD_CARGO.kg &&
    cbm === STANDARD_CARGO.cbm &&
    goods === STANDARD_CARGO.goodsValue &&
    cur === STANDARD_CARGO.goodsCurrency &&
    picked.length === 0;

  React.useEffect(() => {
    if (!ready || source !== 'lane' || !laneObj || !cargoOk) return;
    if (isInitial && initialArrival) {
      setArrival(initialArrival);
      return;
    }
    const ctl = new AbortController();
    const t = setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const p = new URLSearchParams({
          hub: laneObj.hub,
          port: laneObj.port,
          mode: laneObj.mode,
          units: String(units),
          cartons: String(cartons),
          kg: String(kg),
          cbm: String(cbm),
          goods: String(goods ?? 0),
          cur: cur === 'KRW' ? 'KRW' : cur,
          traits: picked.join(','),
        });
        const r = await fetch(`/api/tools/arrival?${p}`, { signal: ctl.signal });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? '계산하지 못했습니다');
        setArrival(j);
      } catch (e) {
        if ((e as Error).name !== 'AbortError') setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    }, 220);
    return () => {
      clearTimeout(t);
      ctl.abort();
    };
  }, [ready, source, laneObj, units, cartons, kg, cbm, goods, cur, picked, cargoOk, isInitial, initialArrival]);

  const u = Math.max(1, Math.round(units ?? 1));
  const goodsKrw = goodsValueKrw({ units: u, cartons: 1, kg: 1, cbm: 1, goodsValue: goods ?? 0, goodsCurrency: cur }, basis.fx);
  const laneHas = source === 'lane' && !!arrival && arrival.count > 0;
  const logisticsTotal = source === 'lane' ? (laneHas ? arrival!.median : 0) : (directTotal ?? 0);
  const toPort = source === 'lane' ? (laneHas ? arrival!.toPortMedian : 0) : Math.min(directToPort ?? 0, directTotal ?? 0);
  const rate = basis.dutyRates.find((d) => d.category === cat)?.rate_bp ?? 0;

  let r: SellerPnlResult | null = null;
  try {
    r = sellerPnl({
      units: u,
      price: price ?? 0,
      goodsKrw,
      logisticsTotal,
      freightToPortKrw: toPort,
      extraCostTotal: extra ?? 0,
      dutyRateBp: rate,
      vatRateBp: basis.vatRateBp,
      insuranceBp: basis.insuranceBp,
      saleFeeBp: pctToBp(saleFee),
      adBp: pctToBp(ad),
      inboundPerUnit: inbound ?? 0,
      shippingPerUnit: shipping ?? 0,
    });
  } catch {
    r = null;
  }
  const sens = r ? sellerSensitivity(r) : null;
  const warnings = traitWarnings(picked, traits, basis.traitNotes);
  const modeName = (m: string) => modes.find((x) => x.code === m)?.name ?? m;
  const noLogistics = source === 'lane' && !laneHas;

  const hubs = [...new Set(lanes.map((l) => l.hubName))];

  return (
    <div className="grid gap-6 xl:grid-cols-[420px_minmax(0,1fr)]">
      <div className="grid min-w-0 content-start gap-6">
        <Panel aria-labelledby="t-arrival">
          <PanelHead id="t-arrival" title="① 도착원가 — 공장에서 쿠팡 FC까지" sub="구간 시세의 9구간 합계 중간값으로 잡거나, 받은 견적 금액을 직접 넣습니다" />
          <div className="grid gap-3 p-4">
            <div role="group" aria-label="도착원가 넣는 방법" className="inline-flex w-full rounded-sm border border-line bg-surface-2 p-0.5">
              {(
                [
                  ['lane', '구간 시세로'],
                  ['direct', '직접 입력'],
                ] as const
              ).map(([k, l]) => (
                <button
                  key={k}
                  type="button"
                  aria-pressed={source === k}
                  disabled={k === 'lane' && !lanes.length}
                  onClick={() => setSource(k)}
                  className={cn('h-9 flex-1 rounded-[4px] px-3 text-sm font-semibold', source === k ? 'bg-ink text-on-ink' : 'text-muted hover:text-text')}
                >
                  {l}
                </button>
              ))}
            </div>

            {source === 'lane' ? (
              <Field label="구간" htmlFor="t-lane" hint={laneObj ? `요금표 ${laneObj.cards}장이 있는 구간 · 공개 시세` : undefined}>
                <NativeSelect id="t-lane" value={lane} onChange={(e) => setLane(e.target.value)}>
                  {hubs.map((h) => (
                    <optgroup key={h} label={`${h} 출발`}>
                      {lanes
                        .filter((l) => l.hubName === h)
                        .map((l) => (
                          <option key={l.slug} value={l.slug}>
                            {l.label}
                          </option>
                        ))}
                    </optgroup>
                  ))}
                </NativeSelect>
              </Field>
            ) : null}

            <div className="grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
              <Field label="수량" htmlFor="t-units">
                <NumberField id="t-units" value={units} onValueChange={setUnits} unit="개" min={1} />
              </Field>
              <Field label="물품가(전체)" htmlFor="t-goods">
                <div className="flex gap-2">
                  <NumberField id="t-goods" value={goods} onValueChange={setGoods} unit={cur} className="min-w-0 flex-1" />
                  <NativeSelect aria-label="통화" value={cur} onChange={(e) => setCur(e.target.value as 'RMB')} className="w-[76px] shrink-0 px-2">
                    <option>RMB</option>
                    <option>USD</option>
                    <option>KRW</option>
                  </NativeSelect>
                </div>
              </Field>
            </div>

            {source === 'lane' ? (
              <div className="grid grid-cols-3 gap-3">
                <Field label="박스" htmlFor="t-cartons">
                  <NumberField id="t-cartons" value={cartons} onValueChange={setCartons} unit="박스" min={1} />
                </Field>
                <Field label="무게" htmlFor="t-kg">
                  <NumberField id="t-kg" value={kg} onValueChange={setKg} unit="kg" decimals={1} min={0.1} />
                </Field>
                <Field label="부피" htmlFor="t-cbm">
                  <NumberField id="t-cbm" value={cbm} onValueChange={setCbm} unit="CBM" decimals={2} min={0.01} />
                </Field>
              </div>
            ) : (
              <>
                <Field label="물류비 9구간 합계(전체)" htmlFor="t-total" hint="받은 견적의 FC 도착 총액(집하부터 회송 대비까지)">
                  <NumberField id="t-total" value={directTotal} onValueChange={setDirectTotal} unit="원" />
                </Field>
                <Field label="그중 한국 도착항까지 운임" htmlFor="t-toport" hint="집하·창고 작업·수출통관·국제운송의 합 — 관세 과세가격에 들어갑니다">
                  <NumberField id="t-toport" value={directToPort} onValueChange={setDirectToPort} unit="원" />
                </Field>
              </>
            )}

            <fieldset className="min-w-0">
              <legend className="mb-1.5 text-sm font-semibold text-text">화물 특성</legend>
              <div className="flex flex-wrap gap-1.5">
                {traits.map((t) => {
                  const on = picked.includes(t.code);
                  return (
                    <button
                      key={t.code}
                      type="button"
                      aria-pressed={on}
                      onClick={() => setPicked((s) => (on ? s.filter((x) => x !== t.code) : [...s, t.code]))}
                      className={cn(
                        'h-8 rounded-xs border px-2.5 text-xs font-semibold',
                        on ? 'border-ink bg-ink text-on-ink' : 'border-line bg-surface text-muted hover:border-muted/60 hover:text-text',
                      )}
                    >
                      {t.name}
                    </button>
                  );
                })}
              </div>
            </fieldset>

            <Field label="특성·기타 추가비용(전체, 알면)" htmlFor="t-extra" hint="인증·검사·할증처럼 견적 밖에서 드는 돈. 물류비에 얹어 계산합니다">
              <NumberField id="t-extra" value={extra} onValueChange={setExtra} unit="원" />
            </Field>
          </div>

          {source === 'lane' ? (
            <div aria-live="polite" aria-busy={loading} className={cn('border-t border-line-2 p-4 transition-opacity', loading && 'opacity-60')} data-testid="tool-arrival">
              {error ? (
                <p role="alert" className="flex items-center gap-2 text-sm text-stamp">
                  <TriangleAlert className="size-4" aria-hidden /> {error}
                </p>
              ) : null}
              {laneHas ? (
                <>
                  <p className="text-xs font-semibold text-muted">9구간 합계 · 업체 {arrival!.count}곳 견적의 중간값</p>
                  <p className="display mt-1 text-[clamp(26px,3vw,32px)] leading-none tnum" data-testid="tool-arrival-total">
                    {num(arrival!.median)}
                    <span className="ml-1 text-[0.5em]">원</span>
                  </p>
                  <p className="mt-1 text-xs text-muted tnum">
                    개당 {num(arrival!.perUnitMedian)}원 · 최저 {num(arrival!.min)}원 · 싼 쪽 4분의 1 {num(arrival!.q1)}원 이하
                  </p>
                  <NineBar
                    className="mt-3"
                    size="md"
                    segments={arrival!.segments.map((s) => ({ segment: s.segment, amount: s.amount, certainty: 'confirmed' as const }))}
                    label={`${laneObj?.label ?? ''} 구간별 중간값`}
                  />
                  <ol className="mt-3 grid grid-cols-3 gap-x-3 gap-y-1 text-2xs text-muted tnum">
                    {arrival!.segments.map((s, i) => (
                      <li key={s.segment} className="flex min-w-0 justify-between gap-1">
                        <span className="truncate">
                          {i + 1}. {SEGMENT_LABEL_KO[s.segment]}
                        </span>
                        <span className="text-text">{s.amount == null ? '—' : num(s.amount)}</span>
                      </li>
                    ))}
                  </ol>
                  <p className="mt-2 text-2xs text-muted">
                    공개: 구간별 중간값과 합계 · 가입 후: 업체별 9구간 가격과 견적 요청. 구간별 값은 각 칸의 중간값이라 더한 값({num(arrival!.segmentMedianSum)}원)이 합계 중간값과 조금 다를 수 있습니다.
                  </p>
                </>
              ) : (
                <p className="text-sm text-muted">
                  {picked.length ? '이 특성을 취급하는 업체의 공개 시세가 이 구간에 없습니다.' : '이 조건에 맞는 요금표가 아직 없습니다.'} 받은 견적이 있으면 「직접 입력」으로 넣어 주세요.
                </p>
              )}
              {arrival && arrival.excluded.length ? (
                <div className="mt-4 rounded-sm border border-stamp/30 bg-stamp-bg p-3" data-testid="tool-excluded">
                  <p className="flex items-center gap-1.5 text-xs font-bold text-stamp">
                    <Ban className="size-3.5" aria-hidden /> 화물 특성 때문에 뺀 업체 {arrival.excluded.length}곳 — 위 합계에 넣지 않았습니다
                  </p>
                  <ul className="mt-2 grid gap-1.5">
                    {arrival.excludedGroups.map((g) => (
                      <li key={g.reason} className="text-xs text-text">
                        <Chip tone="stamp" className="mr-1.5">{g.reason}</Chip>
                        <span className="break-keep">{g.names.join(' · ')}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          ) : null}

          {warnings.length ? (
            <div className="border-t border-line-2 bg-caution-bg p-4" data-testid="tool-warnings">
              <p className="flex items-center gap-1.5 text-sm font-bold text-caution">
                <TriangleAlert className="size-4" aria-hidden /> 특성 때문에 더 들 수 있는 돈
              </p>
              <ul className="mt-2 grid gap-2 text-xs">
                {warnings.map((w) => {
                  const t = traits.find((x) => x.code === w.trait);
                  return (
                    <li key={w.trait}>
                      <b className="text-text">{w.name}</b>
                      {t?.verdict ? <span className="text-muted"> — {t.verdict}</span> : null}
                      {w.items.length ? <span className="mt-0.5 block text-text">생길 수 있는 비용: {w.items.join(' · ')}</span> : null}
                      {w.blockedModes.length || w.needsCapability ? (
                        <span className="mt-0.5 block text-muted">
                          {w.blockedModes.length ? `${w.blockedModes.map(modeName).join('·')} 불가` : ''}
                          {w.blockedModes.length && w.needsCapability ? ' · ' : ''}
                          {w.needsCapability ? '취급 등록 업체만 받습니다' : ''}
                        </span>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
              <p className="mt-2 text-2xs text-muted">금액은 업체·검사 결과마다 달라 합계에 자동으로 넣지 않습니다. 알면 위 「추가비용」에 넣으세요.</p>
            </div>
          ) : null}
        </Panel>

        <Panel aria-labelledby="t-sell">
          <PanelHead
            id="t-sell"
            title="② 쿠팡 판매 조건"
            sub={<span data-testid="tool-basis">기준값: {basisLabel(fee)}</span>}
            action={
              <Button type="button" variant="ghost" size="sm" onClick={resetFees}>
                <RotateCcw aria-hidden /> 기준값으로
              </Button>
            }
          />
          <div className="grid gap-3 p-4">
            <div className="grid grid-cols-2 gap-3">
              <Field label="판매가(부가세 포함)" htmlFor="t-price">
                <NumberField id="t-price" value={price} onValueChange={setPrice} unit="원" />
              </Field>
              <Field label="판매 수수료" htmlFor="t-fee">
                <NumberField id="t-fee" value={saleFee} onValueChange={setSaleFee} unit="%" decimals={2} />
              </Field>
              <Field label="로켓그로스 입출고비" htmlFor="t-inbound" hint="개당">
                <NumberField id="t-inbound" value={inbound} onValueChange={setInbound} unit="원" />
              </Field>
              <Field label="로켓그로스 배송비" htmlFor="t-ship" hint="개당">
                <NumberField id="t-ship" value={shipping} onValueChange={setShipping} unit="원" />
              </Field>
              <Field label="광고비율" htmlFor="t-ad" hint="판매가 대비">
                <NumberField id="t-ad" value={ad} onValueChange={setAd} unit="%" decimals={1} />
              </Field>
              <Field label="관세율 분류(참고)" htmlFor="t-cat">
                <NativeSelect id="t-cat" value={cat} onChange={(e) => setCat(e.target.value)}>
                  {basis.dutyRates.map((d) => (
                    <option key={d.category} value={d.category}>
                      {d.name_ko} · {(d.rate_bp / 100).toFixed(1)}%
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            </div>
            <p className="flex items-start gap-1.5 text-2xs text-muted">
              <Info className="mt-px size-3.5 shrink-0" aria-hidden />
              <span>
                {fee.source ?? '쿠팡 요율을 확인한 값이 아닙니다. 쿠팡 WING·로켓그로스 요금표에서 확인해 넣어 주세요.'} 환율 1 RMB = {basis.fx.RMB}원 · 1 USD = {basis.fx.USD}원(운영 설정 값).
              </span>
            </p>
          </div>
        </Panel>
      </div>

      <div className="grid min-w-0 content-start gap-6">
        {r ? (
          <>
            <section aria-label="개당 손익" className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="tool-result">
              {(
                [
                  ['개당 이익', won(r.pnl.profit), r.pnl.profit >= 0 ? 'text-ok' : 'text-stamp', 'tool-profit'],
                  ['이익률(부가세 뺀 매출 대비)', pct(r.pnl.marginBp / 10000, 1), r.pnl.marginBp >= 0 ? 'text-ok' : 'text-stamp', 'tool-margin'],
                  ['손익분기 판매가', Number.isFinite(r.breakEvenPrice) ? won(r.breakEvenPrice) : '없음', 'text-text', 'tool-breakeven'],
                  ['전체 이익', won(r.totalProfit), r.totalProfit >= 0 ? 'text-ok' : 'text-stamp', 'tool-total'],
                ] as const
              ).map(([k, v, c, id]) => (
                <div key={k} className="rounded-md border border-line bg-surface p-4">
                  <p className="text-xs font-semibold text-muted">{k}</p>
                  <p className={cn('display mt-1.5 whitespace-nowrap text-[clamp(18px,2vw,24px)] leading-none tnum', c)} data-testid={id}>
                    {v}
                  </p>
                </div>
              ))}
            </section>
            {noLogistics ? (
              <p role="status" className="flex items-start gap-2 rounded-md border border-caution/40 bg-caution-bg px-4 py-3 text-sm text-caution">
                <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden /> 물류비가 비어 있어 이 결과에는 도착원가가 빠져 있습니다.
              </p>
            ) : null}
            <Panel>
              <PanelHead title="개당 원가 쪼개기" sub={`개당 도착원가(상품 + 물류 + 추가비용 + 관세) ${won(r.arrivalPerUnit)} · 매입 부가세는 공제 대상이라 원가에서 뺍니다`} />
              <table className="w-full text-sm tnum">
                <tbody>
                  {(
                    [
                      ['판매가(부가세 포함)', r.base.price, false],
                      ['부가세 뺀 매출', r.pnl.netRevenue, true],
                      ['쿠팡 판매 수수료', -r.saleFee, false],
                      ['광고비', -r.adCost, false],
                      ['로켓그로스 입출고비', -r.inbound, false],
                      ['로켓그로스 배송비', -r.shipping, false],
                      ['상품 원가', -r.goodsPerUnit, false],
                      ['물류비(9구간)', -r.logisticsPerUnit, false],
                      ['특성·기타 추가비용', -r.extraPerUnit, false],
                      ['관세(참고 추정)', -r.dutyPerUnit, false],
                      ['개당 이익', r.pnl.profit, true],
                    ] as const
                  ).map(([k, v, bold]) => (
                    <tr key={k} className={cn('border-t border-line-2', bold && 'font-bold')}>
                      <th scope="row" className="px-4 py-2 text-left font-[inherit]">
                        {k}
                      </th>
                      <td className={cn('px-4 py-2 text-right', v < 0 && 'text-muted')}>{num(v)}원</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Panel>
            <Panel>
              <PanelHead title="관세·부가세 참고 추정" sub="판매용 수입 · 일반 수입신고 기준. 실제 세액은 수입신고 때 세관이 정합니다. 수입 부가세는 나중에 공제받는 돈이라 손익에서 뺐습니다." />
              <div className="grid grid-cols-2 gap-px bg-line-2 sm:grid-cols-4">
                {(
                  [
                    ['과세가격(CIF)', r.duty.customsValue],
                    ['관세', r.duty.duty],
                    ['부가세(수입)', r.duty.vat],
                    ['통관 때 낼 돈', r.duty.total],
                  ] as const
                ).map(([k, v]) => (
                  <div key={k} className="min-w-0 bg-surface p-4">
                    <p className="text-xs text-muted">{k}</p>
                    <p className="truncate text-md font-bold tnum">{won(v)}</p>
                  </div>
                ))}
              </div>
            </Panel>
            {sens ? (
              <Panel>
                <PanelHead title="민감도표 — 개당 이익" sub="가로: 판매가 변화 · 세로: 물류비(9구간 + 추가비용) 변화" />
                <div className="overflow-x-auto p-4">
                  <table className="w-full min-w-[520px] border-separate border-spacing-[2px] text-xs tnum" data-testid="tool-sensitivity">
                    <thead>
                      <tr>
                        <th scope="col" className="text-left font-semibold text-muted">
                          물류비 \ 판매가
                        </th>
                        {sens.priceSteps.map((p) => (
                          <th key={p} scope="col" className="font-semibold text-muted">
                            {p > 0 ? '+' : ''}
                            {p}% · {num(Math.round((r!.base.price * (100 + p)) / 100))}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {sens.logisticsSteps.map((l, i) => (
                        <tr key={l}>
                          <th scope="row" className="pr-2 text-left font-semibold text-muted">
                            {l > 0 ? '+' : ''}
                            {l}%
                          </th>
                          {sens.profit[i].map((v, j) => (
                            <td
                              key={j}
                              className={cn(
                                'rounded-[3px] px-2 py-2 text-right font-semibold',
                                v < 0 ? 'bg-stamp-bg text-stamp' : 'bg-ok-bg text-ok',
                                l === 0 && sens.priceSteps[j] === 0 && 'outline outline-2 outline-label',
                              )}
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
            ) : null}
          </>
        ) : (
          <Panel className="p-6 text-sm text-muted">값을 채우면 개당 손익이 여기에 나옵니다.</Panel>
        )}

        <Panel aria-labelledby="t-open">
          <PanelHead id="t-open" title="여기까지는 가입 없이, 이 다음은 가입 후" />
          <div className="grid gap-px bg-line-2 sm:grid-cols-2">
            <div className="bg-surface p-4">
              <p className="text-xs font-bold text-ok">지금 공개</p>
              <ul className="mt-2 space-y-1 text-sm">
                <li>구간별 9구간 중간값과 합계</li>
                <li>특성 때문에 빠지는 업체와 그 사유</li>
                <li>관세·부가세 참고 추정 · 개당 마진 · 손익분기</li>
              </ul>
            </div>
            <div className="bg-surface p-4">
              <p className="flex items-center gap-1 text-xs font-bold text-muted">
                <LockKeyhole className="size-3.5" aria-hidden /> 가입 후
              </p>
              <ul className="mt-2 space-y-1 text-sm">
                <li>업체별 9구간 가격 같은 조건 비교</li>
                <li>견적 요청 올리기 · 응찰 받기</li>
                <li>SKU 저장해 판매손익 다시 보기</li>
              </ul>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 border-t border-line-2 px-4 py-3">
            <Button asChild variant="primary">
              <Link href="/join/shipper">
                업체별 가격·견적 요청은 가입 후 <ArrowRight aria-hidden />
              </Link>
            </Button>
            {laneObj ? (
              <Button asChild variant="secondary">
                <Link href={`/lanes/${laneObj.slug}`}>이 구간 시세 보기</Link>
              </Button>
            ) : null}
          </div>
        </Panel>
      </div>
    </div>
  );
}

