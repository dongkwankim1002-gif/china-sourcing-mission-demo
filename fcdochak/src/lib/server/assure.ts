import 'server-only';
/**
 * 확정가·보장 자리 — 설정 읽기, 비교·응찰 총액 모으기, 관심 등록 읽기.
 * 계산은 src/lib/money/assure 순수 함수. 여기서는 자료를 모아 넘기기만 한다.
 */
import type { Queryable } from '../db';
import { readAssureConfig, type AssureConfig, type AssureKind } from '../assure-settings';
import {
  computeQuote,
  coverageBase,
  coverageFee,
  deferredFee,
  firmPrice,
  returnsFromRate,
  SEGMENTS,
  type CoverageResult,
  type FirmPriceResult,
  type Segment,
} from '../money';
import type { CargoQueryT } from '../cargo-params';
import { toCargo } from '../cargo-params';
import { compare, loadPartnerFacts, type Offer, type PartnerMetrics } from './compare';
import { requestDetail } from './shipper';
import type { AppSettings } from './settings';

export async function loadAssureConfig(q: Queryable): Promise<AssureConfig> {
  const rows = await q.query<{ key: string; value: unknown }>(`select key, value from fcd.v_current_settings where key like 'v2.%'`);
  return readAssureConfig(new Map(rows.map((r) => [r.key, r.value])));
}

export interface AssureBasis {
  /** 확정가 표본 — 같은 조건 총액들 */
  totals: number[];
  /** 표본의 운송 방식(대표 업체의 방식) */
  mode: string | null;
  /** 회송 보장·후불을 셈할 대표 업체(비교 1위 또는 가장 싼 응찰) */
  lead: { partnerName: string; total: number; segments: { segment: Segment; amount: number | null }[]; metrics: PartnerMetrics | null } | null;
}

export interface AssureView {
  config: AssureConfig;
  firm: FirmPriceResult | null;
  coverage: (CoverageResult & { coveredAmount: number; returns: number; shipments: number; partnerName: string }) | null;
  deferred: (ReturnType<typeof deferredFee> & { amount: number }) | null;
  lead: AssureBasis['lead'];
  mode: string | null;
}

/** 모은 자료 + 설정 → 화면에 보일 참고 숫자(스위치와 상관없이 계산은 한다 — 꺼져 있으면 「참고」로만 보인다) */
export function assureView(config: AssureConfig, basis: AssureBasis): AssureView {
  const firm = config.firmRates ? firmPrice(basis.totals, config.firmRates) : null;
  let coverage: AssureView['coverage'] = null;
  if (config.coverageRates && basis.lead) {
    const m = basis.lead.metrics;
    const shipments = m?.done_30d ?? 0;
    const returns = returnsFromRate(m?.return_rate_30d ?? null, shipments);
    const coveredAmount = coverageBase(basis.lead.segments);
    coverage = { ...coverageFee({ returns, shipments, coveredAmount }, config.coverageRates), coveredAmount, returns, shipments, partnerName: basis.lead.partnerName };
  }
  const deferred = config.deferredRates && basis.lead ? { ...deferredFee(basis.lead.total, config.deferredRates), amount: basis.lead.total } : null;
  return { config, firm, coverage, deferred, lead: basis.lead, mode: basis.mode };
}

/**
 * 비교 화면의 표본 — 같은 조건에서 비교에 오른(취급 가능·유효) 요금표 전부의 참고치 포함 합계.
 * 화면 필터·정렬과 상관없이 같은 조건 시장 분포로 본다. 대표 업체는 특수관계를 뺀 가장 싼 곳.
 */
export async function compareBasis(q: Queryable, cq: CargoQueryT, s: AppSettings, today: string): Promise<AssureBasis> {
  const r = await compare(q, { hub: cq.hub, port: cq.port, mode: cq.mode, cargo: toCargo(cq), traits: cq.traits }, s, today);
  return basisFromOffers(r.offers);
}

/**
 * 비교 결과(비교에 오른 요금표)에서 표본과 대표 업체를 고른다 — 화면과 기록이 같은 규칙을 쓴다.
 * 대표 업체 = 특수관계를 뺀 가장 싼 곳. 표본 = 대표 업체와 같은 운송 방식의 요금표 총액
 * (방식 「상관없음」이면 항공·해상이 섞여 분포가 뜻을 잃는다).
 */
