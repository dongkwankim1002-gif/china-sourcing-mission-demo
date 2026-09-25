import 'server-only';
/**
 * 같은 조건 비교 — 화물 하나 × 구간 하나 → 현재 요금표마다 9구간 견적.
 * 보이는 요금표는 RLS 가 정한다(비로그인 = 공개가 요금표만).
 */
import type { Queryable } from '../db';
import {
  completeWithReference,
  computeQuote,
  daysUntil,
  exclusionReasons,
  isFcReady,
  priceCertaintyOf,
  recommendScore,
  scoreParts,
  type Cargo,
  type ExclusionReason,
  type QuoteResult,
  type RateLine,
  type RateTier,
  type Segment,
  type TraitRule,
} from '../money';
import type { AppSettings } from './settings';

export interface CompareInput {
  hub: string;
  port: string;
  mode: string | null;
  cargo: Cargo;
  traits: string[];
}

export interface PartnerBrief {
  id: string;
  name: string;
  name_zh: string | null;
  slug: string | null;
  status: string;
  business_type: string | null;
  logo_path: string | null;
  related_party_note: string | null;
  is_demo: boolean;
}

export interface PartnerMetrics {
  shipments_done: number;
  on_time_rate: number | null;
  return_rate_30d: number | null;
  done_30d: number;
  avg_deviation: number | null;
  avg_signed_deviation: number | null;
  invoiced_count: number;
  price_certainty: number | null;
  reviews_count: number;
  avg_rating: number | null;
}

export interface Offer {
  cardId: string;
  cardNo: string;
  version: number;
  partner: PartnerBrief;
  mode: string;
  validFrom: string;
  validTo: string;
  createdAt: string;
  cardCertainty: string;
  fuelSeparate: boolean;
  isPublicPrice: boolean;
  transit: [number, number];
  raw: QuoteResult;
  quote: QuoteResult;
  score: number;
  parts: ReturnType<typeof scoreParts>;
  metrics: PartnerMetrics | null;
  fcReady: boolean;
  isAd: boolean;
  daysLeft: number;
  exclusions: ExclusionReason[];
  status: string;
}

export interface CompareResult {
  offers: Offer[];
  excluded: Offer[];
  expired: Offer[];
  ad: Offer | null;
  verdicts: { code: string; name_ko: string; verdict_ko: string; requirement_ko: string }[];
  referenceUsed: boolean;
}

interface CardRow {
  id: string;
  org_id: string;
  card_no: string;
  version: number;
  mode: string;
  valid_from: string;
  valid_to: string;
  certainty: string;
  fuel_surcharge_separate: boolean;
  is_public_price: boolean;
  transit_days_min: number;
  transit_days_max: number;
  status: string;
  created_at: string;
}

export async function loadCards(q: Queryable, where: { hub: string; port: string; mode: string | null; cardIds?: string[] }) {
  const cards = await q.query<CardRow>(
    `select id, org_id, card_no, version, mode, valid_from, valid_to, certainty, fuel_surcharge_separate, is_public_price,
            transit_days_min, transit_days_max, status, created_at
       from fcd.v_rate_cards_current
      where origin_hub = $1 and port = $2 and ($3::text is null or mode = $3)
        and ($4::uuid[] is null or id = any($4::uuid[]))
        and valid_to >= (now() at time zone 'Asia/Seoul')::date - 30`,
    [where.hub, where.port, where.mode, where.cardIds ?? null],
  );
  const ids = cards.map((c) => c.id);
  if (ids.length === 0) return { cards, lines: new Map<string, RateLine[]>(), tiers: new Map<string, RateTier[]>() };
  const lineRows = await q.query<{ rate_card_id: string; segment: Segment; included: boolean; basis: RateLine['basis']; unit_price: number; currency: RateLine['currency']; min_charge: number | null; certainty: RateLine['certainty'] }>(
    `select rate_card_id, segment, included, basis, unit_price, currency, min_charge, certainty
       from fcd.rate_card_lines where rate_card_id = any($1::uuid[])`,
    [ids],
  );
  const tierRows = await q.query<{ rate_card_id: string; segment: Segment; min_qty: number; discount_bp: number }>(
    `select rate_card_id, segment, min_qty, discount_bp from fcd.rate_card_tiers where rate_card_id = any($1::uuid[])`,
    [ids],
  );
  const lines = new Map<string, RateLine[]>();
  for (const l of lineRows) {
    const arr = lines.get(l.rate_card_id) ?? [];
    arr.push({ segment: l.segment, included: l.included, basis: l.basis, unitPrice: l.unit_price, currency: l.currency, minCharge: l.min_charge, certainty: l.certainty });
    lines.set(l.rate_card_id, arr);
  }
  const tiers = new Map<string, RateTier[]>();
  for (const t of tierRows) {
    const arr = tiers.get(t.rate_card_id) ?? [];
    arr.push({ segment: t.segment, minQty: t.min_qty, discountBp: t.discount_bp });
    tiers.set(t.rate_card_id, arr);
  }
  return { cards, lines, tiers };
}

