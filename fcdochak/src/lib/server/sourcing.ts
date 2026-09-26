import 'server-only';
/**
 * 소싱처 찾기(v2 3차 sourcing) — 설정·요청·후보 읽기와 후보 도착원가 시뮬.
 * 계산은 money/sourcing(candidateSim → sellerPnl) 순수 함수. 물류비는 FC도착 구간 시세(compare)와 같은 규칙으로
 * 모으고(공개 도착원가와 같은 최소 표본 — 업체가 적으면 플랫폼 참고치), 업체별 금액은 싣지 않는다.
 */
import type { Queryable } from '../db';
import { env } from '../env';
import { candidateCargo, candidateSim, computeQuote, SEGMENTS_TO_KR_PORT, unitPriceAt, type CandidateSimResult, type PriceTier } from '../money';
import { buildArrivalResponse } from '../tools-arrival';
import { readSourcingConfig, type SourcingConfig, type SourcingStatus } from '../sourcing/settings';
import { similarityScore } from '../sourcing/similarity';
import type { ProviderCandidate } from '../sourcing/providers';
import { compare } from './compare';
import { loadSettings, type AppSettings } from './settings';
import { loadArrivalRule, loadToolBasis, type ToolBasis } from './tools';

export async function loadSourcingConfig(q: Queryable): Promise<SourcingConfig> {
  const rows = await q.query<{ key: string; value: unknown }>(`select key, value from fcd.v_current_settings where key like 'sourcing.%'`);
  return readSourcingConfig(new Map(rows.map((r) => [r.key, r.value])));
}

export interface RequestRow {
  id: string;
  request_no: string;
  org_id: string;
  org_name?: string;
  is_demo?: boolean;
  created_by: string;
  origin: 'sku' | 'sales' | 'manual';
  origin_ref: string | null;
  product_name: string;
  category: string;
  keywords: string[];
  image_url: string | null;
  target_price: number | null;
  monthly_units: number | null;
  first_order_units: number | null;
  needs_cert: boolean;
  cert_note: string | null;
  hub: string | null;
  note: string | null;
  due_on: string;
  preview: boolean;
  created_at: string;
  status: SourcingStatus;
  assignee_id: string | null;
  status_at: string | null;
  candidates: number;
}

const REQ_COLS = `r.id, r.request_no, r.org_id, r.created_by, r.origin, r.origin_ref, r.product_name, r.category, r.keywords, r.image_url,
  r.target_price, r.monthly_units, r.first_order_units, r.needs_cert, r.cert_note, r.hub, r.note, r.due_on::text due_on, r.preview, r.created_at,
  r.status, r.assignee_id, r.status_at,
  (select count(*)::int from fcd.sourcing_candidates c where c.request_id = r.id) candidates`;

export async function myRequests(q: Queryable, orgId: string): Promise<RequestRow[]> {
  return q.query<RequestRow>(`select ${REQ_COLS} from fcd.v_sourcing_requests_current r where r.org_id = $1 order by r.created_at desc limit 50`, [orgId]);
}

export async function openRequestCount(q: Queryable, orgId: string): Promise<number> {
  const r = await q.query<{ n: number }>(
    `select count(*)::int n from fcd.v_sourcing_requests_current where org_id = $1 and status in ('requested','researching','candidates_ready','sample_requested')`,
    [orgId],
  );
  return r[0]?.n ?? 0;
}

/** 운영 대기열 — 모든 조직(운영자만 RLS 로 다 보인다) */
export async function requestQueue(q: Queryable): Promise<(RequestRow & { org_name: string; is_demo: boolean; assignee_name: string | null })[]> {
  return q.query(
    `select ${REQ_COLS}, o.name org_name, o.is_demo, p.name assignee_name
       from fcd.v_sourcing_requests_current r join fcd.orgs o on o.id = r.org_id left join fcd.profiles p on p.id = r.assignee_id
      order by case when r.status in ('requested','researching') then 0 when r.status in ('candidates_ready','sample_requested') then 1 else 2 end,
               r.due_on, r.created_at
      limit 200`,
  );
}

