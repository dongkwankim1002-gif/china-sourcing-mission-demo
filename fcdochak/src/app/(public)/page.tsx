import Link from 'next/link';
import { ArrowRight, BadgeCheck, CalendarClock, FileSpreadsheet, PackageCheck, Truck } from 'lucide-react';
import { Calculator } from '@/components/public/calculator';
import { buildQuoteResponse, type QuoteResponse } from '@/lib/public-quote';
import { DEFAULT_INPUT } from '@/lib/calc-defaults';
import { LetterMark } from '@/components/brand-mark';
import { Button, Chip } from '@/components/ui/core';
import { JsonLd } from '@/components/json-ld';
import { asPublic, todayKst } from '@/lib/db';
import { env } from '@/lib/env';
import { BRAND } from '@/lib/brand';
import { FAQ } from '@/content/faq';
import { compare } from '@/lib/server/compare';
import { laneStats, listPartners, marketCounts, publicReviews, STANDARD_CARGO } from '@/lib/server/public';
import { getReference } from '@/lib/server/reference';
import { loadSettings } from '@/lib/server/settings';
import { dateKo, notFuture, num, wonShort } from '@/lib/format';
import { ACTION, BIZ_TYPE_LABEL } from '@/lib/terms';
import { OutcomeChip, ReplyBlock } from '@/components/trust/review-item';
import { SEGMENTS, SEGMENT_LABEL_KO } from '@/lib/money/segments';

export const revalidate = 600;

async function initialQuote(): Promise<QuoteResponse | null> {
  const i = DEFAULT_INPUT;
  const r = await asPublic(async (q) => {
    const s = await loadSettings(q);
    return compare(
      q,
      { hub: i.hub, port: i.port, mode: null, cargo: { units: i.units!, cartons: i.cartons!, kg: i.kg!, cbm: i.cbm!, goodsValue: i.goods!, goodsCurrency: i.cur }, traits: [] },
      s,
      todayKst(),
    );
  });
  return buildQuoteResponse(r, { sort: 'cheapest', includeRelated: false, detail: false });
}

const HERO_TITLE = '중국 공장에서 쿠팡 FC까지, 같은 조건으로 한 줄 비교.';

const SEG_DESC: Record<string, string> = {
  pickup: '공장·도매시장에서 거둬 창고로',
  cn_warehouse: '검수·라벨·재포장',
  export_customs: '중국 수출신고',
  freight: '해상·카페리·항공',
  port: '터미널·CFS·서류',
  broker: '수입신고 대리(수수료 기준 제외)',
  kr_warehouse: '입고·보관·FC 규격 작업',
  fc_delivery: 'FC 입고 운송·예약',
  return_reserve: '입고 반려 시 회송 예비',
};

