'use server';
/**
 * 소싱처 찾기(v2 3차 sourcing) — 요청·취소·샘플 관심 등록(화주), 상태·후보·조건 새 판(운영).
 * 어느 것도 밖으로 연락하지 않는다(메일·문자·외부 API 없음). 스위치 sourcing.enabled 가 꺼져 있으면 요청은 「미리보기」로 기록만.
 */
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { asUser, todayKst, type Queryable } from '@/lib/db';
import { requireViewer } from '@/lib/server/viewer';
import { newNo } from '@/lib/server/rate-cards';
import { candidatesFor, loadSourcingConfig, openRequestCount, requestById, rowToSimQuote, scoreCandidate, simContext, simulate } from '@/lib/server/sourcing';
import { loadSettings } from '@/lib/server/settings';
import { dueOn, SOURCING_STATUSES } from '@/lib/sourcing/settings';
import { getSourcingProvider } from '@/lib/sourcing/providers';
import { normalizeTiers, parseTierText } from '@/lib/money';

interface R {
  ok: boolean;
  error?: string;
  id?: string;
  already?: boolean;
  added?: number;
}

async function audit(q: Queryable, actor: string, orgId: string, action: string, target: string, detail: unknown) {
  await q.query(`insert into fcd.audit_log (actor_id, org_id, action, target, detail) values ($1,$2,$3,$4,$5::jsonb)`, [actor, orgId, action, target, JSON.stringify(detail)]);
}

const url = z
  .string()
  .trim()
  .max(500)
  .regex(/^https?:\/\/\S+$/, '주소는 http:// 또는 https:// 로 시작해야 합니다');
const optUrl = z.union([url, z.literal('')]).optional();

const NewRequest = z.object({
  origin: z.enum(['sku', 'sales', 'manual']),
  originRef: z.string().trim().max(80).optional(),
  productName: z.string().trim().min(2, '상품명을 두 글자 이상 적어 주세요').max(120),
  category: z.string().trim().min(1).max(40),
  keywords: z.string().trim().max(200).optional(),
  imageUrl: optUrl,
  targetPrice: z.number().int().min(100).max(100_000_000).nullable(),
  monthlyUnits: z.number().int().min(0).max(10_000_000).nullable(),
  firstOrderUnits: z.number().int().min(1).max(10_000_000).nullable(),
  needsCert: z.boolean(),
  certNote: z.string().trim().max(120).optional(),
  hub: z.string().regex(/^[A-Z]{3}$/).nullable(),
  note: z.string().trim().max(600).optional(),
});

/** 소싱 요청 — 스위치가 꺼져 있어도 「미리보기」로 기록만 한다(관심 등록처럼). 발송 없음 */
export async function createSourcingRequest(input: z.infer<typeof NewRequest>): Promise<R> {
  const v = await requireViewer('app');
  const p = NewRequest.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? '요청을 읽지 못했습니다' };
  const d = p.data;
  const today = todayKst();
  const out = await asUser(v, async (q): Promise<R> => {
    const config = await loadSourcingConfig(q);
    if ((await openRequestCount(q, v.org.id)) >= config.rules.maxOpenPerOrg) {
      return { ok: false, error: `열린 요청이 ${config.rules.maxOpenPerOrg}건입니다 — 끝나거나 취소한 뒤 새로 남겨 주세요` };
    }
    const cats = await q.query<{ category: string }>(`select category from fcd.v_current_duty_rates where category = $1`, [d.category]);
    if (!cats.length) return { ok: false, error: '분류를 목록에서 골라 주세요' };
    const keywords = (d.keywords ?? '')
      .split(/[,，、\n]+/)
      .map((k) => k.trim())
      .filter((k) => k.length > 0 && k.length <= 30)
      .slice(0, 12);
    const row = await q.query<{ id: string }>(
      `insert into fcd.sourcing_requests (request_no, org_id, created_by, origin, origin_ref, product_name, category, keywords, image_url,
         target_price, monthly_units, first_order_units, needs_cert, cert_note, hub, note, due_on, preview)
       values ($1,$2,$3,$4,$5,$6,$7,$8::text[],$9,$10,$11,$12,$13,$14,$15,$16,$17::date,$18) returning id`,
      [
        newNo('SR'), v.org.id, v.id, d.origin, d.origin === 'manual' ? null : d.originRef || null, d.productName, d.category, keywords, d.imageUrl || null,
        d.targetPrice, d.monthlyUnits, d.firstOrderUnits, d.needsCert, d.needsCert ? d.certNote || null : null, d.hub, d.note || null,
        dueOn(today, config.rules.slaDays), !config.on,
      ],
    );
    await audit(q, v.id, v.org.id, 'sourcing.request', `sourcing_request:${row[0].id}`, { origin: d.origin, preview: !config.on });
    return { ok: true, id: row[0].id };
  });
  if (out.ok) {
    revalidatePath('/app/sourcing');
    revalidatePath('/admin/sourcing');
  }
  return out;
}