export async function requestById(q: Queryable, id: string): Promise<(RequestRow & { org_name: string; is_demo: boolean }) | null> {
  const rows = await q.query<RequestRow & { org_name: string; is_demo: boolean }>(
    `select ${REQ_COLS}, o.name org_name, o.is_demo from fcd.v_sourcing_requests_current r join fcd.orgs o on o.id = r.org_id where r.id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

export interface RequestEventRow {
  id: string;
  status: SourcingStatus;
  note: string | null;
  created_at: string;
  assignee_id: string | null;
  actor_id: string;
}

export async function requestEvents(q: Queryable, requestId: string): Promise<RequestEventRow[]> {
  return q.query(`select id, status, note, created_at, assignee_id, actor_id from fcd.sourcing_request_events where request_id = $1 order by created_at desc, id desc`, [requestId]);
}

export interface CandidateRow {
  id: string;
  request_id: string;
  org_id: string;
  label: string;
  supplier_kind: 'factory' | 'trader' | 'unknown';
  hub: string | null;
  region: string | null;
  product_title: string;
  category: string | null;
  rating: number | null;
  years_active: number | null;
  certs_claimed: string[];
  certs_verified: string[];
  source: 'manual' | 'seller_link' | 'mock' | 'api';
  source_url: string | null;
  image_url: string | null;
  similarity: number;
  similarity_detail: unknown;
  note: string | null;
  created_at: string;
  quote: QuoteRow | null;
}

export interface QuoteRow {
  id: string;
  version: number;
  status: 'active' | 'withdrawn';
  currency: 'RMB' | 'USD';
  tiers: PriceTier[];
  moq: number;
  lead_days_min: number;
  lead_days_max: number;
  sample_fee: number | null;
  sample_days: number | null;
  unit_kg: number;
  unit_cbm: number;
  units_per_carton: number;
  valid_until: string | null;
  note: string | null;
  created_at: string;
}

export async function candidatesFor(q: Queryable, requestId: string): Promise<CandidateRow[]> {
  const cands = await q.query<Omit<CandidateRow, 'quote'> & { rating: string | null }>(
    `select id, request_id, org_id, label, supplier_kind, hub, region, product_title, category, rating::text rating, years_active, certs_claimed, certs_verified,
            source, source_url, image_url, similarity, similarity_detail, note, created_at
       from fcd.sourcing_candidates where request_id = $1 order by similarity desc, created_at`,
    [requestId],
  );
  if (!cands.length) return [];
  const quotes = await q.query<QuoteRow & { candidate_id: string; sample_fee: string | null; unit_kg: string; unit_cbm: string }>(
    `select id, candidate_id, version, status, currency, tiers, moq, lead_days_min, lead_days_max, sample_fee::text sample_fee, sample_days,
            unit_kg::text unit_kg, unit_cbm::text unit_cbm, units_per_carton, valid_until::text valid_until, note, created_at
       from fcd.v_candidate_quotes_current where candidate_id = any($1::uuid[])`,
    [cands.map((c) => c.id)],
  );
  const byCand = new Map(quotes.map((x) => [x.candidate_id, x]));
  return cands.map((c) => {
    const x = byCand.get(c.id);
    return {
      ...c,
      rating: c.rating == null ? null : Number(c.rating),
      quote: x
        ? { ...x, sample_fee: x.sample_fee == null ? null : Number(x.sample_fee), unit_kg: Number(x.unit_kg), unit_cbm: Number(x.unit_cbm) }
        : null,
    };
  });
}

export async function mySampleInterests(q: Queryable, userId: string, requestId: string): Promise<Set<string>> {
  const rows = await q.query<{ candidate_id: string }>(`select candidate_id from fcd.sourcing_sample_interests where user_id = $1 and request_id = $2`, [userId, requestId]);
  return new Set(rows.map((r) => r.candidate_id));
}

export async function sampleInterestsFor(q: Queryable, requestId: string) {
  return q.query<{ id: string; candidate_id: string; created_at: string; user_name: string; detail: { qty?: number; arrivalPerUnit?: number; version?: number } | null }>(
    `select s.id, s.candidate_id, s.created_at, p.name user_name, s.detail from fcd.sourcing_sample_interests s join fcd.profiles p on p.id = s.user_id
      where s.request_id = $1 order by s.created_at desc`,
    [requestId],
  );
}

/** 운영 조직 사람(담당 고르기) */
export async function platformPeople(q: Queryable): Promise<{ id: string; name: string }[]> {
  return q.query(
    `select distinct p.id, p.name from fcd.memberships m join fcd.orgs o on o.id = m.org_id join fcd.profiles p on p.id = m.user_id
      where o.kind = 'platform' and m.role = 'platform_admin' order by p.name`,
  );
}

// ─── 시뮬 ─────────────────────────────────────────────────────────────

export interface SimContext {
  s: AppSettings;
  basis: ToolBasis;
  config: SourcingConfig;
  rule: Awaited<ReturnType<typeof loadArrivalRule>>;
  today: string;
}

export async function simContext(q: Queryable, today: string): Promise<SimContext> {
  const s = await loadSettings(q);
  const basis = await loadToolBasis(q);
  const config = await loadSourcingConfig(q);
  const rule = await loadArrivalRule(q);
  return { s, basis, config, rule, today };
}

export interface SimView {
  sim: CandidateSimResult;
  /** 물류비를 어디서 셈했나 — market = 업체 요금표 중간값 · reference = 플랫폼 참고치 */
  logisticsBasis: 'market' | 'reference';
  offers: number;
  hub: string;
  port: string;
  mode: string;
  fc: string;
  /** FC도착 비교 화면 링크(같은 화물 조건) */
  compareHref: string;
}

export interface SimQuote {
  currency: 'RMB' | 'USD';
  tiers: PriceTier[];
  moq: number;
  unitKg: number;
  unitCbm: number;
  unitsPerCarton: number;
}

/** 후보 하나의 도착원가·마진 — 같은 화물로 구간 시세를 모아 candidateSim 에 넘긴다 */
export async function simulate(q: Queryable, ctx: SimContext, input: { hub: string | null; category: string; qty: number; price: number; quote: SimQuote }): Promise<SimView> {
  const r = ctx.config.rules;
  const hub = input.hub ?? r.defaultHub;
  const tier = unitPriceAt(input.quote.tiers, input.qty);
  const cargo = candidateCargo({ qty: input.qty, unitKg: input.quote.unitKg, unitCbm: input.quote.unitCbm, unitsPerCarton: input.quote.unitsPerCarton, unitPrice: tier.unitPrice, currency: input.quote.currency });
  const cmp = await compare(q, { hub, port: r.defaultPort, mode: r.defaultMode, cargo, traits: [], fc: r.defaultFc }, ctx.s, ctx.today);
  const ref = computeQuote(ctx.s.referenceLines, cargo, ctx.s.quoteParams);
  const reference = {
    total: ref.segments.reduce((a, x) => a + (x.amount ?? 0), 0),
    toPort: ref.segments.filter((x) => SEGMENTS_TO_KR_PORT.includes(x.segment)).reduce((a, x) => a + (x.amount ?? 0), 0),
    segments: ref.segments.map((x) => ({ segment: x.segment, amount: x.amount })),
  };
  const arr = buildArrivalResponse(cmp, {
    okOrg: (p) => (p.status === 'official' || p.status === 'pending_verification') && (env.demoMode || !p.is_demo),
    units: input.qty,
    rule: ctx.rule,
    reference,
  });
  // 같은 구간 요금표가 하나도 없으면 참고치로
  const useRef = arr.count === 0;
  const logisticsTotal = useRef ? reference.total : arr.median;
  const freightToPort = useRef ? reference.toPort : arr.toPortMedian;
  const duty = ctx.basis.dutyRates.find((d) => d.category === input.category) ?? ctx.basis.dutyRates.find((d) => d.category === 'general');
  const fee = ctx.basis.fee;
  const sim = candidateSim({
    qty: input.qty,
    price: input.price,
    tiers: input.quote.tiers,
    currency: input.quote.currency,
    moq: input.quote.moq,
    unitKg: input.quote.unitKg,
    unitCbm: input.quote.unitCbm,
    unitsPerCarton: input.quote.unitsPerCarton,
    fx: ctx.basis.fx,
    logisticsTotal,
    freightToPortKrw: freightToPort,
    dutyRateBp: duty?.rate_bp ?? 0,
    vatRateBp: ctx.basis.vatRateBp,
    insuranceBp: ctx.basis.insuranceBp,
    saleFeeBp: fee.saleFeeBp,
    adBp: fee.adBp,
    inboundPerUnit: fee.rgInboundPerUnit,
    shippingPerUnit: fee.rgShippingPerUnit,
    agentFeeBp: ctx.config.fees.agentFeeBp,
  });
  const p = new URLSearchParams({
    hub,
    port: r.defaultPort,
    mode: r.defaultMode,
    units: String(cargo.units),
    cartons: String(cargo.cartons),
    kg: String(cargo.kg),
    cbm: String(cargo.cbm),
    goods: String(cargo.goodsValue),
    cur: cargo.goodsCurrency,
    fc: r.defaultFc,
  });
  return {
    sim,
    logisticsBasis: useRef ? 'reference' : arr.basis,
    offers: arr.count,
    hub,
    port: r.defaultPort,
    mode: r.defaultMode,
    fc: r.defaultFc,
    compareHref: `/app/compare?${p.toString()}`,
  };
}

/** 후보(흉내·담당 입력)의 유사도 — 넣을 때 셈해 남긴다 */
export function scoreCandidate(
  req: { product_name: string; keywords: string[]; category: string; target_price: number | null; first_order_units: number | null },
  c: { productTitle: string; category: string | null; tiers: PriceTier[]; currency: 'RMB' | 'USD'; moq: number },
  config: SourcingConfig,
  fx: Record<'KRW' | 'RMB' | 'USD', number>,
) {
  const qty = Math.max(req.first_order_units ?? c.moq, 1);
  const unit = unitPriceAt(c.tiers, qty).unitPrice;
  return similarityScore(
    { productName: req.product_name, keywords: req.keywords, category: req.category, targetPrice: req.target_price },
    { productTitle: c.productTitle, category: c.category, unitPriceKrw: Math.round(unit * fx[c.currency]) },
    { weights: config.rules.similarity, targetCostShareBp: config.rules.targetCostShareBp, priceBandBp: config.rules.priceBandBp },
  );
}

export function providerToSimQuote(c: ProviderCandidate): SimQuote {
  return { currency: c.quote.currency, tiers: c.quote.tiers, moq: c.quote.moq, unitKg: c.quote.unitKg, unitCbm: c.quote.unitCbm, unitsPerCarton: c.quote.unitsPerCarton };
}

export function rowToSimQuote(x: QuoteRow): SimQuote {
  return { currency: x.currency, tiers: x.tiers, moq: x.moq, unitKg: x.unit_kg, unitCbm: x.unit_cbm, unitsPerCarton: x.units_per_carton };
}
