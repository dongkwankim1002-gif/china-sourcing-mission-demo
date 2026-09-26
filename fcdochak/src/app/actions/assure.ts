'use server';
/**
 * 확정가·보장 — 관심 등록과 시범 확정가 견적 기록.
 * 어느 쪽도 계약·결제·밖으로 나가는 연락을 하지 않는다. 확정가 견적은 스위치(v2.firm_price_enabled)가 켜졌을 때만 기록하고,
 * 금액은 화면이 보낸 값이 아니라 서버에서 같은 조건으로 다시 셈한다.
 */
import { revalidatePath } from 'next/cache';
import { contractParty } from '@/lib/server/alliance';
import { z } from 'zod';
import { asUser, todayKst, type Queryable } from '@/lib/db';
import { requireViewer } from '@/lib/server/viewer';
import { loadSettings } from '@/lib/server/settings';
import { compareBasis, currentFirmQuote, laneKey, loadAssureConfig, requestBasis } from '@/lib/server/assure';
import { newNo } from '@/lib/server/rate-cards';
import { ASSURE_KINDS, ASSURE_KIND_LABEL } from '@/lib/assure-settings';
import { parseCargoQuery } from '@/lib/cargo-params';
import { firmPrice } from '@/lib/money';

interface R {
  ok: boolean;
  error?: string;
  already?: boolean;
  quoteNo?: string;
}

async function audit(q: Queryable, actor: string, orgId: string, action: string, target: string, detail: unknown) {
  await q.query(`insert into fcd.audit_log (actor_id, org_id, action, target, detail) values ($1,$2,$3,$4,$5::jsonb)`, [actor, orgId, action, target, JSON.stringify(detail)]);
}

const Ctx = z.union([
  z.object({ source: z.literal('compare'), query: z.string().max(600) }),
  z.object({ source: z.literal('request'), requestId: z.string().uuid() }),
]);

const Interest = z.object({
  kind: z.enum(ASSURE_KINDS),
  ctx: Ctx,
  /** 그때 본 참고 금액(원) — 기록용. 계산에 쓰지 않는다 */
  shown: z.number().int().min(0).max(100_000_000_000).nullable().optional(),
  note: z.string().trim().max(300).optional(),
});

/** 관심 등록 — 한 사람이 종류마다 한 번. 이미 했으면 그대로 둔다(두 번 눌러 동시에 와도 유일 색인에 걸려 조용히 넘어간다) */
export async function registerInterest(input: z.infer<typeof Interest>): Promise<R> {
  const v = await requireViewer('app');
  const p = Interest.safeParse(input);
  if (!p.success) return { ok: false, error: '요청을 읽지 못했습니다' };
  const d = p.data;
  const detail = d.ctx.source === 'compare'
    ? { query: new URLSearchParams(d.ctx.query).toString(), shown: d.shown ?? null }
    : { requestId: d.ctx.requestId, shown: d.shown ?? null };
  const r = await asUser(v, async (q) => {
    const ins = await q.query<{ id: string }>(
      `insert into fcd.assure_interests (org_id, user_id, kind, source, detail, note)
       values ($1, $2, $3, $4, $5::jsonb, $6)
       on conflict (user_id, kind) do nothing
       returning id`,
      [v.org.id, v.id, d.kind, d.ctx.source, JSON.stringify(detail), d.note || null],
    );
    if (ins[0]) await audit(q, v.id, v.org.id, 'assure.interest', `assure_interest:${ins[0].id}`, { kind: d.kind, source: d.ctx.source });
    return ins[0] ?? null;
  });
  revalidatePath('/admin/assure');
  return r ? { ok: true } : { ok: true, already: true };
}