export async function loadPartnerFacts(q: Queryable, orgIds: string[], today: string) {
  if (orgIds.length === 0) return { partners: new Map<string, PartnerBrief & { caps: string[] }>(), metrics: new Map<string, PartnerMetrics>(), grades: new Map<string, boolean>(), ads: [] as { org_id: string; lane_hub: string | null; lane_port: string | null }[] };
  const partners = await q.query<PartnerBrief & { caps: string[] | null }>(
    `select o.id, o.name, o.name_zh, o.slug, o.status, o.business_type, o.logo_path, o.related_party_note, o.is_demo,
            (select array_agg(trait) from fcd.org_capabilities c where c.org_id = o.id) as caps
       from fcd.orgs o where o.id = any($1::uuid[])`,
    [orgIds],
  );
  const metrics = await q.query<PartnerMetrics & { org_id: string }>(`select * from fcd.v_partner_metrics where org_id = any($1::uuid[])`, [orgIds]);
  const grades = await q.query<{ org_id: string; granted: boolean }>(
    `select distinct on (org_id) org_id, granted from fcd.grade_records
      where org_id = any($1::uuid[]) and grade = 'fc_ready' order by org_id, created_at desc`,
    [orgIds],
  );
  const ads = await q.query<{ org_id: string; lane_hub: string | null; lane_port: string | null }>(
    `select org_id, lane_hub, lane_port from fcd.ad_slots
      where status = 'active' and starts_on <= $2::date and ends_on >= $2::date and org_id = any($1::uuid[])`,
    [orgIds, today],
  );
  return {
    partners: new Map(partners.map((p) => [p.id, { ...p, caps: p.caps ?? [] }])),
    metrics: new Map(metrics.map((m) => [m.org_id, m])),
    grades: new Map(grades.map((g) => [g.org_id, g.granted])),
    ads,
  };
}

export async function loadTraitRules(q: Queryable) {
  const rows = await q.query<{ code: string; name_ko: string; verdict_ko: string; requirement_ko: string; needs_capability: boolean; blocked_modes: string[] }>(
    'select code, name_ko, verdict_ko, requirement_ko, needs_capability, blocked_modes from fcd.cargo_traits order by ord',
  );
  const rules: TraitRule[] = rows.map((r) => ({ code: r.code, name: r.name_ko, needsCapability: r.needs_capability, blockedModes: r.blocked_modes }));
  return { rows, rules };
}

