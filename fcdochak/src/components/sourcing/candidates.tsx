/**
 * 후보 공급처 비교표 + 후보마다 도착원가·개당 마진 시뮬(서버에서 셈한 값을 보여 주기만).
 * 화주 화면·운영 화면이 같이 쓴다. 예시(흉내 제공자) 후보에는 늘 「예시」가 붙는다.
 */
import Link from 'next/link';
import { ArrowRight, BadgeCheck, TriangleAlert } from 'lucide-react';
import { Chip } from '@/components/ui/core';
import { CANDIDATE_SOURCE_LABEL, SOURCING_ACTION, SUPPLIER_KIND_LABEL } from '@/lib/terms';
import { SIMILARITY_LEVEL_LABEL, type SimilarityResult } from '@/lib/sourcing/similarity';
import type { SimView } from '@/lib/server/sourcing';
import type { PriceTier } from '@/lib/money/sourcing';
import { num, won } from '@/lib/format';
import { cn } from '@/lib/cn';

export interface CandView {
  key: string;
  id: string | null;
  label: string;
  kind: 'factory' | 'trader' | 'unknown';
  hubName: string | null;
  region: string | null;
  productTitle: string;
  rating: number | null;
  yearsActive: number | null;
  certsClaimed: string[];
  certsVerified: string[];
  source: 'manual' | 'seller_link' | 'mock' | 'api';
  sourceUrl: string | null;
  similarity: number;
  level: SimilarityResult['level'];
  currency: 'RMB' | 'USD';
  tiers: PriceTier[];
  moq: number;
  leadMin: number;
  leadMax: number;
  sampleFee: number | null;
  sampleDays: number | null;
  sampleCostKrw: number;
  version: number | null;
  withdrawn: boolean;
  sim: SimView | null;
  simError?: string | null;
}

const cur = (c: 'RMB' | 'USD') => (c === 'RMB' ? '元' : 'USD');
const fmtPrice = (n: number) => (Number.isInteger(n) ? num(n) : n.toFixed(2));

export function tiersText(t: PriceTier[], c: 'RMB' | 'USD') {
  return t.map((x) => `${num(x.minQty)}개~ ${fmtPrice(x.unitPrice)}${cur(c)}`).join(' · ');
}

function Certs({ c }: { c: CandView }) {
  if (!c.certsClaimed.length && !c.certsVerified.length) return <span className="text-muted">없음</span>;
  return (
    <span className="flex flex-wrap gap-1">
      {c.certsVerified.map((x) => (
        <Chip key={`v${x}`} tone="ok" icon={<BadgeCheck aria-hidden />}>{x} 확인</Chip>
      ))}
      {c.certsClaimed.filter((x) => !c.certsVerified.includes(x)).map((x) => (
        <Chip key={`c${x}`} tone="neutral">{x} 주장</Chip>
      ))}
    </span>
  );
}

