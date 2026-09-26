/**
 * 데모 시드 — 소싱처 찾기(v2 3차 sourcing, 미리보기). 조금만:
 *   · 데모 화주(리빙모아) 요청 둘 — ① 저장한 SKU 에서 시작, 후보 셋(흉내 제공자 「예시 공장 A」…)·담당 배정·후보 있음
 *     ② 직접 입력, 접수만(운영 대기열에 처리할 것이 보이게)
 *   · 다른 데모 화주 한 곳에 요청 하나(조직별로 갈리는지 보이게)
 * 흉내 후보는 source = 'mock' — 화면에 「예시」. 모두 is_demo 조직 아래라 걷어내기(조직 삭제) 한 번에 CASCADE 로 사라진다.
 */
import type { Queryable } from '@/lib/db/driver';
import { mockCandidates } from '@/lib/sourcing/providers/mock';
import { similarityScore } from '@/lib/sourcing/similarity';
import { unitPriceAt, normalizeTiers } from '@/lib/money/sourcing';
import type { SourcingRules } from '@/lib/sourcing/settings';
import { SETTINGS, SOURCING_SETTINGS } from '../reference/data';

const DAY = 86_400_000;

export async function seedSourcingDemo(q: Queryable, opts: { now: number; shipperEmail: string; adminEmail: string; onlyIfEmpty?: boolean }) {
  const me = (
    await q.query<{ user_id: string; org_id: string }>(
      `select p.id user_id, p.home_org_id org_id from fcd.profiles p join fcd.orgs o on o.id = p.home_org_id where lower(p.email) = $1 and o.is_demo`,
      [opts.shipperEmail.toLowerCase()],
    )
  )[0];
  const admin = (await q.query<{ id: string }>(`select id from fcd.profiles where lower(email) = $1`, [opts.adminEmail.toLowerCase()]))[0];
  if (!me || !admin) return 0;
  if (opts.onlyIfEmpty && (await q.query<{ n: number }>(`select count(*)::int n from fcd.sourcing_requests r join fcd.orgs o on o.id = r.org_id where o.is_demo`))[0].n > 0) return 0;
  const rules = SOURCING_SETTINGS.find((s) => s.key === 'sourcing.rules')!.value as SourcingRules;
  const fx = SETTINGS.find((s) => s.key === 'fx')!.value as Record<'KRW' | 'RMB' | 'USD', number>;
  const ymd = (ms: number) => new Date(ms + 9 * 3600_000).toISOString().slice(0, 10);
  const ts = (ms: number) => new Date(ms).toISOString();

  const sku = (
    await q.query<{ id: string; name: string; hs_category: string; target_price: number | null; units: number; kg: string; cbm: string }>(
      `select id, name, hs_category, target_price, units, kg::text, cbm::text from fcd.skus where org_id = $1 and not archived order by created_at limit 1`,
      [me.org_id],
    )
  )[0];
  const other = (
    await q.query<{ user_id: string; org_id: string }>(
      `select m.user_id, m.org_id from fcd.memberships m join fcd.orgs o on o.id = m.org_id
        where o.is_demo and o.kind = 'shipper' and o.id <> $1 order by o.name, m.user_id limit 1`,
      [me.org_id],
    )
  )[0];

  let n = 0;
  const insertRequest = async (x: {
    no: string; org: string; by: string; origin: 'sku' | 'manual'; ref: string | null; name: string; category: string; keywords: string[];
    price: number | null; monthly: number | null; first: number | null; needsCert: boolean; certNote: string | null; hub: string | null; note: string | null; at: number;
  }) => {
    const r = await q.query<{ id: string }>(
      `insert into fcd.sourcing_requests (request_no, org_id, created_by, origin, origin_ref, product_name, category, keywords, target_price, monthly_units, first_order_units,
         needs_cert, cert_note, hub, note, due_on, preview, created_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8::text[],$9,$10,$11,$12,$13,$14,$15,$16::date,true,$17::timestamptz) returning id`,
      [x.no, x.org, x.by, x.origin, x.ref, x.name, x.category, x.keywords, x.price, x.monthly, x.first, x.needsCert, x.certNote, x.hub, x.note, ymd(x.at + rules.slaDays * DAY), ts(x.at)],
    );
    n++;
    return r[0].id;
  };

  // ① 저장한 SKU 에서 — 후보 셋
  const name1 = sku?.name ?? '실리콘 서랍 정리함';
  const cat1 = sku?.hs_category ?? 'general';
  const price1 = sku?.target_price ?? 19900;
  const first1 = sku ? Math.max(300, Math.round(sku.units / 100) * 100) : 600;
  const at1 = opts.now - 4 * DAY;
  const r1 = await insertRequest({
    no: 'SR-EX-0001', org: me.org_id, by: me.user_id, origin: sku ? 'sku' : 'manual', ref: sku?.id ?? null, name: name1, category: cat1, keywords: [], price: price1,
    monthly: 1200, first: first1, needsCert: false, certNote: null, hub: 'YIW', note: '지금 공장보다 단가를 낮추고 싶습니다(예시)', at: at1,
  });
  await q.query(`insert into fcd.sourcing_request_events (request_id, org_id, status, assignee_id, note, actor_id, created_at) values ($1,$2,'researching',$3,'예시 — 담당 배정',$3,$4::timestamptz)`, [r1, me.org_id, admin.id, ts(at1 + 3 * 3600_000)]);
  const unitKg = sku ? Math.round((Number(sku.kg) / sku.units) * 1000) / 1000 : null;
  const unitCbm = sku ? Math.round((Number(sku.cbm) / sku.units) * 100000) / 100000 : null;
  const found = mockCandidates(
    { productName: name1, keywords: [], category: cat1, targetPrice: price1, hub: 'YIW', qty: first1, needsCert: false },
    { limit: 3, fxRmb: fx.RMB, targetCostShareBp: rules.targetCostShareBp, unitKg, unitCbm },
  );
  for (const [i, f] of found.entries()) {
    const tiers = normalizeTiers(f.quote.tiers);
    const unit = unitPriceAt(tiers, first1).unitPrice;
    const sim = similarityScore(
      { productName: name1, keywords: [], category: cat1, targetPrice: price1 },
      { productTitle: f.productTitle, category: f.category, unitPriceKrw: Math.round(unit * fx[f.quote.currency]) },
      { weights: rules.similarity, targetCostShareBp: rules.targetCostShareBp, priceBandBp: rules.priceBandBp },
    );
    const at = at1 + (1 + i) * DAY;
    const c = await q.query<{ id: string }>(
      `insert into fcd.sourcing_candidates (request_id, org_id, label, supplier_kind, hub, region, product_title, category, rating, years_active, certs_claimed, source,
         similarity, similarity_detail, note, created_by, created_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::text[],'mock',$12,$13::jsonb,'흉내 제공자가 만든 예시 — 실제 공급처가 아닙니다',$14,$15::timestamptz) returning id`,
      [r1, me.org_id, f.label, f.supplierKind, f.hub, f.region, f.productTitle, f.category, f.rating, f.yearsActive, f.certsClaimed, sim.score, JSON.stringify(sim), admin.id, ts(at)],
    );
    await q.query(
      `insert into fcd.candidate_quotes (candidate_id, org_id, version, status, currency, tiers, moq, lead_days_min, lead_days_max, sample_fee, sample_days, unit_kg, unit_cbm, units_per_carton, created_by, created_at)
       values ($1,$2,1,'active',$3,$4::jsonb,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::timestamptz)`,
      [c[0].id, me.org_id, f.quote.currency, JSON.stringify(tiers), f.quote.moq, f.quote.leadDaysMin, f.quote.leadDaysMax, f.quote.sampleFee, f.quote.sampleDays, f.quote.unitKg, f.quote.unitCbm, f.quote.unitsPerCarton, admin.id, ts(at)],
    );
  }
  await q.query(`insert into fcd.sourcing_request_events (request_id, org_id, status, assignee_id, note, actor_id, created_at) values ($1,$2,'candidates_ready',$3,'예시 후보 셋',$3,$4::timestamptz)`, [r1, me.org_id, admin.id, ts(at1 + 3.5 * DAY)]);

  // ② 직접 입력 — 접수만
  await insertRequest({
    no: 'SR-EX-0002', org: me.org_id, by: me.user_id, origin: 'manual', ref: null, name: '접이식 욕실 선반', category: 'general', keywords: ['욕실', '선반', '置物架'], price: 24900,
    monthly: 400, first: 500, needsCert: false, certNote: null, hub: null, note: null, at: opts.now - 1 * DAY,
  });

  // 다른 데모 화주 — 접수만(기한 지남이 보이게 오래전)
  if (other) {
    await insertRequest({
      no: 'SR-EX-0003', org: other.org_id, by: other.user_id, origin: 'manual', ref: null, name: '어린이 물병 350ml', category: 'toys', keywords: ['물병', '어린이'], price: 12900,
      monthly: 800, first: 1000, needsCert: true, certNote: '어린이제품 안전확인(확인 필요)', hub: 'CAN', note: null, at: opts.now - (rules.slaDays + 3) * DAY,
    });
  }
  return n;
}
