import Link from 'next/link';
import { Suspense } from 'react';
import { AlertTriangle, ChevronDown, FileClock, Info, LayoutGrid, List, Table2 } from 'lucide-react';
import { asUser, todayKst } from '@/lib/db';
import { requireViewer } from '@/lib/server/viewer';
import { compare, filterOffers, rankOffers, SORT_LABEL, type Offer, type SortKey } from '@/lib/server/compare';
import { loadSettings } from '@/lib/server/settings';
import { getReference, nameOf } from '@/lib/server/reference';
import { listSkus } from '@/lib/server/shipper';
import { loadTraitNotes } from '@/lib/server/tools';
import { parseCargoQuery, toCargo } from '@/lib/cargo-params';
import { reasonText, totalsBreakdown } from '@/lib/money';
import { LetterMark } from '@/components/brand-mark';
import { NineBar, NineBarLegend } from '@/components/nine-bar';
import { AdChip, FcReadyChip, PartnerStatusChip, RelatedChip, Won } from '@/components/badges';
import { Button, Chip, EmptyState, PageTitle, Panel } from '@/components/ui/core';
import { Tooltip } from '@/components/ui/radix';
import { CompareEditor } from './editor';
import { DestinationNote } from '@/components/destination-note';
import { cn } from '@/lib/cn';
import { dateKo, num, pct, won } from '@/lib/format';
import { ACTION, SEGMENTS_SHORT } from './labels';
import { SEGMENTS, SEGMENT_LABEL_KO } from '@/lib/money/segments';
import { ScoreBreakdown } from '@/components/trust/score-breakdown';
import { assureView, basisFromOffers, currentFirmQuote, laneKey, loadAssureConfig, myInterestKinds } from '@/lib/server/assure';
import { AssurePanel } from '@/components/assure/assure-panel';
import { contractParty } from '@/lib/server/alliance';
import { cargoToSearch } from '@/lib/cargo-params';
// v2 6차 scorecard — 성적 칩 · 실질 비용(견적가 + 예상 지연 비용)
import { indexSnaps, loadScorecardConfig, namedSnaps, snapKey, type Snap } from '@/lib/server/scorecard';
import { delayBaseline, realCost, type RealCostResult } from '@/lib/money';
import { loadSalesView } from '@/lib/server/sales';
import { env } from '@/lib/env';
import { ScoreChips } from '@/components/scorecard/parts';
import { RealCostPanel } from '@/components/scorecard/real-cost';

export const metadata = { title: '같은 조건 비교' };

const SORTS: [SortKey, string][] = [
  ['recommend', SORT_LABEL.recommend],
  ['cheapest', SORT_LABEL.cheapest],
  ['fastest', SORT_LABEL.fastest],
  ['deviation', SORT_LABEL.deviation],
];