/** 화주가 자기 요청을 취소 — 새 기록(요청 줄은 고치지 않는다) */
export async function cancelSourcingRequest(input: { requestId: string }): Promise<R> {
  const v = await requireViewer('app');
  const id = z.string().uuid().safeParse(input.requestId);
  if (!id.success) return { ok: false, error: '요청을 읽지 못했습니다' };
  const out = await asUser(v, async (q): Promise<R> => {
    const r = await requestById(q, id.data);
    if (!r || r.org_id !== v.org.id) return { ok: false, error: '요청을 찾지 못했습니다' };
    if (r.status === 'cancelled' || r.status === 'closed') return { ok: true, already: true };
    await q.query(`insert into fcd.sourcing_request_events (request_id, org_id, status, actor_id, note) values ($1,$2,'cancelled',$3,'화주가 취소')`, [r.id, r.org_id, v.id]);
    await audit(q, v.id, v.org.id, 'sourcing.cancel', `sourcing_request:${r.id}`, {});
    return { ok: true };
  });
  revalidatePath(`/app/sourcing/${input.requestId}`);
  revalidatePath('/app/sourcing');
  revalidatePath('/admin/sourcing');
  return out;
}

const Sample = z.object({
  requestId: z.string().uuid(),
  candidateId: z.string().uuid(),
  qty: z.number().int().min(1).max(10_000_000).nullable().optional(),
  price: z.number().int().min(100).max(100_000_000).nullable().optional(),
});

/**
 * 샘플 요청 — 관심 등록만(스위치 꺼짐). 한 사람이 후보마다 한 번.
 * 기록(detail)의 판 번호·개당 도착원가는 보낸 값을 믿지 않고 서버가 지금 판 조건으로 다시 셈한다. 내린 후보에는 못 남긴다.
 */
export async function registerSampleInterest(input: z.infer<typeof Sample>): Promise<R> {
  const v = await requireViewer('app');
  const p = Sample.safeParse(input);
  if (!p.success) return { ok: false, error: '요청을 읽지 못했습니다' };
  const d = p.data;
  const out = await asUser(v, async (q): Promise<R> => {
    const r = await requestById(q, d.requestId);
    if (!r || r.org_id !== v.org.id) return { ok: false, error: '요청을 찾지 못했습니다' };
    const cand = (await candidatesFor(q, r.id)).find((c) => c.id === d.candidateId);
    if (!cand?.quote) return { ok: false, error: '후보를 찾지 못했습니다' };
    if (cand.quote.status !== 'active') return { ok: false, error: '내린 후보라 샘플 요청을 남길 수 없습니다' };
    const qty = d.qty ?? r.first_order_units ?? 500;
    const price = d.price ?? r.target_price;
    let arrivalPerUnit: number | null = null;
    if (price != null) {
      try {
        const ctx = await simContext(q, todayKst());
        arrivalPerUnit = (await simulate(q, ctx, { hub: cand.hub ?? r.hub, category: r.category, qty, price, quote: rowToSimQuote(cand.quote) })).sim.arrivalPerUnit;
      } catch {
        arrivalPerUnit = null;
      }
    }
    const ins = await q.query<{ id: string }>(
      `insert into fcd.sourcing_sample_interests (org_id, user_id, request_id, candidate_id, detail)
       values ($1,$2,$3,$4,$5::jsonb) on conflict (user_id, candidate_id) do nothing returning id`,
      [v.org.id, v.id, d.requestId, d.candidateId, JSON.stringify({ qty, price, arrivalPerUnit, version: cand.quote.version, by: 'server' })],
    );
    if (!ins[0]) return { ok: true, already: true };
    await audit(q, v.id, v.org.id, 'sourcing.sample_interest', `sourcing_candidate:${d.candidateId}`, { requestId: d.requestId });
    return { ok: true };
  });
  revalidatePath(`/app/sourcing/${d.requestId}`);
  revalidatePath(`/admin/sourcing/${d.requestId}`);
  return out;
}