export default async function Home() {
  const [ref, counts, lanes, partners, reviews, initial] = await Promise.all([
    getReference(),
    marketCounts(),
    laneStats(),
    listPartners(),
    publicReviews(6),
    initialQuote(),
  ]);
  const official = partners.filter((p) => p.status === 'official');
  const logos = official.filter((p) => p.logo_path);
  const lettered = official.filter((p) => !p.logo_path).slice(0, 12 - logos.length);

  return (
    <>
      <JsonLd
        data={{
          '@context': 'https://schema.org',
          '@type': 'WebSite',
          name: BRAND.name,
          url: env.siteUrl,
          description: BRAND.description,
          potentialAction: { '@type': 'SearchAction', target: `${env.siteUrl}/partners?q={query}`, 'query-input': 'required name=query' },
        }}
      />
      <section className="bg-ink text-on-ink">
        <div className="mx-auto max-w-[1280px] px-4 pb-12 pt-8 md:pt-12">
          <p className="mb-3 inline-flex items-center gap-2 rounded-xs border border-white/15 px-2 py-1 text-2xs font-semibold text-on-ink-muted">
            <span className="size-1.5 rounded-full bg-ok" aria-hidden />
            오늘 갱신된 요금표 <b className="text-on-ink tnum">{num(counts.cards_today)}장</b> · 이번 주 견적 요청 <b className="text-on-ink tnum">{num(counts.requests_week)}건</b>
          </p>
          {/* 읽히는 이름은 한 문장 그대로 — 색 강조 조각이 이름에서 빠지지 않게 이름을 제목에 직접 준다(보이는 글과 같은 말) */}
          <h1 aria-label={HERO_TITLE} className="display max-w-3xl text-[clamp(30px,5vw,52px)] leading-[1.08]">
            <span className="block">중국 공장에서 쿠팡 FC까지,</span>
            <span className="block">
              <strong className="font-normal text-label">같은 조건</strong>으로 한 줄 비교.
            </span>
          </h1>
          <p className="mt-3 max-w-2xl text-md text-on-ink-muted">
            업체마다 다른 견적 양식을 9구간으로 맞춰 적습니다. 뒤에 붙던 추가비용이 어디서 생기는지 먼저 보입니다.
          </p>
          <div className="mt-8">
            <Calculator hubs={ref.hubs} fcs={ref.fcs} traits={ref.traits} initial={initial} demo={env.demoMode} />
          </div>
        </div>
      </section>

      <section aria-labelledby="live" className="border-b border-line bg-surface">
        <h2 id="live" className="sr-only">지금 시장</h2>
        <dl className="mx-auto grid max-w-[1280px] grid-cols-2 divide-line px-4 md:grid-cols-4 md:divide-x">
          {[
            ['오늘 갱신된 요금표', `${num(counts.cards_today)}장`, FileSpreadsheet],
            ['이번 주 견적 요청', `${num(counts.requests_week)}건`, CalendarClock],
            ['공식 등록 업체', `${num(counts.partners_official)}곳`, BadgeCheck],
            ['30일 FC 입고 완료', `${num(counts.delivered_30d)}건`, PackageCheck],
          ].map(([k, v, Icon]) => {
            const I = Icon as typeof Truck;
            return (
              <div key={k as string} className="grid grid-cols-[20px_1fr] items-center gap-x-3 px-2 py-5 md:px-6">
                <I className="row-span-2 size-5 shrink-0 text-muted" aria-hidden />
                <dt className="text-xs text-muted">{k as string}</dt>
                <dd className="display col-start-2 text-2xl text-text tnum">{v as string}</dd>
              </div>
            );
          })}
        </dl>
      </section>

      <section aria-labelledby="nine" className="cv-auto mx-auto max-w-[1280px] px-4 py-14">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs font-bold text-muted">9구간 막대 읽는 법</p>
            <h2 id="nine" className="display mt-1 text-[clamp(26px,3.4vw,40px)] leading-tight">견적 한 장을 아홉 칸으로</h2>
          </div>
          <p className="max-w-md text-sm text-muted">칠한 칸은 확정, 빗금은 예상, 호박색 테두리는 추가비용 가능, 점선은 업체가 맡지 않아 참고치로 채운 칸입니다.</p>
        </div>
        <ol className="mt-8 grid grid-cols-3 gap-[2px] sm:grid-cols-9">
          {SEGMENTS.map((s, i) => (
            <li key={s} className="min-w-0">
              <span className="block h-3 rounded-[2px]" style={{ background: `var(--seg-${i + 1})` }} aria-hidden />
              <p className="mt-2 text-xs font-bold text-text">
                <span className="text-muted tnum">{i + 1}</span> {SEGMENT_LABEL_KO[s]}
              </p>
              <p className="mt-0.5 text-2xs leading-4 text-muted">{SEG_DESC[s]}</p>
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="lanes" className="cv-auto border-y border-line bg-surface">
        <div className="mx-auto max-w-[1280px] px-4 py-12">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-xs font-bold text-muted">
                기준 화물 {STANDARD_CARGO.cbm} CBM · {num(STANDARD_CARGO.kg)} kg · {STANDARD_CARGO.cartons}박스 · {num(STANDARD_CARGO.units)}개
              </p>
              <h2 id="lanes" className="display mt-1 text-[clamp(26px,3.4vw,40px)] leading-tight">구간 시세</h2>
            </div>
            <Button asChild variant="secondary" size="sm">
              <Link href="/lanes">
                모든 구간 보기 <ArrowRight aria-hidden />
              </Link>
            </Button>
          </div>
          {lanes.length ? (
            <div className="mt-6 overflow-x-auto rounded-md border border-line">
              <table className="w-full min-w-[640px] text-sm tnum">
                <caption className="sr-only">구간별 FC 도착 총액 중간값</caption>
                <thead className="bg-surface-2 text-xs text-muted">
                  <tr>
                    <th scope="col" className="px-4 py-2.5 text-left font-semibold">구간</th>
                    <th scope="col" className="px-4 py-2.5 text-left font-semibold">방식</th>
                    <th scope="col" className="px-4 py-2.5 text-right font-semibold">중간값</th>
                    <th scope="col" className="px-4 py-2.5 text-right font-semibold">최저</th>
                    <th scope="col" className="px-4 py-2.5 text-right font-semibold">기간</th>
                    <th scope="col" className="px-4 py-2.5 text-right font-semibold">요금표</th>
                  </tr>
                </thead>
                <tbody>
                  {lanes.slice(0, 10).map((l) => (
                    <tr key={l.slug} className="border-t border-line-2 hover:bg-surface-2">
                      <th scope="row" className="px-4 py-2.5 text-left font-semibold">
                        <Link href={`/lanes/${l.slug}`} className="hover:underline">
                          {l.hubName} → {l.portName}
                        </Link>
                      </th>
                      <td className="px-4 py-2.5 text-muted">{l.modeName}</td>
                      <td className="px-4 py-2.5 text-right font-bold">{wonShort(l.median)}</td>
                      <td className="px-4 py-2.5 text-right text-muted">{wonShort(l.min)}</td>
                      <td className="px-4 py-2.5 text-right text-muted">{l.transitMin}~{l.transitMax}일</td>
                      <td className="px-4 py-2.5 text-right text-muted">{l.cards}장 · {l.partners}곳</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="mt-6 rounded-md border border-dashed border-line p-6 text-sm text-muted">아직 올라온 요금표가 없습니다. 첫 요금표가 올라오면 이 표가 채워집니다.</p>
          )}
        </div>
      </section>

      <section aria-labelledby="partners" className="cv-auto mx-auto max-w-[1280px] px-4 py-14">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs font-bold text-muted">업체가 직접 올린 로고만 싣습니다</p>
            <h2 id="partners" className="display mt-1 text-[clamp(26px,3.4vw,40px)] leading-tight">공식 등록 업체</h2>
          </div>
          <Button asChild variant="secondary" size="sm">
            <Link href="/partners">
              업체 찾기 <ArrowRight aria-hidden />
            </Link>
          </Button>
        </div>
        {official.length ? (
          <ul className="mt-6 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            {[...logos, ...lettered].map((p) => (
              <li key={p.id}>
                <Link href={`/p/${p.slug}`} className="flex h-full items-center gap-3 rounded-md border border-line bg-surface p-3 hover:border-muted/60">
                  <LetterMark name={p.name} logo={p.logo_path} size={40} />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-bold">{p.name}</span>
                    <span className="block truncate text-2xs text-muted">{BIZ_TYPE_LABEL[p.business_type ?? ''] ?? ''} · {p.hq_city}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-6 text-sm text-muted">첫 공식 업체를 기다리고 있습니다.</p>
        )}
      </section>

      <section aria-labelledby="reviews" className="cv-auto border-y border-line bg-surface">
        <div className="mx-auto max-w-[1280px] px-4 py-14">
          <p className="text-xs font-bold text-muted">끝난 선적에서만 평가를 받습니다 — 회송·입고 반려·분실(미도착)로 끝난 선적도 싣습니다</p>
          <h2 id="reviews" className="display mt-1 text-[clamp(26px,3.4vw,40px)] leading-tight">화주 후기</h2>
          {reviews.length ? (
            <ul className="mt-6 grid gap-3 md:grid-cols-2 lg:grid-cols-3">
              {notFuture(reviews, todayKst()).map((r) => (
                <li key={r.id} className="flex flex-col rounded-md border border-line bg-surface-2 p-4">
                  <div className="flex items-center justify-between gap-2">
                    <Stamp score={r.rating} />
                    <span className="text-2xs text-muted">{dateKo(r.created_at, { dow: false })}</span>
                  </div>
                  <p className="mt-3 flex-1 text-sm leading-6 text-text">“{r.body}”</p>
                  <div className="mt-3 flex flex-wrap items-center gap-1.5 text-2xs text-muted">
                    <span>{r.author_label}</span>·
                    <Link href={`/p/${r.partner_slug}`} className="font-semibold text-text hover:underline">
                      {r.partner_name}
                    </Link>
                    {r.on_time_ok ? <Chip tone="ok" className="h-5">정시 입고</Chip> : null}
                    {r.billing_ok ? <Chip tone="ok" className="h-5">견적대로 청구</Chip> : <Chip tone="caution" className="h-5">청구 차이</Chip>}
                    <OutcomeChip outcome={r.outcome} />
                  </div>
                  {r.reply_body ? <ReplyBlock partnerName={r.partner_name} body={r.reply_body} version={r.reply_version} at={r.reply_at} /> : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-6 text-sm text-muted">아직 평가가 없습니다.</p>
          )}
        </div>
      </section>

      <section aria-labelledby="faq" className="cv-auto mx-auto max-w-[1280px] px-4 py-14">
        <div className="grid gap-8 lg:grid-cols-[320px_1fr]">
          <div>
            <h2 id="faq" className="display text-[clamp(26px,3.4vw,40px)] leading-tight">자주 묻는 질문</h2>
            <Link href="/faq" className="mt-3 inline-flex items-center gap-1 text-sm font-semibold hover:underline">
              전체 보기 <ArrowRight className="size-4" aria-hidden />
            </Link>
          </div>
          <div className="divide-y divide-line rounded-md border border-line bg-surface">
            {FAQ.slice(0, 6).map((f) => (
              <details key={f.q} className="group px-4 [&_summary::-webkit-details-marker]:hidden">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-4 text-md font-semibold">
                  {f.q}
                  <span aria-hidden className="grid size-6 shrink-0 place-items-center rounded-xs border border-line text-muted transition-transform group-open:rotate-45">+</span>
                </summary>
                <p className="pb-4 text-sm leading-6 text-muted">{f.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      <section aria-labelledby="join" className="cv-auto bg-label text-on-label">
        <div className="mx-auto flex max-w-[1280px] flex-wrap items-center justify-between gap-6 px-4 py-10">
          <div>
            <h2 id="join" className="display text-[clamp(24px,3vw,36px)] leading-tight">물류사라면 요금표 한 장으로 시작하세요</h2>
            <p className="mt-2 max-w-xl text-sm font-medium">
              사업자 → 거점·운송 방식 → 취급 능력 → 첫 요금표, 네 단계면 끝납니다. 입점비·게시비는 없습니다. 콘솔은 한국어·中文 모두 됩니다.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="ink" size="lg">
              <Link href="/join/partner">{ACTION.joinPartner}</Link>
            </Button>
            <Button asChild variant="secondary" size="lg" className="border-ink/20 bg-transparent text-on-label hover:bg-white/30">
              <Link href="/policy#listing">게시 기준 보기</Link>
            </Button>
          </div>
        </div>
      </section>
    </>
  );
}

/** 도장 모양 점수 — 별 다섯 개 대신 */
function Stamp({ score }: { score: number }) {
  const tone = score >= 4 ? 'text-ok border-ok' : score === 3 ? 'text-caution border-caution' : 'text-stamp border-stamp';
  return (
    <span className={`inline-flex h-7 items-center gap-1 rounded-xs border-2 px-2 text-xs font-black ${tone}`} aria-label={`평가 ${score}점(5점 만점)`}>
      <span className="display text-base leading-none">{score}</span>
      <span className="text-2xs">/ 5</span>
    </span>
  );
}