export default async function ComparePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const v = await requireViewer('app');
  const ref = await getReference();
  const cq = parseCargoQuery(sp);
  const view = (['rows', 'cards', 'table'].includes(sp.view ?? '') ? sp.view : 'rows') as 'rows' | 'cards' | 'table';
  const sort = (SORTS.some(([k]) => k === sp.sort) ? sp.sort : 'recommend') as SortKey;
  const f = { confirmedOnly: sp.conf === '1', fcReadyOnly: sp.fcr === '1', officialOnly: sp.off === '1' };
  const withRelated = sp.rel === '1';
  const today = todayKst();
  const { result, skus, traitNotes, assure, score } = await asUser(v, async (q) => {
    const s = await loadSettings(q);
    const [result, skus, traitNotes] = await Promise.all([
      compare(q, { hub: cq.hub, port: cq.port, mode: cq.mode, cargo: toCargo(cq), traits: cq.traits, fc: cq.fc }, s, today),
      listSkus(q, v.org.id),
      loadTraitNotes(q),
    ]);
    // v2 assure — 확정가·보장 참고(스위치 꺼짐이면 참고 숫자 + 관심 등록만)
    const [config, mine, current] = await Promise.all([loadAssureConfig(q), myInterestKinds(q, v.id), currentFirmQuote(q, v.org.id, { laneKey: laneKey(cq) })]);
    const assureBasis = basisFromOffers(result.offers);
    const party = await contractParty(q, assureBasis.lead?.partnerId); // v2 alliance — 확정가 계약 상대(꺼짐이면 null)
    const assure = { view: assureView(config, assureBasis), mine: [...mine], current, party };
    const score = { snaps: await namedSnaps(q), cfg: await loadScorecardConfig(q) };
    return { result, skus, traitNotes, assure, score };
  });
  // 특수관계 업체는 기본으로 순위에서 뺀다 — 「특수관계 포함」을 켜면 넣고, 1위가 특수관계면 경고 띠
  const ranked = rankOffers(filterOffers(result.offers, f), { sort, includeRelated: withRelated });
  const offers = ranked.list;
  const ad = result.ad && filterOffers([result.ad], f).length && (withRelated || !result.ad.partner.related_party_note) ? result.ad : null;
  const list = ad ? offers.filter((o) => o.cardId !== ad.cardId) : offers;
  const scaleMax = Math.max(1, ...offers.map((o) => o.quote.total));

  // v2 6차 scorecard — 업체 성적(이 항구 × 방식 판) · 실질 비용. 판매량·마진: 셀러가 넣은 값 → 판매 분석(고른 SKU) → 없으면 지연 일수만
  const sIdx = indexSnaps(score.snaps);
  const minN = score.cfg.rules.minSamples;
  const statOf = (o: Offer): Snap | null => {
    const r = sIdx.get(snapKey('partner', o.partner.id, cq.port, o.mode));
    return r && r.n >= minN && r.metrics.clear ? r : null;
  };
  const allOf = (o: Offer): Snap | null => sIdx.get(snapKey('partner', o.partner.id)) ?? null;
  const num0 = (x: string | undefined, max: number) => {
    const n = Number(x);
    return x != null && x !== '' && Number.isFinite(n) && n >= 0 && n <= max ? n : null;
  };
  let perDay = num0(sp.ds, 100_000);
  let margin = num0(sp.mg, 10_000_000);
  let salesBasis: 'input' | 'sales' | null = perDay != null && margin != null ? 'input' : null;
  if (!salesBasis && sp.sku) {
    const sv = await loadSalesView(v, 30, env.wingEnabled).catch(() => null);
    const pr = sv && !sv.preview ? sv.analysis.products.find((p) => p.skuId === sp.sku) : null;
    if (pr && pr.perDay > 0 && pr.pnl) {
      perDay = perDay ?? Math.round(pr.perDay * 100) / 100;
      margin = margin ?? pr.pnl.profit;
      salesBasis = 'sales';
    }
  }
  const overallPm = sIdx.get(snapKey('overall', null, cq.port, cq.mode ?? null));
  const baseline = delayBaseline(offers.map((o) => statOf(o)?.metrics.clear ?? null), overallPm && overallPm.n >= minN ? (overallPm.metrics.clear?.p50 ?? null) : null);
  const real = new Map<string, RealCostResult>(
    [...offers, ...(result.ad ? [result.ad] : [])].map((o) => {
      const st = statOf(o)?.metrics.clear ?? null;
      return [o.cardId, realCost({ quote: o.quote.total, stat: st, baselineDays: baseline?.days ?? null, perDay: salesBasis ? perDay : null, marginPerUnit: salesBasis ? margin : null })];
    }),
  );

  const qs = (patch: Record<string, string | null>) => {
    const p = new URLSearchParams(Object.entries(sp).filter(([, x]) => x != null) as [string, string][]);
    for (const [k, x] of Object.entries(patch)) (x == null ? p.delete(k) : p.set(k, x));
    return `/app/compare?${p}`;
  };
  const traitNames = cq.traits.map((t) => ref.traits.find((x) => x.code === t)?.name_ko ?? t);
  const summary = `${nameOf(ref, 'hub', cq.hub)} → ${nameOf(ref, 'port', cq.port)} · ${cq.mode ? nameOf(ref, 'mode', cq.mode) : '방식 상관없음'} · ${num(cq.units)}개 · ${cq.cartons}박스 · ${num(cq.kg, 1)} kg · ${num(cq.cbm, 2)} CBM · 물품가 ${num(cq.goods)} ${cq.cur}${traitNames.length ? ` · ${traitNames.join('·')}` : ''}`;
  const requestHref = (o?: Offer) => {
    const p = new URLSearchParams({ hub: cq.hub, port: cq.port, mode: o?.mode ?? cq.mode ?? 'ANY', units: String(cq.units), cartons: String(cq.cartons), kg: String(cq.kg), cbm: String(cq.cbm), goods: String(cq.goods), cur: cq.cur, fc: cq.fc });
    if (cq.traits.length) p.set('traits', cq.traits.join(','));
    if (sp.sku) p.set('sku', sp.sku);
    return `/app/requests/new?${p}`;
  };

  return (
    <>
      <PageTitle
        title="같은 조건 비교"
        sub="업체마다 다른 견적을 9구간에 맞추고, 맡지 않는 구간은 플랫폼 참고치로 채워 같은 조건으로 봅니다."
        actions={<Button asChild variant="primary"><Link href={requestHref()}>{ACTION.newRequest}</Link></Button>}
      />
      <Suspense>
        <CompareEditor
          initial={{ hub: cq.hub, port: cq.port, mode: cq.mode ?? 'ANY', units: cq.units, cartons: cq.cartons, kg: cq.kg, cbm: cq.cbm, goods: cq.goods, cur: cq.cur, fc: cq.fc, traits: cq.traits, skuId: sp.sku ?? null }}
          summary={summary}
          hubs={ref.hubs}
          fcs={ref.fcs}
          traits={ref.traits}
          skus={skus.map((s) => ({ ...s }))}
          startOpen={!sp.hub}
        />
      </Suspense>

      {result.destination ? <DestinationNote name={result.destination.name} kind={result.destination.kind} className="mt-4" /> : null}
      {result.verdicts.length ? (
        <section aria-labelledby="verdict" className="mt-4 rounded-md border border-caution/40 bg-caution-bg p-4">
          <h2 id="verdict" className="flex items-center gap-2 text-sm font-bold text-caution">
            <AlertTriangle className="size-4" aria-hidden /> 사전 판정
          </h2>
          <ul className="mt-2 grid gap-1.5 text-sm">
            {result.verdicts.map((x) => (
              <li key={x.code}>
                <b>{x.name_ko}</b> — {x.verdict_ko} <span className="text-muted">{x.requirement_ko}</span>
                {traitNotes.find((n) => n.trait === x.code)?.items.length ? (
                  <span className="mt-0.5 block text-xs text-caution">추가비용 가능: {traitNotes.find((n) => n.trait === x.code)!.items.join(' · ')}</span>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-sm border border-line bg-surface p-0.5" role="group" aria-label="보기">
          {([
            ['rows', '줄', List],
            ['cards', '카드', LayoutGrid],
            ['table', '9구간 표', Table2],
          ] as const).map(([k, l, I]) => (
            <Link key={k} href={qs({ view: k === 'rows' ? null : k })} scroll={false} aria-current={view === k ? 'true' : undefined} className={cn('inline-flex h-8 items-center gap-1.5 rounded-[4px] px-3 text-sm font-semibold', view === k ? 'bg-ink text-on-ink' : 'text-muted hover:text-text')}>
              <I className="size-4" aria-hidden /> {l}
            </Link>
          ))}
        </div>
        <div className="inline-flex flex-wrap rounded-sm border border-line bg-surface p-0.5" role="group" aria-label="정렬">
          {SORTS.map(([k, l]) => (
            <Link key={k} href={qs({ sort: k === 'recommend' ? null : k })} scroll={false} aria-current={sort === k ? 'true' : undefined} className={cn('h-8 rounded-[4px] px-3 text-sm font-semibold leading-8', sort === k ? 'bg-ink text-on-ink' : 'text-muted hover:text-text')}>
              {l}
            </Link>
          ))}
        </div>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="필터">
          {([
            ['conf', '확정 견적만', f.confirmedOnly],
            ['fcr', 'FC 입고 준비 인증만', f.fcReadyOnly],
            ['off', '공식 등록만', f.officialOnly],
          ] as const).map(([k, l, on]) => (
            <Link key={k} href={qs({ [k]: on ? null : '1' })} scroll={false} aria-pressed={on} className={cn('inline-flex h-9 items-center gap-1.5 rounded-xs border px-3 text-sm font-semibold', on ? 'border-ink bg-ink text-on-ink' : 'border-line bg-surface hover:border-muted/60')}>
              <span className={cn('grid size-4 place-items-center rounded-[2px] border text-2xs', on ? 'border-label bg-label text-on-label' : 'border-muted/60')}>{on ? '✓' : ''}</span>
              {l}
            </Link>
          ))}
          <Link href={qs({ rel: withRelated ? null : '1' })} scroll={false} aria-pressed={withRelated} className={cn('inline-flex h-9 items-center gap-1.5 rounded-xs border px-3 text-sm font-semibold', withRelated ? 'border-ink bg-ink text-on-ink' : 'border-line bg-surface hover:border-muted/60')}>
            <span className={cn('grid size-4 place-items-center rounded-[2px] border text-2xs', withRelated ? 'border-label bg-label text-on-label' : 'border-muted/60')}>{withRelated ? '✓' : ''}</span>
            특수관계 포함
          </Link>
        </div>
      </div>
      <p className="mt-3 text-xs text-muted" data-testid="compare-sort-now">
        현재 기준: <b className="text-text">{SORT_LABEL[sort]}</b> · 비교 {offers.length}곳 · 제외 {result.excluded.length}곳 · 만료 요금표 {result.expired.length}장
        {ranked.relatedHidden ? ` · 특수관계 업체 ${ranked.relatedHidden}곳은 순위에서 뺐습니다(「특수관계 포함」으로 보기)` : ''} · 추천 점수 = 정시 입고 30 · 청구 편차 25 · FC 회송률 25 · 가격 확실성 20 (광고·특수관계는 점수 밖)
        {offers.some((o) => !o.sampleEnough) ? ` · 최근 ${offers[0].trust.sample.days}일 끝난 선적이 ${offers[0].trust.sample.min}건 미만인 업체는 점수 대신 「표본 부족」으로 적고${sort === 'recommend' ? ' 추천순에서 뒤에 둡니다' : ''}` : ''}
      </p>
      {ranked.relatedTop && offers[0] ? (
        <p role="alert" className="mt-3 flex items-start gap-2 rounded-md border border-caution/40 bg-caution-bg px-4 py-2.5 text-sm font-semibold text-caution">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            1위 {offers[0].partner.name} — 플랫폼과 특수관계인 업체입니다{offers[0].partner.related_party_note ? `(${offers[0].partner.related_party_note.trim().replace(/[.。]$/, '')})` : ''}. 순위는 같은 기준으로 매겼지만 함께 판단해 주세요.
          </span>
        </p>
      ) : null}

      {offers.length ? (
        <RealCostPanel
          hidden={Object.entries(sp).filter(([k, x]) => x != null && k !== 'ds' && k !== 'mg') as [string, string][]}
          perDay={perDay}
          margin={margin}
          basis={salesBasis}
          baseline={baseline}
          portName={nameOf(ref, 'port', cq.port)}
          rows={list.slice(0, 6).map((o) => ({ name: o.partner.name, quote: o.quote.total, real: real.get(o.cardId) ?? null }))}
        />
      ) : null}
      {offers.length === 0 ? (
        <Panel className="mt-3">
          <EmptyState
            title={result.offers.length ? '필터에 맞는 업체가 없습니다' : '이 조건에 맞는 요금표가 없습니다'}
            body={result.offers.length ? '필터를 하나씩 풀어 보세요.' : '방식을 「상관없음」으로 바꾸거나, 견적 요청을 올려 업체들의 응찰을 받아 보세요.'}
            action={
              result.offers.length ? <Button asChild variant="secondary"><Link href={qs({ conf: null, fcr: null, off: null })}>필터 지우기</Link></Button> : <Button asChild variant="primary"><Link href={requestHref()}>{ACTION.newRequest}</Link></Button>
            }
          />
        </Panel>
      ) : view === 'table' ? (
        <Panel className="mt-3 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1100px] border-separate border-spacing-0 text-xs tnum">
              <caption className="sr-only">업체별 9구간 금액</caption>
              <thead className="bg-surface-2 text-muted">
                <tr>
                  <th scope="col" className="sticky left-0 z-10 bg-surface-2 px-3 py-2 text-left font-semibold">업체</th>
                  {SEGMENTS.map((s, i) => (
                    <th key={s} scope="col" className="px-2 py-2 text-right font-semibold">
                      <span className="mr-1 inline-block size-2 rounded-[1px] align-middle" style={{ background: `var(--seg-${i + 1})` }} />
                      {SEGMENTS_SHORT[s]}
                    </th>
                  ))}
                  <th scope="col" className="px-3 py-2 text-right font-semibold">확정 합계</th>
                  <th scope="col" className="px-3 py-2 text-right font-semibold">참고치 포함 합계</th>
                  <th scope="col" className="px-3 py-2 text-right font-semibold">개당</th>
                </tr>
              </thead>
              <tbody>
                {[...(ad ? [ad] : []), ...list].map((o) => (
                  <tr key={o.cardId} className="hover:bg-surface-2">
                    <th scope="row" className="sticky left-0 z-10 border-t border-line-2 bg-surface px-3 py-2 text-left font-semibold">
                      <span className="flex items-center gap-1.5">
                        {o === ad ? <AdChip /> : null}
                        <Link href={`/p/${o.partner.slug}`} className="hover:underline">{o.partner.name}</Link>
                      </span>
                      <span className="block text-2xs font-normal text-muted">{nameOf(ref, 'mode', o.mode)} · {o.transit[0]}~{o.transit[1]}일</span>
                    </th>
                    {o.quote.segments.map((s) => (
                      <td key={s.segment} className={cn('border-t border-line-2 px-2 py-2 text-right', s.filled && 'text-muted italic', s.certainty === 'extra_possible' && 'text-caution')}>
                        {s.amount == null ? '—' : num(s.amount)}
                        <span className="block text-2xs not-italic text-muted">{s.filled ? '참고치' : s.certainty === 'estimated' ? '예상' : s.certainty === 'extra_possible' ? '추가 가능' : ''}</span>
                      </td>
                    ))}
                    <td className="border-t border-line-2 px-3 py-2 text-right">{num(totalsBreakdown(o.quote.segments).confirmed)}</td>
                    <td className="border-t border-line-2 px-3 py-2 text-right text-sm font-bold">{num(o.quote.total)}</td>
                    <td className="border-t border-line-2 px-3 py-2 text-right">{num(o.quote.perUnit)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="border-t border-line-2 px-4 py-2 text-2xs text-muted">단위: 원. 기울인 숫자는 업체가 맡지 않아 플랫폼 참고치로 채운 칸입니다(확정 합계에 넣지 않음). 관세사 칸은 수수료 기준에서 뺍니다.</div>
        </Panel>
      ) : (
        <div className={cn('mt-3', view === 'cards' ? 'grid gap-3 md:grid-cols-2 xl:grid-cols-3' : 'grid gap-2')}>
          {ad ? <OfferItem o={ad} rank={0} ad scaleMax={scaleMax} card={view === 'cards'} requestHref={requestHref(ad)} modeName={nameOf(ref, 'mode', ad.mode)} score={statOf(ad) ?? allOf(ad)} certified={!!allOf(ad)?.certified} minN={minN} real={real.get(ad.cardId) ?? null} /> : null}
          {list.map((o, i) => (
            <OfferItem key={o.cardId} o={o} rank={i + 1} scaleMax={scaleMax} card={view === 'cards'} requestHref={requestHref(o)} modeName={nameOf(ref, 'mode', o.mode)} score={statOf(o) ?? allOf(o)} certified={!!allOf(o)?.certified} minN={minN} real={real.get(o.cardId) ?? null} />
          ))}
        </div>
      )}
      <NineBarLegend className="mt-3" />
      <AssurePanel
        view={assure.view}
        mine={assure.mine}
        current={assure.current}
        party={assure.party}
        sampleLabel="요금표"
        modeLabel={assure.view.mode ? nameOf(ref, 'mode', assure.view.mode) : null}
        ctx={{ source: 'compare', query: cargoToSearch({ hub: cq.hub, port: cq.port, mode: cq.mode, units: cq.units, cartons: cq.cartons, kg: cq.kg, cbm: cq.cbm, goods: cq.goods, cur: cq.cur, fc: cq.fc, traits: cq.traits }) }}
      />

      {result.excluded.length ? (
        <details className="group mt-6 rounded-md border border-line bg-surface">
          <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm font-bold [&::-webkit-details-marker]:hidden">
            <ChevronDown className="size-4 transition-transform group-open:rotate-180" aria-hidden /> 제외된 업체 {result.excluded.length}곳과 사유
          </summary>
          <ul className="border-t border-line-2">
            {result.excluded.map((o) => (
              <li key={o.cardId} className="flex flex-wrap items-center gap-2 border-b border-line-2 px-4 py-2.5 text-sm last:border-0">
                <span className="font-semibold">{o.partner.name}</span>
                <span className="text-xs text-muted">{nameOf(ref, 'mode', o.mode)}</span>
                <span className="flex-1" />
                {o.exclusions.map((e, i) => (
                  <Chip key={i} tone="stamp">{reasonText(e)}</Chip>
                ))}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      {result.expired.length ? (
        <details className="group mt-3 rounded-md border border-line bg-surface">
          <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm font-bold [&::-webkit-details-marker]:hidden">
            <FileClock className="size-4 text-muted" aria-hidden /> 만료 요금표 {result.expired.length}장 — 비교에서 뺐습니다
          </summary>
          <ul className="border-t border-line-2">
            {result.expired.map((o) => (
              <li key={o.cardId} className="flex flex-wrap items-center gap-3 border-b border-line-2 px-4 py-2.5 text-sm last:border-0">
                <span className="font-semibold">{o.partner.name}</span>
                <span className="text-xs text-muted">{nameOf(ref, 'mode', o.mode)} · {dateKo(o.validTo, { dow: false })} 만료</span>
                <span className="flex-1" />
                <span className="text-xs text-muted">만료 당시 {won(o.quote.total)}</span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      <p className="mt-6 flex items-start gap-2 text-2xs text-muted">
        <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        가격은 각 업체가 제공한 요금표로 계산합니다. 운송계약은 업체와 직접 맺습니다. 관세·부가세는 판매손익에서 참고 추정으로 봅니다.
      </p>
    </>
  );
}

function OfferItem({ o, rank, ad, scaleMax, card, requestHref, modeName, score, certified, minN, real }: { o: Offer; rank: number; ad?: boolean; scaleMax: number; card: boolean; requestHref: string; modeName: string; score: Snap | null; certified: boolean; minN: number; real: RealCostResult | null }) {
  const certainty = o.quote.total ? o.raw.confirmedTotal / o.quote.total : 0;
  const m = o.metrics;
  const t = totalsBreakdown(o.quote.segments);
  return (
    <article className={cn('min-w-0 rounded-md border bg-surface', ad ? 'border-ink' : 'border-line')}>
      <div className={cn('grid gap-3 p-4', !card && 'lg:grid-cols-[minmax(0,260px)_minmax(0,1fr)_200px] lg:items-center')}>
        <div className="flex min-w-0 items-start gap-3">
          <span className="w-5 pt-1 text-center text-xs font-bold text-muted tnum">{ad ? '' : rank}</span>
          <LetterMark name={o.partner.name} logo={o.partner.logo_path} size={36} />
          <div className="min-w-0">
            <h3 className="truncate text-sm font-bold">
              <a href={`/p/${o.partner.slug}`} className="hover:underline">{o.partner.name}</a>
            </h3>
            <div className="mt-1 flex flex-wrap gap-1">
              {ad ? <AdChip /> : null}
              <PartnerStatusChip status={o.partner.status} />
              {o.fcReady ? <FcReadyChip /> : null}
              {o.partner.related_party_note ? <RelatedChip note={o.partner.related_party_note} /> : null}
            </div>
          </div>
        </div>
        <div className="min-w-0">
          <NineBar segments={o.quote.segments} size="md" scaleMax={card ? undefined : scaleMax} label={o.partner.name} />
          <p className="mt-2 text-2xs text-muted">
            {modeName} · {o.transit[0]}~{o.transit[1]}일 · 확정 {pct(certainty, 0)}
            {o.raw.extraPossible.length ? <span className="text-caution"> · 추가비용 가능: {o.raw.extraPossible.map((s) => SEGMENT_LABEL_KO[s]).join('·')}</span> : null}
            {o.quote.filled.length ? ` · 참고치 ${o.quote.filled.length}칸` : ''}
            {o.fuelSeparate ? ' · 유류할증 별도' : ''} · {dateKo(o.validTo, { dow: false })}까지{o.daysLeft <= 10 ? <span className="font-semibold text-caution">(곧 만료)</span> : null} · 제공 {dateKo(o.createdAt, { dow: false })} · {o.cardNo} v{o.version}
          </p>
          <ScoreBreakdown variant="inline" className="mt-1" parts={o.parts} score={o.score} trust={o.trust} metrics={m} certainty={certainty} />
          <ScoreChips s={score} minSamples={minN} compact certified={certified} className="mt-1.5" />
          {real?.usual ? (
            <p className="mt-1 text-2xs text-muted tnum" data-testid="offer-real-cost">
              실질 비용 평소 {real.usual.total != null ? <b className="text-text">{won(real.usual.total)}</b> : '—'}(지연 {real.usual.delayDays}일) · 늦을 때 {real.late?.total != null ? <b className="text-text">{won(real.late.total)}</b> : '—'}(지연 {real.late?.delayDays}일)
            </p>
          ) : null}
        </div>
        <div className={cn('flex flex-wrap items-end justify-between gap-3', !card && 'lg:flex-col lg:flex-nowrap lg:items-end')}>
          <div className={cn(!card && 'lg:text-right')}>
            <Won v={o.quote.total} className="block text-lg font-bold" />
            <span className="block text-xs text-muted tnum">개당 {num(o.quote.perUnit)}원</span>
            <span className="block text-2xs text-muted tnum">
              확정 합계 {num(t.confirmed)}원{t.referenceCount ? ` · 참고치 포함 합계 ${num(t.withReference)}원` : ''}
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Tooltip
              content={
                <span className="grid gap-0.5 tnum">
                  <b>{o.sampleEnough ? `추천 ${o.score}점` : `표본 부족(${o.trust.sample.n}건) — 점수를 내지 않습니다`}</b>
                  {o.sampleEnough ? (
                    <>
                  <span>정시 입고 {o.parts.onTime.toFixed(1)} / 30 {m?.shipments_done ? `(${pct(m.on_time_rate, 0)})` : '(실측 없음)'}</span>
                  <span>청구 편차 {o.parts.deviation.toFixed(1)} / 25 {m?.invoiced_count ? `(${pct(m.avg_deviation, 1)})` : '(실측 없음)'}</span>
                  <span>FC 회송률 {o.parts.fcReturn.toFixed(1)} / 25 {m?.done_30d ? `(${pct(m.return_rate_30d, 1)})` : '(실측 없음)'}</span>
                  <span>가격 확실성 {o.parts.certainty.toFixed(1)} / 20</span>
                    </>
                  ) : (
                    <span>최근 {o.trust.sample.days}일 끝난 선적 {o.trust.sample.n}건 · 기준 {o.trust.sample.min}건</span>
                  )}
                </span>
              }
            >
              <button type="button" className="h-8 shrink-0 whitespace-nowrap rounded-xs border border-line px-2 text-xs font-bold tnum hover:border-muted/60">{o.sampleEnough ? `추천 ${o.score}` : `표본 부족(${o.trust.sample.n}건)`}</button>
            </Tooltip>
            <Button asChild size="sm" variant="primary">
              <a href={requestHref}>견적 요청</a>
            </Button>
          </div>
        </div>
      </div>
    </article>
  );
}