// ─── 운영 ─────────────────────────────────────────────────────────────

const Status = z.object({
  requestId: z.string().uuid(),
  status: z.enum(SOURCING_STATUSES),
  assigneeId: z.string().uuid().nullable(),
  note: z.string().trim().max(300).optional(),
});

export async function setSourcingStatus(input: z.infer<typeof Status>): Promise<R> {
  const v = await requireViewer('admin');
  const p = Status.safeParse(input);
  if (!p.success) return { ok: false, error: '요청을 읽지 못했습니다' };
  const d = p.data;
  const out = await asUser(v, async (q): Promise<R> => {
    const r = await requestById(q, d.requestId);
    if (!r) return { ok: false, error: '요청을 찾지 못했습니다' };
    if (d.assigneeId) {
      const ok = await q.query(`select 1 from fcd.memberships m join fcd.orgs o on o.id = m.org_id where m.user_id = $1 and o.kind = 'platform' and m.role = 'platform_admin'`, [d.assigneeId]);
      if (!ok.length) return { ok: false, error: '담당은 운영 조직 사람이어야 합니다' };
    }
    await q.query(`insert into fcd.sourcing_request_events (request_id, org_id, status, assignee_id, note, actor_id) values ($1,$2,$3,$4,$5,$6)`, [
      r.id, r.org_id, d.status, d.assigneeId, d.note || null, v.id,
    ]);
    await audit(q, v.id, r.org_id, 'sourcing.status', `sourcing_request:${r.id}`, { status: d.status, assignee: d.assigneeId });
    return { ok: true };
  });
  revalidatePath(`/admin/sourcing/${d.requestId}`);
  revalidatePath('/admin/sourcing');
  return out;
}

const QuoteFields = z.object({
  currency: z.enum(['RMB', 'USD']),
  tiersText: z.string().trim().min(1).max(300),
  moq: z.number().int().min(1).max(10_000_000),
  leadDaysMin: z.number().int().min(0).max(365),
  leadDaysMax: z.number().int().min(0).max(365),
  sampleFee: z.number().min(0).max(1_000_000).nullable(),
  sampleDays: z.number().int().min(0).max(180).nullable(),
  unitKg: z.number().gt(0).max(10_000),
  unitCbm: z.number().gt(0).max(100),
  unitsPerCarton: z.number().int().min(1).max(100_000),
  validUntil: z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.literal('')]).optional(),
  note: z.string().trim().max(300).optional(),
});

const NewCandidate = z.object({
  requestId: z.string().uuid(),
  label: z.string().trim().min(1).max(60),
  supplierKind: z.enum(['factory', 'trader', 'unknown']),
  hub: z.string().regex(/^[A-Z]{3}$/).nullable(),
  region: z.string().trim().max(40).optional(),
  productTitle: z.string().trim().min(1).max(160),
  category: z.string().trim().max(40).nullable(),
  rating: z.number().min(0).max(5).nullable(),
  yearsActive: z.number().int().min(0).max(100).nullable(),
  certsClaimed: z.string().trim().max(120).optional(),
  certsVerified: z.string().trim().max(120).optional(),
  source: z.enum(['manual', 'seller_link']),
  sourceUrl: optUrl,
  note: z.string().trim().max(400).optional(),
  quote: QuoteFields,
});

const certList = (s?: string) =>
  (s ?? '')
    .split(/[,\s/]+/)
    .map((x) => x.trim().toUpperCase())
    .filter((x) => /^[A-Z0-9-]{1,20}$/.test(x))
    .slice(0, 10);

type QuoteIn = { currency: 'RMB' | 'USD'; tiers: { minQty: number; unitPrice: number }[]; moq: number; leadDaysMin: number; leadDaysMax: number; sampleFee: number | null; sampleDays: number | null; unitKg: number; unitCbm: number; unitsPerCarton: number; validUntil: string | null; note: string | null; status: 'active' | 'withdrawn' };

