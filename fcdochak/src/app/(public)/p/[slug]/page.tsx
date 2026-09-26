import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ExternalLink, Info } from 'lucide-react';
import { listPartners, partnerBySlug, partnerPageReviews, STANDARD_CARGO } from '@/lib/server/public';
import { getReference, nameOf } from '@/lib/server/reference';
import { loadCards } from '@/lib/server/compare';
import { loadSettings } from '@/lib/server/settings';
import { asPublic, todayKst } from '@/lib/db';
import { completeWithReference, computeQuote, recommendScore, scoreParts, type Segment } from '@/lib/money';
import { ScoreBreakdown } from '@/components/trust/score-breakdown';
import { ReviewItem } from '@/components/trust/review-item';
import { LetterMark } from '@/components/brand-mark';
import { FcReadyChip, PartnerStatusChip, RelatedChip } from '@/components/badges';
import { NineBar } from '@/components/nine-bar';
import { ListingActions } from '@/components/public/listing-forms';
import { Chip, DefList, EmptyState, Panel, PanelHead } from '@/components/ui/core';
import { JsonLd } from '@/components/json-ld';
import { env } from '@/lib/env';
import { dateKo, notFuture, num, pct, won, ymdDots } from '@/lib/format';
import { BIZ_TYPE_LABEL } from '@/lib/terms';
import { partnerLeadTimes } from '@/lib/server/tracker'; // v2 5차 tracker
import { PartnerLeadTime } from '@/components/tracker/partner-lead';
import { EntityTabs } from '@/components/scorecard/entity-tabs'; // v2 6차 scorecard — 「성적표」 탭(5차 실측 칸을 이 탭으로 합침)

export const revalidate = 3600;
export const dynamicParams = true;

export async function generateStaticParams() {
  const all = await listPartners();
  return all.map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const d = await partnerBySlug(slug);
  if (!d) return { title: '업체를 찾을 수 없습니다', robots: { index: false } };
  const p = d.partner;
  return {
    title: `${p.name}${p.name_zh ? ` (${p.name_zh})` : ''} — ${BIZ_TYPE_LABEL[p.business_type ?? ''] ?? '물류'} · ${p.hq_city ?? ''}`,
    description:
      p.status === 'official'
        ? `${p.name} 요금표와 실측 점수(정시 입고·청구 편차·FC 회송률). 중국 → 쿠팡 FC 물류.`
        : `${p.name} — 공개정보 기준 회사 정보와 노선. 확인일 ${ymdDots(p.public_checked_on)}.`,
    alternates: { canonical: `/p/${p.slug}` },
  };
}