export async function compare(q: Queryable, input: CompareInput, s: AppSettings, today: string): Promise<CompareResult> {
  const { cards, lines, tiers } = await loadCards(q, { hub: input.hub, port: input.port, mode: input.mode });
  const orgIds = [...new Set(cards.map((c) => c.org_id))];
  const [facts, traits] = await Promise.all([loadPartnerFacts(q, orgIds, today), loadTraitRules(q)]);
  const refQuote = computeQuote(s.referenceLines, input.cargo, s.quoteParams);
  const reference = Object.fromEntries(refQuote.segments.map((x) => [x.segment, x.amount])) as Partial<Record<Segment, number>>;

  const all: Offer[] = [];
  for (const c of cards) {
    const ls = lines.get(c.id) ?? [];
    // 종합 견적만 비교한다(국제운송을 맡는 요금표). 관세사·국내 창고 전문 업체는 업체 찾기에서.
    if (!ls.some((l) => l.segment === 'freight' && l.included)) continue;
    const partner = facts.partners.get(c.org_id);
    if (!partner) continue;
    const raw = computeQuote(ls, input.cargo, s.quoteParams, tiers.get(c.id) ?? []);
    const quote = completeWithReference(raw, reference, input.cargo.units);
    const metrics = facts.metrics.get(c.org_id) ?? null;
    const certainty = priceCertaintyOf(raw.confirmedTotal, quote.total);
    const scoreInput = {
      onTimeRate: metrics?.shipments_done ? metrics.on_time_rate : null,
      avgDeviation: metrics?.invoiced_count ? metrics.avg_deviation : null,
      fcReturnRate: metrics?.done_30d ? metrics.return_rate_30d : null,
      priceCertainty: certainty,
    };
    const fcReady =
      (facts.grades.get(c.org_id) ?? false) &&
      isFcReady(metrics?.shipments_done ?? 0, metrics?.return_rate_30d ?? null, s.fcReadyRule);
    const exclusions = exclusionReasons(
      { orgId: c.org_id, capabilities: partner.caps, mode: c.mode, validFrom: c.valid_from, validTo: c.valid_to, status: c.status as 'active' | 'withdrawn' },
      input.traits,
      traits.rules,
      today,
    );
    all.push({
      cardId: c.id,
      cardNo: c.card_no,
      version: c.version,
      partner,
      mode: c.mode,
      validFrom: c.valid_from,
      validTo: c.valid_to,
      createdAt: c.created_at,
      cardCertainty: c.certainty,
      fuelSeparate: c.fuel_surcharge_separate,
      isPublicPrice: c.is_public_price,
      transit: [c.transit_days_min, c.transit_days_max],
      raw,
      quote,
      score: recommendScore(scoreInput, s.scoreCaps),
      parts: scoreParts(scoreInput, s.scoreCaps),
      metrics,
      fcReady,
      isAd: facts.ads.some((a) => a.org_id === c.org_id && (a.lane_hub == null || a.lane_hub === input.hub) && (a.lane_port == null || a.lane_port === input.port)),
      daysLeft: daysUntil(c.valid_to, today),
      exclusions,
      status: c.status,
    });
  }
  const expired = all.filter((o) => o.exclusions.some((e) => e.kind === 'expired'));
  const excluded = all.filter((o) => o.exclusions.length > 0 && !o.exclusions.some((e) => e.kind === 'expired'));
  const offers = all.filter((o) => o.exclusions.length === 0);
  // 한 업체가 같은 구간에 여러 방식 요금표를 두면 모두 보인다(방식이 다르므로). 같은 방식 중복은 최신만.
  offers.sort((a, b) => b.score - a.score || a.quote.total - b.quote.total);
  const adCand = offers.filter((o) => o.isAd).sort((a, b) => a.quote.total - b.quote.total)[0] ?? null;
  const verdicts = traits.rows.filter((t) => input.traits.includes(t.code));
  return { offers, excluded, expired, ad: adCand, verdicts, referenceUsed: offers.some((o) => o.quote.filled.length > 0) };
}

export type SortKey = 'recommend' | 'cheapest' | 'fastest' | 'deviation';

export function sortOffers(list: Offer[], key: SortKey): Offer[] {
  const a = [...list];
  switch (key) {
    case 'cheapest':
      return a.sort((x, y) => x.quote.total - y.quote.total);
    case 'fastest':
      return a.sort((x, y) => x.transit[0] - y.transit[0] || x.transit[1] - y.transit[1] || x.quote.total - y.quote.total);
    case 'deviation':
      return a.sort((x, y) => (x.metrics?.avg_deviation ?? 9) - (y.metrics?.avg_deviation ?? 9) || x.quote.total - y.quote.total);
    default:
      return a.sort((x, y) => y.score - x.score || x.quote.total - y.quote.total);
  }
}

export function filterOffers(list: Offer[], f: { confirmedOnly?: boolean; fcReadyOnly?: boolean; officialOnly?: boolean }) {
  return list.filter(
    (o) =>
      (!f.confirmedOnly || (o.cardCertainty === 'confirmed' && o.raw.extraPossible.length === 0)) &&
      (!f.fcReadyOnly || o.fcReady) &&
      (!f.officialOnly || o.partner.status === 'official'),
  );
}