async function insertQuote(q: Queryable, actor: string, candidateId: string, orgId: string, prev: { id: string; version: number } | null, x: QuoteIn) {
  if (x.leadDaysMax < x.leadDaysMin) throw new RangeError('생산 일수의 끝이 시작보다 짧습니다');
  const r = await q.query<{ id: string }>(
    `insert into fcd.candidate_quotes (candidate_id, org_id, version, supersedes_id, status, currency, tiers, moq, lead_days_min, lead_days_max, sample_fee, sample_days,
       unit_kg, unit_cbm, units_per_carton, valid_until, note, created_by)
     values ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11,$12,$13,$14,$15,$16::date,$17,$18) returning id`,
    [
      candidateId, orgId, (prev?.version ?? 0) + 1, prev?.id ?? null, x.status, x.currency, JSON.stringify(x.tiers), x.moq, x.leadDaysMin, x.leadDaysMax,
      x.sampleFee, x.sampleDays, x.unitKg, x.unitCbm, x.unitsPerCarton, x.validUntil, x.note, actor,
    ],
  );
  return r[0].id;
}

/** 담당이 후보를 넣는다 — 유사도는 서버에서 셈해 남긴다 */
export async function addCandidate(input: z.infer<typeof NewCandidate>): Promise<R> {
  const v = await requireViewer('admin');
  const p = NewCandidate.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? '입력을 읽지 못했습니다' };
  const d = p.data;
  let tiers;
  try {
    tiers = parseTierText(d.quote.tiersText);
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
  if (d.quote.leadDaysMax < d.quote.leadDaysMin) return { ok: false, error: '생산 일수의 끝이 시작보다 짧습니다' };
  const out = await asUser(v, async (q): Promise<R> => {
    const r = await requestById(q, d.requestId);
    if (!r) return { ok: false, error: '요청을 찾지 못했습니다' };
    const config = await loadSourcingConfig(q);
    const existing = await candidatesFor(q, r.id);
    if (existing.length >= config.rules.maxCandidates) return { ok: false, error: `후보는 요청당 ${config.rules.maxCandidates}곳까지입니다` };
    const s = await loadSettings(q);
    const sim = scoreCandidate(r, { productTitle: d.productTitle, category: d.category, tiers, currency: d.quote.currency, moq: d.quote.moq }, config, s.fx);
    const c = await q.query<{ id: string }>(
      `insert into fcd.sourcing_candidates (request_id, org_id, label, supplier_kind, hub, region, product_title, category, rating, years_active,
         certs_claimed, certs_verified, source, source_url, similarity, similarity_detail, note, created_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::text[],$12::text[],$13,$14,$15,$16::jsonb,$17,$18) returning id`,
      [
        r.id, r.org_id, d.label, d.supplierKind, d.hub, d.region || null, d.productTitle, d.category, d.rating, d.yearsActive,
        certList(d.certsClaimed), certList(d.certsVerified), d.source, d.sourceUrl || null, sim.score, JSON.stringify(sim), d.note || null, v.id,
      ],
    );
    await insertQuote(q, v.id, c[0].id, r.org_id, null, {
      ...d.quote, tiers, validUntil: d.quote.validUntil || null, note: d.quote.note || null, status: 'active',
    });
    await audit(q, v.id, r.org_id, 'sourcing.candidate', `sourcing_candidate:${c[0].id}`, { requestId: r.id, source: d.source, similarity: sim.score });
    return { ok: true, id: c[0].id };
  });
  revalidatePath(`/admin/sourcing/${d.requestId}`);
  revalidatePath(`/app/sourcing/${d.requestId}`);
  return out;
}

