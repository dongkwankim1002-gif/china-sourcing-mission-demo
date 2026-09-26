/**
 * v2 3차 sourcing — 소싱처 찾기(패밀리 확장 모듈, 미리보기).
 * 순수 함수(단가 구간·화물·후보 시뮬 = sellerPnl 재사용·샘플 비용·유사도) · 흉내 제공자(결정적·밖을 부르지 않음) · 설정 ·
 * 메모리 PGlite(운영 DB 아님)에서 RLS·권한·새 판·서버 시뮬·데모 걷어내기. 화면 흐름은 e2e/v2-sourcing.spec.ts.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
import type { Driver } from '@/lib/db/driver';
import {
  candidateCargo,
  candidateSim,
  expectedUnitCostKrw,
  normalizeTiers,
  parseTierText,
  sampleCostKrw,
  sellerPnl,
  unitPriceAt,
  type CandidateSimInput,
} from '@/lib/money';
import { priceScore, similarityScore, termSet, tokenize, wordScore } from '@/lib/sourcing/similarity';
import { dueOn, dueState, readSourcingConfig, SOURCING_SETTING_SCHEMAS, type SourcingRules } from '@/lib/sourcing/settings';
import { getSourcingProvider, mockCandidates, MockSourcingProvider, SourcingProviderUnavailable } from '@/lib/sourcing/providers';
import { salesProductsForSourcing, skusForSourcing, sourcingSeeds } from '@/lib/sourcing/seeds';
import { V2_SETTING_SCHEMAS } from '@/lib/v2-setting-schemas';
import { DEMO_TABLES, demoCounts } from '@/lib/server/demo-status';
import { simContext, simulate, candidatesFor, requestQueue } from '@/lib/server/sourcing';
import { SETTINGS, SOURCING_SETTINGS } from '@seed/reference/data';
import { seedDemo } from '@seed/demo';
import { buildPurgeSql, planPurge } from '@seed/demo/purge';
import { asRole, hazardDb, todayKst } from './helpers';

const FX = { KRW: 1, RMB: 190.5, USD: 1380 } as const;
const RULES = SOURCING_SETTINGS.find((s) => s.key === 'sourcing.rules')!.value as SourcingRules;
const W = RULES.similarity;
const SIMRULE = { weights: W, targetCostShareBp: RULES.targetCostShareBp, priceBandBp: RULES.priceBandBp };

describe('단가 구간', () => {
  it('정리: 수량 오름차순, 같은 수량은 뒤의 값, 잘못된 줄은 오류', () => {
    expect(normalizeTiers([{ minQty: 500, unitPrice: 11 }, { minQty: 100, unitPrice: 12.5 }, { minQty: 500, unitPrice: 10.8 }])).toEqual([
      { minQty: 100, unitPrice: 12.5 },
      { minQty: 500, unitPrice: 10.8 },
    ]);
    expect(() => normalizeTiers([])).toThrow(RangeError);
    expect(() => normalizeTiers([{ minQty: 0, unitPrice: 1 }])).toThrow(RangeError);
    expect(() => normalizeTiers([{ minQty: 10, unitPrice: 0 }])).toThrow(RangeError);
  });
  it('글 읽기: 「수량:단가」 쉼표·줄바꿈, 틀린 줄은 알려 준다', () => {
    expect(parseTierText('300:12.5, 900:11.8\n3000 = 11')).toEqual([
      { minQty: 300, unitPrice: 12.5 },
      { minQty: 900, unitPrice: 11.8 },
      { minQty: 3000, unitPrice: 11 },
    ]);
    expect(() => parseTierText('300개 12.5원쯤')).toThrow(/수량:단가/);
  });
  it('수량의 단가: 수량 이하인 가장 큰 구간, 첫 구간보다 적으면 첫 구간', () => {
    const t = [{ minQty: 300, unitPrice: 12.5 }, { minQty: 900, unitPrice: 11.8 }, { minQty: 3000, unitPrice: 11 }];
    expect(unitPriceAt(t, 100).unitPrice).toBe(12.5);
    expect(unitPriceAt(t, 300).unitPrice).toBe(12.5);
    expect(unitPriceAt(t, 899).unitPrice).toBe(12.5);
    expect(unitPriceAt(t, 900).unitPrice).toBe(11.8);
    expect(unitPriceAt(t, 10000).unitPrice).toBe(11);
  });
});

describe('후보 화물·시뮬 — 판매손익(sellerPnl)을 그대로 쓴다', () => {
  it('화물: 박스 올림, 무게 0.1kg·부피 0.01CBM 올림, 물품가 = 수량 × 단가', () => {
    expect(candidateCargo({ qty: 1000, unitKg: 0.35, unitCbm: 0.0025, unitsPerCarton: 40, unitPrice: 11.8, currency: 'RMB' })).toEqual({
      units: 1000, cartons: 25, kg: 350, cbm: 2.5, goodsValue: 11800, goodsCurrency: 'RMB',
    });
    const c = candidateCargo({ qty: 101, unitKg: 0.333, unitCbm: 0.00111, unitsPerCarton: 50, unitPrice: 1.005, currency: 'USD' });
    expect(c.cartons).toBe(3);
    expect(c.kg).toBe(33.7);
    expect(c.cbm).toBe(0.12);
    expect(() => candidateCargo({ qty: 0, unitKg: 1, unitCbm: 1, unitsPerCarton: 1, unitPrice: 1, currency: 'RMB' })).toThrow(RangeError);
  });

  const base: CandidateSimInput = {
    qty: 1000, price: 19900, tiers: [{ minQty: 300, unitPrice: 12.5 }, { minQty: 900, unitPrice: 11.8 }], currency: 'RMB', moq: 300,
    unitKg: 0.35, unitCbm: 0.0025, unitsPerCarton: 40, fx: { ...FX }, logisticsTotal: 1_000_000, freightToPortKrw: 550_000,
    dutyRateBp: 800, vatRateBp: 1000, insuranceBp: 30, saleFeeBp: 1080, adBp: 0, inboundPerUnit: 400, shippingPerUnit: 2300, agentFeeBp: 500,
  };
  it('대행 수수료는 상품가 × bp 를 추가비용 칸에 — sellerPnl 과 원 단위까지 같다', () => {
    const r = candidateSim(base);
    expect(r.tier.unitPrice).toBe(11.8);
    expect(r.goodsKrw).toBe(Math.round(11800 * 190.5)); // 2,247,900
    expect(r.agentFee).toBe(Math.round(r.goodsKrw * 0.05));
    const direct = sellerPnl({
      units: 1000, price: 19900, goodsKrw: r.goodsKrw, logisticsTotal: 1_000_000, freightToPortKrw: 550_000, extraCostTotal: r.agentFee,
      dutyRateBp: 800, vatRateBp: 1000, insuranceBp: 30, saleFeeBp: 1080, adBp: 0, inboundPerUnit: 400, shippingPerUnit: 2300,
    });
    expect(r.pnl).toEqual(direct);
    expect(r.arrivalPerUnit).toBe(direct.arrivalPerUnit);
    expect(r.profitPerUnit).toBe(direct.pnl.profit);
    expect(r.totalProfit).toBe(direct.pnl.profit * 1000);
    expect(r.belowMoq).toBe(false);
  });
  it('수수료 0 이면 추가비용 0, 수수료만큼 개당 이익이 는다', () => {
    const a = candidateSim(base);
    const b = candidateSim({ ...base, agentFeeBp: 0 });
    expect(b.agentFee).toBe(0);
    expect(b.profitPerUnit - a.profitPerUnit).toBe(Math.round(a.agentFee / 1000));
  });
  it('최소 주문량 미달 표시, 틀린 수수료율은 오류', () => {
    expect(candidateSim({ ...base, qty: 200 }).belowMoq).toBe(true);
    expect(() => candidateSim({ ...base, agentFeeBp: -1 })).toThrow(RangeError);
  });
  it('샘플 비용 = 샘플비 원 환산 + 처리 가정치, 기대 매입가', () => {
    expect(sampleCostKrw(50, 'RMB', FX, 30000)).toBe(9525 + 30000);
    expect(sampleCostKrw(null, 'RMB', FX, 30000)).toBe(30000);
    expect(expectedUnitCostKrw(19900, 3000)).toBe(5970);
  });
});

describe('유사도', () => {
  it('낱말 나누기·조각: 한글·한자 붙여 쓴 말은 두 글자 묶음도', () => {
    expect(tokenize('실리콘 서랍-정리함 (4칸)')).toEqual(['실리콘', '서랍', '정리함', '4칸']);
    const t = termSet('收纳盒');
    expect(t.has('收纳盒')).toBe(true);
    expect(t.has('~收纳')).toBe(true);
    expect(termSet('a b cd').has('a')).toBe(false);
  });
  it('같은 이름이면 낱말 100, 겹침이 없으면 0', () => {
    expect(wordScore(termSet('실리콘 서랍 정리함'), termSet('실리콘 서랍 정리함')).score).toBe(100);
    expect(wordScore(termSet('실리콘 서랍 정리함'), termSet('블루투스 스피커')).score).toBe(0);
    expect(wordScore(termSet('실리콘 서랍 정리함'), termSet('서랍 정리함 대용량')).shared).toEqual(['서랍', '정리함']);
  });
  it('가격대: 폭 안이면 100, 두 배 폭에서 0, 사이는 곧게', () => {
    expect(priceScore(6000, 6000, 3000)).toBe(100);
    expect(priceScore(7800, 6000, 3000)).toBe(100);
    expect(priceScore(9600, 6000, 3000)).toBe(0);
    expect(priceScore(8700, 6000, 3000)).toBe(50);
    expect(priceScore(0, 6000, 3000)).toBe(0);
  });
  it('가중 합 — 목표 판매가가 없으면 가격 항목을 빼고 다시 나눈다', () => {
    const req = { productName: '실리콘 서랍 정리함', category: 'general', targetPrice: 19900 };
    const same = similarityScore(req, { productTitle: '실리콘 서랍 정리함', category: 'general', unitPriceKrw: 5970 }, SIMRULE);
    expect(same.score).toBe(100);
    expect(same.level).toBe('high');
    const diff = similarityScore(req, { productTitle: '블루투스 스피커', category: 'audio', unitPriceKrw: 50000 }, SIMRULE);
    expect(diff.score).toBe(0);
    expect(diff.level).toBe('low');
    const noPrice = similarityScore({ ...req, targetPrice: null }, { productTitle: '실리콘 서랍 정리함', category: 'audio', unitPriceKrw: 5970 }, SIMRULE);
    expect(noPrice.price).toBeNull();
    // 낱말 100 × 50% + 분류 0 × 20% → 50/70
    expect(noPrice.score).toBe(Math.round((100 * W.wordBp) / (W.wordBp + W.categoryBp)));
    expect(noPrice.image).toBeNull();
  });
});

describe('흉내 제공자 — 결정적, 밖을 부르지 않는다', () => {
  const q = { productName: '실리콘 서랍 정리함', keywords: [], category: 'general', targetPrice: 19900, hub: 'YIW', qty: 600, needsCert: true };
  const o = { limit: 3, fxRmb: 190.5, targetCostShareBp: 3000 };
  it('같은 조건이면 같은 후보, 이름은 「예시」, 인증은 주장만(KC 없음)', async () => {
    const f = vi.fn();
    vi.stubGlobal('fetch', f);
    try {
      const a = await new MockSourcingProvider().search(q, o);
      const b = mockCandidates(q, o);
      expect(a).toEqual(b);
      expect(a).toHaveLength(3);
      for (const c of a) {
        expect(c.label).toMatch(/^예시 (공장|무역상) [A-J]$/);
        expect(c.source).toBe('mock');
        expect(c.productTitle).toContain('(예시)');
        expect(c.certsClaimed).not.toContain('KC');
        expect(c.certsClaimed.length).toBe(1);
        expect(() => normalizeTiers(c.quote.tiers)).not.toThrow();
        expect(c.quote.leadDaysMax).toBeGreaterThanOrEqual(c.quote.leadDaysMin);
      }
      expect(mockCandidates({ ...q, productName: '다른 상품' }, o)).not.toEqual(b);
      expect(f).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it('공식 API 제공자는 준비 중 오류(부르지 않음)', () => {
    expect(getSourcingProvider('mock').external).toBe(false);
    for (const id of ['1688', 'alibaba', 'taobao'] as const) expect(() => getSourcingProvider(id)).toThrow(SourcingProviderUnavailable);
  });
});

describe('설정', () => {
  it('첫 판: 스위치 꺼짐, 수수료는 가정치, 어드민 새 판 검사를 통과', () => {
    const m = new Map(SETTINGS.map((s) => [s.key, s.value]));
    const c = readSourcingConfig(m);
    expect(c.on).toBe(false);
    expect(c.fees.example).toBe(true);
    for (const s of SOURCING_SETTINGS) {
      expect(SOURCING_SETTING_SCHEMAS[s.key].safeParse(s.value).success, s.key).toBe(true);
      expect(V2_SETTING_SCHEMAS[s.key], s.key).toBeDefined();
    }
    expect(readSourcingConfig(new Map([...m, ['sourcing.enabled', 'true']])).on).toBe(false);
    expect(readSourcingConfig(new Map([...m, ['sourcing.enabled', true]])).on).toBe(true);
    expect(() => readSourcingConfig(new Map())).toThrow(/sourcing.rules/);
  });
  it('처리 기한·기한 상태', () => {
    expect(dueOn('2026-09-26', 5)).toBe('2026-10-01');
    expect(dueState('2026-09-25', '2026-09-26', 'requested')).toBe('overdue');
    expect(dueState('2026-09-26', '2026-09-26', 'researching')).toBe('today');
    expect(dueState('2026-09-30', '2026-09-26', 'requested')).toBe('ok');
    expect(dueState('2026-09-01', '2026-09-26', 'candidates_ready')).toBe('done');
    expect(dueState('2026-09-01', '2026-09-26', 'cancelled')).toBe('done');
  });
});

// ─── DB(메모리 PGlite) ──────────────────────────────────────────────

let db: Driver;
let ids: { shipper: string; partner: string; admin: string };
let shipperOrg: string;
let other: { user: string; org: string };

beforeAll(async () => {
  db = await hazardDb();
  const r = await seedDemo(db, { today: todayKst(), password: 'test-only-password' });
  ids = r.demoIds!;
  shipperOrg = (await db.query<{ org_id: string }>(`select org_id from fcd.memberships where user_id = $1`, [ids.shipper]))[0].org_id;
  const o = await db.query<{ user_id: string; org_id: string }>(
    `select m.user_id, m.org_id from fcd.memberships m join fcd.orgs o on o.id = m.org_id where o.kind = 'shipper' and m.org_id <> $1 order by o.name limit 1`,
    [shipperOrg],
  );
  other = { user: o[0].user_id, org: o[0].org_id };
}, 120_000);
afterAll(async () => {
  await db.close();
});

const newReq = (q: Driver, org: string, by: string, no: string) =>
  q.query<{ id: string }>(
    `insert into fcd.sourcing_requests (request_no, org_id, created_by, origin, product_name, category, due_on) values ($1,$2,$3,'manual','시험 상품','general',current_date + 5) returning id`,
    [no, org, by],
  );

describe('RLS·권한', () => {
  it('다섯 표 모두 UPDATE·DELETE 권한이 없다', async () => {
    for (const t of ['sourcing_requests', 'sourcing_request_events', 'sourcing_candidates', 'candidate_quotes', 'sourcing_sample_interests']) {
      const r = await db.query<{ u: boolean; d: boolean }>(`select has_table_privilege('fcd_user', 'fcd.${t}', 'UPDATE') u, has_table_privilege('fcd_user', 'fcd.${t}', 'DELETE') d`);
      expect(r[0], t).toEqual({ u: false, d: false });
      const p = await db.query<{ i: boolean }>(`select has_table_privilege('fcd_public', 'fcd.${t}', 'INSERT') i`);
      expect(p[0].i, t).toBe(false);
    }
  });
  it('화주는 자기 조직 요청·후보만, 운영자는 전부', async () => {
    const mine = await asRole(db, 'fcd_user', ids.shipper, true, (q) => q.query<{ org_id: string }>(`select org_id from fcd.sourcing_requests`));
    expect(mine.length).toBeGreaterThanOrEqual(2);
    expect(new Set(mine.map((x) => x.org_id))).toEqual(new Set([shipperOrg]));
    const cand = await asRole(db, 'fcd_user', ids.shipper, true, (q) => q.query<{ org_id: string }>(`select org_id from fcd.sourcing_candidates`));
    expect(cand.length).toBe(3);
    const all = await asRole(db, 'fcd_user', ids.admin, true, (q) => q.query<{ org_id: string }>(`select org_id from fcd.sourcing_requests`));
    expect(new Set(all.map((x) => x.org_id)).size).toBeGreaterThanOrEqual(2);
    const partner = await asRole(db, 'fcd_user', ids.partner, true, (q) => q.query(`select id from fcd.sourcing_requests`));
    expect(partner).toEqual([]);
    const pub = asRole(db, 'fcd_public', null, true, (q) => q.query(`select id from fcd.sourcing_requests`));
    await expect(pub).rejects.toThrow();
  });
  it('화주는 남의 조직으로 요청을 못 넣고, 물류사는 요청을 못 넣는다', async () => {
    await expect(asRole(db, 'fcd_user', ids.shipper, true, (q) => newReq(q, other.org, ids.shipper, 'SR-T-0001'))).rejects.toThrow();
    const pOrg = (await db.query<{ org_id: string }>(`select org_id from fcd.memberships where user_id = $1`, [ids.partner]))[0].org_id;
    await expect(asRole(db, 'fcd_user', ids.partner, true, (q) => newReq(q, pOrg, ids.partner, 'SR-T-0002'))).rejects.toThrow();
    const ok = await asRole(db, 'fcd_user', ids.shipper, true, (q) => newReq(q, shipperOrg, ids.shipper, 'SR-T-0003'));
    expect(ok[0].id).toBeTruthy();
  });
  it('후보·조건은 운영자만 넣는다 — 화주는 막힌다', async () => {
    const req = (await db.query<{ id: string }>(`select id from fcd.sourcing_requests where request_no = 'SR-T-0003'`))[0].id;
    const ins = (u: string) =>
      asRole(db, 'fcd_user', u, true, (q) =>
        q.query<{ id: string }>(
          `insert into fcd.sourcing_candidates (request_id, org_id, label, supplier_kind, product_title, source, similarity, created_by) values ($1,$2,'공장 X','factory','시험','manual',50,$3) returning id`,
          [req, shipperOrg, u],
        ),
      );
    await expect(ins(ids.shipper)).rejects.toThrow();
    const c = await ins(ids.admin);
    // 요청과 다른 조직으로는 못 넣는다
    await expect(
      asRole(db, 'fcd_user', ids.admin, true, (q) =>
        q.query(`insert into fcd.sourcing_candidates (request_id, org_id, label, supplier_kind, product_title, source, similarity, created_by) values ($1,$2,'공장 Y','factory','시험','manual',50,$3)`, [req, other.org, ids.admin]),
      ),
    ).rejects.toThrow();
    const quote = (u: string, ver: number, sup: string | null) =>
      asRole(db, 'fcd_user', u, true, (q) =>
        q.query<{ id: string }>(
          `insert into fcd.candidate_quotes (candidate_id, org_id, version, supersedes_id, status, currency, tiers, moq, lead_days_min, lead_days_max, unit_kg, unit_cbm, units_per_carton, created_by)
           values ($1,$2,$3,$4,'active','RMB','[{"minQty":100,"unitPrice":10}]'::jsonb,100,10,20,0.3,0.002,40,$5) returning id`,
          [c[0].id, shipperOrg, ver, sup, u],
        ),
      );
    await expect(quote(ids.shipper, 1, null)).rejects.toThrow();
    const v1 = await quote(ids.admin, 1, null);
    // 첫 판은 하나만, 판 번호를 건너뛸 수 없고, 같은 판을 두 번 이을 수 없다
    await expect(quote(ids.admin, 1, null)).rejects.toThrow();
    await expect(quote(ids.admin, 3, v1[0].id)).rejects.toThrow();
    const v2 = await quote(ids.admin, 2, v1[0].id);
    await expect(quote(ids.admin, 2, v1[0].id)).rejects.toThrow();
    const cur = await asRole(db, 'fcd_user', ids.shipper, true, (q) => q.query<{ id: string; version: number }>(`select id, version from fcd.v_candidate_quotes_current where candidate_id = $1`, [c[0].id]));
    expect(cur).toEqual([{ id: v2[0].id, version: 2 }]);
    // 다른 화주는 이 후보를 못 본다
    const seen = await asRole(db, 'fcd_user', other.user, true, (q) => q.query(`select id from fcd.sourcing_candidates where id = $1`, [c[0].id]));
    expect(seen).toEqual([]);
  });
  it('상태 기록: 화주는 자기 요청 취소만, 운영자는 모든 상태·담당', async () => {
    const req = (await db.query<{ id: string }>(`select id from fcd.sourcing_requests where request_no = 'SR-T-0003'`))[0].id;
    const ev = (u: string, status: string, org = shipperOrg, assignee: string | null = null) =>
      asRole(db, 'fcd_user', u, true, (q) => q.query(`insert into fcd.sourcing_request_events (request_id, org_id, status, assignee_id, actor_id) values ($1,$2,$3,$4,$5)`, [req, org, status, assignee, u]));
    await expect(ev(ids.shipper, 'closed')).rejects.toThrow();
    await expect(ev(other.user, 'cancelled', other.org)).rejects.toThrow();
    await expect(ev(ids.admin, 'researching', other.org)).rejects.toThrow(); // 요청과 다른 조직
    await ev(ids.admin, 'researching', shipperOrg, ids.admin);
    let cur = await asRole(db, 'fcd_user', ids.shipper, true, (q) => q.query<{ status: string; assignee_id: string | null }>(`select status, assignee_id from fcd.v_sourcing_requests_current where id = $1`, [req]));
    expect(cur[0]).toEqual({ status: 'researching', assignee_id: ids.admin });
    await ev(ids.shipper, 'cancelled');
    cur = await asRole(db, 'fcd_user', ids.shipper, true, (q) => q.query(`select status, assignee_id from fcd.v_sourcing_requests_current where id = $1`, [req]));
    expect(cur[0]).toEqual({ status: 'cancelled', assignee_id: null });
  });
  it('샘플 관심 등록: 자기 요청의 후보만, 한 사람이 후보마다 한 번', async () => {
    const r1 = (await db.query<{ id: string }>(`select id from fcd.sourcing_requests where request_no = 'SR-EX-0001'`))[0].id;
    const c = (await db.query<{ id: string }>(`select id from fcd.sourcing_candidates where request_id = $1 order by label limit 1`, [r1]))[0].id;
    const ins = (u: string, org: string) =>
      asRole(db, 'fcd_user', u, true, (q) => q.query<{ id: string }>(`insert into fcd.sourcing_sample_interests (org_id, user_id, request_id, candidate_id) values ($1,$2,$3,$4) on conflict (user_id, candidate_id) do nothing returning id`, [org, u, r1, c]));
    await expect(ins(other.user, other.org)).rejects.toThrow();
    expect((await ins(ids.shipper, shipperOrg)).length).toBe(1);
    expect((await ins(ids.shipper, shipperOrg)).length).toBe(0);
  });
});

describe('데모 자료·시작점·서버 시뮬', () => {
  it('데모: 리빙모아 요청 둘(하나는 예시 후보 셋·후보 있음) + 다른 화주 하나, 후보는 모두 「예시」', async () => {
    const q = await asRole(db, 'fcd_user', ids.admin, true, (x) => requestQueue(x));
    const ex = q.filter((r) => r.request_no.startsWith('SR-EX-'));
    expect(ex.map((r) => r.request_no).sort()).toEqual(['SR-EX-0001', 'SR-EX-0002', 'SR-EX-0003']);
    const r1 = ex.find((r) => r.request_no === 'SR-EX-0001')!;
    expect(r1.status).toBe('candidates_ready');
    expect(r1.candidates).toBe(3);
    expect(ex.every((r) => r.is_demo && r.preview)).toBe(true);
    const cands = await asRole(db, 'fcd_user', ids.shipper, true, (x) => candidatesFor(x, r1.id));
    expect(cands.every((c) => c.source === 'mock' && /^예시 /.test(c.label) && c.quote?.version === 1)).toBe(true);
  });
  it('시작점: 저장한 SKU(개당 무게·부피), 판매 분석 연결 지점은 합치기 전 빈 목록', async () => {
    const seeds = await asRole(db, 'fcd_user', ids.shipper, true, (x) => sourcingSeeds(x, shipperOrg));
    const skus = await asRole(db, 'fcd_user', ids.shipper, true, (x) => skusForSourcing(x, shipperOrg));
    expect(await asRole(db, 'fcd_user', ids.shipper, true, (x) => salesProductsForSourcing(x, shipperOrg))).toEqual([]);
    expect(seeds).toEqual(skus);
    expect(skus.length).toBeGreaterThan(0);
    expect(skus[0].unitKg).toBeGreaterThan(0);
  });
  it('서버 시뮬: 같은 화물로 구간 시세를 모아 후보 도착원가를 셈한다', async () => {
    const out = await asRole(db, 'fcd_user', ids.shipper, true, async (x) => {
      const ctx = await simContext(x, todayKst());
      const r1 = (await x.query<{ id: string }>(`select id from fcd.sourcing_requests where request_no = 'SR-EX-0001'`))[0].id;
      const c = (await candidatesFor(x, r1))[0];
      return simulate(x, ctx, {
        hub: 'YIW', category: 'general', qty: 600, price: 19900,
        quote: { currency: c.quote!.currency, tiers: c.quote!.tiers, moq: c.quote!.moq, unitKg: c.quote!.unit_kg, unitCbm: c.quote!.unit_cbm, unitsPerCarton: c.quote!.units_per_carton },
      });
    });
    expect(out.sim.qty).toBe(600);
    expect(out.sim.pnl.logisticsPerUnit).toBeGreaterThan(0);
    expect(out.sim.arrivalPerUnit).toBe(out.sim.pnl.goodsPerUnit + out.sim.pnl.logisticsPerUnit + out.sim.pnl.extraPerUnit + out.sim.pnl.dutyPerUnit);
    expect(out.compareHref).toMatch(/^\/app\/compare\?hub=YIW&port=ICN&mode=LCL&units=600&/);
    expect(['market', 'reference']).toContain(out.logisticsBasis);
  });
});

describe('데모 걷어내기 — 새 표도 함께', () => {
  it('DEMO_TABLES 에 다섯 표가 있고, 걷어내면 데모 건수가 0', async () => {
    const names = ['sourcing_requests', 'sourcing_request_events', 'sourcing_candidates', 'candidate_quotes', 'sourcing_sample_interests'];
    expect(DEMO_TABLES.map((t) => t.table)).toEqual(expect.arrayContaining(names));
    const before = await db.transaction((tx) => demoCounts(tx));
    for (const t of names) expect(before.find((c) => c.table === t)!.demo, t).toBeGreaterThan(0);
    const plan = await db.transaction((tx) => planPurge(tx));
    await db.exec(buildPurgeSql(plan));
    const after = await db.transaction((tx) => demoCounts(tx));
    for (const t of names) expect(after.find((c) => c.table === t)!.demo, t).toBe(0);
  });
});
