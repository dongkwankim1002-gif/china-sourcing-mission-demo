import Link from 'next/link';
import { Suspense } from 'react';
import { AlertTriangle, ChevronDown, FileClock, Info, LayoutGrid, List, Table2 } from 'lucide-react';
import { asUser, todayKst } from '@/lib/db';
import { requireViewer } from '@/lib/server/viewer';
import { compare, filterOffers, rankOffers, SORT_LABEL, type Offer, type SortKey } from '@/lib/server/compare';
import { loadSettings } from '@/lib/server/settings';
import { getReference, nameOf } from '@/lib/server/reference';
import { listSkus } from '@/lib/server/shipper';
import { parseCargoQuery, toCargo } from '@/lib/cargo-params';
import { reasonText, totalsBreakdown } from '@/lib/money';
import { LetterMark } from '@/components/brand-mark';
import { NineBar, NineBarLegend } from '@/components/nine-bar';
import { AdChip, FcReadyChip, PartnerStatusChip, RelatedChip, Won } from '@/components/badges';
import { Button, Chip, EmptyState, PageTitle, Panel } from '@/components/ui/core';
import { Tooltip } from '@/components/ui/radix';
import { CompareEditor } from './editor';
import { cn } from '@/lib/cn';
import { dateKo, num, pct, won } from '@/lib/format';
import { ACTION, SEGMENTS_SHORT } from './labels';
import { SEGMENTS, SEGMENT_LABEL_KO } from '@/lib/money/segments';

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
  const { result, skus } = await asUser(v, async (q) => {
    const s = await loadSettings(q);
    const [result, skus] = await Promise.all([
      compare(q, { hub: cq.hub, port: cq.port, mode: cq.mode, cargo: toCargo(cq), traits: cq.traits }, s, today),
      listSkus(q, v.org.id),
    ]);
    return { result, skus };
  });
  // 특수관계 업체는 기본으로 순위에서 뺀다 — 「특수관계 포함」을 켜면 넣고, 1위가 특수관계면 경고 띠
  const ranked = rankOffers(filterOffers(result.offers, f), { sort, includeRelated: withRelated });
  const offers = ranked.list;
  const ad = result.ad && filterOffers([result.ad], f).length && (withRelated || !result.ad.partner.related_party_note) ? result.ad : null;
  const list = ad ? offers.filter((o) => o.cardId !== ad.cardId) : offers;
  const scaleMax = Math.max(1, ...offers.map((o) => o.quote.total));

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

      {result.verdicts.length ? (
        <section aria-labelledby="verdict" className="mt-4 rounded-md border border-caution/40 bg-caution-bg p-4">
          <h2 id="verdict" className="flex items-center gap-2 text-sm font-bold text-caution">
            <AlertTriangle className="size-4" aria-hidden /> 사전 판정
          </h2>
          <ul className="mt-2 grid gap-1.5 text-sm">
            {result.verdicts.map((x) => (
              <li key={x.code}>
                <b>{x.name_ko}</b> — {x.verdict_ko} <span className="text-muted">{x.requirement_ko}</span>
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
        {ranked.relatedHidden ? ` · 특수관계 업체 ${ranked.relatedHidden}곳은 순위에서 뺐습니다(「특수관계 포함」으로 보기)` : ''} · 추천 점수 = 정시 입고 30 · 청구 편차 25 · FC 회송률 25 · 가격확정도 20 (광고·특수관계는 점수 밖)
      </p>
      {ranked.relatedTop && offers[0] ? (
        <p role="alert" className="mt-3 flex items-start gap-2 rounded-md border border-caution/40 bg-caution-bg px-4 py-2.5 text-sm font-semibold text-caution">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            1위 {offers[0].partner.name} — 플랫폼과 특수관계인 업체입니다{offers[0].partner.related_party_note ? `(${offers[0].partner.related_party_note.trim().replace(/[.。]$/, '')})` : ''}. 순위는 같은 기준으로 매겼지만 함께 판단해 주세요.
          </span>
        </p>
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
          {ad ? <OfferItem o={ad} rank={0} ad scaleMax={scaleMax} card={view === 'cards'} requestHref={requestHref(ad)} modeName={nameOf(ref, 'mode', ad.mode)} /> : null}
          {list.map((o, i) => (
            <OfferItem key={o.cardId} o={o} rank={i + 1} scaleMax={scaleMax} card={view === 'cards'} requestHref={requestHref(o)} modeName={nameOf(ref, 'mode', o.mode)} />
          ))}
        </div>
      )}
      <NineBarLegend className="mt-3" />

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

function OfferItem({ o, rank, ad, scaleMax, card, requestHref, modeName }: { o: Offer; rank: number; ad?: boolean; scaleMax: number; card: boolean; requestHref: string; modeName: string }) {
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
        </div>
        <div className={cn('flex items-end justify-between gap-3', !card && 'lg:flex-col lg:items-end')}>
          <div className={cn(!card && 'lg:text-right')}>
            <Won v={o.quote.total} className="block text-lg font-bold" />
            <span className="block text-xs text-muted tnum">개당 {num(o.quote.perUnit)}원</span>
            <span className="block text-2xs text-muted tnum">
              확정 합계 {num(t.confirmed)}원{t.referenceCount ? ` · 참고치 포함 합계 ${num(t.withReference)}원` : ''}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Tooltip
              content={
                <span className="grid gap-0.5 tnum">
                  <b>추천 {o.score}점</b>
                  <span>정시 입고 {o.parts.onTime.toFixed(1)} / 30 {m?.shipments_done ? `(${pct(m.on_time_rate, 0)})` : '(실측 없음)'}</span>
                  <span>청구 편차 {o.parts.deviation.toFixed(1)} / 25 {m?.invoiced_count ? `(${pct(m.avg_deviation, 1)})` : '(실측 없음)'}</span>
                  <span>FC 회송률 {o.parts.fcReturn.toFixed(1)} / 25 {m?.done_30d ? `(${pct(m.return_rate_30d, 1)})` : '(실측 없음)'}</span>
                  <span>가격확정도 {o.parts.certainty.toFixed(1)} / 20</span>
                </span>
              }
            >
              <button type="button" className="h-8 rounded-xs border border-line px-2 text-xs font-bold tnum hover:border-muted/60">추천 {o.score}</button>
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
