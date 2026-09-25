import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowRight } from 'lucide-react';
import { laneBySlug, lanePartners, laneStats, STANDARD_CARGO } from '@/lib/server/public';
import { NineBar, NineBarLegend, NineTable } from '@/components/nine-bar';
import { LetterMark } from '@/components/brand-mark';
import { PartnerStatusChip, RelatedChip } from '@/components/badges';
import { Button, EmptyState, Panel, PanelHead } from '@/components/ui/core';
import { JsonLd } from '@/components/json-ld';
import { env } from '@/lib/env';
import { ago, num, won, wonShort } from '@/lib/format';
import { SEGMENTS, type Segment } from '@/lib/money/segments';
import { BIZ_TYPE_LABEL } from '@/lib/terms';
import { OpenGate } from '@/components/public/open-gate';

export const revalidate = 3600;
export const dynamicParams = true;

export async function generateStaticParams() {
  const lanes = await laneStats();
  return lanes.map((l) => ({ lane: l.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ lane: string }> }): Promise<Metadata> {
  const { lane: slug } = await params;
  const { lane } = await laneBySlug(slug);
  if (!lane) return { title: '구간을 찾을 수 없습니다' };
  const title = `${lane.hubName} → ${lane.portName} ${lane.modeName} 쿠팡 FC 도착 물류비 시세`;
  return {
    title,
    description: `${lane.hubName}(${lane.hubNameZh})에서 ${lane.portName}항을 거쳐 쿠팡 FC까지 ${lane.modeName} 기준 화물 ${STANDARD_CARGO.cbm} CBM 의 FC 도착 총액 중간값 ${wonShort(lane.median)}, 최저 ${wonShort(lane.min)}, ${lane.transitMin}~${lane.transitMax}일. 요금표 ${lane.cards}장 기준.`,
    alternates: { canonical: `/lanes/${lane.slug}` },
    openGraph: { title, type: 'article' },
  };
}

export default async function LanePage({ params }: { params: Promise<{ lane: string }> }) {
  const { lane: slug } = await params;
  const { lane, all } = await laneBySlug(slug);
  if (!lane) notFound();
  const partners = await lanePartners(lane.hub, lane.port, lane.mode);
  const segs = SEGMENTS.map((s) => ({ segment: s as Segment, amount: lane.medianSegments[s] ?? null, certainty: 'confirmed' as const }));
  const related = all.filter((l) => l.slug !== lane.slug && (l.hub === lane.hub || (l.port === lane.port && l.mode === lane.mode))).slice(0, 6);
  const calcHref = `/?hub=${lane.hub}&port=${lane.port}&mode=${lane.mode}#main`;
  const toolHref = `/tools/pnl?lane=${lane.slug}`;
  const segSum = SEGMENTS.reduce((a, s) => a + (lane.medianSegments[s] ?? 0), 0);
  return (
    <>
      <JsonLd
        data={{
          '@context': 'https://schema.org',
          '@type': 'Service',
          serviceType: '국제 물류(중국 → 쿠팡 FC)',
          name: `${lane.hubName} → ${lane.portName} ${lane.modeName}`,
          areaServed: [{ '@type': 'Place', name: lane.hubName }, { '@type': 'Place', name: `${lane.portName}항` }],
          offers: {
            '@type': 'AggregateOffer',
            priceCurrency: 'KRW',
            lowPrice: lane.min,
            highPrice: Math.max(lane.median, lane.min),
            offerCount: lane.cards,
            url: `${env.siteUrl}/lanes/${lane.slug}`,
          },
        }}
      />
      <section className="bg-ink text-on-ink">
        <div className="mx-auto max-w-[1280px] px-4 py-10">
          <nav aria-label="경로" className="text-xs text-on-ink-muted">
            <Link href="/lanes" className="hover:text-on-ink">구간 시세</Link> / {lane.hubName}
          </nav>
          <h1 className="display mt-2 text-[clamp(28px,4.4vw,48px)] leading-tight">
            {lane.hubName} → {lane.portName} <span className="text-label">{lane.modeName}</span>
          </h1>
          <p className="mt-2 text-sm text-on-ink-muted">
            기준 화물 {STANDARD_CARGO.cbm} CBM · {num(STANDARD_CARGO.kg)} kg · {STANDARD_CARGO.cartons}박스 · {num(STANDARD_CARGO.units)}개, 쿠팡 FC 도착까지 9구간 합계
          </p>
          <dl className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div>
              <dt className="text-xs text-on-ink-muted">중간값</dt>
              <dd className="display text-[clamp(30px,4vw,44px)] leading-none text-label tnum" title={won(lane.median)}>{wonShort(lane.median)}</dd>
            </div>
            <div>
              <dt className="text-xs text-on-ink-muted">최저</dt>
              <dd className="display text-2xl text-on-ink tnum" title={won(lane.min)}>{wonShort(lane.min)}</dd>
            </div>
            <div>
              <dt className="text-xs text-on-ink-muted">싼 쪽 4분의 1</dt>
              <dd className="display text-2xl text-on-ink tnum">{wonShort(lane.q1)} 이하</dd>
            </div>
            <div>
              <dt className="text-xs text-on-ink-muted">기간 · 요금표</dt>
              <dd className="display text-2xl text-on-ink tnum">{lane.transitMin}~{lane.transitMax}일 · {lane.cards}장</dd>
            </div>
          </dl>
          <div className="on-ink mt-6">
            <NineBar segments={segs} size="hero" ticks table="none" label={`${lane.hubName}→${lane.portName} ${lane.modeName} 구간별 중간값`} />
          </div>
          <p className="mt-3 text-2xs text-on-ink-muted">최근 갱신 {ago(lane.updatedAt)} · 구간별 값은 각 구간의 중간값이라 합({won(segSum)})이 총액 중간값과 조금 다를 수 있습니다.</p>
          <div className="mt-6 flex flex-wrap gap-2">
            <Button asChild variant="primary">
              <Link href={calcHref}>
                내 화물로 계산하기 <ArrowRight aria-hidden />
              </Link>
            </Button>
            <Button asChild variant="secondary">
              <Link href={toolHref} data-testid="lane-to-pnl">이 구간으로 판매손익 계산</Link>
            </Button>
            <Button asChild variant="onInk" className="border border-white/20">
              <Link href="/join/shipper">업체별 가격·견적 요청은 가입 후</Link>
            </Button>
          </div>
        </div>
      </section>
      <div className="mx-auto grid max-w-[1280px] gap-6 px-4 py-10 lg:grid-cols-[1fr_380px]">
        <OpenGate className="lg:col-span-2" toolHref={toolHref} />
        <Panel>
          <PanelHead
            title="9구간 중간값 · 공개"
            sub="업체가 맡지 않은 구간은 플랫폼 참고치로 채워 계산"
            action={
              <p className="text-right text-xs text-muted" data-testid="lane-seg-sum">
                구간별 중간값 합계 <b className="block text-md text-text tnum">{won(segSum)}</b>
              </p>
            }
          />
          <div className="p-4">
            <NineTable segments={segs} />
            <NineBarLegend className="mt-3" />
          </div>
        </Panel>
        <Panel>
          <PanelHead title={`이 구간 업체 ${partners.length}곳`} sub="이름은 공개 · 업체별 가격과 견적 요청은 가입 후" />
          {partners.length ? (
            <ul>
              {partners.map((p) => (
                <li key={p.id} className="flex items-center gap-3 border-b border-line-2 px-4 py-2.5 last:border-0">
                  <LetterMark name={p.name} logo={p.logo_path} size={32} />
                  <span className="min-w-0 flex-1">
                    <Link href={`/p/${p.slug}`} className="block truncate text-sm font-semibold hover:underline">{p.name}</Link>
                    <span className="text-2xs text-muted">{BIZ_TYPE_LABEL[p.business_type ?? ''] ?? ''}</span>
                  </span>
                  <PartnerStatusChip status={p.status} />
                  {p.related_party_note ? <RelatedChip note={p.related_party_note} /> : null}
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="아직 업체가 없습니다" />
          )}
        </Panel>
        {related.length ? (
          <section aria-labelledby="rel" className="cv-auto lg:col-span-2">
            <h2 id="rel" className="text-md font-bold">비슷한 구간</h2>
            <ul className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {related.map((l) => (
                <li key={l.slug}>
                  <Link href={`/lanes/${l.slug}`} className="flex items-center justify-between rounded-md border border-line bg-surface px-4 py-3 hover:border-muted/60">
                    <span className="text-sm font-semibold">{l.hubName} → {l.portName} · {l.modeName}</span>
                    <span className="text-sm font-bold tnum">{wonShort(l.median)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </>
  );
}