/** 시범 확정가 견적 — 스위치가 켜졌을 때만. 같은 조건에 이미 있으면 새 판으로 쌓는다 */
export async function saveFirmQuote(input: z.infer<typeof Ctx>): Promise<R> {
  const v = await requireViewer('app');
  const p = Ctx.safeParse(input);
  if (!p.success) return { ok: false, error: '요청을 읽지 못했습니다' };
  const ctx = p.data;
  const today = todayKst();
  const out = await asUser(v, async (q): Promise<R> => {
    const config = await loadAssureConfig(q);
    if (!config.on.firm) return { ok: false, error: `${ASSURE_KIND_LABEL.firm} 시범이 꺼져 있습니다 — 관심 등록만 받습니다` };
    if (!config.firmRates) return { ok: false, error: '확정가 요율 설정이 없습니다(운영 설정에서 v2.firm_price_rates)' };
    const s = await loadSettings(q);
    let totals: number[];
    let lane: Record<string, unknown>;
    let prev;
    let leadPartnerId: string | undefined;
    if (ctx.source === 'compare') {
      const cq = parseCargoQuery(new URLSearchParams(ctx.query));
      const cb = await compareBasis(q, cq, s, today);
      totals = cb.totals;
      leadPartnerId = cb.lead?.partnerId;
      const key = laneKey(cq);
      lane = { key, hub: cq.hub, port: cq.port, mode: cq.mode ?? 'ANY', units: cq.units, cartons: cq.cartons, kg: cq.kg, cbm: cq.cbm, goods: cq.goods, cur: cq.cur, fc: cq.fc, traits: cq.traits };
      prev = await currentFirmQuote(q, v.org.id, { laneKey: key });
    } else {
      const b = await requestBasis(q, ctx.requestId, v.org.id, s, today);
      if (!b) return { ok: false, error: '요청을 찾지 못했습니다' };
      totals = b.totals;
      leadPartnerId = b.lead?.partnerId;
      lane = { requestId: ctx.requestId, reqNo: b.reqNo };
      prev = await currentFirmQuote(q, v.org.id, { requestId: ctx.requestId });
    }
    const f = firmPrice(totals, config.firmRates);
    if (!f.ok) return { ok: false, error: '같은 조건 요금표·응찰이 없어 확정가를 낼 수 없습니다' };
    if (!f.offerable) return { ok: false, error: '가격 변동폭이 커서 이 조건은 확정가 시범 대상이 아닙니다' };
    // 그때 카드에 보인 계약 상대(제휴 주선사)를 함께 남긴다 — 나중에 제휴가 끝나거나 서류가 만료돼도 무엇을 보였는지 안다
    const party = await contractParty(q, leadPartnerId);
    const quoteNo = prev?.quote_no ?? newNo('FP');
    const validUntil = new Date(Date.parse(`${today}T00:00:00Z`) + config.firmRates.validDays * 86400_000).toISOString().slice(0, 10);
    const row = await q.query<{ id: string }>(
      `insert into fcd.firm_price_quotes (quote_no, version, supersedes_id, org_id, created_by, source, request_id, lane, sample_n, base_total, premium, firm_price, confidence_bp, stats, rates, pilot, valid_until)
       values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$12,$13,$14::jsonb,$15::jsonb,true,$16::date) returning id`,
      [
        quoteNo, (prev?.version ?? 0) + 1, prev?.id ?? null, v.org.id, v.id, ctx.source, ctx.source === 'request' ? ctx.requestId : null,
        JSON.stringify(lane), f.stats.n, f.base, f.premium, f.firmPrice, f.confidenceBp,
        JSON.stringify({ ...f.stats, excess: f.excess, parametricExcess: f.parametricExcess, basis: f.basis, lowSample: f.lowSample, party: party ? { termsNo: party.termsNo, partnerName: party.partnerName, regTail: party.regTail, preferred: party.preferred } : null }),
        JSON.stringify(config.firmRates), validUntil,
      ],
    );
    await audit(q, v.id, v.org.id, 'assure.firm_quote', `firm_price_quote:${row[0].id}`, { quoteNo, firmPrice: f.firmPrice, n: f.stats.n });
    return { ok: true, quoteNo };
  });
  if (out.ok) {
    revalidatePath('/app/compare');
    if (ctx.source === 'request') revalidatePath(`/app/requests/${ctx.requestId}`);
    revalidatePath('/admin/assure');
  }
  return out;
}