export default async function PartnerPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [d, ref] = await Promise.all([partnerBySlug(slug), getReference()]);
  if (!d) notFound();
  const { partner: p, caps, metrics, fcReady, publicCards, trust, scoreCaps } = d;
  const official = p.status === 'official' || p.status === 'pending_verification';
  const reviews = official ? await partnerPageReviews(p.id) : [];
  const leadTimes = official ? await asPublic((q) => partnerLeadTimes(q, p.id)) : [];

  // 공개가 요금표 — 기준 화물로 계산(비로그인이 볼 수 있는 것만)
  const priced = official
    ? await asPublic(async (q) => {
        const s = await loadSettings(q);
        const refQ = computeQuote(s.referenceLines, STANDARD_CARGO, s.quoteParams);
        const reference = Object.fromEntries(refQ.segments.map((x) => [x.segment, x.amount])) as Partial<Record<Segment, number>>;
        const out: { lane: string; mode: string; validTo: string; total: number; segs: ReturnType<typeof computeQuote>['segments'] }[] = [];
        // 요금표를 구간마다 따로 읽지 않고 한 번에 읽는다(DB 가 먼 빌드 서버에서 왕복을 줄인다). 순서는 공개 요금표 순서대로.
        const { cards, lines, tiers } = publicCards.length
          ? await loadCards(q, { hub: null, port: null, mode: null, cardIds: publicCards.map((c) => c.id) })
          : { cards: [], lines: new Map(), tiers: new Map() };
        const order = new Map(publicCards.map((c, i) => [c.id, i]));
        for (const c of [...cards].sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))) {
          const ls = lines.get(c.id) ?? [];
          if (!ls.length) continue;
          const r = completeWithReference(computeQuote(ls, STANDARD_CARGO, s.quoteParams, tiers.get(c.id) ?? []), reference, STANDARD_CARGO.units);
          out.push({ lane: `${nameOf(ref, 'hub', c.origin_hub)} → ${nameOf(ref, 'port', c.port)}`, mode: nameOf(ref, 'mode', c.mode), validTo: c.valid_to, total: r.total, segs: r.segments });
        }
        return out;
      })
    : [];

  const hubs = (p.hubs ?? []).map((h) => nameOf(ref, 'hub', h));
  const modes = (p.modes ?? []).map((m) => nameOf(ref, 'mode', m));
  const m = metrics as Record<string, number | null> | null;
  // 추천 점수 항목별 — 비교 화면과 같은 함수. 가격 확실성은 요금표마다 다르므로 여기서는 최근 180일 응찰의 확정 구간 비중
  const certainty = m?.price_certainty ?? null;
  const scoreInput = {
    onTimeRate: m?.shipments_done ? (m.on_time_rate ?? null) : null,
    avgDeviation: m?.invoiced_count ? (m.avg_deviation ?? null) : null,
    fcReturnRate: m?.done_30d ? (m.return_rate_30d ?? null) : null,
    priceCertainty: certainty ?? 0,
  };
  const parts = scoreParts(scoreInput, scoreCaps);
  const score = recommendScore(scoreInput, scoreCaps);
  const metricsView = m ? { shipments_done: m.shipments_done, on_time_rate: m.on_time_rate, return_rate_30d: m.return_rate_30d, done_30d: m.done_30d, invoiced_count: m.invoiced_count } : null;

  return (
    <div className="mx-auto max-w-[1280px] px-4 py-10">
      <JsonLd
        data={{
          '@context': 'https://schema.org',
          '@type': 'Organization',
          name: p.name,
          alternateName: p.name_zh ?? undefined,
          address: p.address ?? undefined,
          telephone: p.phone ?? undefined,
          url: `${env.siteUrl}/p/${p.slug}`,
          ...(m?.reviews_count ? { aggregateRating: { '@type': 'AggregateRating', ratingValue: Number(m.avg_rating ?? 0).toFixed(1), reviewCount: m.reviews_count, bestRating: 5, worstRating: 1 } } : {}),
        }}
      />
      <nav aria-label="경로" className="text-xs text-muted">
        <Link href="/partners" className="hover:text-text">업체 찾기</Link> / {p.name}
      </nav>
      <header className="mt-3 flex flex-wrap items-start gap-4">
        <LetterMark name={p.name} logo={p.logo_path} size={64} />
        <div className="min-w-0 flex-1">
          <h1 className="display text-[clamp(26px,3.6vw,40px)] leading-tight">{p.name}</h1>
          <p className="text-sm text-muted">{p.name_zh} · {BIZ_TYPE_LABEL[p.business_type ?? ''] ?? ''} · {p.hq_city}</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <PartnerStatusChip status={p.status} />
            {fcReady ? <FcReadyChip /> : null}
            {p.related_party_note ? <RelatedChip note={p.related_party_note} /> : null}
            {p.is_demo ? <Chip tone="label">예시 업체</Chip> : null}
          </div>
        </div>
      </header>

      {p.related_party_note ? (
        <aside className="mt-5 rounded-md border border-caution/40 bg-caution-bg p-4 text-sm">
          <p className="font-bold text-caution">특수관계 공개</p>
          <p className="mt-1 text-text">{p.related_party_note}</p>
          <p className="mt-1 text-xs text-muted">이 관계는 추천 점수에 들어가지 않습니다. 목록 순서는 실측 점수로만 정해집니다.</p>
        </aside>
      ) : null}

      {official ? (
        <div className="mt-6">
        <EntityTabs
          entityId={p.id}
          next={`/p/${p.slug}#scorecard`}
          ports={Object.fromEntries(ref.ports.map((x) => [x.code, x.name_ko]))}
          modes={Object.fromEntries(ref.modes.map((x) => [x.code, x.name_ko]))}
          extra={<PartnerLeadTime rows={leadTimes} portName={(c) => nameOf(ref, 'port', c)} modeName={(c) => nameOf(ref, 'mode', c)} />}
          overview={
        <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="grid min-w-0 gap-6">
            <Panel>
              <PanelHead title="실측 점수" sub="손으로 넣는 칸이 아닙니다 — 선적·청구 기록에서 계산합니다" />
              <dl className="grid grid-cols-2 gap-px bg-line-2 sm:grid-cols-4">
                {[
                  ['정시 입고율', m?.shipments_done ? pct(m.on_time_rate, 0) : '실측 없음', `완료 ${num(m?.shipments_done ?? 0)}건`],
                  ['평균 청구 편차', m?.invoiced_count ? pct(m.avg_signed_deviation, 1, true) : '실측 없음', `청구 ${num(m?.invoiced_count ?? 0)}건`],
                  ['30일 FC 회송률', m?.done_30d ? pct(m.return_rate_30d, 1) : '실측 없음', `30일 입고 ${num(m?.done_30d ?? 0)}건`],
                  ['화주 평가', m?.reviews_count ? `${Number(m.avg_rating).toFixed(1)} / 5` : '평가 없음', `${num(m?.reviews_count ?? 0)}건`],
                ].map(([k, v, s]) => (
                  <div key={k} className="bg-surface p-4">
                    <dt className="text-xs text-muted">{k}</dt>
                    <dd className="display mt-1 text-2xl tnum">{v}</dd>
                    <dd className="text-2xs text-muted">{s}</dd>
                  </div>
                ))}
              </dl>
            </Panel>
            <Panel>
              <PanelHead title="추천 점수 항목" sub="비교 화면의 추천 점수가 어디서 나오는지 — 항목별 점수와 잰 값" />
              <ScoreBreakdown parts={parts} score={score} trust={trust} metrics={metricsView} certainty={certainty} certaintyNote="최근 180일 응찰 기준(비교 화면은 요금표마다 다름)" />
            </Panel>
            <Panel className="cv-auto">
              <PanelHead title="공개 요금" sub={`기준 화물 ${STANDARD_CARGO.cbm} CBM · ${num(STANDARD_CARGO.kg)} kg — 빈 구간은 참고치. 비공개 요금은 가입 후 비교에서`} />
              {priced.length ? (
                <ul>
                  {priced.map((r, i) => (
                    <li key={i} className="grid gap-2 border-b border-line-2 px-4 py-3 last:border-0 sm:grid-cols-[200px_1fr_140px] sm:items-center">
                      <div>
                        <p className="text-sm font-semibold">{r.lane}</p>
                        <p className="text-2xs text-muted">{r.mode} · {dateKo(r.validTo, { dow: false })}까지</p>
                      </div>
                      <NineBar segments={r.segs} size="md" />
                      <p className="text-right text-sm font-bold tnum">{won(r.total)}</p>
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState title="공개한 요금이 없습니다" body="이 업체는 요금을 가입한 화주에게만 보여 줍니다." />
              )}
            </Panel>
            <Panel className="cv-auto">
              <PanelHead title="화주 후기" sub="끝난 선적의 평가 — FC 입고뿐 아니라 회송·입고 반려·분실(미도착)으로 끝난 선적도 싣습니다" />
              {reviews.length ? (
                <ul data-testid="partner-reviews">
                  {notFuture(reviews, todayKst()).map((r) => (
                    <ReviewItem key={r.id} r={r} partnerName={p.name} />
                  ))}
                </ul>
              ) : (
                <EmptyState title="아직 평가가 없습니다" />
              )}
            </Panel>
          </div>
          <aside className="cv-auto grid content-start gap-6">
            <Panel>
              <PanelHead title="회사 정보" />
              <div className="p-4">
                <DefList
                  items={[
                    ['주소', p.address ?? '—'],
                    ['대표 연락처', p.phone ?? '—'],
                    ['거점', hubs.join(' · ') || '—'],
                    ['운송 방식', modes.join(' · ') || '—'],
                    ['취급 능력', caps.map((c) => c.name_ko).join(' · ') || '일반 화물'],
                    ['업역 등록', p.license_no ?? '—'],
                    ['적하보험', p.cargo_insurance ?? '—'],
                    ...(p.website ? [['누리집', <a key="w" href={p.website} rel="nofollow noopener" className="inline-flex items-center gap-1 underline">{p.website.replace(/^https?:\/\//, '')} <ExternalLink className="size-3" /></a>] as [string, React.ReactNode]] : []),
                  ]}
                />
                {p.intro ? <p className="mt-4 border-t border-line-2 pt-4 text-sm leading-6">{p.intro}</p> : null}
              </div>
            </Panel>
          </aside>
        </div>
          }
        />
        </div>
      ) : (
        <div className="mt-6 grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
          <Panel>
            <PanelHead title="공개정보 기준" sub={`확인일 ${ymdDots(p.public_checked_on)} · 출처: ${p.public_source ?? '공개 자료'}`} />
            <div className="p-4">
              <DefList
                items={[
                  ['회사명', p.name],
                  ['주소', p.address ?? '—'],
                  ['대표 연락처', p.phone ?? '—'],
                  ['노선', `${hubs.join(' · ')} / ${modes.join(' · ')}`],
                ]}
              />
              <p className="mt-4 flex items-start gap-2 rounded-sm bg-surface-2 p-3 text-xs text-muted">
                <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                이 페이지는 업체가 직접 올린 것이 아닙니다. 공개된 회사 정보만 싣고, 가격·소개문·사진·담당자 개인 연락처는 싣지 않습니다.
              </p>
            </div>
          </Panel>
          <Panel>
            <PanelHead title="이 회사 담당자이신가요?" />
            <div className="grid gap-3 p-4 text-sm">
              <p>인증하면 요금표를 올리고 견적 요청을 받을 수 있습니다. 원하지 않으시면 게시를 내릴 수 있습니다.</p>
              <ListingActions orgId={p.id} orgName={p.name} />
            </div>
          </Panel>
        </div>
      )}
    </div>
  );
}
