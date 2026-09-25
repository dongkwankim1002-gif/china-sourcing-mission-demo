/**
 * v2 assure — 확정가·회송 보장·후불 순수 함수와 새 표(관심 등록·확정가 견적)의 권한.
 * 화면 흐름은 e2e/v2-assure.spec.ts.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
import type { Driver } from '@/lib/db/driver';
import { seedDemo } from '@seed/demo';
import { buildPurgeSql, planPurge } from '@seed/demo/purge';
import { V2_ASSURE_SETTINGS } from '@seed/reference/data';
import { demoCounts, DEMO_TABLES } from '@/lib/server/demo-status';
import {
  ceilTo,
  coverageBase,
  coverageFee,
  deferredFee,
  firmPrice,
  normalQuantile,
  quantileBp,
  returnsFromRate,
  totalsStats,
  type CoverageRates,
  type FirmPriceRates,
} from '@/lib/money';
import { ASSURE_KINDS, ASSURE_SETTING_SCHEMAS, ASSURE_SWITCH_KEY, readAssureConfig } from '@/lib/assure-settings';
import { asRole, hazardDb, todayKst } from './helpers';

const FIRM: FirmPriceRates = { confidenceBp: 9000, loadingBp: 10000, minPremiumBp: 150, smallSampleMin: 5, smallSamplePremiumBp: 500, maxPremiumBp: 2000, roundTo: 1000, validDays: 7 };
const COVER: CoverageRates = { priorReturnRateBp: 350, credibilityK: 30, loadingBp: 4000, minFee: 5000, maxInsurableRateBp: 1500, roundTo: 100 };

describe('분위·분포', () => {
  it('선형 보간 분위(R type 7) — 경계 0·100% 는 최저·최고', () => {
    const s = [1, 2, 3, 4];
    expect(quantileBp(s, 0)).toBe(1);
    expect(quantileBp(s, 10000)).toBe(4);
    expect(quantileBp(s, 5000)).toBe(3); // 2.5 → 반올림
    expect(quantileBp(s, 5000, 'up')).toBe(3);
    expect(quantileBp(s, 9000, 'up')).toBe(4); // 3.7 → 올림
    expect(quantileBp([10, 20], 2500, 'up')).toBe(13); // 12.5 → 13
    expect(quantileBp([10, 20], 2500)).toBe(13); // 반올림도 13
    expect(quantileBp([10, 20], 2400)).toBe(12); // 12.4
    expect(() => quantileBp([], 5000)).toThrow();
    expect(() => quantileBp(s, 10001)).toThrow();
  });
  it('중간값·표본 분산·표준편차·변동계수', () => {
    const st = totalsStats([2, 4, 4, 4, 5, 5, 7, 9], 9000)!;
    expect(st).toMatchObject({ n: 8, min: 2, max: 9, mean: 5, median: 5 });
    expect(st.variance).toBe(5); // 32/7 = 4.57 → 반올림 5
    expect(st.stdev).toBe(2); // √5 = 2.24
    expect(st.cvBp).toBe(4000);
    expect(totalsStats([], 9000)).toBeNull();
  });
  it('표본 하나·모두 같음 = 분산 0', () => {
    expect(totalsStats([1_000_000], 9000)).toMatchObject({ n: 1, variance: 0, stdev: 0, median: 1_000_000, upper: 1_000_000, cvBp: 0 });
    expect(totalsStats([500, 500, 500], 9900)).toMatchObject({ variance: 0, stdev: 0, upper: 500 });
  });
  it('원 단위 정수가 아니거나 음수면 받지 않는다', () => {
    expect(() => totalsStats([1.5], 9000)).toThrow();
    expect(() => totalsStats([-1], 9000)).toThrow();
  });
  it('정규 역누적분포 근사', () => {
    expect(normalQuantile(0.5)).toBeCloseTo(0, 9);
    expect(normalQuantile(0.9)).toBeCloseTo(1.2815516, 6);
    expect(normalQuantile(0.975)).toBeCloseTo(1.959964, 6);
    expect(normalQuantile(0.01)).toBeCloseTo(-2.3263479, 6);
    expect(normalQuantile(0.999)).toBeCloseTo(3.0902323, 6);
    expect(() => normalQuantile(1)).toThrow();
  });
  it('올림 단위', () => {
    expect(ceilTo(1001, 1000)).toBe(2000);
    expect(ceilTo(1000, 1000)).toBe(1000);
    expect(ceilTo(0, 1000)).toBe(0);
    expect(ceilTo(7, 1)).toBe(7);
  });
});

describe('확정가 = 기준 총액 + 초과 위험 프리미엄', () => {
  it('표본이 없으면 내지 않는다', () => {
    expect(firmPrice([], FIRM)).toEqual({ ok: false, reason: 'no_sample' });
  });
  it('분산 0 — 초과 위험 0, 최소 프리미엄만', () => {
    const f = firmPrice(Array(6).fill(1_000_000), FIRM);
    if (!f.ok) throw new Error('ok');
    expect(f.excess).toBe(0);
    expect(f.parametricExcess).toBe(0);
    expect(f.basis).toBe('minimum');
    expect(f.lowSample).toBe(false);
    expect(f.premium).toBe(15_000); // 1.5%
    expect(f.firmPrice).toBe(1_015_000);
    expect(f.offerable).toBe(true);
  });
  it('표본 하나 — 표본 적음 최소 프리미엄(5%)', () => {
    const f = firmPrice([1_000_000], FIRM);
    if (!f.ok) throw new Error('ok');
    expect(f.lowSample).toBe(true);
    expect(f.basis).toBe('small_sample');
    expect(f.firmPrice).toBe(1_050_000);
    expect(f.premiumBp).toBe(500);
  });
  it('표본 적음 경계 — 4곳은 적음, 5곳은 아님', () => {
    const four = firmPrice([1_000_000, 1_000_000, 1_000_000, 1_000_000], FIRM);
    const five = firmPrice([1_000_000, 1_000_000, 1_000_000, 1_000_000, 1_000_000], FIRM);
    expect(four.ok && four.lowSample).toBe(true);
    expect(five.ok && five.lowSample).toBe(false);
    expect(four.ok && four.firmPrice).toBe(1_050_000);
    expect(five.ok && five.firmPrice).toBe(1_015_000);
  });
  it('흩어진 표본 — 분위와 정규 근사 중 큰 초과 위험을 쓴다', () => {
    const totals = [1_800_000, 1_900_000, 2_000_000, 2_050_000, 2_100_000, 2_200_000, 2_400_000];
    const f = firmPrice(totals, FIRM);
    if (!f.ok) throw new Error('ok');
    expect(f.base).toBe(2_050_000);
    // 90% 분위: (7−1)·0.9 = 5.4 → 2,200,000 + 0.4·200,000 = 2,280,000
    expect(f.stats.upper).toBe(2_280_000);
    const empirical = 2_280_000 - 2_050_000;
    const parametric = Math.ceil(normalQuantile(0.9) * f.stats.stdev - 1e-9);
    expect(f.excess).toBe(Math.max(empirical, parametric));
    expect(f.basis).toBe('risk');
    expect(f.firmPrice % 1000).toBe(0);
    expect(f.firmPrice).toBeGreaterThanOrEqual(f.base + f.excess);
    expect(f.firmPrice - f.base).toBe(f.premium);
    expect(f.firmPrice).toBeLessThan(f.base + f.excess + 1000);
    expect(f.offerable).toBe(true);
  });
  it('신뢰수준이 높을수록 확정가가 내려가지 않는다', () => {
    const totals = [1_000_000, 1_050_000, 1_120_000, 1_200_000, 1_210_000, 1_400_000];
    let prev = 0;
    for (const c of [5000, 7000, 8000, 9000, 9500, 9900]) {
      const f = firmPrice(totals, { ...FIRM, confidenceBp: c });
      if (!f.ok) throw new Error('ok');
      expect(f.firmPrice).toBeGreaterThanOrEqual(prev);
      prev = f.firmPrice;
    }
  });
  it('신뢰수준 50% 는 초과 위험 0(중간값 = 분위)', () => {
    const f = firmPrice([100_000, 200_000, 300_000, 400_000, 500_000], { ...FIRM, confidenceBp: 5000 });
    expect(f.ok && f.excess).toBe(0);
  });
  it('프리미엄이 상한(20%)을 넘으면 시범 대상 아님', () => {
    const f = firmPrice([1_000_000, 1_000_000, 1_000_000, 1_000_000, 1_000_000, 3_000_000], FIRM);
    expect(f.ok && f.offerable).toBe(false);
    // 상한 경계 — 프리미엄이 정확히 상한이면 된다
    const edge = firmPrice(Array(5).fill(1_000_000), { ...FIRM, minPremiumBp: 2000 });
    expect(edge.ok && edge.offerable).toBe(true);
    const over = firmPrice(Array(5).fill(1_000_000), { ...FIRM, minPremiumBp: 2001 });
    expect(over.ok && over.offerable).toBe(false);
  });
  it('총액 0 — 확정가 0, 나눗셈 없음', () => {
    const f = firmPrice([0, 0, 0, 0, 0], FIRM);
    expect(f.ok && f.firmPrice).toBe(0);
    expect(f.ok && f.premiumBp).toBe(0);
  });
  it('요율이 이상하면 받지 않는다', () => {
    expect(() => firmPrice([1], { ...FIRM, confidenceBp: 4999 })).toThrow();
    expect(() => firmPrice([1], { ...FIRM, confidenceBp: 10000 })).toThrow();
    expect(() => firmPrice([1], { ...FIRM, loadingBp: -1 })).toThrow();
  });
  it('순서를 섞어도 같은 값', () => {
    const a = firmPrice([3, 1, 2, 5, 4].map((x) => x * 100_000), FIRM);
    const b = firmPrice([1, 2, 3, 4, 5].map((x) => x * 100_000), FIRM);
    expect(a).toEqual(b);
  });
});

describe('회송 보장료', () => {
  it('실측 없음 — 시장 기본 회송률, 최소 보장료', () => {
    const c = coverageFee({ returns: 0, shipments: 0, coveredAmount: 100_000 }, COVER);
    expect(c.rateBp).toBe(350);
    expect(c.credibilityBp).toBe(0);
    expect(c.expectedLoss).toBe(3500);
    expect(c.fee).toBe(5000); // 3,500 × 1.4 = 4,900 → 최소 5,000
    expect(c.lowSample).toBe(true);
    expect(c.offerable).toBe(true);
  });
  it('물량이 많으면 실측 쪽으로 — 신뢰도 가중', () => {
    const c = coverageFee({ returns: 10, shipments: 1000, coveredAmount: 1_000_000 }, COVER);
    // (10·10000 + 30·350) / 1030 = 107.28bp
    expect(c.rateBp).toBe(107);
    expect(c.credibilityBp).toBe(9709);
    expect(c.expectedLoss).toBe(10_729);
    expect(c.fee).toBe(15_100); // 10,729 × 1.4 = 15,020.6 → 15,021 → 100원 올림
    expect(c.lowSample).toBe(false);
  });
  it('보장 금액 0 이면 보장료 0', () => {
    expect(coverageFee({ returns: 1, shipments: 10, coveredAmount: 0 }, COVER).fee).toBe(0);
  });
  it('보장 한도 회송률 경계 — 같으면 되고 넘으면 안 된다', () => {
    const r = { ...COVER, credibilityK: 0 };
    expect(coverageFee({ returns: 15, shipments: 100, coveredAmount: 10_000 }, r).offerable).toBe(true);
    expect(coverageFee({ returns: 16, shipments: 100, coveredAmount: 10_000 }, r).offerable).toBe(false);
  });
  it('K = 0 이고 물량 0 이면 기본값', () => {
    expect(coverageFee({ returns: 0, shipments: 0, coveredAmount: 10_000 }, { ...COVER, credibilityK: 0 }).rateBp).toBe(350);
  });
  it('잘못된 입력', () => {
    expect(() => coverageFee({ returns: 5, shipments: 4, coveredAmount: 1 }, COVER)).toThrow();
    expect(() => coverageFee({ returns: 0, shipments: 1, coveredAmount: 1.5 }, COVER)).toThrow();
  });
  it('회송 건수·보장 금액 도움 함수', () => {
    expect(returnsFromRate(0.035, 60)).toBe(2);
    expect(returnsFromRate(null, 60)).toBe(0);
    expect(returnsFromRate(1.2, 10)).toBe(10);
    expect(
      coverageBase([
        { segment: 'freight', amount: 900_000 },
        { segment: 'kr_warehouse', amount: 60_000 },
        { segment: 'fc_delivery', amount: 90_000 },
        { segment: 'return_reserve', amount: null },
      ]),
    ).toBe(150_000);
  });
});

describe('물류비 후불 참고 수수료', () => {
  const r = { monthlyFeeBp: 150, termDays: 30, maxAmount: 30_000_000 };
  it('기간 비례·올림', () => {
    expect(deferredFee(1_000_000, r)).toEqual({ fee: 15_000, due: 1_015_000, termDays: 30, withinLimit: true });
    expect(deferredFee(1_000_000, { ...r, termDays: 45 }).fee).toBe(22_500);
    expect(deferredFee(1, r).fee).toBe(1);
    expect(deferredFee(0, r).fee).toBe(0);
  });
  it('한도 경계', () => {
    expect(deferredFee(30_000_000, r).withinLimit).toBe(true);
    expect(deferredFee(30_000_001, r).withinLimit).toBe(false);
  });
});

describe('설정 — 스위치 기본 꺼짐, 요율은 설정 표에서', () => {
  it('참조 시드의 스위치는 모두 false, 요율은 규칙을 지킨다', () => {
    const m = new Map(V2_ASSURE_SETTINGS.map((s) => [s.key, s.value]));
    for (const k of ASSURE_KINDS) expect(m.get(ASSURE_SWITCH_KEY[k])).toBe(false);
    for (const s of V2_ASSURE_SETTINGS) expect(ASSURE_SETTING_SCHEMAS[s.key].safeParse(s.value).success, s.key).toBe(true);
    const c = readAssureConfig(m);
    expect(Object.values(c.on).every((x) => x === false)).toBe(true);
    expect(c.firmRates && c.coverageRates && c.deferredRates).toBeTruthy();
  });
  it('키가 없거나 true 가 아니면 꺼짐', () => {
    const c = readAssureConfig(new Map());
    expect(Object.values(c.on).some(Boolean)).toBe(false);
    expect(c.firmRates).toBeNull();
    expect(readAssureConfig(new Map([['v2.firm_price_enabled', 'true']])).on.firm).toBe(false);
    expect(readAssureConfig(new Map([['v2.firm_price_enabled', true]])).on.firm).toBe(true);
  });
});

// ── DB ────────────────────────────────────────────────────────────────────────

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
    `select m.user_id, m.org_id from fcd.memberships m join fcd.orgs o on o.id = m.org_id where o.kind = 'shipper' and m.org_id <> $1 limit 1`,
    [shipperOrg],
  );
  other = { user: o[0].user_id, org: o[0].org_id };
});
afterAll(async () => {
  await db.close();
});

const insertInterest = (q: Driver, org: string, user: string, kind: string) =>
  q.query(`insert into fcd.assure_interests (org_id, user_id, kind, source, detail) values ($1,$2,$3,'compare','{}'::jsonb)`, [org, user, kind]);

const insertQuote = (q: Driver, org: string, user: string, no: string, version: number, supersedes: string | null) =>
  q.query<{ id: string }>(
    `insert into fcd.firm_price_quotes (quote_no, version, supersedes_id, org_id, created_by, source, lane, sample_n, base_total, premium, firm_price, confidence_bp, stats, rates, valid_until)
     values ($1,$2,$3,$4,$5,'compare','{"key":"t"}'::jsonb,5,1000000,15000,1015000,9000,'{}'::jsonb,'{}'::jsonb,current_date + 7) returning id`,
    [no, version, supersedes, org, user],
  );

describe('새 표 — 권한', () => {
  it('참조 시드가 v2 스위치를 꺼짐으로 넣는다', async () => {
    const r = await db.query<{ key: string; value: unknown }>(`select key, value from fcd.v_current_settings where key like 'v2.%_enabled'`);
    expect(r.length).toBeGreaterThanOrEqual(4); // v2 2차 꾸러미 스위치(v2.alliance_enabled 등)도 같은 규칙 — 모두 꺼짐
    expect(r.every((x) => x.value === false)).toBe(true);
  });
  it('RLS 가 켜져 있고, 두 표 모두 UPDATE·DELETE 권한이 없다', async () => {
    for (const t of ['assure_interests', 'firm_price_quotes']) {
      const r = await db.query<{ rls: boolean; u: boolean; d: boolean; pu: boolean }>(
        `select c.relrowsecurity rls, has_table_privilege('fcd_user', c.oid, 'UPDATE') u, has_table_privilege('fcd_user', c.oid, 'DELETE') d,
                has_table_privilege('fcd_public', c.oid, 'INSERT') pu
           from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'fcd' and c.relname = $1`,
        [t],
      );
      expect(r[0], t).toEqual({ rls: true, u: false, d: false, pu: false });
    }
  });
  it('관심 등록 — 본인 이름으로만 넣고, 본인 것만 본다. 운영자는 모두 본다', async () => {
    await asRole(db, 'fcd_user', ids.shipper, true, (q) => insertInterest(q, shipperOrg, ids.shipper, 'firm'));
    await asRole(db, 'fcd_user', other.user, true, (q) => insertInterest(q, other.org, other.user, 'coverage'));
    const mine = await asRole(db, 'fcd_user', ids.shipper, true, (q) => q.query<{ kind: string }>(`select kind from fcd.assure_interests`));
    expect(mine.map((x) => x.kind)).toEqual(['firm']);
    const admin = await asRole(db, 'fcd_user', ids.admin, true, (q) => q.query<{ n: number }>(`select count(*)::int n from fcd.assure_interests`));
    expect(admin[0].n).toBe(2);
    // 남의 이름·남의 조직·물류사·비로그인은 못 넣는다
    await expect(asRole(db, 'fcd_user', ids.shipper, true, (q) => insertInterest(q, shipperOrg, other.user, 'deferred'))).rejects.toThrow();
    await expect(asRole(db, 'fcd_user', ids.shipper, true, (q) => insertInterest(q, other.org, ids.shipper, 'deferred'))).rejects.toThrow();
    const partnerOrg = (await db.query<{ org_id: string }>(`select org_id from fcd.memberships where user_id = $1`, [ids.partner]))[0].org_id;
    await expect(asRole(db, 'fcd_user', ids.partner, true, (q) => insertInterest(q, partnerOrg, ids.partner, 'firm'))).rejects.toThrow();
    await expect(asRole(db, 'fcd_public', null, true, (q) => insertInterest(q, shipperOrg, ids.shipper, 'firm'))).rejects.toThrow();
    // 한 사람 한 종류 한 번
    await expect(asRole(db, 'fcd_user', ids.shipper, true, (q) => insertInterest(q, shipperOrg, ids.shipper, 'firm'))).rejects.toThrow();
    // 모르는 종류
    await expect(asRole(db, 'fcd_user', ids.shipper, true, (q) => insertInterest(q, shipperOrg, ids.shipper, 'loan'))).rejects.toThrow();
  });
  it('DEMO_MODE 꺼짐이면 데모 화주의 관심 등록이 안 보인다(운영자는 본다)', async () => {
    const off = await asRole(db, 'fcd_user', ids.shipper, false, (q) => q.query<{ n: number }>(`select count(*)::int n from fcd.assure_interests`));
    expect(off[0].n).toBe(0);
    const admin = await asRole(db, 'fcd_user', ids.admin, false, (q) => q.query<{ n: number }>(`select count(*)::int n from fcd.assure_interests`));
    expect(admin[0].n).toBe(2);
  });
  it('확정가 견적 — 고칠 수 없고 새 판으로만, 한 판에 후속은 하나', async () => {
    const v1 = await asRole(db, 'fcd_user', ids.shipper, true, (q) => insertQuote(q, shipperOrg, ids.shipper, 'FP-T-1', 1, null));
    await expect(asRole(db, 'fcd_user', ids.shipper, true, (q) => q.query(`update fcd.firm_price_quotes set firm_price = 1 where id = $1`, [v1[0].id]))).rejects.toThrow();
    await asRole(db, 'fcd_user', ids.shipper, true, (q) => insertQuote(q, shipperOrg, ids.shipper, 'FP-T-1', 2, v1[0].id));
    await expect(asRole(db, 'fcd_user', ids.shipper, true, (q) => insertQuote(q, shipperOrg, ids.shipper, 'FP-T-1', 3, v1[0].id))).rejects.toThrow();
    // 남의 조직 견적을 잇거나, 남의 조직 이름으로 넣을 수 없다
    await expect(asRole(db, 'fcd_user', other.user, true, (q) => insertQuote(q, other.org, other.user, 'FP-T-2', 2, v1[0].id))).rejects.toThrow();
    await expect(asRole(db, 'fcd_user', other.user, true, (q) => insertQuote(q, shipperOrg, other.user, 'FP-T-3', 1, null))).rejects.toThrow();
    const seen = await asRole(db, 'fcd_user', other.user, true, (q) => q.query(`select id from fcd.firm_price_quotes`));
    expect(seen).toEqual([]);
    // 확정가는 기준 총액보다 작을 수 없다
    await expect(
      asRole(db, 'fcd_user', ids.shipper, true, (q) =>
        q.query(`insert into fcd.firm_price_quotes (quote_no, org_id, created_by, source, lane, sample_n, base_total, premium, firm_price, confidence_bp, stats, rates, valid_until)
                 values ('FP-T-4',$1,$2,'compare','{}'::jsonb,1,100,0,99,9000,'{}'::jsonb,'{}'::jsonb,current_date)`, [shipperOrg, ids.shipper]),
      ),
    ).rejects.toThrow();
  });
});

describe('시범 확정가 기록 = 화면과 같은 조건', () => {
  it('목적지가 3PL 이어도 compareBasis 표본이 비교 화면(compare + fc) 표본과 같다', async () => {
    const { compare } = await import('@/lib/server/compare');
    const { loadSettings } = await import('@/lib/server/settings');
    const { compareBasis, basisFromOffers } = await import('@/lib/server/assure');
    const { CargoQuery, toCargo } = await import('@/lib/cargo-params');
    const today = todayKst();
    for (const fc of ['TP-BSN', 'FC-ICH']) {
      const cq = CargoQuery.parse({ hub: 'YIW', port: 'ICN', fc });
      const [page, action, plain] = await asRole(db, 'fcd_user', ids.shipper, true, async (q) => {
        const s = await loadSettings(q);
        const r = await compare(q, { hub: cq.hub, port: cq.port, mode: cq.mode, cargo: toCargo(cq), traits: cq.traits, fc: cq.fc }, s, today);
        const r0 = await compare(q, { hub: cq.hub, port: cq.port, mode: cq.mode, cargo: toCargo(cq), traits: cq.traits }, s, today);
        return [basisFromOffers(r.offers), await compareBasis(q, cq, s, today), basisFromOffers(r0.offers)] as const;
      });
      expect(page.totals.length, fc).toBeGreaterThan(0);
      expect(action.totals, fc).toEqual(page.totals);
      if (fc === 'TP-BSN') expect(action.totals).not.toEqual(plain.totals);
    }
  });
});

describe('데모 걷어내기 — 새 표도 함께', () => {
  it('DEMO_TABLES 에 두 표가 있고, 걷어내면 데모 건수가 0', async () => {
    expect(DEMO_TABLES.map((t) => t.table)).toEqual(expect.arrayContaining(['assure_interests', 'firm_price_quotes']));
    const before = await db.transaction((tx) => demoCounts(tx));
    expect(before.find((c) => c.table === 'assure_interests')!.demo).toBe(2);
    expect(before.find((c) => c.table === 'firm_price_quotes')!.demo).toBe(2);
    const plan = await db.transaction((tx) => planPurge(tx));
    await db.exec(buildPurgeSql(plan));
    const after = await db.transaction((tx) => demoCounts(tx));
    for (const t of ['assure_interests', 'firm_price_quotes']) expect(after.find((c) => c.table === t)!.demo, t).toBe(0);
  });
});
