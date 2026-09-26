/**
 * v2 3차 sales — 쿠팡 API 제공 · 판매 분석: 순수 계산(money/sales) · 분석 한 번(analyze) · 흉내 어댑터(결정적·미래 없음·재고 음수 없음) ·
 * 설정 규칙 · 메모리 PGlite(운영 DB 아님)에서 RLS·권한·새 판·데모·걷어내기. 쿠팡을 부르지 않는다. 화면 흐름은 e2e/v2-sales.spec.ts.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { setDbForTests } from '@/lib/db';
import type { Driver } from '@/lib/db/driver';
import {
  abcClassify,
  addDays,
  arrivalPerUnit,
  avgPrice,
  bucketSeries,
  changeBp,
  dailySeries,
  daysBetween,
  daysOfStock,
  inboundReflectDays,
  median,
  periodWindows,
  reorderOn,
  reorderState,
  returnRateBp,
  skuUnitPnl,
  stockoutOn,
  suggestUnits,
  sumRange,
  velocity,
} from '@/lib/money/sales';
import { unitPnl } from '@/lib/money/pnl';
import { analyzeSales } from '@/lib/sales/analyze';
import { DEMO_SALES_SEED, PREVIEW_PRODUCTS, PREVIEW_SALES_SEED, mockReflectLag, mockSales } from '@/lib/sales/mock';
import { parseEgressIps, parseSalesRules } from '@/lib/sales/settings';
import { SALES_CONSENT, consentScopes } from '@/lib/sales/consent';
import { storeSalesDataset } from '@/lib/sales/store';
import type { SalesRules } from '@/lib/sales/types';
import { V2_SETTING_SCHEMAS } from '@/lib/v2-setting-schemas';
import { DEMO_TABLES, demoCounts } from '@/lib/server/demo-status';
import { decideAccess, loadSalesView } from '@/lib/server/sales';
import type { Viewer } from '@/lib/server/viewer';
import { SALES_SETTINGS, SETTINGS } from '@seed/reference/data';
import { DEMO_ACCOUNTS, seedDemo } from '@seed/demo';
import { buildPurgeSql, planPurge } from '@seed/demo/purge';
import { asRole, hazardDb, todayKst } from './helpers';

vi.mock('server-only', () => ({}));

const RULES: SalesRules = { velocityDays: 28, prepDays: 7, coverDays: 60, abcABp: 8000, abcBBp: 9500, lowStockDays: 21, actualShipments: 5, inboundReflectBp: 5000, roundUnits: 50 };
const FEE = { saleFeeBp: 1080, adBp: 0, rgInboundPerUnit: 300, rgShippingPerUnit: 1200 };

describe('날짜·합계·지난 기간 대비', () => {
  it('날짜 더하기·빼기', () => {
    expect(addDays('2026-02-27', 2)).toBe('2026-03-01');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
    expect(daysBetween('2026-09-01', '2026-09-26')).toBe(25);
    expect(() => addDays('2026/09/01', 1)).toThrow(RangeError);
  });
  it('기간 창 — 끝날 포함 days 일 · 바로 앞 같은 길이', () => {
    expect(periodWindows('2026-09-25', 7)).toEqual({ cur: { from: '2026-09-19', to: '2026-09-25' }, prev: { from: '2026-09-12', to: '2026-09-18' } });
    expect(() => periodWindows('2026-09-25', 0)).toThrow(RangeError);
  });
  it('합계는 취소·기간 밖을 뺀다', () => {
    const rows = [
      { on: '2026-09-20', units: 3, amount: 30000, orders: 2 },
      { on: '2026-09-21', units: 1, amount: 10000, cancelled: true },
      { on: '2026-09-10', units: 5, amount: 50000 },
    ];
    expect(sumRange(rows, { from: '2026-09-19', to: '2026-09-25' })).toEqual({ units: 3, amount: 30000, orders: 2 });
  });
  it('대비(bp) — 지난 기간 0 이면 null, 줄면 음수', () => {
    expect(changeBp(120, 100)).toBe(2000);
    expect(changeBp(75, 100)).toBe(-2500);
    expect(changeBp(10, 0)).toBeNull();
    expect(changeBp(-50, -100)).toBe(5000);
  });
  it('일별은 빠진 날을 0 으로 채우고, 주(월요일)·월로 묶는다', () => {
    const d = dailySeries([{ on: '2026-09-22', units: 2, amount: 200 }], { from: '2026-09-20', to: '2026-09-23' });
    expect(d.map((x) => x.units)).toEqual([0, 0, 2, 0]);
    // 2026-09-20 은 일요일 → 앞 주(9-14 월) · 9-21 월부터 새 주
    const w = bucketSeries(d, 'week');
    expect(w.map((x) => [x.d, x.units, x.days])).toEqual([
      ['2026-09-14', 0, 1],
      ['2026-09-21', 2, 3],
    ]);
    expect(bucketSeries(dailySeries([], { from: '2026-08-30', to: '2026-09-02' }), 'month').map((x) => [x.d, x.days])).toEqual([
      ['2026-08', 2],
      ['2026-09', 2],
    ]);
  });
});

describe('ABC', () => {
  it('누적 80%/95% — 경계를 넘기는 상품은 그 등급, 첫 상품은 늘 A, 매출 0 은 C', () => {
    const m = abcClassify(
      [
        { id: 'a', revenue: 700 },
        { id: 'b', revenue: 200 },
        { id: 'c', revenue: 60 },
        { id: 'd', revenue: 40 },
        { id: 'z', revenue: 0 },
      ],
      8000,
      9500,
    );
    expect(m.get('a')).toMatchObject({ cls: 'A', rank: 1, shareBp: 7000, cumBp: 7000 });
    expect(m.get('b')).toMatchObject({ cls: 'A', cumBp: 9000 }); // 앞까지 70% < 80%
    expect(m.get('c')).toMatchObject({ cls: 'B', cumBp: 9600 }); // 앞까지 90% < 95%
    expect(m.get('d')!.cls).toBe('C');
    expect(m.get('z')!.cls).toBe('C');
    expect(abcClassify([{ id: 'x', revenue: 1 }], 8000, 9500).get('x')!.cls).toBe('A');
    expect(() => abcClassify([], 9000, 8000)).toThrow(RangeError);
  });
  it('같은 매출이면 번호 순(결정적)', () => {
    const m = abcClassify(
      [
        { id: 'b', revenue: 5 },
        { id: 'a', revenue: 5 },
      ],
      8000,
      9500,
    );
    expect(m.get('a')!.rank).toBe(1);
  });
});

describe('판매 속도 · 재고 일수 · 품절 · 재입고', () => {
  const rows = Array.from({ length: 28 }, (_, i) => ({ on: addDays('2026-09-25', -i), units: i % 2 ? 3 : 1, amount: 0 }));
  it('속도 = 최근 N일 판매 ÷ N(판매 없던 날 포함, 둘째 자리)', () => {
    expect(velocity(rows, '2026-09-25', 28)).toBe(2);
    expect(velocity(rows, '2026-09-25', 7)).toBe(Math.round(((1 + 3 + 1 + 3 + 1 + 3 + 1) * 100) / 7) / 100);
    expect(velocity([], '2026-09-25', 28)).toBe(0);
  });
  it('재고 일수(내림)·품절 예상일 · 판매 없으면 null', () => {
    expect(daysOfStock(100, 3)).toBe(33);
    expect(daysOfStock(0, 3)).toBe(0);
    expect(daysOfStock(100, 0)).toBeNull();
    expect(stockoutOn('2026-09-25', 33)).toBe('2026-10-28');
    expect(stockoutOn('2026-09-25', null)).toBeNull();
  });
  it('재입고 권장일 = 품절 예상일 − (운송일 + 준비일) · 상태', () => {
    expect(reorderOn('2026-10-28', 12, 7)).toBe('2026-10-09');
    expect(reorderOn(null, 12, 7)).toBeNull();
    expect(() => reorderOn('2026-10-28', -1, 7)).toThrow(RangeError);
    expect(reorderState('2026-09-20', '2026-09-26', 21)).toBe('late');
    expect(reorderState('2026-10-09', '2026-09-26', 21)).toBe('soon');
    expect(reorderState('2026-12-01', '2026-09-26', 21)).toBe('ok');
    expect(reorderState(null, '2026-09-26', 21)).toBe('none');
  });
  it('권장 수량 = 속도 × (리드타임 + 덮을 일수) − 재고, 올림 단위', () => {
    expect(suggestUnits(2, 19, 60, 40, 50)).toBe(150); // 158 − 40 = 118 → 150
    expect(suggestUnits(2, 19, 60, 500, 50)).toBe(0);
    expect(suggestUnits(0, 19, 60, 0, 50)).toBe(0);
    expect(suggestUnits(1.25, 10, 10, 0, 1)).toBe(25);
  });
});

describe('도착원가 근거 · 마진', () => {
  it('실제 선적이 있으면 수량 가중(최근 N건), 없으면 구간 시세, 둘 다 없으면 none', () => {
    const a = arrivalPerUnit(
      [
        { units: 100, logistics: 100_000, goodsKrw: 300_000, duty: 24_000 },
        { units: 300, logistics: 240_000, goodsKrw: 900_000, duty: 72_000 },
        { units: 1000, logistics: 9_999_999, goodsKrw: 0, duty: 0 },
      ],
      { goodsPerUnit: 1, logisticsPerUnit: 1, dutyPerUnit: 1 },
      2,
    );
    expect(a).toEqual({ basis: 'actual', samples: 2, goodsPerUnit: 3000, logisticsPerUnit: 850, dutyPerUnit: 240, perUnit: 4090 });
    expect(arrivalPerUnit([], { goodsPerUnit: 2000, logisticsPerUnit: 900, dutyPerUnit: 150 }, 5)).toMatchObject({ basis: 'market', perUnit: 3050 });
    expect(arrivalPerUnit([{ units: 0, logistics: 1, goodsKrw: 1, duty: 1 }], null, 5).basis).toBe('none');
  });
  it('개당 이익은 판매손익 계산기와 같은 식(unitPnl) — 수수료 = 판매 + 광고, 로켓그로스 = 입출고 + 배송', () => {
    const a = arrivalPerUnit([], { goodsPerUnit: 2600, logisticsPerUnit: 1300, dutyPerUnit: 210 }, 5);
    const r = skuUnitPnl(12_900, a, { ...FEE, adBp: 300 }, 1000);
    expect(r).toEqual(unitPnl({ price: 12_900, goodsPerUnit: 2600, logisticsPerUnit: 1300, dutyPerUnit: 210, saleFeeBp: 1380, fulfillmentPerUnit: 1500, vatRateBp: 1000 }));
    expect(r.profit).toBe(r.netRevenue - r.saleFee - r.cost);
    // 싸게 팔면 적자
    expect(skuUnitPnl(4_900, a, FEE, 1000).profit).toBeLessThan(0);
  });
  it('평균 실판매가·반품률·중간값', () => {
    expect(avgPrice(129_000, 10)).toBe(12_900);
    expect(avgPrice(0, 0)).toBeNull();
    expect(returnRateBp(3, 120)).toBe(250);
    expect(returnRateBp(1, 0)).toBeNull();
    expect(median([5, 1, 3])).toBe(3);
    expect(median([1, 2, 3, 4])).toBe(3);
    expect(median([])).toBeNull();
  });
  it('입고 반영 일수 = 재고가 전날보다 (수량 × 비율) 이상 늘어난 첫날 − FC 입고일', () => {
    const snaps = [
      { on: '2026-09-09', onHand: 50 },
      { on: '2026-09-10', onHand: 45 },
      { on: '2026-09-11', onHand: 40 },
      { on: '2026-09-12', onHand: 38 },
      { on: '2026-09-13', onHand: 540 },
    ];
    expect(inboundReflectDays('2026-09-10', 500, snaps, 5000)).toBe(3);
    expect(inboundReflectDays('2026-09-10', 5000, snaps, 5000)).toBeNull();
    expect(inboundReflectDays('2026-09-10', 0, snaps, 5000)).toBeNull();
  });
});

describe('흉내 어댑터 — 결정적 · 미래 없음 · 재고 음수 없음', () => {
  const today = '2026-09-26';
  const products = [
    { name: 'P1', skuId: null, price: 10_000, inbounds: [{ on: '2026-08-01', units: 800 }] },
    { name: 'P2', skuId: null, price: 5_000 },
  ];
  it('같은 씨앗·같은 오늘이면 같은 결과, 씨앗이 다르면 다르다', () => {
    const a = mockSales({ seed: DEMO_SALES_SEED, today, products });
    const b = mockSales({ seed: DEMO_SALES_SEED, today, products });
    expect(a).toEqual(b);
    expect(mockSales({ seed: 'other', today, products }).products[0].ext).not.toBe(a.products[0].ext);
  });
  it('180일 · 오늘 전날까지 · 번호는 예시(EX-) · 재고는 0 이상', () => {
    const d = mockSales({ seed: DEMO_SALES_SEED, today, products });
    const end = addDays(today, -1);
    const all = [...d.orders.map((o) => o.on), ...d.inventory.map((s) => s.on), ...d.returns.map((r) => r.on)];
    expect(all.every((x) => x <= end)).toBe(true);
    expect(d.inventory.filter((s) => s.productExt === d.products[0].ext)).toHaveLength(180);
    expect(d.inventory[0].on).toBe(addDays(end, -179));
    expect(d.inventory.every((s) => s.onHand >= 0)).toBe(true);
    expect(d.products.every((p) => p.ext.startsWith('EX-VI-'))).toBe(true);
    expect(d.orders.every((o) => o.ext.startsWith('EX-OD-') && o.units > 0 && o.amount > 0)).toBe(true);
    expect(d.returns.every((r) => r.ext.startsWith('EX-RT-'))).toBe(true);
    expect(new Set(d.orders.map((o) => o.ext)).size).toBe(d.orders.length);
  });
  it('입고는 1~4일 뒤 재고에 반영된다', () => {
    const d = mockSales({ seed: DEMO_SALES_SEED, today, products });
    const lag = mockReflectLag(DEMO_SALES_SEED, 0, '2026-08-01');
    expect(lag).toBeGreaterThanOrEqual(1);
    expect(lag).toBeLessThanOrEqual(4);
    const snaps = d.inventory.filter((s) => s.productExt === d.products[0].ext).map((s) => ({ on: s.on, onHand: s.onHand }));
    expect(inboundReflectDays('2026-08-01', 800, snaps, 5000)).toBe(lag);
  });
  it('첫날을 고정하면 다음 날 다시 만들어도 앞날 기록이 같다(다시 동기화해도 새 판이 안 생긴다)', () => {
    const a = mockSales({ seed: DEMO_SALES_SEED, today, products });
    const b = mockSales({ seed: DEMO_SALES_SEED, today: addDays(today, 3), start: a.inventory[0].on, products });
    const keyA = new Map(a.orders.map((o) => [o.ext, o]));
    for (const o of b.orders) if (keyA.has(o.ext)) expect(o).toEqual(keyA.get(o.ext));
    expect(b.orders.length).toBeGreaterThan(a.orders.length);
  });
});

describe('분석 한 번 — 미리보기 예시로', () => {
  const today = '2026-09-26';
  const ds = mockSales({ seed: PREVIEW_SALES_SEED, today, products: PREVIEW_PRODUCTS });
  const arrival = Object.fromEntries(ds.products.map((p, i) => [p.ext, arrivalPerUnit([], PREVIEW_PRODUCTS[i].example, 5)]));
  const transit = Object.fromEntries(ds.products.map((p) => [p.ext, { days: 12, basis: 'market' as const, lane: 'YIW→ICN' }]));
  const a = analyzeSales(ds, { today, periodDays: 30, rules: RULES, fee: FEE, vatRateBp: 1000, arrival, transit, delivered: [] });
  it('합계 = 상품별 합 · 순위 순 · 첫 상품은 A', () => {
    expect(a.totals.amount).toBe(a.products.reduce((s, p) => s + p.amount, 0));
    expect(a.totals.units).toBe(a.products.reduce((s, p) => s + p.units, 0));
    expect(a.products.map((p) => p.rank)).toEqual([1, 2, 3, 4, 5]);
    expect(a.products[0].abc).toBe('A');
    expect(a.period.cur.to).toBe('2026-09-25');
  });
  it('추정 순이익 = 상품별 개당 이익 × 판매량의 합', () => {
    expect(a.profit.cur).toBe(a.products.reduce((s, p) => s + (p.periodProfit ?? 0), 0));
    expect(a.lossCount).toBe(a.products.filter((p) => p.pnl && p.pnl.profit < 0 && p.units > 0).length);
  });
  it('재입고 권장일 = 품절 예상일 − (12 + 준비일 7)', () => {
    for (const p of a.products) if (p.stockout) expect(p.reorder).toBe(addDays(p.stockout, -19));
  });
  it('반품 사유는 많은 순, 비율 합은 대략 100%', () => {
    const units = a.reasons.map((r) => r.units);
    expect([...units].sort((x, y) => y - x)).toEqual(units);
    if (a.reasons.length) expect(Math.abs(a.reasons.reduce((s, r) => s + r.shareBp, 0) - 10_000)).toBeLessThanOrEqual(a.reasons.length);
  });
});

describe('설정 · 동의 문구', () => {
  it('참조 시드 첫 판이 규칙을 통과하고 어드민 설정 화면 규칙에도 있다', () => {
    for (const s of SALES_SETTINGS) {
      expect(SETTINGS.some((x) => x.key === s.key), s.key).toBe(true);
      expect(V2_SETTING_SCHEMAS[s.key].safeParse(s.value).success, s.key).toBe(true);
    }
    expect(parseSalesRules(SALES_SETTINGS.find((s) => s.key === 'sales.rules')!.value)).toEqual(RULES);
    expect(() => parseSalesRules({ ...RULES, abcABp: 9600 })).toThrow();
  });
  it('연동 IP — 첫 판은 비어 있고(「준비 중」), 모양이 틀리면 빈 목록', () => {
    expect(parseEgressIps(SALES_SETTINGS.find((s) => s.key === 'wing.egress_ips')!.value)).toEqual([]);
    expect(parseEgressIps(['203.0.113.10'])).toEqual(['203.0.113.10']);
    expect(parseEgressIps(['999.1.1.1'])).toEqual([]);
    expect(parseEgressIps(null)).toEqual([]);
  });
  it('동의 문구 — 읽는 것 다섯, 하지 않는 것에 쓰기 행동', () => {
    expect(SALES_CONSENT.reads.map((r) => r.key)).toEqual(['products', 'orders', 'inventory', 'returns', 'settlements']);
    for (const w of ['상품 등록·수정·삭제', '가격 변경', '주문 처리(발주 확인·송장 입력·취소)']) expect(SALES_CONSENT.notDo).toContain(w);
    expect(consentScopes().reads).toHaveLength(5);
  });
});

describe('DB — RLS·권한·새 판·데모(메모리 PGlite)', () => {
  let db: Driver;
  let shipperUser: string;
  let shipperOrg: string;
  let otherShipperUser: string;
  const REAL_SHIPPER = '41000000-0000-4000-8000-000000000001';
  const REAL_USER = '41000000-0000-4000-8000-0000000000aa';
  const REAL_MEMBER = '41000000-0000-4000-8000-0000000000bb';
  const TABLES = ['sales_sync_runs', 'sales_products', 'sales_orders', 'sales_inventory_snapshots', 'sales_returns', 'sales_settlements', 'wing_consents', 'wing_key_alerts'];

  beforeAll(async () => {
    db = await hazardDb();
    await seedDemo(db, { today: todayKst(), password: 'test-only-password' });
    const me = (await db.query<{ id: string; home_org_id: string }>(`select id, home_org_id from fcd.profiles where email = $1`, [DEMO_ACCOUNTS.shipper.email]))[0];
    shipperUser = me.id;
    shipperOrg = me.home_org_id;
    otherShipperUser = (
      await db.query<{ user_id: string }>(
        `select m.user_id from fcd.memberships m join fcd.orgs o on o.id = m.org_id where o.kind = 'shipper' and o.is_demo and o.id <> $1 order by m.user_id limit 1`,
        [shipperOrg],
      )
    )[0].user_id;
    await db.exec(`
      insert into fcd.orgs (id, kind, name, slug, is_demo, status) values ('${REAL_SHIPPER}', 'shipper', '실제화주S', 'real-shipper-sales', false, 'active');
      insert into fcd.profiles (id, home_org_id, email, name) values ('${REAL_USER}', '${REAL_SHIPPER}', 'real-s@example.com', '실제화주S');
      insert into fcd.profiles (id, home_org_id, email, name) values ('${REAL_MEMBER}', '${REAL_SHIPPER}', 'real-s2@example.com', '실제구성원S');
      insert into fcd.memberships (user_id, org_id, role) values ('${REAL_USER}', '${REAL_SHIPPER}', 'shipper_admin');
      insert into fcd.memberships (user_id, org_id, role) values ('${REAL_MEMBER}', '${REAL_SHIPPER}', 'shipper_member');
    `);
  }, 120_000);
  afterAll(async () => {
    await db?.close();
  });

  it('새 표 여덟은 RLS 가 켜져 있고, UPDATE·DELETE 권한이 없고, 공개·anon 은 못 읽는다', async () => {
    const rls = await db.query<{ relname: string; relrowsecurity: boolean }>(
      `select c.relname, c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'fcd' and c.relname = any($1::text[])`,
      [TABLES],
    );
    expect(rls).toHaveLength(TABLES.length);
    for (const r of rls) expect(r.relrowsecurity, r.relname).toBe(true);
    for (const x of TABLES) {
      const p = await db.query<{ u: boolean; d: boolean }>(`select has_table_privilege('fcd_user', $1, 'UPDATE') u, has_table_privilege('fcd_user', $1, 'DELETE') d`, [`fcd.${x}`]);
      expect(p[0], x).toEqual({ u: false, d: false });
      for (const r of ['anon', 'authenticated', 'fcd_public']) {
        const s = await db.query<{ ok: boolean }>(`select has_table_privilege($1, $2, 'SELECT') ok`, [r, `fcd.${x}`]);
        expect(s[0].ok, `${r} ${x}`).toBe(false);
      }
    }
    const ins = await db.query<{ ok: boolean }>(`select has_table_privilege('fcd_user', 'fcd.wing_key_alerts', 'INSERT') ok`);
    expect(ins[0].ok).toBe(false);
    for (const t of TABLES) expect(DEMO_TABLES.some((x) => x.table === t), t).toBe(true);
  });

  it('데모 시드: 데모 화주에 180일 예시 판매 기록 · 미래 날짜 없음 · 동기화 기록 · 키·정산은 없다', async () => {
    const c = await db.transaction((tx) => demoCounts(tx));
    const get = (t: string) => c.find((x) => x.table === t)!.demo;
    expect(get('sales_products')).toBeGreaterThanOrEqual(3);
    expect(get('sales_orders')).toBeGreaterThan(300);
    expect(get('sales_inventory_snapshots')).toBe(get('sales_products') * 180);
    expect(get('sales_returns')).toBeGreaterThan(0);
    expect(get('sales_sync_runs')).toBe(1);
    expect(get('sales_settlements')).toBe(0);
    expect(get('wing_connections')).toBe(0);
    const fut = await db.query<{ n: number }>(
      `select (select count(*) from fcd.sales_orders where ordered_on >= $1::date) + (select count(*) from fcd.sales_inventory_snapshots where snap_on >= $1::date) + (select count(*) from fcd.sales_returns where returned_on >= $1::date) n`,
      [todayKst()],
    );
    expect(Number(fut[0].n)).toBe(0);
    const linked = await db.query<{ n: number }>(`select count(*)::int n from fcd.v_sales_products_current p join fcd.skus s on s.id = p.sku_id and s.org_id = p.org_id where p.org_id = $1`, [shipperOrg]);
    expect(linked[0].n).toBe(get('sales_products'));
  });

  it('데모 화주만 자기 판매 기록을 본다 — 다른 화주·데모 숨김이면 0', async () => {
    const mine = await asRole(db, 'fcd_user', shipperUser, true, (q) => q.query<{ n: number }>(`select count(*)::int n from fcd.v_sales_orders_current`));
    expect(mine[0].n).toBeGreaterThan(0);
    const other = await asRole(db, 'fcd_user', otherShipperUser, true, (q) => q.query<{ n: number }>(`select count(*)::int n from fcd.v_sales_orders_current where org_id = $1`, [shipperOrg]));
    expect(other[0].n).toBe(0);
    const hidden = await asRole(db, 'fcd_user', shipperUser, false, (q) => q.query<{ n: number }>(`select count(*)::int n from fcd.sales_products`));
    expect(hidden[0].n).toBe(0);
  });

  it('쌓기: 같은 자료를 다시 넣으면 건너뛰고, 바뀐 주문은 다음 판 · 남의 SKU 는 못 잇는다 · 판을 건너뛸 수 없다', async () => {
    const ds = mockSales({ seed: 'real-test', today: todayKst(), days: 10, products: [{ name: '실제 상품', skuId: null, price: 9_900, baseDaily: 5 }] });
    const s1 = await asRole(db, 'fcd_user', REAL_USER, true, (q) => storeSalesDataset(q, { orgId: REAL_SHIPPER, userId: REAL_USER, source: 'file', ds }));
    expect(s1.orders).toBe(ds.orders.length);
    const s2 = await asRole(db, 'fcd_user', REAL_USER, true, (q) => storeSalesDataset(q, { orgId: REAL_SHIPPER, userId: REAL_USER, source: 'file', ds }));
    expect(s2).toMatchObject({ products: 0, orders: 0, inventory: 0, returns: 0 });
    const changed = { ...ds, orders: ds.orders.map((o, i) => (i === 0 ? { ...o, cancelled: true } : o)) };
    const s3 = await asRole(db, 'fcd_user', REAL_USER, true, (q) => storeSalesDataset(q, { orgId: REAL_SHIPPER, userId: REAL_USER, source: 'file', ds: changed }));
    expect(s3.orders).toBe(1);
    const v = await db.query<{ version: number; cancelled: boolean }>(`select version, cancelled from fcd.v_sales_orders_current where org_id = $1 and external_id = $2`, [REAL_SHIPPER, ds.orders[0].ext]);
    expect(v[0]).toEqual({ version: 2, cancelled: true });
    const runs = await db.query<{ n: number }>(`select count(*)::int n from fcd.sales_sync_runs where org_id = $1`, [REAL_SHIPPER]);
    expect(runs[0].n).toBe(3);
    // 데모 화주의 SKU 를 실제 화주 상품에 이을 수 없다
    const demoSku = (await db.query<{ id: string }>(`select id from fcd.skus where org_id = $1 limit 1`, [shipperOrg]))[0].id;
    await expect(
      asRole(db, 'fcd_user', REAL_USER, true, (q) =>
        q.query(`insert into fcd.sales_products (org_id, source, external_id, name, sku_id, created_by) values ($1,'file','REALP0001','남의 SKU',$2,$3)`, [REAL_SHIPPER, demoSku, REAL_USER]),
      ),
    ).rejects.toThrow();
    const root = (await db.query<{ id: string }>(`select id from fcd.sales_orders where org_id = $1 and external_id = $2 and version = 1`, [REAL_SHIPPER, ds.orders[0].ext]))[0].id;
    await expect(
      asRole(db, 'fcd_user', REAL_USER, true, (q) =>
        q.query(
          `insert into fcd.sales_orders (org_id, source, external_id, product_ext, ordered_on, units, amount, version, supersedes_id, created_by) values ($1,'file',$2,$3,current_date - 1,1,1,2,$4,$5)`,
          [REAL_SHIPPER, ds.orders[0].ext, ds.products[0].ext, root, REAL_USER],
        ),
      ),
    ).rejects.toThrow();
    // 다른 화주는 이 조직에 못 넣는다
    await expect(
      asRole(db, 'fcd_user', shipperUser, true, (q) => q.query(`insert into fcd.sales_sync_runs (org_id, source, status, created_by) values ($1,'file','ok',$2)`, [REAL_SHIPPER, shipperUser])),
    ).rejects.toThrow();
  });

  it('동의는 화주 관리자만 남기고, 같은 조직 사람이 읽는다', async () => {
    const scopes = JSON.stringify(consentScopes());
    await asRole(db, 'fcd_user', REAL_USER, true, (q) =>
      q.query(`insert into fcd.wing_consents (org_id, consent_version, scopes, agreed, agreed_by) values ($1,$2,$3::jsonb,true,$4)`, [REAL_SHIPPER, SALES_CONSENT.version, scopes, REAL_USER]),
    );
    await expect(
      asRole(db, 'fcd_user', REAL_MEMBER, true, (q) =>
        q.query(`insert into fcd.wing_consents (org_id, consent_version, scopes, agreed, agreed_by) values ($1,$2,$3::jsonb,true,$4)`, [REAL_SHIPPER, SALES_CONSENT.version, scopes, REAL_MEMBER]),
      ),
    ).rejects.toThrow();
    const r = await asRole(db, 'fcd_user', REAL_MEMBER, true, (q) => q.query<{ n: number }>(`select count(*)::int n from fcd.wing_consents`));
    expect(r[0].n).toBe(1);
    const other = await asRole(db, 'fcd_user', shipperUser, true, (q) => q.query<{ n: number }>(`select count(*)::int n from fcd.wing_consents where org_id = $1`, [REAL_SHIPPER]));
    expect(other[0].n).toBe(0);
  });

  it('열림 판정 — 키 = live · 데모 + 흉내 동기화 = example · 없음 = none', () => {
    expect(decideAccess({ hasKey: true, isDemo: false, hasMockSync: false })).toBe('live');
    expect(decideAccess({ hasKey: false, isDemo: true, hasMockSync: true })).toBe('example');
    expect(decideAccess({ hasKey: false, isDemo: true, hasMockSync: false })).toBe('none');
    // 실제 조직은 흉내 기록이 있어도 키가 없으면 열리지 않는다
    expect(decideAccess({ hasKey: false, isDemo: false, hasMockSync: true })).toBe('none');
  });

  it('판매 분석 한 번(데모 화주) — 예시 연결 · 실제 선적 원가 · 적자 SKU · 입고 성과 / 연결 없는 화주는 미리보기', async () => {
    setDbForTests(db);
    try {
      const org = (await db.query<{ id: string; name: string; is_demo: boolean }>(`select id, name, is_demo from fcd.orgs where id = $1`, [shipperOrg]))[0];
      const viewer = { id: shipperUser, name: 'x', email: DEMO_ACCOUNTS.shipper.email, locale: 'ko', orgs: [], unread: 0, org: { ...org, kind: 'shipper', role: 'shipper_admin', status: 'active', slug: null, name_zh: null, default_locale: 'ko' } } as unknown as Viewer;
      const vw = await loadSalesView(viewer, 30, false);
      expect(vw.access).toBe('example');
      expect(vw.preview).toBe(false);
      expect(vw.analysis.products.length).toBeGreaterThanOrEqual(3);
      expect(vw.analysis.totals.amount).toBeGreaterThan(0);
      expect(vw.analysis.products.some((p) => p.arrival.basis === 'actual')).toBe(true);
      expect(vw.analysis.lossCount).toBeGreaterThanOrEqual(1);
      expect(vw.analysis.products.every((p) => p.transit && p.transit.days > 0)).toBe(true);
      expect(vw.analysis.inbound.length).toBeGreaterThan(0);
      expect(vw.analysis.inbound.some((x) => x.reflectDays != null && x.reflectDays >= 1 && x.reflectDays <= 4)).toBe(true);
      expect(Object.keys(vw.skuCargo).length).toBe(vw.analysis.products.length);
      const real = { ...viewer, id: REAL_MEMBER, org: { ...viewer.org, id: REAL_SHIPPER, is_demo: false, role: 'shipper_member' } } as Viewer;
      const rv = await loadSalesView(real, 30, false);
      expect(rv.access).toBe('none');
      expect(rv.preview).toBe(true);
      expect(rv.example).toBe(true);
      expect(rv.analysis.products[0].name).toMatch(/^예시/);
    } finally {
      setDbForTests(undefined);
    }
  });

  it('걷어내기: 데모의 판매 기록은 0, 실제 화주의 기록은 남는다', async () => {
    const before = await db.transaction((tx) => demoCounts(tx));
    const plan = await db.transaction((tx) => planPurge(tx));
    await db.exec(buildPurgeSql(plan));
    const after = await db.transaction((tx) => demoCounts(tx));
    for (const t of TABLES) {
      expect(after.find((c) => c.table === t)!.demo, t).toBe(0);
      expect(after.find((c) => c.table === t)!.real, t).toBe(before.find((c) => c.table === t)!.real);
    }
    const real = await db.query<{ n: number }>(`select count(*)::int n from fcd.sales_orders where org_id = $1`, [REAL_SHIPPER]);
    expect(real[0].n).toBeGreaterThan(0);
  });
});