export function CandidateTable({ items, caption }: { items: CandView[]; caption: string }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] text-sm" data-testid="sourcing-compare">
        <caption className="sr-only">{caption}</caption>
        <thead className="bg-surface-2 text-left text-xs text-muted">
          <tr>
            <th scope="col" className="px-3 py-2 font-semibold">후보</th>
            <th scope="col" className="px-3 py-2 font-semibold">단가 구간</th>
            <th scope="col" className="whitespace-nowrap px-3 py-2 font-semibold">최소 주문량 · 생산 일수</th>
            <th scope="col" className="px-3 py-2 font-semibold">인증</th>
            <th scope="col" className="px-3 py-2 text-right font-semibold">샘플비</th>
            <th scope="col" className="px-3 py-2 text-right font-semibold">유사도</th>
          </tr>
        </thead>
        <tbody>
          {items.map((c) => (
            <tr key={c.key} className={cn('border-t border-line-2 align-top', c.withdrawn && 'opacity-60')}>
              <th scope="row" className="px-3 py-2 text-left font-normal">
                <span className="flex flex-wrap items-center gap-1.5 font-semibold">
                  {c.label}
                  <Chip tone={c.kind === 'factory' ? 'info' : 'neutral'}>{SUPPLIER_KIND_LABEL[c.kind]}</Chip>
                  {c.source === 'mock' ? <Chip tone="caution">예시</Chip> : <Chip tone="neutral">{CANDIDATE_SOURCE_LABEL[c.source]}</Chip>}
                  {c.withdrawn ? <Chip tone="stamp">내림</Chip> : null}
                </span>
                <span className="mt-0.5 block text-xs text-muted">{c.productTitle}</span>
                <span className="block text-2xs text-muted tnum">
                  {[c.region ?? c.hubName, c.yearsActive != null ? `${c.yearsActive}년째` : null, c.rating != null ? `평점 ${c.rating.toFixed(1)}` : '평점 없음'].filter(Boolean).join(' · ')}
                </span>
              </th>
              <td className="px-3 py-2 text-xs tnum">
                <ul aria-label="단가 구간">
                  {c.tiers.map((x) => (
                    <li key={x.minQty} className="whitespace-nowrap">{num(x.minQty)}개~ {fmtPrice(x.unitPrice)}{cur(c.currency)}</li>
                  ))}
                </ul>
              </td>
              <td className="whitespace-nowrap px-3 py-2 tnum">
                {num(c.moq)}개부터
                <span className="block text-xs text-muted">생산 {c.leadMin}~{c.leadMax}일</span>
              </td>
              <td className="whitespace-nowrap px-3 py-2"><Certs c={c} /></td>
              <td className="whitespace-nowrap px-3 py-2 text-right tnum">
                {c.sampleFee != null ? `${fmtPrice(c.sampleFee)}${cur(c.currency)}` : '—'}
                <span className="block text-2xs text-muted">처리 포함 {won(c.sampleCostKrw)}</span>
              </td>
              <td className="px-3 py-2 text-right">
                <b className="tnum">{c.similarity}</b>
                <span className="block text-2xs text-muted">{SIMILARITY_LEVEL_LABEL[c.level]}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** 후보 하나의 도착원가·마진 칸 */
export function SimCard({ c, action }: { c: CandView; action?: React.ReactNode }) {
  const s = c.sim?.sim;
  return (
    <article className="min-w-0 rounded-md border border-line bg-surface p-4" data-testid="sourcing-sim" aria-label={`${c.label} 도착원가·마진`}>
      <header className="flex flex-wrap items-center gap-2">
        <h3 className="text-base font-bold">{c.label}</h3>
        {c.source === 'mock' ? <Chip tone="caution">예시</Chip> : null}
        {c.withdrawn ? <Chip tone="stamp">내림</Chip> : null}
        <span className="flex-1" />
        {action}
      </header>
      {s ? (
        <>
          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
            <div className="min-w-0">
              <dt className="text-xs text-muted">개당 도착원가</dt>
              <dd className="text-lg font-bold tnum">{won(s.arrivalPerUnit)}</dd>
            </div>
            <div className="min-w-0">
              <dt className="text-xs text-muted">개당 마진</dt>
              <dd className={cn('text-lg font-bold tnum', s.profitPerUnit < 0 && 'text-stamp')}>
                {won(s.profitPerUnit)} <span className="text-xs font-semibold">({(s.marginBp / 100).toFixed(1)}%)</span>
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="text-xs text-muted">손익분기 판매가</dt>
              <dd className="font-semibold tnum">{Number.isFinite(s.pnl.breakEvenPrice) ? won(s.pnl.breakEvenPrice) : '—'}</dd>
            </div>
            <div className="min-w-0">
              <dt className="text-xs text-muted">{num(s.qty)}개 발주 총이익</dt>
              <dd className={cn('font-semibold tnum', s.totalProfit < 0 && 'text-stamp')}>{won(s.totalProfit)}</dd>
            </div>
          </dl>
          <p className="mt-2 text-xs text-muted tnum">
            상품 {won(s.pnl.goodsPerUnit)} ({fmtPrice(s.tier.unitPrice)}
            {cur(c.currency)} × {num(s.qty)}개 구간) + 9구간 물류 {won(s.pnl.logisticsPerUnit)} + 대행 수수료(가정치) {won(s.pnl.extraPerUnit)} + 관세 참고{' '}
            {won(s.pnl.dutyPerUnit)} · 화물 {num(s.cargo.cartons)}박스 · {s.cargo.kg}kg · {s.cargo.cbm}CBM
          </p>
          <p className="mt-1 text-2xs text-muted">
            물류비: {c.sim!.logisticsBasis === 'market' ? `같은 구간 요금표 ${c.sim!.offers}장 중간값` : '플랫폼 참고치(요금표가 적은 구간)'} · 관세·부가세는 참고 추정입니다.
          </p>
          {s.belowMoq ? (
            <p className="mt-2 flex items-center gap-1.5 text-xs text-caution">
              <TriangleAlert className="size-3.5" aria-hidden /> 발주 수량이 최소 주문량({num(c.moq)}개)보다 적습니다 — 첫 구간 단가로 셈했습니다.
            </p>
          ) : null}
          <p className="mt-3">
            <Link href={c.sim!.compareHref} className="inline-flex items-center gap-1 text-sm font-semibold underline underline-offset-4">
              {SOURCING_ACTION.toCompare} <ArrowRight className="size-4" aria-hidden />
            </Link>
          </p>
        </>
      ) : (
        <p className="mt-2 text-sm text-muted">{c.simError ?? '조건이 없어 셈하지 못했습니다.'}</p>
      )}
    </article>
  );
}
