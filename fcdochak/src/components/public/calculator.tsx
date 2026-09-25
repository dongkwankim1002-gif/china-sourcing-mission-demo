'use client';
import * as React from 'react';
import Link from 'next/link';
import { ArrowRight, Info, TriangleAlert } from 'lucide-react';
import { NumberField } from '@/components/number-field';
import { NineBar, NineBarLegend, type BarSegment } from '@/components/nine-bar';
import { LetterMark } from '@/components/brand-mark';
import { Button, NativeSelect } from '@/components/ui/core';
import { SeaMap } from './sea-map';
import { DemoMenu } from './header-client';
import { cn } from '@/lib/cn';
import { num } from '@/lib/format';
import { ACTION } from '@/lib/terms';
import { DEFAULT_INPUT, type CalcInput } from '@/lib/calc-defaults';
import type { PublicSort, QuoteResponse } from '@/lib/public-quote';
import { SORT_LABEL, topTitle } from '@/lib/ranking';
import { cargoSummaryText } from '@/lib/standard-cargo';

export type { QuoteResponse };

const MODES = [
  ['ANY', '상관없음'],
  ['LCL', 'LCL'],
  ['FERRY', '카페리'],
  ['FCL', 'FCL'],
  ['AIR', '항공'],
] as const;

function useTween(target: number, ms = 220) {
  const [v, setV] = React.useState(target);
  const from = React.useRef(target);
  React.useEffect(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) {
      setV(target);
      from.current = target;
      return;
    }
    const start = performance.now();
    const a = from.current;
    let raf = 0;
    const step = (t: number) => {
      const k = Math.min(1, (t - start) / ms);
      const e = 1 - (1 - k) ** 3;
      setV(Math.round(a + (target - a) * e));
      if (k < 1) raf = requestAnimationFrame(step);
      else from.current = target;
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return v;
}

export function Calculator({
  hubs,
  fcs,
  traits,
  initial,
  demo,
}: {
  hubs: { code: string; name_ko: string; province_ko: string }[];
  fcs: { code: string; name: string }[];
  traits: { code: string; name_ko: string }[];
  initial: QuoteResponse | null;
  demo: boolean;
}) {
  const [input, setInput] = React.useState<CalcInput>(DEFAULT_INPUT);
  const [data, setData] = React.useState<QuoteResponse | null>(initial);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const set = <K extends keyof CalcInput>(k: K, v: CalcInput[K]) => setInput((s) => ({ ...s, [k]: v }));
  const first = React.useRef(true);
  // 정렬 기준(가격순/추천 점수순)과 특수관계 업체 포함 — 서버가 같은 순수 함수로 순위를 매긴다
  const [sort, setSort] = React.useState<PublicSort>(initial?.sort ?? 'cheapest');
  const [withRelated, setWithRelated] = React.useState<boolean>(initial?.includeRelated ?? false);

  const valid = input.units && input.cartons && input.kg && input.cbm && input.goods != null;
  React.useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (!valid) return;
    const ctl = new AbortController();
    const t = setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const p = new URLSearchParams({
          hub: input.hub,
          port: input.port,
          mode: input.mode,
          units: String(input.units),
          cartons: String(input.cartons),
          kg: String(input.kg),
          cbm: String(input.cbm),
          goods: String(input.goods ?? 0),
          cur: input.cur,
          fc: input.fc,
          traits: input.traits.join(','),
          sort,
        });
        if (withRelated) p.set('related', '1');
        const r = await fetch(`/api/quote?${p}`, { signal: ctl.signal });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? '계산하지 못했습니다');
        setData(j);
      } catch (e) {
        if ((e as Error).name !== 'AbortError') setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    }, 180);
    return () => {
      clearTimeout(t);
      ctl.abort();
    };
  }, [input, valid, sort, withRelated]);

  // 구간 쪽에서 「내 화물로 계산하기」로 넘어오면 ?hub·port·mode 를 첫 값으로
  React.useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const hub = q.get('hub')?.toUpperCase();
    const port = q.get('port')?.toUpperCase();
    const mode = q.get('mode')?.toUpperCase();
    const next: Partial<CalcInput> = {};
    if (hub && hubs.some((h) => h.code === hub)) next.hub = hub;
    if (port && ['ICN', 'PTK'].includes(port)) next.port = port;
    if (mode && ['ANY', 'LCL', 'FCL', 'AIR', 'FERRY'].includes(mode)) next.mode = mode;
    const sd = ['QDG', 'WEH', 'YNT', 'RZH'].includes(next.hub ?? DEFAULT_INPUT.hub);
    if (!sd && next.port === 'PTK') delete next.port;
    if (!sd && next.mode === 'FERRY') delete next.mode;
    if (Object.keys(next).length) setInput((s) => ({ ...s, ...next }));
  }, [hubs]);

  const best = data?.top[0] ?? null;
  const total = useTween(best?.total ?? 0);
  const perUnit = useTween(best?.perUnit ?? 0);
  const shandong = ['QDG', 'WEH', 'YNT', 'RZH'].includes(input.hub);
  const bar: BarSegment[] | null = data?.bar?.map((b) => ({ segment: b.segment, amount: b.amount, certainty: b.certainty, filled: b.filled })) ?? null;
  const shownSort = data?.sort ?? sort;
  const hubName = hubs.find((h) => h.code === input.hub)?.name_ko ?? input.hub;
  const modeName = MODES.find(([m]) => m === input.mode)?.[1] ?? input.mode;
  const conditionText = valid
    ? `${hubName} → ${input.port === 'PTK' ? '평택항' : '인천항'} · ${input.mode === 'ANY' ? '방식 상관없음' : modeName} · ${cargoSummaryText({ units: input.units!, cartons: input.cartons!, kg: input.kg!, cbm: input.cbm!, goodsValue: input.goods ?? 0, goodsCurrency: input.cur })}${input.traits.length ? ` · 특성 ${input.traits.length}개` : ''}`
    : '입력을 채우면 조건이 여기에 적힙니다';
  const bestTotals = best?.totals ?? null;

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_420px] xl:grid-cols-[minmax(0,1fr)_460px]">
      <div className="min-w-0">
        <form
          aria-label="화물 조건"
          onSubmit={(e) => e.preventDefault()}
          className="grid grid-cols-2 gap-x-3 gap-y-3 rounded-md border border-white/15 bg-white/[0.04] p-4 sm:grid-cols-4"
        >
          <OnInkField label="출발 거점" htmlFor="c-hub">
            <NativeSelect id="c-hub" value={input.hub} onChange={(e) => {
              const hub = e.target.value;
              setInput((s) => ({ ...s, hub, port: ['QDG', 'WEH', 'YNT', 'RZH'].includes(hub) ? s.port : 'ICN', mode: s.mode === 'FERRY' && !['QDG', 'WEH', 'YNT', 'RZH'].includes(hub) ? 'ANY' : s.mode }));
            }} className={onInkSelect}>
              {hubs.map((h) => (
                <option key={h.code} value={h.code}>
                  {h.name_ko} · {h.province_ko}
                </option>
              ))}
            </NativeSelect>
          </OnInkField>
          <OnInkField label="도착항" htmlFor="c-port">
            <NativeSelect id="c-port" value={input.port} onChange={(e) => set('port', e.target.value)} className={onInkSelect}>
              <option value="ICN">인천항</option>
              <option value="PTK">평택항</option>
            </NativeSelect>
          </OnInkField>
          <OnInkField label="도착 FC" htmlFor="c-fc">
            <NativeSelect id="c-fc" value={input.fc} onChange={(e) => set('fc', e.target.value)} className={onInkSelect}>
              {fcs.map((f) => (
                <option key={f.code} value={f.code}>
                  {f.name}
                </option>
              ))}
            </NativeSelect>
          </OnInkField>
          <fieldset className="min-w-0">
            <legend className="mb-1.5 text-xs font-semibold text-on-ink-muted">운송 방식</legend>
            <NativeSelect aria-label="운송 방식" value={input.mode} onChange={(e) => set('mode', e.target.value)} className={onInkSelect}>
              {MODES.filter(([m]) => m !== 'FERRY' || shandong).map(([m, l]) => (
                <option key={m} value={m}>
                  {l}
                </option>
              ))}
            </NativeSelect>
          </fieldset>
          <OnInkField label="수량" htmlFor="c-units">
            <NumberField id="c-units" value={input.units} onValueChange={(v) => set('units', v)} unit="개" min={1} onInk />
          </OnInkField>
          <OnInkField label="박스" htmlFor="c-cartons">
            <NumberField id="c-cartons" value={input.cartons} onValueChange={(v) => set('cartons', v)} unit="박스" min={1} onInk />
          </OnInkField>
          <OnInkField label="무게" htmlFor="c-kg">
            <NumberField id="c-kg" value={input.kg} onValueChange={(v) => set('kg', v)} unit="kg" decimals={1} min={0.1} onInk />
          </OnInkField>
          <OnInkField label="부피" htmlFor="c-cbm">
            <NumberField id="c-cbm" value={input.cbm} onValueChange={(v) => set('cbm', v)} unit="CBM" decimals={2} min={0.01} onInk />
          </OnInkField>
          <OnInkField label="물품가" htmlFor="c-goods" className="col-span-2">
            <div className="flex gap-2">
              <NumberField id="c-goods" value={input.goods} onValueChange={(v) => set('goods', v)} unit={input.cur} className="flex-1" onInk />
              <NativeSelect aria-label="통화" value={input.cur} onChange={(e) => set('cur', e.target.value as 'RMB' | 'USD')} className={cn(onInkSelect, 'w-24')}>
                <option value="RMB">RMB</option>
                <option value="USD">USD</option>
              </NativeSelect>
            </div>
          </OnInkField>
          <fieldset className="col-span-2">
            <legend className="mb-1.5 text-xs font-semibold text-on-ink-muted">화물 특성</legend>
            <div className="flex flex-wrap gap-1.5">
              {traits.map((t) => {
                const on = input.traits.includes(t.code);
                return (
                  <button
                    key={t.code}
                    type="button"
                    aria-pressed={on}
                    onClick={() => set('traits', on ? input.traits.filter((x) => x !== t.code) : [...input.traits, t.code])}
                    className={cn(
                      'h-8 rounded-xs border px-2.5 text-xs font-semibold',
                      on ? 'border-label bg-label text-on-label' : 'border-white/20 text-on-ink-muted hover:border-white/40 hover:text-on-ink',
                    )}
                  >
                    {t.name_ko}
                  </button>
                );
              })}
            </div>
          </fieldset>
        </form>

        <section aria-live="polite" aria-busy={loading} className={cn('mt-6 transition-opacity', loading && 'opacity-60')}>
          <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
            <div>
              <p className="text-sm font-semibold text-on-ink-muted">
                FC 도착 총액(참고치 포함 합계) · {shownSort === 'cheapest' ? '공개 요금 중 가장 낮은 곳' : '추천 점수 1위'}
              </p>
              <p className="display mt-1 text-[clamp(44px,8vw,76px)] leading-none text-label tnum">
                {best ? (
                  <>
                    {num(total)}
                    <span className="ml-1 text-[0.45em] text-on-ink">원</span>
                  </>
                ) : (
                  <span className="text-[0.5em] text-on-ink-muted">맞는 공개 요금이 없습니다</span>
                )}
              </p>
            </div>
            {best ? (
              <p className="pb-1 text-sm text-on-ink-muted">
                개당 <b className="display text-2xl font-normal text-on-ink tnum">{num(perUnit)}원</b>
                <span className="ml-2">· {best.transit[0]}~{best.transit[1]}일</span>
              </p>
            ) : null}
          </div>
          <p className="mt-2 text-xs text-on-ink-muted" data-testid="calc-condition">
            <b className="mr-1 rounded-[2px] border border-white/25 px-1 py-px text-2xs font-bold text-on-ink">이 조건 기준</b>
            <span className="break-keep">{conditionText}</span>
          </p>
          {bestTotals ? (
            <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:flex sm:flex-wrap sm:items-baseline" data-testid="calc-totals">
              <div className="flex items-baseline gap-1.5">
                <dt className="text-on-ink-muted">확정 합계</dt>
                <dd className="font-bold text-on-ink tnum">{num(bestTotals.confirmed)}원</dd>
              </div>
              <div className="flex items-baseline gap-1.5">
                <dt className="text-on-ink-muted">참고치 포함 합계</dt>
                <dd className="font-bold text-on-ink tnum">{num(bestTotals.withReference)}원</dd>
              </div>
              <div className="col-span-2 text-2xs text-on-ink-muted sm:col-span-1">
                = 확정 {num(bestTotals.confirmed)} + 업체 예상 {num(bestTotals.estimated)} + 참고치 {num(bestTotals.reference)}
                {bestTotals.referenceCount ? `(${bestTotals.referenceCount}칸)` : ''}
              </div>
            </dl>
          ) : null}
          {bar ? (
            <div className="on-ink mt-5">
              <NineBar
                segments={bar}
                size="hero"
                ticks
                unit={data?.barUnit ?? 'permille'}
                label={`${shownSort === 'cheapest' ? '가장 낮은 곳' : '추천 점수 1위'}${data?.barUnit === 'won' ? '' : '(비중만 — 가입하면 구간 금액이 보입니다)'}`}
              />
              <NineBarLegend className="mt-3 [&_li]:text-on-ink-muted" />
            </div>
          ) : null}
          {error ? (
            <p role="alert" className="mt-3 flex items-center gap-2 text-sm text-label">
              <TriangleAlert className="size-4" /> {error}
            </p>
          ) : null}
          {data?.verdicts.length ? (
            <ul className="mt-4 space-y-1.5">
              {data.verdicts.map((v) => (
                <li key={v.code} className="flex gap-2 text-xs text-on-ink-muted">
                  <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-label" aria-hidden />
                  <span>
                    <b className="text-on-ink">{v.name}</b> — {v.text}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}

          <div className="mt-6 rounded-md border border-white/15">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 px-4 py-2.5">
              <h2 className="text-sm font-bold text-on-ink">{topTitle(data?.top.length ?? 0)}</h2>
              <span className="text-2xs text-on-ink-muted">
                비교 {data?.count ?? 0}곳{data?.excluded ? ` · 조건이 안 맞아 뺀 곳 ${data.excluded}` : ''}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-white/10 px-4 py-2.5">
              <div role="group" aria-label="정렬 기준" className="inline-flex rounded-sm border border-white/20 p-0.5">
                {(['cheapest', 'recommend'] as const).map((k) => (
                  <button
                    key={k}
                    type="button"
                    aria-pressed={sort === k}
                    onClick={() => setSort(k)}
                    className={cn('h-8 rounded-[4px] px-3 text-xs font-semibold', sort === k ? 'bg-label text-on-label' : 'text-on-ink-muted hover:text-on-ink')}
                  >
                    {SORT_LABEL[k]}
                  </button>
                ))}
              </div>
              <label className="inline-flex min-h-8 cursor-pointer items-center gap-2 text-xs font-semibold text-on-ink-muted">
                <input type="checkbox" checked={withRelated} onChange={(e) => setWithRelated(e.target.checked)} className="size-4 accent-[var(--label)]" />
                특수관계 포함
              </label>
              <p className="text-2xs text-on-ink-muted" aria-live="polite" data-testid="calc-sort-now">
                현재 기준: <b className="text-on-ink">{SORT_LABEL[shownSort]}</b>
                {shownSort === 'recommend' ? ' (정시 30 · 청구 편차 25 · FC 회송 25 · 가격확정도 20)' : ''}
                {data && !data.includeRelated && data.relatedHidden ? ` · 특수관계 업체 ${data.relatedHidden}곳은 순위에서 뺐습니다` : ''}
              </p>
            </div>
            {data?.relatedTop && best ? (
              <p role="alert" className="flex items-start gap-2 border-b border-white/10 bg-caution-bg px-4 py-2.5 text-xs font-semibold text-caution">
                <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
                <span>
                  1위 {best.name} — 플랫폼과 특수관계인 업체입니다{best.relatedNote ? `(${best.relatedNote.trim().replace(/[.。]$/, '')})` : ''}. 순위는 같은 기준으로 매겼지만 함께 판단해 주세요.
                </span>
              </p>
            ) : null}
            {data && data.top.length > 0 ? (
              <ol data-testid="calc-top">
                {data.top.map((o, i) => (
                  <li key={o.slug + o.mode} className="flex items-center gap-3 border-b border-white/5 px-4 py-2.5 last:border-0">
                    <span className="w-4 text-center text-xs font-bold text-on-ink-muted tnum">{i + 1}</span>
                    <LetterMark name={o.name} logo={o.logo} size={28} />
                    <span className="min-w-0 flex-1">
                      <Link href={`/p/${o.slug}`} className="block truncate text-sm font-semibold text-on-ink hover:underline">
                        {o.name}
                      </Link>
                      <span className="block text-2xs text-on-ink-muted">
                        {o.status === 'official' ? '공식 등록' : '인증 대기'} · {o.mode === 'FERRY' ? '카페리' : o.mode === 'AIR' ? '항공' : o.mode} · {o.transit[0]}~{o.transit[1]}일
                        {o.filled ? ` · 빈 구간 ${o.filled}개 참고치` : ''}
                        {` · 확정 합계 ${num(o.totals.confirmed)}원`}
                        {o.related ? ' · 특수관계' : ''}
                        {shownSort === 'recommend' ? (o.sampleEnough === false ? ` · 표본 부족(${o.sampleN}건)` : ` · 추천 ${o.score}점`) : ''}
                      </span>
                    </span>
                    <span className="text-right">
                      <span className="block text-sm font-bold text-on-ink tnum">{num(o.total)}원</span>
                      <span className="block text-2xs text-on-ink-muted tnum">개당 {num(o.perUnit)}원</span>
                    </span>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="px-4 py-6 text-sm text-on-ink-muted">
                이 조건에 공개된 요금표가 아직 없습니다. 가입하면 공개하지 않은 요금까지 비교하고, 견적 요청으로 응찰을 받을 수 있습니다.
              </p>
            )}
            <div className="flex flex-wrap items-center gap-2 border-t border-white/10 px-4 py-3">
              <Button asChild variant="primary" size="md">
                <Link href="/join/shipper">
                  9구간 상세·견적 요청은 가입 후 <ArrowRight aria-hidden />
                </Link>
              </Button>
              {demo ? <DemoMenu variant="secondary" label={ACTION.demo} align="start" /> : null}
              <span className="flex items-center gap-1 text-2xs text-on-ink-muted">
                <Info className="size-3.5" aria-hidden /> 빈 구간은 플랫폼 참고치로 채워 같은 조건으로 맞춥니다
              </span>
            </div>
          </div>
        </section>
      </div>
      <div className="relative hidden min-w-0 lg:block">
        <div className="sticky top-20">
          <SeaMap hub={input.hub} port={input.port} fc={input.fc} mode={input.mode === 'ANY' ? null : input.mode} className="h-auto w-full" />
        </div>
      </div>
      <div className="lg:hidden">
        <SeaMap hub={input.hub} port={input.port} fc={input.fc} mode={input.mode === 'ANY' ? null : input.mode} className="mx-auto h-auto w-full max-w-md" />
      </div>
    </div>
  );
}

const onInkSelect = 'border-white/20 bg-white/10 text-on-ink hover:border-white/40 focus-visible:border-label [&>option]:text-text [&>option]:bg-surface';

function OnInkField({ label, htmlFor, children, className }: { label: string; htmlFor: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('flex min-w-0 flex-col', className)}>
      <label htmlFor={htmlFor} className="mb-1.5 text-xs font-semibold text-on-ink-muted">
        {label}
      </label>
      {children}
    </div>
  );
}
