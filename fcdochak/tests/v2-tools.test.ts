/**
 * v2 tools — 가입 전 가치: 공개 판매손익 계산기(/tools/pnl)의 돈 계산·기준값·「구간 시세로 도착원가」 집계.
 * 화면 흐름은 e2e/v2-tools.spec.ts.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Driver } from '@/lib/db/driver';
import { seedDemo } from '@seed/demo';
import { SETTINGS, CARGO_TRAITS } from '@seed/reference/data';
import { setDbForTests } from '@/lib/db';
import {
  breakEvenPrice,
  estimateDutyVat,
  groupExclusions,
  medianOf,
  quantileOf,
  sellerPnl,
  sellerSensitivity,
  summarizeArrival,
  traitWarnings,
  unitPnl,
  type SellerPnlInput,
} from '@/lib/money';
import { basisLabel, parseFeeBasis, parseTraitNotes } from '@/lib/tools-settings';
import { buildArrivalResponse } from '@/lib/tools-arrival';
import { buildQuoteResponse } from '@/lib/public-quote';
import { STANDARD_CARGO } from '@/lib/standard-cargo';
import { asRole, hazardDb, todayKst } from './helpers';

vi.mock('server-only', () => ({}));

const base: SellerPnlInput = {
  units: 1200,
  price: 19_900,
  goodsKrw: 4_572_000,
  logisticsTotal: 1_200_000,
  freightToPortKrw: 600_000,
  extraCostTotal: 0,
  dutyRateBp: 800,
  vatRateBp: 1000,
  insuranceBp: 20,
  saleFeeBp: 1080,
  adBp: 0,
  inboundPerUnit: 700,
  shippingPerUnit: 2100,
};

describe('판매손익 — sellerPnl 은 unitPnl·breakEvenPrice 를 그대로 쓴다', () => {
  it('광고비 0 이면 기존 판매손익 식과 원 단위까지 같다', () => {
    const r = sellerPnl(base);
    const duty = estimateDutyVat({ goodsKrw: base.goodsKrw, freightToPortKrw: base.freightToPortKrw, insuranceBp: 20, dutyRateBp: 800, vatRateBp: 1000 });
    const same = unitPnl({
      price: 19_900,
      goodsPerUnit: Math.round(base.goodsKrw / 1200),
      logisticsPerUnit: 1000,
      dutyPerUnit: Math.round(duty.duty / 1200),
      saleFeeBp: 1080,
      fulfillmentPerUnit: 2800,
      vatRateBp: 1000,
    });
    expect(r.pnl).toEqual(same);
    expect(r.duty).toEqual(duty);
    expect(r.adCost).toBe(0);
    expect(r.saleFee).toBe(same.saleFee);
    expect(r.totalProfit).toBe(same.profit * 1200);
  });

  it('쪼갠 줄을 더하면 개당 이익과 같다(광고비·추가비용 포함)', () => {
    const r = sellerPnl({ ...base, adBp: 750, extraCostTotal: 90_000 });
    const sum =
      r.pnl.netRevenue - r.saleFee - r.adCost - r.inbound - r.shipping - r.goodsPerUnit - r.logisticsPerUnit - r.extraPerUnit - r.dutyPerUnit;
    expect(sum).toBe(r.pnl.profit);
    expect(r.adCost).toBe(Math.round((19_900 * 750) / 10_000));
    expect(r.extraPerUnit).toBe(75);
    expect(r.arrivalPerUnit).toBe(r.goodsPerUnit + r.logisticsPerUnit + r.extraPerUnit + r.dutyPerUnit);
  });

  it('광고비는 판매가 비례 비용 — 광고비율을 올리면 손익분기 판매가가 오른다', () => {
    const a = sellerPnl(base);
    const b = sellerPnl({ ...base, adBp: 1000 });
    expect(b.breakEvenPrice).toBeGreaterThan(a.breakEvenPrice);
    expect(b.breakEvenPrice).toBe(breakEvenPrice(b.base));
    // 손익분기 가격에서 이익은 0 이상, 10원 아래에서는 음수
    const at = sellerPnl({ ...base, adBp: 1000, price: b.breakEvenPrice });
    expect(at.pnl.profit).toBeGreaterThanOrEqual(0);
    const below = sellerPnl({ ...base, adBp: 1000, price: b.breakEvenPrice - 10 });
    expect(below.pnl.profit).toBeLessThan(0);
  });

  it('수수료+광고가 매출을 다 먹으면 손익분기 없음(무한대)', () => {
    const r = sellerPnl({ ...base, saleFeeBp: 6000, adBp: 4000 });
    expect(r.breakEvenPrice).toBe(Number.POSITIVE_INFINITY);
  });

  it('민감도표는 pnl.ts 의 sensitivity — 가운데 칸 = 지금 이익', () => {
    const r = sellerPnl({ ...base, extraCostTotal: 12_000 });
    const s = sellerSensitivity(r);
    const li = s.logisticsSteps.indexOf(0);
    const pi = s.priceSteps.indexOf(0);
    expect(s.profit[li][pi]).toBe(r.pnl.profit);
    // 물류비가 늘면 이익이 준다
    expect(s.profit[s.logisticsSteps.length - 1][pi]).toBeLessThan(r.pnl.profit);
  });

  it('잘못된 값은 막는다', () => {
    expect(() => sellerPnl({ ...base, units: 0 })).toThrow();
    expect(() => sellerPnl({ ...base, price: Number.NaN })).toThrow();
    expect(() => sellerPnl({ ...base, extraCostTotal: -1 })).toThrow();
  });
});

describe('도착원가 집계 — 업체별 금액 없이 중간값만', () => {
  it('중간값·4분의 1', () => {
    expect(medianOf([])).toBe(0);
    expect(medianOf([3, 1, 2])).toBe(2);
    expect(medianOf([1, 2, 3, 5])).toBe(3);
    expect(quantileOf([10, 20, 30, 40, 50], 0.25)).toBe(20);
  });
  it('summarizeArrival', () => {
    const mk = (total: number, toPort: number) => ({ total, toPort, segments: [{ segment: 'freight', amount: toPort }, { segment: 'broker', amount: total - toPort }] });
    const s = summarizeArrival([mk(100, 40), mk(300, 100), mk(200, 60)]);
    expect(s).toMatchObject({ count: 3, median: 200, min: 100, toPortMedian: 60 });
    expect(s.segmentMedians).toEqual({ freight: 60, broker: 140 });
    expect(s.segmentMedianSum).toBe(200);
    expect(summarizeArrival([])).toMatchObject({ count: 0, median: 0, min: 0 });
  });
  it('사유별로 묶기', () => {
    const g = groupExclusions([
      { name: '나', reasons: ['배터리 취급 등록 없음'] },
      { name: '가', reasons: ['배터리 취급 등록 없음', '위험물 취급 등록 없음'] },
    ]);
    expect(g[0]).toEqual({ reason: '배터리 취급 등록 없음', count: 2, names: ['가', '나'] });
    expect(g[1].count).toBe(1);
  });
});

describe('화물 특성 → 추가비용 경고', () => {
  const rules = CARGO_TRAITS.map((t) => ({ code: t.code, name: t.name_ko, needsCapability: t.needs_capability, blockedModes: t.blocked_modes }));
  const notes = parseTraitNotes(SETTINGS.find((s) => s.key === 'tools.trait_extra_costs')!.value);
  it('참조 시드에 모든 특성의 추가비용 항목이 있다(금액 없이 글로)', () => {
    for (const t of CARGO_TRAITS) {
      const n = notes.find((x) => x.trait === t.code);
      expect(n?.items.length, t.code).toBeGreaterThan(0);
      for (const i of n!.items) expect(i).not.toMatch(/\d+\s*원/); // 모르는 금액을 지어내지 않는다
    }
  });
  it('고른 특성만, 방식 제한·등록 필요도 같이', () => {
    const w = traitWarnings(['battery', 'nope'], rules, notes);
    expect(w).toHaveLength(1);
    expect(w[0]).toMatchObject({ trait: 'battery', name: '배터리', blockedModes: ['AIR'], needsCapability: true });
    expect(w[0].items.join()).toMatch(/UN38\.3/);
    expect(traitWarnings([], rules, notes)).toEqual([]);
    // 표에 없는 특성도 방식 제한은 알린다
    expect(traitWarnings(['dg'], rules, [])[0]).toMatchObject({ items: [], blockedModes: ['AIR', 'FERRY'] });
  });
});

describe('쿠팡 기준값 — 설정 표에서, 「예시 기준값 · 확인일」', () => {
  const seeded = SETTINGS.find((s) => s.key === 'tools.coupang_fee_basis')!;
  const fallback = { saleFeeBp: 1080, fulfillmentPerUnit: 2800 };
  it('참조 시드는 예시로 표시되고 확인일이 있다', () => {
    const b = parseFeeBasis(seeded.value, fallback);
    expect(b.fromSettings).toBe(true);
    expect(b.example).toBe(true);
    expect(b.checkedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(basisLabel(b)).toBe(`예시 기준값 · 확인일 ${b.checkedOn}`);
    // 기존 판매손익 기준값과 어긋나지 않게(같은 수수료, 입출고+배송 = 개당 풀필먼트)
    expect(b.saleFeeBp).toBe(SETTINGS.find((s) => s.key === 'sale_fee_bp')!.value);
    expect(b.rgInboundPerUnit + b.rgShippingPerUnit).toBe(SETTINGS.find((s) => s.key === 'fulfillment_per_unit')!.value);
  });
  it('키가 없거나 모양이 틀리면 옛 기본값 + 「확인일 없음」', () => {
    for (const bad of [undefined, null, 3, [], { saleFeeBp: -1, rgInboundPerUnit: 0, rgShippingPerUnit: 0 }]) {
      const b = parseFeeBasis(bad, fallback);
      expect(b).toMatchObject({ saleFeeBp: 1080, rgInboundPerUnit: 0, rgShippingPerUnit: 2800, fromSettings: false, example: true, checkedOn: null });
      expect(basisLabel(b)).toBe('예시 기준값 · 확인일 없음');
    }
  });
  it('「확인한 기준값」은 example:false 와 확인일이 함께 있을 때만', () => {
    const v = { ...(seeded.value as object), example: false };
    expect(parseFeeBasis(v, fallback).example).toBe(false);
    expect(parseFeeBasis({ ...v, checkedOn: null }, fallback).example).toBe(true);
  });
  it('계산 코드에 쿠팡 요율 숫자를 박지 않는다', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const root = path.resolve(__dirname, '..');
    for (const f of ['src/lib/money/seller.ts', 'src/lib/tools-settings.ts', 'src/app/(public)/tools/pnl/tool.tsx', 'src/app/(public)/tools/pnl/page.tsx']) {
      const s = fs.readFileSync(path.join(root, f), 'utf8');
      expect(s, f).not.toMatch(/\b(1080|2100|700)\b/);
    }
  });
});

describe('구간 시세로 도착원가 — DB(데모) 위에서', () => {
  let db: Driver;
  const today = todayKst();
  const oldDemo = process.env.DEMO_MODE;
  beforeAll(async () => {
    db = await hazardDb();
    await seedDemo(db, { today, password: 'test-only-password' });
    process.env.DEMO_MODE = 'on';
    setDbForTests(db);
  });
  afterAll(async () => {
    setDbForTests(undefined);
    if (oldDemo == null) delete process.env.DEMO_MODE;
    else process.env.DEMO_MODE = oldDemo;
    await db.close();
  });

  it('비로그인도 도구 기준값을 읽는다(설정 표)', async () => {
    const { publicToolBasis } = await import('@/lib/server/tools');
    const b = await publicToolBasis();
    expect(b.fee.fromSettings).toBe(true);
    expect(b.fee.example).toBe(true);
    expect(b.traitNotes.length).toBe(CARGO_TRAITS.length);
    expect(b.dutyRates.length).toBeGreaterThan(0);
    const rows = await asRole(db, 'fcd_public', null, true, (q) =>
      q.query<{ key: string }>(`select key from fcd.v_current_settings where key like 'tools.%' order by key`),
    );
    expect(rows.map((r) => r.key)).toEqual(['tools.coupang_fee_basis', 'tools.trait_extra_costs']);
  });

  it('구간 시세 중간값과 같은 규칙 — 기준 화물이면 구간 시세 총액 중간값과 같다', async () => {
    const { arrivalEstimate } = await import('@/lib/server/tools');
    const { laneStats } = await import('@/lib/server/public');
    const lanes = await laneStats();
    expect(lanes.length).toBeGreaterThan(0);
    const l = lanes.find((x) => x.hub === 'YIW' && x.port === 'ICN') ?? lanes[0];
    const a = await arrivalEstimate({ hub: l.hub, port: l.port, mode: l.mode, cargo: STANDARD_CARGO, traits: [] });
    expect(a.count).toBe(l.cards);
    expect(a.median).toBe(l.median);
    expect(a.min).toBe(l.min);
    expect(a.segments).toHaveLength(9);
    expect(a.toPortMedian).toBeGreaterThan(0);
    expect(a.toPortMedian).toBeLessThan(a.median);
    expect(a.excluded).toEqual([]);
  });

  it('취급 못 하는 특성이면 그 업체는 빠지고 이름·사유만 남는다(가격 없음)', async () => {
    const { arrivalEstimate } = await import('@/lib/server/tools');
    const { laneStats } = await import('@/lib/server/public');
    const lanes = await laneStats();
    let found = false;
    for (const l of lanes) {
      const plain = await arrivalEstimate({ hub: l.hub, port: l.port, mode: l.mode, cargo: STANDARD_CARGO, traits: [] });
      const dg = await arrivalEstimate({ hub: l.hub, port: l.port, mode: l.mode, cargo: STANDARD_CARGO, traits: ['dg', 'battery'] });
      if (dg.excluded.length === 0) continue;
      found = true;
      expect(dg.count).toBeLessThan(plain.count);
      for (const e of dg.excluded) {
        expect(Object.keys(e).sort()).toEqual(['mode', 'name', 'reasons']);
        expect(e.reasons.length).toBeGreaterThan(0);
        for (const r of e.reasons) expect(r).toMatch(/위험물|배터리/);
      }
      expect(dg.excludedGroups.reduce((a, g) => a + g.count, 0)).toBeGreaterThan(0);
      expect(dg.verdicts.map((v) => v.code).sort()).toEqual(['battery', 'dg']);
      break;
    }
    expect(found).toBe(true);
  });

  it('응답에는 업체별 금액이 없다', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const offer = (name: string, total: number, exclusions: any[] = []) => ({
      partner: { id: name, name, name_zh: null, slug: name, status: 'official', business_type: null, logo_path: null, related_party_note: null, is_demo: false },
      mode: 'LCL',
      exclusions,
      quote: { total, segments: [{ segment: 'freight', amount: total, certainty: 'confirmed', filled: false }] },
    });
    const r = buildArrivalResponse(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { offers: [offer('a', 100), offer('b', 300)], excluded: [offer('c', 50, [{ kind: 'capability', trait: 'dg', traitName: '위험물' }]), offer('d', 70, [{ kind: 'withdrawn' }])], verdicts: [] } as any,
      { okOrg: () => true, units: 10 },
    );
    expect(r.median).toBe(200);
    expect(r.perUnitMedian).toBe(20);
    expect(r.excluded).toEqual([{ name: 'c', mode: 'LCL', reasons: ['위험물 취급 등록 없음'] }]); // 거둔 요금표는 도구에서 다루지 않는다
    expect(JSON.stringify(r)).not.toMatch(/"total"/);
    expect(JSON.stringify(r.excluded)).not.toMatch(/50/);
  });

  it('홈 계산기 응답에도 뺀 업체 이름·사유가 실린다(가격 없음)', () => {
    const r = buildQuoteResponse(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { offers: [], excluded: [{ partner: { name: '가람' }, mode: 'AIR', exclusions: [{ kind: 'mode_blocked', trait: 'battery', traitName: '배터리', mode: 'AIR' }] }], verdicts: [] } as any,
      { sort: 'cheapest', includeRelated: false, detail: false },
    );
    expect(r.excluded).toBe(1);
    expect(r.excludedList).toEqual([{ name: '가람', mode: 'AIR', reasons: ['배터리은(는) 이 운송 방식으로 보낼 수 없음'] }]);
  });
});
