import 'server-only';
/** 후보 행(담당 입력) · 흉내 후보 → 화면 모양(CandView) + 도착원가 시뮬 */
import type { Queryable } from '../db';
import { sampleCostKrw } from '../money';
import { getSourcingProvider } from '../sourcing/providers';
import type { CandView } from '@/components/sourcing/candidates';
import { providerToSimQuote, rowToSimQuote, scoreCandidate, simulate, type CandidateRow, type RequestRow, type SimContext } from './sourcing';

async function trySim(q: Queryable, ctx: SimContext, input: Parameters<typeof simulate>[2]) {
  try {
    return { sim: await simulate(q, ctx, input), simError: null };
  } catch (e) {
    return { sim: null, simError: `셈하지 못했습니다: ${(e as Error).message}` };
  }
}

export async function candidateViews(
  q: Queryable,
  ctx: SimContext,
  req: RequestRow,
  rows: CandidateRow[],
  opts: { qty: number; price: number | null; hubName: Map<string, string>; sampleDone?: Set<string> },
): Promise<CandView[]> {
  const out: CandView[] = [];
  for (const c of rows) {
    const x = c.quote;
    if (!x) continue;
    const withdrawn = x.status === 'withdrawn';
    const detail = (c.similarity_detail ?? {}) as { level?: CandView['level'] };
    const base: Omit<CandView, 'sim'> = {
      key: c.id,
      id: c.id,
      label: c.label,
      kind: c.supplier_kind,
      hubName: c.hub ? (opts.hubName.get(c.hub) ?? c.hub) : null,
      region: c.region,
      productTitle: c.product_title,
      rating: c.rating,
      yearsActive: c.years_active,
      certsClaimed: c.certs_claimed,
      certsVerified: c.certs_verified,
      source: c.source,
      sourceUrl: c.source_url,
      similarity: c.similarity,
      level: detail.level ?? (c.similarity >= 60 ? 'high' : c.similarity >= ctx.config.rules.similarity.minShow ? 'mid' : 'low'),
      currency: x.currency,
      tiers: x.tiers,
      moq: x.moq,
      leadMin: x.lead_days_min,
      leadMax: x.lead_days_max,
      sampleFee: x.sample_fee,
      sampleDays: x.sample_days,
      sampleCostKrw: sampleCostKrw(x.sample_fee, x.currency, ctx.basis.fx, ctx.config.fees.sampleHandlingKrw),
      version: x.version,
      withdrawn,
    };
    if (withdrawn || opts.price == null) {
      out.push({ ...base, sim: null, simError: withdrawn ? '내린 후보라 셈하지 않습니다.' : '목표 판매가를 넣으면 마진을 셈합니다.' });
      continue;
    }
    out.push({ ...base, ...(await trySim(q, ctx, { hub: c.hub ?? req.hub, category: req.category, qty: opts.qty, price: opts.price, quote: rowToSimQuote(x) })) });
  }
  return out;
}

/** 담당이 후보를 넣기 전 미리보기 — 흉내 제공자의 예시 후보(저장하지 않는다, 밖을 부르지 않는다) */
export async function mockViews(
  q: Queryable,
  ctx: SimContext,
  req: RequestRow,
  opts: { qty: number; price: number | null; hubName: Map<string, string>; unitKg?: number | null; unitCbm?: number | null },
): Promise<CandView[]> {
  const found = await getSourcingProvider('mock').search(
    { productName: req.product_name, keywords: req.keywords, category: req.category, targetPrice: req.target_price, hub: req.hub, qty: opts.qty, needsCert: req.needs_cert },
    { limit: 3, fxRmb: ctx.basis.fx.RMB, targetCostShareBp: ctx.config.rules.targetCostShareBp, unitKg: opts.unitKg, unitCbm: opts.unitCbm },
  );
  const out: CandView[] = [];
  for (const [i, f] of found.entries()) {
    const sim = scoreCandidate(req, { productTitle: f.productTitle, category: f.category, tiers: f.quote.tiers, currency: f.quote.currency, moq: f.quote.moq }, ctx.config, ctx.basis.fx);
    const base: Omit<CandView, 'sim'> = {
      key: `mock-${i}`,
      id: null,
      label: f.label,
      kind: f.supplierKind,
      hubName: f.hub ? (opts.hubName.get(f.hub) ?? f.hub) : null,
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
      sampleCostKrw: sampleCostKrw(f.quote.sampleFee, f.quote.currency, ctx.basis.fx, ctx.config.fees.sampleHandlingKrw),
      version: null,
      withdrawn: false,
    };
    if (opts.price == null) out.push({ ...base, sim: null, simError: '목표 판매가를 넣으면 마진을 셈합니다.' });
    else out.push({ ...base, ...(await trySim(q, ctx, { hub: f.hub, category: req.category, qty: opts.qty, price: opts.price, quote: providerToSimQuote(f) })) });
  }
  return out.sort((a, b) => b.similarity - a.similarity);
}
