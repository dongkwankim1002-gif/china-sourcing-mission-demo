/**
 * v2 metrics — 이벤트 기록 · 운영 지표 순수 함수 · 목적지 넓히기(마지막 구간).
 * 화면 흐름(운영 지표 화면·계산기 목적지)은 e2e/v2-metrics.spec.ts.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import type { Driver } from '@/lib/db/driver';
import { seedDemo } from '@seed/demo';
import { seedDemoEvents } from '@seed/demo/events';
import { DESTINATIONS, FC_CENTERS, METRICS_SETTINGS, REFERENCE_LINES, SETTINGS } from '@seed/reference/data';
import {
  activeSellers,
  inviteRatio,
  lastMonths,
  monthKey,
  monthlyActiveSellers,
  monthlyCount,
  monthlyRevenuePerShipment,
  quoteVsInvoice,
  repeatRate,
  returnRate,
  revenuePerShipment,
  trailingRanges,
  type MetricEvent,
} from '@/lib/metrics';
import {
  applyDestination,
  commissionAmount,
  completeWithReference,
  computeQuote,
  destinationKm,
  lastLegAmount,
  totalsBreakdown,
  type LastLegRule,
  type QuoteParams,
} from '@/lib/money';
import { parseCargoQuery } from '@/lib/cargo-params';
import { demoCounts } from '@/lib/server/demo-status';
import { STANDARD_CARGO } from '@/lib/standard-cargo';
import { asRole, hazardDb, todayKst } from './helpers';

const setting = <T,>(k: string) => SETTINGS.find((s) => s.key === k)!.value as T;
const QP: QuoteParams = { fx: setting('fx'), ...setting<Omit<QuoteParams, 'fx'>>('quote_params') };
const RULE = METRICS_SETTINGS.find((s) => s.key === 'destination_leg')!.value as LastLegRule;

// 순수 함수 ------------------------------------------------------------------

describe('지표 순수 함수', () => {
  const ev = (kind: MetricEvent['kind'], seller: string | null, at: string): MetricEvent => ({ kind, sellerOrgId: seller, at });
  const r = { from: '2026-09-01T00:00:00.000Z', to: '2026-10-01T00:00:00.000Z' };

  it('기간·달 — KST 로 가른다', () => {
    expect(monthKey('2026-08-31T15:30:00.000Z')).toBe('2026-09'); // KST 9월 1일 00:30
    expect(monthKey('2026-08-31T14:59:00.000Z')).toBe('2026-08');
    expect(lastMonths('2026-09-25', 3)).toEqual(['2026-07', '2026-08', '2026-09']);
    expect(lastMonths('2026-01-10', 2)).toEqual(['2025-12', '2026-01']);
    const t = trailingRanges('2026-09-25', 30);
    expect(t.cur.to).toBe('2026-09-25T15:00:00.000Z'); // 9월 26일 0시 KST
    expect(Date.parse(t.cur.to) - Date.parse(t.cur.from)).toBe(30 * 86400_000);
    expect(t.prev.to).toBe(t.cur.from);
  });

  it('월간 활성 셀러 — 서로 다른 셀러만, 셀러 없는 이벤트는 빼고', () => {
    const e = [ev('quote_requested', 'A', '2026-09-02T01:00:00Z'), ev('booked', 'A', '2026-09-03T01:00:00Z'), ev('shipped', 'B', '2026-09-04T01:00:00Z'), ev('signed_up', null, '2026-09-05T01:00:00Z'), ev('quote_requested', 'C', '2026-08-10T01:00:00Z')];
    expect(activeSellers(e, r)).toBe(2);
    expect(monthlyActiveSellers(e, ['2026-08', '2026-09'])).toEqual([{ month: '2026-08', n: 1 }, { month: '2026-09', n: 2 }]);
    expect(monthlyCount(e, 'booked', ['2026-08', '2026-09'])).toEqual([{ month: '2026-08', n: 0 }, { month: '2026-09', n: 1 }]);
  });

  it('초대 비율 — 물류사 가입만 분모, 가입이 없으면 null', () => {
    const rows = [{ at: '2026-09-02T00:00:00Z', orgKind: 'partner' as const, via: 'direct' }, { at: '2026-09-03T00:00:00Z', orgKind: 'shipper' as const, via: null }];
    expect(inviteRatio(rows, r)).toEqual({ invited: 0, total: 1, ratio: 0 });
    const withInvite = [...rows, { at: '2026-09-04T00:00:00Z', orgKind: 'partner' as const, via: 'invite' }, { at: '2026-08-04T00:00:00Z', orgKind: 'partner' as const, via: 'invite' }];
    expect(inviteRatio(withInvite, r)).toEqual({ invited: 1, total: 2, ratio: 1 / 2 });
    // 화주 가입이 늘어도 비율은 그대로
    const moreShippers = [...withInvite, { at: '2026-09-05T00:00:00Z', orgKind: 'shipper' as const, via: null }, { at: '2026-09-06T00:00:00Z', orgKind: 'shipper' as const, via: null }];
    expect(inviteRatio(moreShippers, r).ratio).toBe(1 / 2);
    expect(inviteRatio([], r)).toEqual({ invited: 0, total: 0, ratio: null });
  });

  it('재선적률 — 기간 안 예약 셀러 중 그 전에 예약한 적 있는 곳', () => {
    const b = [
      ev('booked', 'A', '2026-07-01T00:00:00Z'), // A: 전에 있음 → 재선적
      ev('booked', 'A', '2026-09-10T00:00:00Z'),
      ev('booked', 'B', '2026-09-05T00:00:00Z'), // B: 기간 안 두 번이지만 첫 예약이 기간 안 → 새 셀러
      ev('booked', 'B', '2026-09-20T00:00:00Z'),
      ev('booked', 'C', '2026-10-05T00:00:00Z'), // 기간 뒤는 무시
      ev('booked', null, '2026-09-10T00:00:00Z'),
    ];
    expect(repeatRate(b, r)).toEqual({ sellers: 2, repeat: 1, rate: 0.5 });
    expect(repeatRate([], r).rate).toBeNull();
  });

  it('견적 대비 청구 차이 — 선적마다 최신 판, 부호 있는 평균과 절대값 평균', () => {
    const rows = [
      { shipmentId: 's1', at: '2026-09-02T00:00:00Z', version: 1, total: 130_000, bidTotal: 100_000 },
      { shipmentId: 's1', at: '2026-09-03T00:00:00Z', version: 2, total: 110_000, bidTotal: 100_000 }, // 정정 판을 쓴다
      { shipmentId: 's2', at: '2026-09-04T00:00:00Z', version: 1, total: 190_000, bidTotal: 200_000 },
      { shipmentId: 's3', at: '2026-08-04T00:00:00Z', version: 1, total: 500_000, bidTotal: 100_000 }, // 기간 밖
    ];
    const q = quoteVsInvoice(rows, r, 500);
    expect(q.n).toBe(2);
    expect(q.avgSigned).toBeCloseTo((0.1 - 0.05) / 2, 10);
    expect(q.avgAbs).toBeCloseTo((0.1 + 0.05) / 2, 10);
    expect(q.overFlag).toBe(2); // 10% · 5%(경계 포함)
    expect(quoteVsInvoice(rows, r, 501).overFlag).toBe(1);
    expect(quoteVsInvoice([], r, 300)).toEqual({ n: 0, avgSigned: null, avgAbs: null, overFlag: 0 });
  });

  it('회송률 — 회송 수량 ÷ 선적 수량(선적 수량을 넘지 않게)', () => {
    const rows = [
      { at: '2026-09-02T00:00:00Z', units: 1000, returned: 20 },
      { at: '2026-09-03T00:00:00Z', units: 500, returned: 0 },
      { at: '2026-09-04T00:00:00Z', units: 10, returned: 50 },
      { at: '2026-08-04T00:00:00Z', units: 999, returned: 999 },
    ];
    expect(returnRate(rows, r)).toEqual({ units: 1510, returned: 30, rate: 30 / 1510, shipments: 3, withReturn: 2 });
    expect(returnRate([], r).rate).toBeNull();
  });

  it('선적당 매출 — 수수료 기준(관세사 보수 제외) × 요율 ÷ 예약 수, commission.ts 와 같은 값', () => {
    const a1 = { freight: 900_000, broker: 33_000, fc_delivery: 100_000 };
    const a2 = { freight: 400_000, broker: null, port: 100_000 };
    const rows = [{ at: '2026-09-02T00:00:00Z', amounts: a1 }, { at: '2026-09-05T00:00:00Z', amounts: a2 }, { at: '2026-08-02T00:00:00Z', amounts: a1 }];
    const rate = setting<number>('commission_rate_bp');
    const want = commissionAmount(a1, rate) + commissionAmount(a2, rate);
    expect(want).toBe(Math.round((1_000_000 + 500_000) * rate / 10_000));
    expect(revenuePerShipment(rows, r, rate)).toEqual({ n: 2, commission: want, perShipment: Math.round(want / 2) });
    expect(revenuePerShipment([], r, rate).perShipment).toBeNull();
    expect(monthlyRevenuePerShipment(rows, ['2026-08', '2026-09', '2026-10'], rate)).toEqual([
      { month: '2026-08', v: commissionAmount(a1, rate) },
      { month: '2026-09', v: Math.round(want / 2) },
      { month: '2026-10', v: null },
    ]);
  });
});

describe('목적지 — 마지막 구간', () => {
  const tpl = { code: 'TP-BSN', kind: '3pl' as const, km_incheon: 420, km_pyeongtaek: 360 };
  const fc = { code: 'FC-ICH', kind: 'coupang_fc' as const, km_incheon: 88, km_pyeongtaek: 62 };
  const base = completeWithReference(computeQuote(REFERENCE_LINES, STANDARD_CARGO, QP), {}, STANDARD_CARGO.units);

  it('예시 창고는 「예시」 표시, 실제 회사 이름 없이 지역만', () => {
    for (const d of DESTINATIONS) {
      expect(d.name.startsWith('예시 ')).toBe(true);
      expect(['3pl', 'mall_wh']).toContain(d.kind);
      expect(d.code).toMatch(/^(TP|MK)-[A-Z]{3}$/);
    }
    // 쿠팡 FC 목록은 그대로
    expect(FC_CENTERS.every((f) => f.code.startsWith('FC-'))).toBe(true);
  });

  it('거리는 도착항 기준 — 평택항이면 평택 거리', () => {
    expect(destinationKm(tpl, 'ICN')).toBe(420);
    expect(destinationKm(tpl, 'PTK')).toBe(360);
  });

  it('팔레트 수 × (기본 + km × km당), 최저요금', () => {
    // 기준 화물 3 CBM ÷ 1.5 = 2 팔레트
    const leg = lastLegAmount(STANDARD_CARGO, tpl, 'ICN', RULE, QP);
    expect(leg.pallets).toBe(2);
    expect(leg.amount).toBe(2 * (RULE.perPalletBase + 420 * RULE.perPalletPerKm));
    const small = lastLegAmount({ ...STANDARD_CARGO, cbm: 0.2 }, { ...tpl, km_incheon: 0 }, 'ICN', { perPalletBase: 1000, perPalletPerKm: 0, minCharge: 50_000 }, QP);
    expect(small).toMatchObject({ amount: 50_000, minApplied: true });
    expect(() => lastLegAmount(STANDARD_CARGO, tpl, 'ICN', { ...RULE, perPalletPerKm: -1 }, QP)).toThrow(RangeError);
  });

  it('쿠팡 FC·기준값 없음이면 그대로(예전과 같은 값)', () => {
    expect(applyDestination(base, STANDARD_CARGO, fc, 'ICN', RULE, QP)).toBe(base);
    expect(applyDestination(base, STANDARD_CARGO, null, 'ICN', RULE, QP)).toBe(base);
    expect(applyDestination(base, STANDARD_CARGO, tpl, 'ICN', null, QP)).toBe(base);
  });

  it('3PL 이면 「FC 운송」만 거리 참고치로 바꾸고 합계를 다시 센다 — 참고치는 확정 합계 밖', () => {
    const out = applyDestination(base, STANDARD_CARGO, tpl, 'ICN', RULE, QP);
    const leg = lastLegAmount(STANDARD_CARGO, tpl, 'ICN', RULE, QP).amount;
    const oldLeg = base.segments.find((s) => s.segment === 'fc_delivery')!.amount!;
    const seg = out.segments.find((s) => s.segment === 'fc_delivery')!;
    expect(seg).toMatchObject({ amount: leg, certainty: 'estimated', filled: true, included: true });
    expect(out.total).toBe(base.total - oldLeg + leg);
    for (const s of out.segments) if (s.segment !== 'fc_delivery') expect(s).toEqual(base.segments.find((x) => x.segment === s.segment));
    const t = totalsBreakdown(out.segments);
    expect(t.confirmed + t.estimated + t.reference).toBe(out.total);
    expect(out.filled).toContain('fc_delivery');
    // 업체가 FC 운송을 확정으로 줬어도 3PL 목적지에서는 확정 합계에서 빠진다
    const confirmedLines = REFERENCE_LINES.map((l) => ({ ...l, certainty: 'confirmed' as const }));
    const c = computeQuote(confirmedLines, STANDARD_CARGO, QP);
    const c2 = applyDestination(c, STANDARD_CARGO, tpl, 'ICN', RULE, QP);
    expect(c2.confirmedTotal).toBe(c.confirmedTotal - c.segments.find((s) => s.segment === 'fc_delivery')!.amount!);
  });

  it('URL·요청 코드 — 쿠팡 FC·3PL·쇼핑몰 창고를 받고 이상한 값은 기본값', () => {
    expect(parseCargoQuery({ fc: 'TP-BSN' }).fc).toBe('TP-BSN');
    expect(parseCargoQuery({ fc: 'MK-GMP' }).fc).toBe('MK-GMP');
    expect(parseCargoQuery({ fc: 'FC-DGU' }).fc).toBe('FC-DGU');
    expect(parseCargoQuery({ fc: 'XX-ABC' }).fc).toBe('FC-ICH');
  });
});

// DB — 마이그레이션·시드·RLS -------------------------------------------------------

describe('이벤트 표와 목적지 참조표(DB)', () => {
  let db: Driver;
  let ids: { shipper: string; partner: string; admin: string };
  const today = todayKst();
  beforeAll(async () => {
    db = await hazardDb();
    const r = await seedDemo(db, { today, password: 'test-only-password' });
    ids = r.demoIds!;
  });
  afterAll(async () => {
    await db?.close();
  });

  it('목적지 참조표 — 쿠팡 FC 10곳 + 예시 3PL·쇼핑몰 창고, 설정 첫 판', async () => {
    const rows = await asRole(db, 'fcd_public', null, false, (q) => q.query<{ code: string; kind: string; is_example: boolean; name: string }>('select code, kind, is_example, name from fcd.v_destinations'));
    expect(rows.filter((x) => x.kind === 'coupang_fc')).toHaveLength(FC_CENTERS.length);
    expect(rows.filter((x) => x.kind === 'coupang_fc').every((x) => !x.is_example)).toBe(true);
    const ex = rows.filter((x) => x.kind !== 'coupang_fc');
    expect(ex).toHaveLength(DESTINATIONS.length);
    expect(ex.every((x) => x.is_example && x.name.includes('예시'))).toBe(true);
    const s = await db.query<{ value: LastLegRule }>(`select value from fcd.v_current_settings where key = 'destination_leg'`);
    expect(s[0].value).toEqual(RULE);
    // kind 는 정해진 값만
    await expect(db.exec(`insert into fcd.fc_centers (code, name, region, km_incheon, km_pyeongtaek, kind) values ('ZZ-ZZZ','x','x',1,1,'warehouse')`)).rejects.toThrow();
  });

  it('데모 시드가 기존 자료에서 이벤트를 만든다 — 요청·예약·선적·입고·청구 수가 원래 표와 같다', async () => {
    const n = async (sql: string) => (await db.query<{ n: number }>(sql))[0].n;
    const ev = (k: string) => n(`select count(*)::int n from fcd.events e join fcd.orgs o on o.id = e.org_id where o.is_demo and e.kind = '${k}'`);
    expect(await ev('quote_requested')).toBe(await n(`select count(*)::int n from fcd.quote_requests r join fcd.orgs o on o.id = r.org_id where o.is_demo`));
    expect(await ev('booked')).toBe(await n(`select count(*)::int n from fcd.bookings b join fcd.orgs o on o.id = b.shipper_org_id where o.is_demo`));
    expect(await ev('bid_selected')).toBe(await ev('booked'));
    expect(await ev('shipped')).toBe(await n(`select count(*)::int n from fcd.shipments where stage >= 5`));
    expect(await ev('fc_inbound')).toBe(await n(`select count(*)::int n from fcd.shipments where stage = 9`));
    expect(await ev('invoiced')).toBe(await n(`select count(*)::int n from fcd.invoices`));
    expect(await ev('returned')).toBe(await n(`select count(*)::int n from fcd.shipments where stage = 9 and fc_returned_units > 0`));
    expect(await ev('signed_up')).toBe(await n(`select count(*)::int n from fcd.orgs where is_demo and kind in ('shipper','partner')`));
    expect(await ev('bid_submitted')).toBeGreaterThan(0);
    // 멱등 — 두 번째는 넣지 않는다
    expect(await db.transaction((q) => seedDemoEvents(q))).toBe(0);
    // 이벤트 시각은 미래가 아니다
    expect(await n(`select count(*)::int n from fcd.events where occurred_at > now() + interval '1 minute'`)).toBe(0);
  });

  it('데모 건수 표에 events 가 있고 모두 데모 조직 아래', async () => {
    const c = (await db.transaction((q) => demoCounts(q))).find((x) => x.table === 'events')!;
    expect(c.demo).toBeGreaterThan(100);
    expect(c.real).toBe(0);
  });

  it('권한 — 비로그인은 못 보고, UPDATE·DELETE 권한이 없다', async () => {
    const grants = await db.query<{ grantee: string; privilege_type: string }>(
      `select grantee, privilege_type from information_schema.role_table_grants where table_schema = 'fcd' and table_name = 'events'`,
    );
    const g = grants.map((x) => `${x.grantee}:${x.privilege_type}`).sort();
    expect(g).toContain('fcd_user:INSERT');
    expect(g).toContain('fcd_user:SELECT');
    expect(g.some((x) => /UPDATE|DELETE|TRUNCATE/.test(x) && /fcd_|anon|authenticated|service_role|PUBLIC/.test(x))).toBe(false);
    await expect(asRole(db, 'fcd_public', null, true, (q) => q.query('select * from fcd.events limit 1'))).rejects.toThrow();
    await expect(asRole(db, 'fcd_user', ids.shipper, true, (q) => q.query(`update fcd.events set kind = 'booked'`))).rejects.toThrow();
    await expect(asRole(db, 'fcd_user', ids.shipper, true, (q) => q.query(`delete from fcd.events`))).rejects.toThrow();
    const rls = await db.query<{ r: boolean }>(`select relrowsecurity r from pg_class where oid = 'fcd.events'::regclass`);
    expect(rls[0].r).toBe(true);
  });

  it('읽기 — 운영자는 전부, 화주는 자기 조직이 한 일만, 데모가 꺼지면 데모 조직 것은 안 보인다', async () => {
    const all = (await db.query<{ n: number }>(`select count(*)::int n from fcd.events`))[0].n;
    const admin = await asRole(db, 'fcd_user', ids.admin, true, (q) => q.query<{ n: number }>(`select count(*)::int n from fcd.events`));
    expect(admin[0].n).toBe(all);
    const mine = await asRole(db, 'fcd_user', ids.shipper, true, (q) => q.query<{ org_id: string }>(`select distinct org_id from fcd.events`));
    const myOrgs = (await db.query<{ org_id: string }>(`select org_id from fcd.memberships where user_id = $1`, [ids.shipper])).map((x) => x.org_id);
    expect(mine.length).toBeGreaterThan(0);
    for (const m of mine) expect(myOrgs).toContain(m.org_id);
    const off = await asRole(db, 'fcd_user', ids.shipper, false, (q) => q.query<{ n: number }>(`select count(*)::int n from fcd.events`));
    expect(off[0].n).toBe(0);
  });

  it('쓰기 — 본인이 자기 조직 이름으로만, 걸린 일이 없는 셀러는 못 적는다', async () => {
    const shipperOrg = (await db.query<{ org_id: string }>(`select org_id from fcd.memberships where user_id = $1`, [ids.shipper]))[0].org_id;
    const partnerOrg = (await db.query<{ org_id: string }>(`select org_id from fcd.memberships where user_id = $1`, [ids.partner]))[0].org_id;
    const req = (await db.query<{ id: string }>(`select id from fcd.quote_requests where org_id = $1 limit 1`, [shipperOrg]))[0].id;
    // 화주 본인 — 자기 요청
    await asRole(db, 'fcd_user', ids.shipper, true, (q) =>
      q.query(`insert into fcd.events (org_id, seller_org_id, actor_id, kind, target_kind, target_id) values ($1,$1,$2,'quote_requested','quote_request',$3)`, [shipperOrg, ids.shipper, req]),
    );
    // 남의 이름(actor 다름)
    await expect(
      asRole(db, 'fcd_user', ids.shipper, true, (q) => q.query(`insert into fcd.events (org_id, actor_id, kind) values ($1,$2,'quote_requested')`, [shipperOrg, ids.partner])),
    ).rejects.toThrow();
    // 남의 조직 이름
    await expect(
      asRole(db, 'fcd_user', ids.shipper, true, (q) => q.query(`insert into fcd.events (org_id, actor_id, kind) values ($1,$2,'bid_submitted')`, [partnerOrg, ids.shipper])),
    ).rejects.toThrow();
    // 물류사가 거래 없는 셀러를 적는 것(예약도 없고 요청 대상도 아님)
    const stranger = (await db.query<{ id: string }>(
      `select o.id from fcd.orgs o where o.is_demo and o.kind = 'shipper'
         and not exists (select 1 from fcd.bookings b where b.shipper_org_id = o.id and b.partner_org_id = $1) limit 1`,
      [partnerOrg],
    ))[0];
    if (stranger) {
      await expect(
        asRole(db, 'fcd_user', ids.partner, true, (q) => q.query(`insert into fcd.events (org_id, seller_org_id, actor_id, kind) values ($1,$2,$3,'shipped')`, [partnerOrg, stranger.id, ids.partner])),
      ).rejects.toThrow();
    }
    // 물류사 — 예약이 있는 셀러의 선적
    const ship = (await db.query<{ id: string; shipper_org_id: string }>(`select id, shipper_org_id from fcd.shipments where partner_org_id = $1 limit 1`, [partnerOrg]))[0];
    await asRole(db, 'fcd_user', ids.partner, true, (q) =>
      q.query(`insert into fcd.events (org_id, seller_org_id, actor_id, kind, target_kind, target_id) values ($1,$2,$3,'shipped','shipment',$4)`, [partnerOrg, ship.shipper_org_id, ids.partner, ship.id]),
    );
    // 정해진 종류만
    await expect(
      asRole(db, 'fcd_user', ids.shipper, true, (q) => q.query(`insert into fcd.events (org_id, actor_id, kind) values ($1,$2,'something_else')`, [shipperOrg, ids.shipper])),
    ).rejects.toThrow();
  });

  it('운영 지표 읽기(adminMetrics) — 데모 자료에서 숫자가 나오고, 「예시 빼고」면 0', async () => {
    const { adminMetrics } = await import('@/lib/server/metrics');
    const { loadSettings } = await import('@/lib/server/settings');
    const m = await asRole(db, 'fcd_user', ids.admin, true, async (q) => adminMetrics(q, await loadSettings(q), today, true));
    expect(m.activeSellers.cur).toBeGreaterThan(0);
    expect(m.managed.cur).toBeGreaterThan(0);
    expect(m.managed.inFlight).toBeGreaterThan(0);
    expect(m.returns.cur.shipments).toBeGreaterThan(0);
    expect(m.billing.cur.n).toBeGreaterThan(0);
    expect(m.revenue.cur.perShipment).toBeGreaterThan(0);
    // 데모 시드 — 초대 링크로 연결된 물류사의 가입은 via = 'invite'
    const invitedAll = (await asRole(db, 'fcd_user', ids.admin, true, (q) =>
      q.query<{ n: number }>(`select count(*)::int n from fcd.events where kind = 'signed_up' and detail->>'via' = 'invite'`),
    ))[0].n;
    expect(invitedAll).toBe(1);
    expect(m.invite.cur.total).toBeGreaterThanOrEqual(m.invite.cur.invited);
    expect(m.repeat.cur.rate).not.toBeNull();
    expect(m.monthly.active).toHaveLength(6);
    const off = await asRole(db, 'fcd_user', ids.admin, true, async (q) => adminMetrics(q, await loadSettings(q), today, false));
    expect(off.totalEvents).toBe(0);
    expect(off.managed.cur).toBe(0);
  });

  it('비교 — 목적지가 3PL 이면 「FC 운송」이 거리 참고치, 쿠팡 FC 면 예전과 같은 합계', async () => {
    const { compare } = await import('@/lib/server/compare');
    const { loadSettings } = await import('@/lib/server/settings');
    const input = { hub: 'YIW', port: 'ICN', mode: null, cargo: STANDARD_CARGO, traits: [] as string[] };
    const [plain, fc, tpl] = await asRole(db, 'fcd_user', ids.shipper, true, async (q) => {
      const s = await loadSettings(q);
      return Promise.all([compare(q, input, s, today), compare(q, { ...input, fc: 'FC-ICH' }, s, today), compare(q, { ...input, fc: 'TP-BSN' }, s, today)]);
    });
    expect(plain.offers.length).toBeGreaterThan(0);
    expect(fc.offers.map((o) => o.quote.total)).toEqual(plain.offers.map((o) => o.quote.total));
    expect(fc.destination).toBeNull();
    expect(tpl.destination?.code).toBe('TP-BSN');
    const leg = lastLegAmount(STANDARD_CARGO, { code: 'TP-BSN', kind: '3pl', km_incheon: 420, km_pyeongtaek: 360 }, 'ICN', RULE, QP).amount;
    for (const o of tpl.offers) {
      const s = o.quote.segments.find((x) => x.segment === 'fc_delivery')!;
      expect(s).toMatchObject({ amount: leg, filled: true, certainty: 'estimated' });
    }
  });
});