export function basisFromOffers(offers: Offer[]): AssureBasis {
  const pool = offers.filter((o) => !o.partner.related_party_note);
  const lead = [...(pool.length ? pool : offers)].sort((a, b) => a.quote.total - b.quote.total)[0];
  if (!lead) return { totals: [], mode: null, lead: null };
  return {
    totals: offers.filter((o) => o.mode === lead.mode).map((o) => o.quote.total),
    mode: lead.mode,
    lead: { partnerName: lead.partner.name, total: lead.quote.total, segments: lead.quote.segments, metrics: lead.metrics },
  };
}

/** 견적 요청의 표본 — 살아 있는 응찰 총액(빈 구간은 참고치로 채움). 대표 업체는 가장 싼 응찰. */
export async function requestBasis(q: Queryable, requestId: string, orgId: string, s: AppSettings, today: string): Promise<(AssureBasis & { reqNo: string }) | null> {
  const d = await requestDetail(q, requestId);
  if (!d || d.r.org_id !== orgId) return null;
  const r = d.r;
  const cargo = { units: r.units, cartons: r.cartons, kg: r.kg, cbm: r.cbm, goodsValue: r.goods_value, goodsCurrency: r.goods_currency as 'RMB' };
  const refQ = computeQuote(s.referenceLines, cargo, s.quoteParams);
  const reference = Object.fromEntries(refQ.segments.map((x) => [x.segment, x.amount ?? 0])) as Record<Segment, number>;
  const live = d.bids.filter((b) => b.status === 'submitted');
  const full = live
    .map((b) => {
      const segments = SEGMENTS.map((sg) => ({ segment: sg, amount: b.amounts[sg] == null ? reference[sg] : (b.amounts[sg] as number) }));
      return { b, segments, total: segments.reduce((t, x) => t + (x.amount ?? 0), 0) };
    })
    .sort((a, b) => a.total - b.total);
  const facts = full.length ? await loadPartnerFacts(q, [...new Set(full.map((x) => x.b.org_id))], today) : null;
  const leadRow = full.find((x) => !x.b.related_party_note) ?? full[0];
  return {
    reqNo: r.req_no,
    totals: leadRow ? full.filter((x) => x.b.mode === leadRow.b.mode).map((x) => x.total) : [],
    mode: leadRow?.b.mode ?? null,
    lead: leadRow ? { partnerName: leadRow.b.partner_name, total: leadRow.total, segments: leadRow.segments, metrics: facts?.metrics.get(leadRow.b.org_id) ?? null } : null,
  };
}

export async function myInterestKinds(q: Queryable, userId: string): Promise<Set<AssureKind>> {
  const rows = await q.query<{ kind: AssureKind }>(`select kind from fcd.assure_interests where user_id = $1`, [userId]);
  return new Set(rows.map((r) => r.kind));
}

export interface FirmQuoteRow {
  id: string;
  quote_no: string;
  version: number;
  firm_price: number;
  base_total: number;
  premium: number;
  sample_n: number;
  confidence_bp: number;
  valid_until: string;
  created_at: string;
}

/** 이 조건(비교 = 구간·화물 같은 판, 요청 = 요청 id)의 현재 확정가 견적(가장 최근 판) */
export async function currentFirmQuote(q: Queryable, orgId: string, ctx: { requestId: string } | { laneKey: string }): Promise<FirmQuoteRow | null> {
  const where = 'requestId' in ctx ? `request_id = $2` : `request_id is null and lane->>'key' = $2`;
  const rows = await q.query<FirmQuoteRow>(
    `select id, quote_no, version, firm_price, base_total, premium, sample_n, confidence_bp, valid_until, created_at
       from fcd.firm_price_quotes f
      where org_id = $1 and ${where}
        and not exists (select 1 from fcd.firm_price_quotes n where n.supersedes_id = f.id)
      order by created_at desc limit 1`,
    [orgId, 'requestId' in ctx ? ctx.requestId : ctx.laneKey],
  );
  return rows[0] ?? null;
}

/** 비교 조건을 한 줄 열쇠로(같은 조건이면 같은 열쇠) */
export function laneKey(cq: CargoQueryT): string {
  return [cq.hub, cq.port, cq.mode ?? 'ANY', cq.units, cq.cartons, cq.kg, cq.cbm, cq.goods, cq.cur, cq.fc, [...cq.traits].sort().join('+')].join('|');
}
