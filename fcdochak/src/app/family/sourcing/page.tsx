import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight, ShieldAlert } from 'lucide-react';
import { asPublic } from '@/lib/db';
import { loadSourcingConfig } from '@/lib/server/sourcing';
import { loadSettings } from '@/lib/server/settings';
import { mockCandidates } from '@/lib/sourcing/providers';
import { similarityScore } from '@/lib/sourcing/similarity';
import { sampleCostKrw, unitPriceAt } from '@/lib/money';
import { SourcingPreviewNotice } from '@/components/sourcing/preview';
import { CandidateTable, type CandView } from '@/components/sourcing/candidates';
import { buttonVariants, Chip, Panel, PanelHead } from '@/components/ui/core';
import { BRAND } from '@/lib/brand';
import { SOURCING_ACTION } from '@/lib/terms';
import { won } from '@/lib/format';

export const revalidate = 60;
export const metadata: Metadata = {
  title: '패밀리 · 유사상품 중국 소싱처 찾기(미리보기)',
  description: `잘 팔리는 내 상품과 비슷한 상품을 만들 중국 공급처를 찾고, ${BRAND.name}의 9구간 원가 엔진으로 쿠팡 FC 도착원가·개당 마진을 비교합니다. 준비 중 · 미리보기.`,
  alternates: { canonical: '/family/sourcing' },
};

const JOURNEY: { t: string; b: string }[] = [
  { t: '잘 팔리는 내 상품', b: '저장한 SKU·판매 분석 상품에서 고르거나 직접 적습니다.' },
  { t: '유사상품 조건', b: '상품명·분류·사진 주소·목표 판매가·월 판매량·인증 필요 여부.' },
  { t: '후보 공급처 비교', b: '단가 구간·최소 주문량·생산 일수·공장/무역상·평점·인증·샘플비·유사도.' },
  { t: '도착원가·마진', b: `후보마다 ${BRAND.name} 구간 시세로 9구간 물류비를 잡고 개당 마진·손익분기를 셈합니다.` },
  { t: '샘플·현지 검품', b: '샘플 요청을 남기면 현지 담당이 확인합니다(지금은 관심 등록만).' },
  { t: '발주', b: '발주·대금은 셀러와 공급처가 직접 합니다.' },
  { t: `${BRAND.name} 물류 견적`, b: '후보 조건(수량·무게·부피·물품가)을 그대로 물류 비교로 넘깁니다.' },
];

const SOURCES: { t: string; b: string; tag: string; tone: 'ok' | 'neutral' | 'caution' }[] = [
  { t: '현지 소싱 담당 수동 조사', b: '중국 현지 담당이 공장·무역상을 찾아 조건을 받아 넣습니다. 서류·샘플로 확인할 수 있어 1단계로 권합니다.', tag: '1단계', tone: 'ok' },
  { t: '셀러가 붙인 링크 확인', b: '이미 본 1688·타오바오 상품 링크를 남기면 담당이 직접 열어 확인합니다. 앱이 자료를 긁어 오지 않습니다.', tag: '1단계', tone: 'ok' },
  { t: '공식 API·이미지 검색', b: '1688·알리바바·타오바오 개방 플랫폼은 개발자 등록·API 권한 신청·약관 확인이 필요합니다(확인 필요). 확인 전에는 부르지 않습니다.', tag: '3단계 · 확인 필요', tone: 'caution' },
];

const RISKS: { t: string; b: string }[] = [
  { t: '지식재산·위조품', b: '비슷한 상품이 상표·디자인을 침해하면 통관이 보류될 수 있습니다(관세법 제235조). 유사도는 같은 상품 판정이 아닙니다.' },
  { t: 'KC 인증', b: '전기·생활·어린이제품 중에는 수입자가 통관 전 KC 인증을 받아야 하는 품목이 있습니다. 중국 인증(CCC 등)은 KC 가 아닙니다.' },
  { t: 'HS 분류·관세', b: '분류가 바뀌면 관세가 바뀝니다. 도착원가의 관세·부가세는 참고 추정입니다.' },
  { t: '공급처 사기·품질', b: '공장/무역상 구분·평점은 담당이 확인한 값만 보입니다. 대금을 중개하지 않습니다.' },
];