/** 흉내 제공자로 예시 후보 채우기 — 밖을 부르지 않는다. 넣은 후보는 source = mock(화면에 「예시」) */
export async function fillMockCandidates(input: { requestId: string }): Promise<R> {
  const v = await requireViewer('admin');
  const id = z.string().uuid().safeParse(input.requestId);
  if (!id.success) return { ok: false, error: '요청을 읽지 못했습니다' };
  const out = await asUser(v, async (q): Promise<R> => {
    const r = await requestById(q, id.data);
    if (!r) return { ok: false, error: '요청을 찾지 못했습니다' };
    const config = await loadSourcingConfig(q);
    const s = await loadSettings(q);
    const existing = await candidatesFor(q, r.id);
    const room = Math.min(3, config.rules.maxCandidates - existing.length);
    if (room <= 0) return { ok: false, error: `후보는 요청당 ${config.rules.maxCandidates}곳까지입니다` };
    const found = await getSourcingProvider('mock').search(
      { productName: r.product_name, keywords: r.keywords, category: r.category, targetPrice: r.target_price, hub: r.hub, qty: r.first_order_units ?? 500, needsCert: r.needs_cert },
      { limit: existing.length + room, fxRmb: s.fx.RMB, targetCostShareBp: config.rules.targetCostShareBp },
    );
    const have = new Set(existing.map((c) => c.label));
    let added = 0;
    for (const f of found) {
      if (have.has(f.label) || added >= room) continue;
      const tiers = normalizeTiers(f.quote.tiers);
      const sim = scoreCandidate(r, { productTitle: f.productTitle, category: f.category, tiers, currency: f.quote.currency, moq: f.quote.moq }, config, s.fx);
      const c = await q.query<{ id: string }>(
        `insert into fcd.sourcing_candidates (request_id, org_id, label, supplier_kind, hub, region, product_title, category, rating, years_active,
           certs_claimed, source, similarity, similarity_detail, note, created_by)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::text[],'mock',$12,$13::jsonb,'흉내 제공자가 만든 예시 — 실제 공급처가 아닙니다',$14) returning id`,
        [r.id, r.org_id, f.label, f.supplierKind, f.hub, f.region, f.productTitle, f.category, f.rating, f.yearsActive, f.certsClaimed, sim.score, JSON.stringify(sim), v.id],
      );
      await insertQuote(q, v.id, c[0].id, r.org_id, null, { ...f.quote, tiers, validUntil: null, note: null, status: 'active' });
      added++;
    }
    await audit(q, v.id, r.org_id, 'sourcing.mock_fill', `sourcing_request:${r.id}`, { added });
    return { ok: true, added };
  });
  revalidatePath(`/admin/sourcing/${input.requestId}`);
  revalidatePath(`/app/sourcing/${input.requestId}`);
  return out;
}

const Revise = z.object({
  requestId: z.string().uuid(),
  candidateId: z.string().uuid(),
  withdraw: z.boolean(),
  quote: QuoteFields.partial().extend({ note: z.string().trim().max(300).optional() }),
});

/** 후보 조건 새 판(바뀐 칸만 받고 나머지는 앞 판 그대로) · 후보 내리기도 새 판 */
export async function reviseCandidateQuote(input: z.infer<typeof Revise>): Promise<R> {
  const v = await requireViewer('admin');
  const p = Revise.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? '입력을 읽지 못했습니다' };
  const d = p.data;
  const out = await asUser(v, async (q): Promise<R> => {
    const cands = await candidatesFor(q, d.requestId);
    const c = cands.find((x) => x.id === d.candidateId);
    if (!c || !c.quote) return { ok: false, error: '후보를 찾지 못했습니다' };
    const cur = c.quote;
    let tiers = cur.tiers;
    if (d.quote.tiersText) {
      try {
        tiers = parseTierText(d.quote.tiersText);
      } catch (e) {
        return { ok: false, error: (e as Error).message };
      }
    }
    try {
      await insertQuote(q, v.id, c.id, c.org_id, { id: cur.id, version: cur.version }, {
        currency: d.quote.currency ?? cur.currency,
        tiers,
        moq: d.quote.moq ?? cur.moq,
        leadDaysMin: d.quote.leadDaysMin ?? cur.lead_days_min,
        leadDaysMax: d.quote.leadDaysMax ?? cur.lead_days_max,
        sampleFee: d.quote.sampleFee === undefined ? cur.sample_fee : d.quote.sampleFee,
        sampleDays: d.quote.sampleDays === undefined ? cur.sample_days : d.quote.sampleDays,
        unitKg: d.quote.unitKg ?? cur.unit_kg,
        unitCbm: d.quote.unitCbm ?? cur.unit_cbm,
        unitsPerCarton: d.quote.unitsPerCarton ?? cur.units_per_carton,
        validUntil: d.quote.validUntil === undefined ? cur.valid_until : d.quote.validUntil || null,
        note: d.quote.note || null,
        status: d.withdraw ? 'withdrawn' : 'active',
      });
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
    await audit(q, v.id, c.org_id, d.withdraw ? 'sourcing.withdraw' : 'sourcing.revise', `sourcing_candidate:${c.id}`, { from: cur.version });
    return { ok: true };
  });
  revalidatePath(`/admin/sourcing/${d.requestId}`);
  revalidatePath(`/app/sourcing/${d.requestId}`);
  return out;
}
