/**
 * v2 4차 onestop — 원스톱 대행형 구역(미리보기).
 * 순수 함수(청구 CBM·가격 하나·최소 요금·9구간 차이·개당 도착원가) · 설정·단계·혼적 마감 ·
 * 메모리 PGlite(운영 DB 아님)에서 RLS·새 판·단계 규칙·스위치·데모 걷어내기. 화면 흐름은 e2e/v2-onestop.spec.ts.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
import type { Driver } from '@/lib/db/driver';
import { billableCbm, compareWithNine, estimateDutyVat, onestopArrival, onestopQuote, sellerPnl, type OnestopQuoteInput } from '@/lib/money';
import {
  effectiveStage,
  nextCutoff,
  nextStages,
  ONESTOP_SETTING_SCHEMAS,
  OnestopTariffSchema,
  readOnestopConfig,
  stageFromShipment,
  type OnestopTariff,
} from '@/lib/onestop/settings';
import { buildOnestopSnapshot, orderCargo, referenceNine } from '@/lib/onestop/snapshot';
import { V2_SETTING_SCHEMAS } from '@/lib/v2-setting-schemas';
import { DEMO_TABLES, demoCounts } from '@/lib/server/demo-status';
import { myOrders, orderByRoot, orderQueue, serverQuote } from '@/lib/server/onestop';
import { ONESTOP_SETTINGS, REFERENCE_LINES, SETTINGS } from '@seed/reference/data';
import { seedDemo } from '@seed/demo';
import { buildPurgeSql, planPurge } from '@seed/demo/purge';
import { asRole, hazardDb, todayKst } from './helpers';

const T = ONESTOP_SETTINGS.find((s) => s.key === 'onestop.tariff')!.value as OnestopTariff;
const FX = { KRW: 1, RMB: 190.5, USD: 1380 } as const;
const base: OnestopQuoteInput = { hub: 'YIW', mode: 'LCL', fc: 'FC-ICH', units: 300, cbm: 0.8, goodsKrw: 0, purchase: false, barcode: true, inspection: 'basic' };

describe('청구 CBM', () => {
  it('0.1 CBM 단위 올림 · 부동소수 꼬리는 올리지 않는다 · 0 이하는 오류', () => {
    expect(billableCbm(0.8, 10)).toBe(0.8);
    expect(billableCbm(0.81, 10)).toBe(0.9);
    expect(billableCbm(0.1 + 0.2, 10)).toBe(0.3);
    expect(billableCbm(0.01, 10)).toBe(0.1);
    expect(billableCbm(2.345, 1)).toBe(2.35);
    expect(() => billableCbm(0, 10)).toThrow(RangeError);
    expect(() => billableCbm(1, 0)).toThrow(RangeError);
  });
});

describe('가격 하나 — onestopQuote', () => {
  it('혼적 운임 + 개당 작업·바코드·검품, 최소 요금보다 크면 그대로', () => {
    const q = onestopQuote(T, base);
    if (!q.ok) throw new Error('no');
    // 0.8 × 219,000 = 175,200 · 300 × (60 + 90 + 120) = 81,000
    expect(q.lines.map((l) => [l.key, l.amount])).toEqual([
      ['freight', 175200],
      ['handling', 18000],
      ['barcode', 27000],
      ['inspection', 36000],
    ]);
    expect(q.subtotal).toBe(256200);
    expect(q.minApplied).toBe(false);
    expect(q.total).toBe(256200);
    expect(q.perUnit).toBe(854);
    expect(q.logistics).toBe(175200);
    expect(q.services).toBe(81000);
    expect(q.lane.port).toBe('ICN');
  });
  it('최소 요금 — 작은 주문은 최소 요금까지 채운다', () => {
    const q = onestopQuote(T, { ...base, hub: 'CAN', units: 200, cbm: 0.15, barcode: false, inspection: 'none' });
    if (!q.ok) throw new Error('no');
    expect(q.billableCbm).toBe(0.2);
    expect(q.subtotal).toBe(0.2 * 239000 + 200 * 60);
    expect(q.minApplied).toBe(true);
    expect(q.minTopUp).toBe(T.minChargeKrw - q.subtotal);
    expect(q.total).toBe(T.minChargeKrw);
  });
  it('원거리 FC 할증 · 정밀 검품 · 사입 대행 수수료(물품가 bp, 반올림)', () => {
    const q = onestopQuote(T, { ...base, fc: 'FC-DGU', inspection: 'full', purchase: true, goodsKrw: 560_133 });
    if (!q.ok) throw new Error('no');
    const by = Object.fromEntries(q.lines.map((l) => [l.key, l.amount]));
    expect(by.remote_fc).toBe(0.8 * 30000);
    expect(by.inspection).toBe(300 * 350);
    expect(by.purchase_fee).toBe(28007); // 560,133 × 5% = 28,006.65 → 28,007
    expect(q.logistics).toBe(175200 + 24000);
  });
  it('요금표에 없는 길·잘못된 수량은 견적을 내지 않는다', () => {
    expect(onestopQuote(T, { ...base, hub: 'SZX' })).toEqual({ ok: false, reason: 'no_lane' });
    expect(onestopQuote(T, { ...base, mode: 'FERRY' })).toEqual({ ok: false, reason: 'no_lane' });
    expect(onestopQuote(T, { ...base, units: 0 })).toEqual({ ok: false, reason: 'bad_input' });
    expect(onestopQuote(T, { ...base, cbm: -1 })).toEqual({ ok: false, reason: 'bad_input' });
    expect(onestopQuote(T, { ...base, units: 1.5 })).toEqual({ ok: false, reason: 'bad_input' });
  });
});

describe('9구간 참고치와의 차이 · 개당 도착원가', () => {
  it('차이 = 원스톱 − 9구간, bp 는 9구간 대비 · 운임만의 차이도', () => {
    const c = compareWithNine({ total: 256200, logistics: 175200 }, 240000);
    expect(c).toEqual({ nineTotal: 240000, diff: 16200, diffBp: 675, logisticsDiff: -64800, logisticsDiffBp: -2700 });
    expect(compareWithNine({ total: 1, logistics: 1 }, 0).diffBp).toBeNull();
    expect(() => compareWithNine({ total: 1, logistics: 1 }, -1)).toThrow(RangeError);
  });
  it('참고치 9구간 — 3 CBM 기준 화물은 약 70.6만 원(기획 문서 5절의 근거)', () => {
    const nine = referenceNine(REFERENCE_LINES, { units: 1200, cartons: 40, kg: 650, cbm: 3, goodsValue: 0, goodsCurrency: 'RMB' }, { fx: { ...FX }, volumetricKgPerCbm: 167, palletCbm: 1.5, containerCbm: 28 });
    expect(nine.total).toBe(706000);
    expect(nine.toPort).toBe(45000 + 44000 + 48000 + 264000);
  });
  it('도착원가 = (물품가 + 원스톱 + 관세) ÷ 수량 — 판매손익(sellerPnl)의 도착원가와 같은 기준(부가세 제외)', () => {
    const i = { units: 600, goodsKrw: 1_120_140, onestopTotal: 400_000, freightToPortKrw: 180_000, dutyRateBp: 800, vatRateBp: 1000, insuranceBp: 20 };
    const a = onestopArrival(i);
    const d = estimateDutyVat({ goodsKrw: i.goodsKrw, freightToPortKrw: i.freightToPortKrw, insuranceBp: 20, dutyRateBp: 800, vatRateBp: 1000 });
    expect(a.duty).toEqual(d);
    expect(a.total).toBe(i.goodsKrw + i.onestopTotal + d.duty);
    expect(a.perUnit).toBe(Math.round(a.total / 600));
    expect(a.perUnitWithVat).toBe(Math.round((a.total + d.vat) / 600));
    const p = sellerPnl({ units: 600, price: 19900, goodsKrw: i.goodsKrw, logisticsTotal: i.onestopTotal, freightToPortKrw: i.freightToPortKrw, extraCostTotal: 0, dutyRateBp: 800, vatRateBp: 1000, insuranceBp: 20, saleFeeBp: 1080, adBp: 0, inboundPerUnit: 0, shippingPerUnit: 0 });
    expect(Math.abs(p.arrivalPerUnit - a.perUnit)).toBeLessThanOrEqual(2); // sellerPnl 은 항목별로 반올림
    expect(() => onestopArrival({ ...i, units: 0 })).toThrow(RangeError);
  });
  it('견적 기록(snapshot) — 물품가가 없으면 도착원가 없음, 있으면 관세율로 추정', () => {
    const input = { hub: 'YIW', mode: 'LCL' as const, fc: 'FC-ICH', units: 300, cartons: 10, cbm: 0.8, kg: 140, unitPrice: null, currency: 'RMB' as const, category: 'general', purchase: false, barcode: true, inspection: 'basic' as const };
    const nine = { basis: 'reference' as const, offers: 0, total: 300000, toPort: 150000 };
    const a = buildOnestopSnapshot({ by: 'seed', tariff: T, fx: { ...FX }, input, nine, dutyRateBp: 800, vatRateBp: 1000, insuranceBp: 20 });
    if (!a.ok) throw new Error('no');
    expect(a.snap.total).toBe(256200);
    expect(a.snap.arrival).toBeNull();
    expect(a.snap.nine.diff).toBe(256200 - 300000);
    const b = buildOnestopSnapshot({ by: 'seed', tariff: T, fx: { ...FX }, input: { ...input, unitPrice: 9.8 }, nine, dutyRateBp: 800, vatRateBp: 1000, insuranceBp: 20 });
    if (!b.ok) throw new Error('no');
    expect(b.snap.goodsKrw).toBe(Math.round(300 * 9.8 * 190.5));
    expect(b.snap.arrival!.perUnit).toBeGreaterThan(b.snap.perUnit);
    expect(orderCargo(input).goodsValue).toBe(0);
    expect(buildOnestopSnapshot({ by: 'seed', tariff: T, fx: { ...FX }, input: { ...input, hub: 'SZX' }, nine, dutyRateBp: 0, vatRateBp: 0, insuranceBp: 0 }).ok).toBe(false);
  });
});

describe('설정·단계·혼적 마감', () => {
  it('참조 시드의 첫 판이 규칙을 통과하고, 스위치는 꺼짐 · 어드민 설정 화면에 두 키', () => {
    expect(OnestopTariffSchema.safeParse(T).success).toBe(true);
    expect(T.example).toBe(true);
    expect(ONESTOP_SETTINGS.find((s) => s.key === 'onestop.enabled')!.value).toBe(false);
    expect(Object.keys(V2_SETTING_SCHEMAS)).toEqual(expect.arrayContaining(Object.keys(ONESTOP_SETTING_SCHEMAS)));
    expect(SETTINGS.map((s) => s.key)).toEqual(expect.arrayContaining(['onestop.enabled', 'onestop.tariff']));
    expect(OnestopTariffSchema.safeParse({ ...T, lanes: [...T.lanes, T.lanes[0]] }).success).toBe(false);
    expect(OnestopTariffSchema.safeParse({ ...T, lanes: [{ ...T.lanes[0], daysMin: 9, daysMax: 3 }] }).success).toBe(false);
  });
  it('설정 읽기 — 스위치가 없으면 꺼짐, 요금표가 없으면 멈춘다', () => {
    expect(readOnestopConfig(new Map([['onestop.tariff', T]])).on).toBe(false);
    expect(readOnestopConfig(new Map<string, unknown>([['onestop.tariff', T], ['onestop.enabled', true]])).on).toBe(true);
    expect(readOnestopConfig(new Map<string, unknown>([['onestop.tariff', T], ['onestop.enabled', 'true']])).on).toBe(false);
    expect(() => readOnestopConfig(new Map())).toThrow(/onestop.tariff/);
  });
  it('이은 선적의 9단계 → 원스톱 단계, 더 앞선 쪽을 보인다(취소는 그대로)', () => {
    expect(stageFromShipment(4)).toBeNull();
    expect(stageFromShipment(5)).toBe('departed');
    expect(stageFromShipment(7)).toBe('customs_cleared');
    expect(stageFromShipment(9)).toBe('fc_received');
    expect(effectiveStage('barcoded', 6)).toEqual({ stage: 'departed', fromShipment: true });
    expect(effectiveStage('customs_cleared', 5)).toEqual({ stage: 'customs_cleared', fromShipment: false });
    expect(effectiveStage('cancelled', 9)).toEqual({ stage: 'cancelled', fromShipment: false });
    expect(nextStages('inspected')).toEqual(['barcoded', 'departed', 'customs_cleared', 'fc_received']);
    expect(nextStages('fc_received')).toEqual([]);
    expect(nextStages('cancelled')).toEqual([]);
  });
  it('다음 혼적 마감 — 화·금 17시(한국 시각), 그날 17시가 지나면 다음 마감', () => {
    const kst = (s: string) => Date.parse(`${s}+09:00`);
    // 2026-09-29 은 화요일
    expect(nextCutoff(kst('2026-09-29T10:00:00'), [2, 5], 17)).toEqual({ date: '2026-09-29', weekday: 2 });
    expect(nextCutoff(kst('2026-09-29T17:00:00'), [2, 5], 17)).toEqual({ date: '2026-10-02', weekday: 5 });
    expect(nextCutoff(kst('2026-10-02T23:59:00'), [2, 5], 17)).toEqual({ date: '2026-10-06', weekday: 2 });
    expect(nextCutoff(kst('2026-09-27T00:30:00'), [0], 1)).toEqual({ date: '2026-09-27', weekday: 0 });
    expect(() => nextCutoff(0, [], 17)).toThrow(RangeError);
  });
});

// ─── DB ────────────────────────────────────────────────────────────────

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

const snapJson = JSON.stringify({ by: 'test', total: 1 });
const newOrder = (q: Driver, org: string, by: string, no: string, preview = true) =>
  q.query<{ id: string }>(
    `insert into fcd.onestop_orders (order_no, org_id, created_by, product_name, category, units, cartons, cbm, kg, hub, mode, port, fc_code, quote, total_krw, preview)
     values ($1,$2,$3,'시험 상품','general',100,5,0.5,80,'YIW','LCL','ICN','FC-ICH',$4::jsonb,150000,$5) returning id`,
    [no, org, by, snapJson, preview],
  );
const addEvent = (u: string, order: string, org: string, stage: string, note: string | null = null) =>
  asRole(db, 'fcd_user', u, true, (q) => q.query(`insert into fcd.onestop_order_events (order_id, org_id, stage, note, actor_id) values ($1,$2,$3,$4,$5)`, [order, org, stage, note, u]));
const revise = (u: string, sup: string, root: string, version: number, org = shipperOrg, shipment: string | null = null) =>
  asRole(db, 'fcd_user', u, true, (q) =>
    q.query<{ id: string }>(
      `insert into fcd.onestop_orders (order_no, org_id, created_by, version, root_id, supersedes_id, product_name, category, units, cartons, cbm, kg, hub, mode, port, fc_code, quote, total_krw, shipment_id, measured, preview)
       select order_no, $2, $3, $4, $5, id, product_name, category, units, cartons, 0.7, kg, hub, mode, port, fc_code, quote, total_krw, $6, true, preview from fcd.onestop_orders where id = $1 returning id`,
      [sup, org, u, version, root, shipment],
    ),
  );

describe('RLS · 새 판 · 단계 규칙', () => {
  it('읽기: 화주는 자기 조직 것만, 운영자는 전부, 물류사·비로그인은 못 본다', async () => {
    const mine = await asRole(db, 'fcd_user', ids.shipper, true, (q) => q.query<{ org_id: string }>(`select org_id from fcd.onestop_orders`));
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.every((x) => x.org_id === shipperOrg)).toBe(true);
    const all = await asRole(db, 'fcd_user', ids.admin, true, (q) => q.query<{ org_id: string }>(`select org_id from fcd.onestop_orders`));
    expect(new Set(all.map((x) => x.org_id)).size).toBeGreaterThanOrEqual(2);
    expect(await asRole(db, 'fcd_user', ids.partner, true, (q) => q.query(`select id from fcd.onestop_orders`))).toEqual([]);
    expect(await asRole(db, 'fcd_user', ids.partner, true, (q) => q.query(`select id from fcd.onestop_order_events`))).toEqual([]);
    await expect(asRole(db, 'fcd_public', null, true, (q) => q.query(`select id from fcd.onestop_orders`))).rejects.toThrow();
  });
  it('UPDATE·DELETE 권한이 없다(운영자도)', async () => {
    await expect(asRole(db, 'fcd_user', ids.admin, true, (q) => q.query(`update fcd.onestop_orders set total_krw = 0`))).rejects.toThrow();
    await expect(asRole(db, 'fcd_user', ids.admin, true, (q) => q.query(`delete from fcd.onestop_order_events`))).rejects.toThrow();
  });
  it('첫 판: 화주 본인 조직만 · 남의 조직·물류사는 막힘 · 스위치 꺼짐이면 preview = true 만', async () => {
    await expect(asRole(db, 'fcd_user', ids.shipper, true, (q) => newOrder(q, other.org, ids.shipper, 'OS-T-0001'))).rejects.toThrow();
    const pOrg = (await db.query<{ org_id: string }>(`select org_id from fcd.memberships where user_id = $1`, [ids.partner]))[0].org_id;
    await expect(asRole(db, 'fcd_user', ids.partner, true, (q) => newOrder(q, pOrg, ids.partner, 'OS-T-0002'))).rejects.toThrow();
    await expect(asRole(db, 'fcd_user', ids.shipper, true, (q) => newOrder(q, shipperOrg, ids.shipper, 'OS-T-0003', false))).rejects.toThrow();
    const ok = await asRole(db, 'fcd_user', ids.shipper, true, (q) => newOrder(q, shipperOrg, ids.shipper, 'OS-T-0004'));
    expect(ok[0].id).toBeTruthy();
    // 운영자도 화주 대신 첫 판을 못 넣는다
    await expect(asRole(db, 'fcd_user', ids.admin, true, (q) => newOrder(q, shipperOrg, ids.admin, 'OS-T-0005'))).rejects.toThrow();
  });
  it('뒤 판: 운영자만 · 지금 판에만 이어서 · 판 번호 하나씩 · 선적은 같은 화주 것만', async () => {
    const v1 = (await db.query<{ id: string }>(`select id from fcd.onestop_orders where order_no = 'OS-T-0004'`))[0].id;
    await expect(revise(ids.shipper, v1, v1, 2)).rejects.toThrow();
    await expect(revise(ids.admin, v1, v1, 3)).rejects.toThrow();
    await expect(revise(ids.admin, v1, v1, 2, other.org)).rejects.toThrow();
    const otherShip = (await db.query<{ id: string }>(`select id from fcd.shipments where shipper_org_id <> $1 limit 1`, [shipperOrg]))[0]?.id;
    if (otherShip) await expect(revise(ids.admin, v1, v1, 2, shipperOrg, otherShip)).rejects.toThrow();
    const myShip = (await db.query<{ id: string }>(`select id from fcd.shipments where shipper_org_id = $1 limit 1`, [shipperOrg]))[0].id;
    const v2 = await revise(ids.admin, v1, v1, 2, shipperOrg, myShip);
    // 앞 판에 다시 잇지 못한다
    await expect(revise(ids.admin, v1, v1, 2)).rejects.toThrow();
    const cur = await asRole(db, 'fcd_user', ids.shipper, true, (q) => orderByRoot(q, v1));
    expect(cur!.id).toBe(v2[0].id);
    expect(cur!.version).toBe(2);
    expect(cur!.cbm).toBe(0.7);
    expect(cur!.shipment_id).toBe(myShip);
    expect(cur!.root).toBe(v1);
  });
  it('단계: 운영자는 앞으로만(건너뛰기 가능)·문제는 설명과 함께·취소는 출항 전 · 화주는 접수 단계 취소만', async () => {
    const root = (await db.query<{ id: string }>(`select id from fcd.onestop_orders where order_no = 'OS-T-0004' and version = 1`))[0].id;
    await expect(addEvent(ids.shipper, root, shipperOrg, 'payment_confirmed')).rejects.toThrow();
    await expect(addEvent(ids.admin, root, other.org, 'payment_confirmed')).rejects.toThrow(); // 주문과 다른 조직
    await expect(addEvent(ids.admin, root, shipperOrg, 'issue')).rejects.toThrow(); // 설명 없음
    await addEvent(ids.admin, root, shipperOrg, 'factory_received'); // 대금 확인 건너뜀
    await expect(addEvent(ids.admin, root, shipperOrg, 'payment_confirmed')).rejects.toThrow(); // 뒤로
    await expect(addEvent(ids.admin, root, shipperOrg, 'factory_received')).rejects.toThrow(); // 같은 단계
    await addEvent(ids.admin, root, shipperOrg, 'issue', '박스 하나 젖음');
    await expect(addEvent(ids.shipper, root, shipperOrg, 'cancelled')).rejects.toThrow(); // 접수 지나면 화주 취소 불가
    await addEvent(ids.admin, root, shipperOrg, 'departed');
    await expect(addEvent(ids.admin, root, shipperOrg, 'cancelled')).rejects.toThrow(); // 출항 뒤 취소 불가
    let cur = await asRole(db, 'fcd_user', ids.shipper, true, (q) => orderByRoot(q, root));
    expect(cur!.stage).toBe('departed');
    // 새 접수는 화주가 취소 가능 → 취소 뒤에는 아무것도 못 남긴다
    const n = await asRole(db, 'fcd_user', ids.shipper, true, (q) => newOrder(q, shipperOrg, ids.shipper, 'OS-T-0006'));
    await expect(addEvent(other.user, n[0].id, other.org, 'cancelled')).rejects.toThrow();
    await addEvent(ids.shipper, n[0].id, shipperOrg, 'cancelled');
    await expect(addEvent(ids.admin, n[0].id, shipperOrg, 'issue', '뒤늦은 메모')).rejects.toThrow();
    cur = await asRole(db, 'fcd_user', ids.shipper, true, (q) => orderByRoot(q, n[0].id));
    expect(cur!.stage).toBe('cancelled');
    expect(cur!.shown).toBe('cancelled');
  });
  it('사람(프로필)을 지워도 주문·단계 기록은 남고 「누가」 칸만 빈다', async () => {
    const TMP = '52000000-0000-4000-8000-0000000000dd';
    await db.exec(`insert into fcd.profiles (id, home_org_id, email, name) values ('${TMP}', '${shipperOrg}', 'tmp-onestop@example.com', '시험 사람');
      insert into fcd.memberships (user_id, org_id, role) values ('${TMP}', '${shipperOrg}', 'shipper_member');`);
    const r = await asRole(db, 'fcd_user', TMP, true, (q) => newOrder(q, shipperOrg, TMP, 'OS-T-0007'));
    await addEvent(TMP, r[0].id, shipperOrg, 'cancelled');
    await db.exec(`delete from fcd.memberships where user_id = '${TMP}'; delete from fcd.profiles where id = '${TMP}';`);
    expect(await db.query(`select created_by from fcd.onestop_orders where id = $1`, [r[0].id])).toEqual([{ created_by: null }]);
    expect(await db.query(`select actor_id from fcd.onestop_order_events where order_id = $1`, [r[0].id])).toEqual([{ actor_id: null }]);
  });
});

describe('데모 자료 · 서버 견적', () => {
  it('데모: 리빙모아 주문 셋(접수 · 검품 + 실측 새 판 · 선적과 이음) + 다른 화주 하나(최소 요금)', async () => {
    const q = await asRole(db, 'fcd_user', ids.admin, true, (x) => orderQueue(x));
    const ex = q.filter((r) => r.order_no.startsWith('OS-EX-'));
    expect(ex.map((r) => r.order_no).sort()).toEqual(['OS-EX-0001', 'OS-EX-0002', 'OS-EX-0003', 'OS-EX-0004']);
    const by = Object.fromEntries(ex.map((r) => [r.order_no, r]));
    expect(by['OS-EX-0001'].stage).toBe('received');
    expect(by['OS-EX-0002'].stage).toBe('inspected');
    expect(by['OS-EX-0002'].version).toBe(2);
    expect(by['OS-EX-0002'].measured).toBe(true);
    expect(by['OS-EX-0003'].shipment_id).toBeTruthy();
    expect(['departed', 'customs_cleared']).toContain(by['OS-EX-0003'].shown);
    expect(by['OS-EX-0003'].shownFromShipment).toBe(true);
    expect(by['OS-EX-0004'].quote.minApplied).toBe(true);
    expect(by['OS-EX-0004'].org_id).not.toBe(shipperOrg);
    expect(ex.every((r) => r.is_demo && r.preview && r.quote.total === r.total_krw)).toBe(true);
    const mine = await asRole(db, 'fcd_user', ids.shipper, true, (x) => myOrders(x, shipperOrg));
    expect(mine.some((r) => r.order_no === 'OS-EX-0004')).toBe(false);
  });
  it('서버 견적: 같은 화물로 구간 시세(없으면 참고치)를 모아 9구간 차이를 남긴다', async () => {
    const r = await asRole(db, 'fcd_user', ids.shipper, true, (x) =>
      serverQuote(x, { hub: 'YIW', mode: 'LCL', fc: 'FC-ICH', units: 300, cartons: 10, cbm: 0.8, kg: 140, unitPrice: 9.8, currency: 'RMB', category: 'general', purchase: true, barcode: true, inspection: 'basic' }, todayKst()),
    );
    if (!r.ok) throw new Error(r.error);
    expect(r.snap.by).toBe('server');
    expect(['market', 'reference']).toContain(r.snap.nine.basis);
    expect(r.snap.nine.nineTotal).toBeGreaterThan(0);
    expect(r.snap.nine.diff).toBe(r.snap.total - r.snap.nine.nineTotal);
    expect(r.snap.lines.some((l) => l.key === 'purchase_fee')).toBe(true);
    expect(r.snap.arrival).not.toBeNull();
    const bad = await asRole(db, 'fcd_user', ids.shipper, true, (x) =>
      serverQuote(x, { hub: 'SZX', mode: 'LCL', fc: 'FC-ICH', units: 300, cartons: 10, cbm: 0.8, kg: 140, unitPrice: null, currency: 'RMB', category: 'general', purchase: false, barcode: true, inspection: 'basic' }, todayKst()),
    );
    expect(bad.ok).toBe(false);
  });
});

describe('데모 걷어내기 — 새 표도 함께', () => {
  it('DEMO_TABLES 에 두 표가 있고, 걷어내면 데모 건수가 0', async () => {
    const names = ['onestop_orders', 'onestop_order_events'];
    expect(DEMO_TABLES.map((t) => t.table)).toEqual(expect.arrayContaining(names));
    const before = await db.transaction((tx) => demoCounts(tx));
    for (const t of names) expect(before.find((c) => c.table === t)!.demo, t).toBeGreaterThan(0);
    const plan = await db.transaction((tx) => planPurge(tx));
    await db.exec(buildPurgeSql(plan));
    const after = await db.transaction((tx) => demoCounts(tx));
    for (const t of names) expect(after.find((c) => c.table === t)!.demo, t).toBe(0);
  });
});