export default async function FamilySourcing() {
  const d = await asPublic(async (q) => {
    const config = await loadSourcingConfig(q);
    const s = await loadSettings(q);
    return { config, fx: s.fx };
  });
  const fees = d.config.fees;
  // 화면 예시 — 흉내 제공자의 가짜 후보(실제 공장 아님, 밖을 부르지 않음)
  const exampleReq = { productName: '실리콘 서랍 정리함', keywords: ['서랍', '정리함'], category: 'general', targetPrice: 19900 };
  const ex: CandView[] = mockCandidates(
    { ...exampleReq, hub: 'YIW', qty: 600, needsCert: false },
    { limit: 3, fxRmb: d.fx.RMB, targetCostShareBp: d.config.rules.targetCostShareBp },
  ).map((f, i) => {
    const unit = unitPriceAt(f.quote.tiers, 600).unitPrice;
    const sim = similarityScore(
      exampleReq,
      { productTitle: f.productTitle, category: f.category, unitPriceKrw: Math.round(unit * d.fx[f.quote.currency]) },
      { weights: d.config.rules.similarity, targetCostShareBp: d.config.rules.targetCostShareBp, priceBandBp: d.config.rules.priceBandBp },
    );
    return {
      key: `ex-${i}`,
      id: null,
      label: f.label,
      kind: f.supplierKind,
      hubName: f.region,
      region: f.region,
      productTitle: f.productTitle,
      rating: f.rating,
      yearsActive: f.yearsActive,
      certsClaimed: f.certsClaimed,
      certsVerified: [],
      source: 'mock',
      sourceUrl: null,
      similarity: sim.score,
      level: sim.level,
      currency: f.quote.currency,
      tiers: f.quote.tiers,
      moq: f.quote.moq,
      leadMin: f.quote.leadDaysMin,
      leadMax: f.quote.leadDaysMax,
      sampleFee: f.quote.sampleFee,
      sampleDays: f.quote.sampleDays,
      sampleCostKrw: sampleCostKrw(f.quote.sampleFee, f.quote.currency, d.fx, fees.sampleHandlingKrw),
      version: null,
      withdrawn: false,
      sim: null,
    };
  });
  return (
    <div className="mx-auto max-w-[1280px] px-4 py-8">
      <SourcingPreviewNotice on={d.config.on} />
      <section className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px] lg:items-end">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-ok">{BRAND.name} 패밀리 사이트 · 차후 개발 예정</p>
          <h1 className="display mt-2 text-[clamp(28px,4.4vw,48px)] font-normal leading-[1.1] text-text">
            잘 팔리는 그 상품,
            <br />
            더 좋은 공장에서.
          </h1>
          <p className="mt-3 max-w-2xl text-md leading-7 text-muted">
            내 상품과 비슷한 상품을 만들 중국 공급처 후보를 모으고, 후보마다 쿠팡 FC 도착원가와 개당 마진을 {BRAND.name}의 9구간 원가 엔진으로 셈해 나란히 봅니다.
            마음에 드는 후보는 그대로 물류 견적으로 넘깁니다.
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            <Link href="/app/sourcing" className={buttonVariants({ variant: 'primary', size: 'lg' })}>
              화주 코너에서 {SOURCING_ACTION.request} <ArrowRight aria-hidden />
            </Link>
            <Link href="/tools/pnl" className={buttonVariants({ variant: 'secondary', size: 'lg' })}>
              판매손익 계산기
            </Link>
          </div>
        </div>
        <Panel as="aside" aria-labelledby="fam-share" className="p-4">
          <h2 id="fam-share" className="text-base font-bold">{BRAND.name}과 함께 쓰는 것</h2>
          <ul className="mt-2 grid gap-2 text-sm">
            <li><b>같은 계정</b> — {BRAND.name} 로그인 그대로, 화주 조직별로 요청이 보입니다.</li>
            <li><b>9구간 원가 엔진</b> — 집하부터 회송 대비까지 같은 계산.</li>
            <li><b>구간 시세</b> — 업체 요금표 중간값(업체가 적으면 플랫폼 참고치).</li>
          </ul>
        </Panel>
      </section>

      <section aria-labelledby="fam-journey" className="mt-10">
        <h2 id="fam-journey" className="text-xl font-bold">어떻게 흘러가나</h2>
        <ol className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {JOURNEY.map((j, i) => (
            <li key={j.t} className="min-w-0 rounded-md border border-line bg-surface p-4">
              <p className="text-xs font-bold text-ok tnum">{i + 1}단계</p>
              <p className="mt-1 font-bold">{j.t}</p>
              <p className="mt-1 text-sm text-muted">{j.b}</p>
            </li>
          ))}
        </ol>
      </section>

      <Panel className="mt-10" aria-labelledby="fam-ex">
        <PanelHead
          id="fam-ex"
          title={`후보 비교 예시 — 실리콘 서랍 정리함(예시) · 600개 · 목표 ${won(19900)}`}
          sub="흉내 제공자가 만든 가짜 후보입니다(「예시 공장 A」는 실제 회사가 아닙니다). 로그인하면 후보마다 도착원가·개당 마진까지 셈합니다."
        />
        <CandidateTable items={ex} caption="후보 공급처 비교 예시" />
      </Panel>

      <section aria-labelledby="fam-src" className="mt-10">
        <h2 id="fam-src" className="text-xl font-bold">후보를 어디서 찾나</h2>
        <ul className="mt-3 grid gap-3 md:grid-cols-3">
          {SOURCES.map((x) => (
            <li key={x.t} className="min-w-0 rounded-md border border-line bg-surface p-4">
              <p className="flex flex-wrap items-center gap-2 font-bold">
                {x.t} <Chip tone={x.tone}>{x.tag}</Chip>
              </p>
              <p className="mt-1 text-sm text-muted">{x.b}</p>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-xs text-muted">유사도는 낱말·분류·가격대로 셈하는 참고치입니다. 사진 비교는 차후입니다.</p>
      </section>

      <div className="mt-10 grid gap-6 lg:grid-cols-2">
        <Panel aria-labelledby="fam-fee">
          <PanelHead id="fam-fee" title="수수료" sub={fees.example ? '가정치입니다 — 확인하거나 정한 값이 아닙니다. 지금은 돈을 받지 않습니다.' : `확인일 ${fees.checkedOn ?? '없음'}`} />
          <ul className="divide-y divide-line-2 text-sm" data-testid="family-fees">
            <li className="flex flex-wrap justify-between gap-2 px-4 py-2.5"><span>소싱 대행</span><b className="tnum">발주 상품가의 {(fees.agentFeeBp / 100).toFixed(1)}%</b></li>
            <li className="flex flex-wrap justify-between gap-2 px-4 py-2.5"><span>샘플 처리</span><b className="tnum">건당 {won(fees.sampleHandlingKrw)} (샘플비·배송 별도)</b></li>
            <li className="flex flex-wrap justify-between gap-2 px-4 py-2.5"><span>현지 검품</span><b className="tnum">1일 {won(fees.inspectionPerDayKrw)}</b></li>
          </ul>
        </Panel>
        <Panel aria-labelledby="fam-risk">
          <PanelHead id="fam-risk" title="알고 쓰세요" sub="법률 자문이 아닙니다. 품목별 판단은 관세사·시험인증기관에 확인하세요." />
          <ul className="grid gap-3 p-4 text-sm">
            {RISKS.map((r) => (
              <li key={r.t} className="flex gap-2">
                <ShieldAlert className="mt-0.5 size-4 shrink-0 text-caution" aria-hidden />
                <span className="min-w-0"><b>{r.t}</b> — {r.b}</span>
              </li>
            ))}
          </ul>
        </Panel>
      </div>

      <section aria-labelledby="fam-steps" className="mt-10 rounded-md border border-line bg-surface p-4">
        <h2 id="fam-steps" className="text-base font-bold">단계 계획</h2>
        <ol className="mt-2 grid gap-2 text-sm md:grid-cols-3">
          <li><Chip tone="caution">지금</Chip> 미리보기 — 화면·계산·예시 후보, 요청은 기록만</li>
          <li><Chip tone="neutral">다음</Chip> 현지 담당 수동 조사 시범 — 셀러 몇 곳으로</li>
          <li><Chip tone="neutral">나중</Chip> 공식 API·이미지 검색 — 약관·계약 확인 뒤</li>
        </ol>
      </section>
    </div>
  );
}
