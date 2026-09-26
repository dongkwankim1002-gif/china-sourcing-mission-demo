/**
 * 청구서 점검의 비교 기준 — 한 구간(거점·도착항·방식)의 현재 요금표로 「셀러가 넣은 화물」의 9구간 금액을 계산해
 * 구간별 분포(중간값·싼 쪽 25%·비싼 쪽 25%·최저)와 총액 분포만 낸다. 개별 업체 가격은 내보내지 않는다.
 *
 * 서버 전용 표시(server-only)를 두지 않는다 — 데모 시드(tsx)와 시험(vitest)이 같은 함수를 부른다.
 * 앱에서는 src/lib/server/invoice-check.ts 가 asSystem 으로 좁게 감싸 부른다(집계 숫자만 나간다).
 * 구간 시세(laneStats)는 기준 화물 하나로 미리 계산해 두는 것이고, 이쪽은 셀러의 화물로 그때그때 계산한다.
 */
import type { Queryable } from './db/driver';
import {
  benchmarkFrom,
  completeWithReference,
  computeQuote,
  distribution,
  SEGMENTS,
  type Benchmark,
  type Cargo,
  type InvoiceCheckRule,
  type MarketTotals,
  type QuoteParams,
  type RateLine,
  type RateTier,
  type Segment,
} from './money';

export interface LaneInput {
  hub: string;
  port: string;
  /** null = 방식 상관없음 */
  mode: string | null;
  cargo: Cargo;
}

export interface MarketParams {
  quoteParams: QuoteParams;
  referenceLines: RateLine[];
  rule: InvoiceCheckRule;
  /** 'YYYY-MM-DD'(KST) — 이날 유효한 요금표만 */
  today: string;
  /** 데모 조직 요금표를 넣을지(DEMO_MODE) */
  demoMode: boolean;
}

export interface LaneMarket {
  benchmarks: Record<Segment, Benchmark>;
  market: MarketTotals;
  /** 이 화물의 플랫폼 참고치(구간별 원) */
  reference: Partial<Record<Segment, number>>;
}

export async function laneMarket(q: Queryable, input: LaneInput, p: MarketParams): Promise<LaneMarket> {
  const cards = await q.query<{ id: string }>(
    `select r.id from fcd.v_rate_cards_current r join fcd.orgs o on o.id = r.org_id
      where r.origin_hub = $1 and r.port = $2 and ($3::text is null or r.mode = $3)
        and r.status = 'active' and r.valid_from <= $4::date and r.valid_to >= $4::date
        and o.kind = 'partner' and o.status in ('official', 'pending_verification') and ($5 or not o.is_demo)`,
    [input.hub, input.port, input.mode, p.today, p.demoMode],
  );
  const ids = cards.map((c) => c.id);
  const lines = new Map<string, RateLine[]>();
  const tiers = new Map<string, RateTier[]>();
  if (ids.length) {
    const lr = await q.query<{ rate_card_id: string; segment: Segment; included: boolean; basis: RateLine['basis']; unit_price: number; currency: RateLine['currency']; min_charge: number | null; certainty: RateLine['certainty'] }>(
      `select rate_card_id, segment, included, basis, unit_price, currency, min_charge, certainty from fcd.rate_card_lines where rate_card_id = any($1::uuid[])`,
      [ids],
    );
    for (const l of lr) {
      const arr = lines.get(l.rate_card_id) ?? [];
      arr.push({ segment: l.segment, included: l.included, basis: l.basis, unitPrice: Number(l.unit_price), currency: l.currency, minCharge: l.min_charge == null ? null : Number(l.min_charge), certainty: l.certainty });
      lines.set(l.rate_card_id, arr);
    }
    const tr = await q.query<{ rate_card_id: string; segment: Segment; min_qty: number; discount_bp: number }>(
      `select rate_card_id, segment, min_qty, discount_bp from fcd.rate_card_tiers where rate_card_id = any($1::uuid[])`,
      [ids],
    );
    for (const t of tr) {
      const arr = tiers.get(t.rate_card_id) ?? [];
      arr.push({ segment: t.segment, minQty: Number(t.min_qty), discountBp: t.discount_bp });
      tiers.set(t.rate_card_id, arr);
    }
  }
  return marketFromCards(
    ids.map((id) => ({ lines: lines.get(id) ?? [], tiers: tiers.get(id) ?? [] })),
    input.cargo,
    p,
  );
}

/** DB 없이 — 요금표 줄 묶음에서 분포를 만든다(시험·시드도 이 길을 탄다) */
export function marketFromCards(cards: { lines: RateLine[]; tiers: RateTier[] }[], cargo: Cargo, p: Pick<MarketParams, 'quoteParams' | 'referenceLines' | 'rule'>): LaneMarket {
  const refQuote = computeQuote(p.referenceLines, cargo, p.quoteParams);
  const reference = Object.fromEntries(refQuote.segments.filter((s) => s.amount != null).map((s) => [s.segment, s.amount])) as Partial<Record<Segment, number>>;
  const segAmounts = new Map<Segment, number[]>(SEGMENTS.map((s) => [s, []]));
  const totals: number[] = [];
  for (const c of cards) {
    // 종합 견적만(국제운송을 맡는 요금표) — 비교 화면·구간 시세와 같은 기준
    if (!c.lines.some((l) => l.segment === 'freight' && l.included)) continue;
    const raw = computeQuote(c.lines, cargo, p.quoteParams, c.tiers);
    for (const s of raw.segments) if (s.amount != null) segAmounts.get(s.segment)!.push(s.amount);
    totals.push(completeWithReference(raw, reference, cargo.units).total);
  }
  const benchmarks = Object.fromEntries(
    SEGMENTS.map((s) => [s, benchmarkFrom(segAmounts.get(s)!, totals.length, reference[s], p.rule)]),
  ) as Record<Segment, Benchmark>;
  return { benchmarks, market: { cards: totals.length, totals: distribution(totals) }, reference };
}

/** 설정 값 → 규칙. 빠진 칸이 있으면 알린다(코드에 기본값을 박지 않는다) */
export function parseInvoiceCheckRule(v: unknown): InvoiceCheckRule {
  const o = (v ?? {}) as Record<string, unknown>;
  const keys: (keyof InvoiceCheckRule)[] = ['minSamples', 'highOverMedianBp', 'lowUnderMedianBp', 'missingCoverageBp', 'publicPerMinute'];
  for (const k of keys) {
    if (typeof o[k] !== 'number' || !Number.isFinite(o[k] as number) || (o[k] as number) < 0) {
      throw new Error(`설정 invoice_check_rule.${k} 가 없거나 숫자가 아닙니다. 참조 시드를 올려 주세요.`);
    }
  }
  return {
    minSamples: o.minSamples as number,
    highOverMedianBp: o.highOverMedianBp as number,
    lowUnderMedianBp: o.lowUnderMedianBp as number,
    missingCoverageBp: o.missingCoverageBp as number,
    publicPerMinute: o.publicPerMinute as number,
    // 없으면(0006 첫 판만 있는 DB) 퍼짐을 싣지 않는다 — 안전한 쪽
    minSpreadSamples: typeof o.minSpreadSamples === 'number' && Number.isFinite(o.minSpreadSamples) && o.minSpreadSamples >= 1 ? o.minSpreadSamples : undefined,
  };
}
