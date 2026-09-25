import { describe, expect, it } from 'vitest';
import {
  SEGMENTS,
  billingDeviation,
  breakEvenPrice,
  chargeableQty,
  commissionAmount,
  commissionBase,
  completeWithReference,
  computeQuote,
  daysUntil,
  estimateDutyVat,
  exclusionReasons,
  goodsValueKrw,
  isFcReady,
  lineAmount,
  perUnitCost,
  recommendScore,
  scoreParts,
  sensitivity,
  sumAmounts,
  unitPnl,
  type Cargo,
  type QuoteParams,
  type RateLine,
} from '@/lib/money';
import { divRoundHalfUp, toScaled } from '@/lib/money/decimal';

const P: QuoteParams = {
  fx: { KRW: 1, RMB: 190.5, USD: 1380 },
  volumetricKgPerCbm: 167,
  palletCbm: 1.5,
  containerCbm: 28,
};

const cargo: Cargo = { units: 1200, cartons: 40, kg: 820, cbm: 3.6, goodsValue: 36000, goodsCurrency: 'RMB' };

const L = (o: Partial<RateLine> & Pick<RateLine, 'segment' | 'basis' | 'unitPrice'>): RateLine => ({
  included: true,
  currency: 'KRW',
  certainty: 'confirmed',
  ...o,
});

describe('정수 산술', () => {
  it('부동소수 꼬리 없이 스케일한다', () => {
    expect(toScaled(0.1 + 0.2, 2)).toBe(30n);
    expect(toScaled(190.5, 4)).toBe(1_905_000n);
    expect(toScaled(-1.005, 2)).toBe(-100n); // toFixed 규칙 그대로
  });
  it('0.5 는 올림, 음수는 대칭', () => {
    expect(divRoundHalfUp(5n, 10n)).toBe(1n);
    expect(divRoundHalfUp(4n, 10n)).toBe(0n);
    expect(divRoundHalfUp(-5n, 10n)).toBe(-1n);
  });
});

describe('청구 수량', () => {
  it('R/T 는 CBM 과 톤 중 큰 값', () => {
    expect(chargeableQty('per_rt', cargo, P)).toBe(3.6);
    expect(chargeableQty('per_rt', { ...cargo, kg: 5200 }, P)).toBe(5.2);
  });
  it('항공 청구중량은 실중량과 부피중량 중 큰 값', () => {
    expect(chargeableQty('per_chargeable_kg', cargo, P)).toBe(820);
    expect(chargeableQty('per_chargeable_kg', { ...cargo, kg: 100 }, P)).toBeCloseTo(601.2);
  });
  it('팔레트·컨테이너는 올림', () => {
    expect(chargeableQty('per_pallet', cargo, P)).toBe(3);
    expect(chargeableQty('per_container', { ...cargo, cbm: 28 }, P)).toBe(1);
    expect(chargeableQty('per_container', { ...cargo, cbm: 28.01 }, P)).toBe(2);
  });
});

describe('한 줄 금액', () => {
  it('RMB 단가 × 환율 × 수량', () => {
    // 3.6 CBM × 120 RMB × 190.5 = 82,296
    expect(lineAmount(L({ segment: 'freight', basis: 'per_cbm', unitPrice: 120, currency: 'RMB' }), cargo, P).amount).toBe(
      82_296,
    );
  });
  it('최저요금이 이긴다', () => {
    const r = lineAmount(L({ segment: 'pickup', basis: 'per_cbm', unitPrice: 5000, minCharge: 50000 }), cargo, P);
    expect(r.amount).toBe(50_000);
    expect(r.minApplied).toBe(true);
  });
  it('구간 할인표 — 가장 높은 문턱 하나만', () => {
    const tiers = [
      { segment: 'freight' as const, minQty: 2, discountBp: 500 },
      { segment: 'freight' as const, minQty: 3, discountBp: 1000 },
      { segment: 'freight' as const, minQty: 10, discountBp: 2000 },
    ];
    const r = lineAmount(L({ segment: 'freight', basis: 'per_cbm', unitPrice: 100000 }), cargo, P, tiers);
    expect(r.discountBp).toBe(1000);
    expect(r.amount).toBe(324_000);
  });
  it('물품가 퍼센트', () => {
    // 36,000 RMB × 190.5 = 6,858,000 원, 0.3% = 20,574
    expect(goodsValueKrw(cargo, P.fx)).toBe(6_858_000);
    expect(lineAmount(L({ segment: 'return_reserve', basis: 'percent_goods', unitPrice: 0.3 }), cargo, P).amount).toBe(20_574);
  });
});

describe('견적 합계', () => {
  const lines: RateLine[] = [
    L({ segment: 'pickup', basis: 'per_shipment', unitPrice: 300, currency: 'RMB' }),
    L({ segment: 'cn_warehouse', basis: 'per_carton', unitPrice: 5, currency: 'RMB' }),
    L({ segment: 'export_customs', basis: 'per_shipment', unitPrice: 250, currency: 'RMB' }),
    L({ segment: 'freight', basis: 'per_rt', unitPrice: 95000 }),
    L({ segment: 'port', basis: 'per_rt', unitPrice: 38000, certainty: 'estimated' }),
    L({ segment: 'broker', basis: 'per_shipment', unitPrice: 33000 }),
    L({ segment: 'kr_warehouse', basis: 'per_carton', unitPrice: 1500 }),
    L({ segment: 'fc_delivery', basis: 'per_pallet', unitPrice: 45000, certainty: 'extra_possible' }),
    { ...L({ segment: 'return_reserve', basis: 'per_carton', unitPrice: 500 }), included: false },
  ];
  const q = computeQuote(lines, cargo, P);

  it('9구간 순서 그대로 나온다', () => {
    expect(q.segments.map((s) => s.segment)).toEqual([...SEGMENTS]);
  });
  it('합계 = 구간 금액의 합, 개당 원가 = 합계 ÷ 수량', () => {
    const expected = 57150 + 38100 + 47625 + 342000 + 136800 + 33000 + 60000 + 135000;
    expect(q.total).toBe(expected);
    expect(sumAmounts(Object.fromEntries(q.segments.map((s) => [s.segment, s.amount])))).toBe(q.total);
    expect(q.perUnit).toBe(Math.round(expected / 1200));
  });
  it('확정 + 예상 = 합계, 추가비용 가능 구간을 알려준다', () => {
    expect(q.confirmedTotal + q.estimatedTotal).toBe(q.total);
    expect(q.extraPossible).toEqual(['fc_delivery']);
    expect(q.excluded).toEqual(['return_reserve']);
  });
  it('같은 조건 비교 — 빈 구간은 참고치로 채우고 확정 합계엔 넣지 않는다', () => {
    const c = completeWithReference(q, { return_reserve: 20000 }, cargo.units);
    expect(c.total).toBe(q.total + 20000);
    expect(c.confirmedTotal).toBe(q.confirmedTotal);
    expect(c.filled).toEqual(['return_reserve']);
    expect(c.excluded).toEqual([]);
  });
  it('개당 원가는 수량 0 을 거부', () => {
    expect(() => perUnitCost(1000, 0)).toThrow();
  });
});

describe('성사 수수료 기준 — 관세사 보수를 뺀다', () => {
  const amounts = {
    pickup: 50000,
    cn_warehouse: 30000,
    export_customs: 40000,
    freight: 300000,
    port: 100000,
    broker: 33000,
    kr_warehouse: 60000,
    fc_delivery: 120000,
    return_reserve: 20000,
  };
  it('기준 = 합계 − 관세사', () => {
    expect(commissionBase(amounts)).toBe(sumAmounts(amounts) - 33000);
  });
  it('관세사 보수가 얼마든 기준은 그대로', () => {
    expect(commissionBase({ ...amounts, broker: 9_999_999 })).toBe(commissionBase(amounts));
    expect(commissionBase({ ...amounts, broker: null })).toBe(commissionBase(amounts));
  });
  it('관세·부가세는 물류비 구간이 아니라 들어올 자리가 없다', () => {
    const withTax = { ...amounts, duty: 500000, vat: 700000 } as unknown as typeof amounts;
    expect(commissionBase(withTax)).toBe(commissionBase(amounts));
  });
  it('수수료 = 기준 × 요율', () => {
    expect(commissionAmount(amounts, 300)).toBe(Math.round((commissionBase(amounts) * 300) / 10000));
    expect(() => commissionAmount(amounts, 5000)).toThrow();
    expect(() => commissionAmount({ freight: -1 }, 300)).toThrow();
  });
});

describe('관세·부가세 참고 추정', () => {
  it('CIF 기준, 원 미만 절사', () => {
    const d = estimateDutyVat({
      goodsKrw: 6_858_000,
      freightToPortKrw: 484_875,
      insuranceBp: 20,
      dutyRateBp: 800,
      vatRateBp: 1000,
    });
    expect(d.insurance).toBe(14_685);
    expect(d.customsValue).toBe(6_858_000 + 484_875 + 14_685);
    expect(d.duty).toBe(Math.floor(d.customsValue * 0.08));
    expect(d.vat).toBe(Math.floor((d.customsValue + d.duty) * 0.1));
    expect(d.isEstimate).toBe(true);
  });
  it('음수 입력 거부', () => {
    expect(() => estimateDutyVat({ goodsKrw: -1, freightToPortKrw: 0, insuranceBp: 0, dutyRateBp: 0, vatRateBp: 0 })).toThrow();
  });
});

describe('판매손익', () => {
  const base = {
    price: 19900,
    goodsPerUnit: 5715,
    logisticsPerUnit: 704,
    dutyPerUnit: 490,
    saleFeeBp: 1080,
    fulfillmentPerUnit: 2800,
    vatRateBp: 1000,
  };
  it('이익 = 부가세 뺀 매출 − 수수료 − 원가', () => {
    const r = unitPnl(base);
    expect(r.netRevenue).toBe(18091);
    expect(r.saleFee).toBe(2149);
    expect(r.profit).toBe(18091 - 2149 - (5715 + 704 + 490 + 2800));
  });
  it('손익분기 판매가에서 이익 ≥ 0, 10원 아래에선 음수', () => {
    const be = breakEvenPrice(base);
    expect(be % 10).toBe(0);
    expect(unitPnl({ ...base, price: be }).profit).toBeGreaterThanOrEqual(0);
    expect(unitPnl({ ...base, price: be - 10 }).profit).toBeLessThan(0);
  });
  it('민감도표 가운데 칸 = 기준 이익', () => {
    const s = sensitivity(base);
    expect(s.profit[2][2]).toBe(unitPnl(base).profit);
    expect(s.profit.length).toBe(6);
  });
});

describe('추천 점수', () => {
  const caps = { deviationCap: 0.1, fcReturnCap: 0.1 };
  it('가중치 30·25·25·20, 만점 100', () => {
    expect(recommendScore({ onTimeRate: 1, avgDeviation: 0, fcReturnRate: 0, priceCertainty: 1 }, caps)).toBe(100);
    expect(recommendScore({ onTimeRate: 0, avgDeviation: 0.2, fcReturnRate: 0.5, priceCertainty: 0 }, caps)).toBe(0);
    const p = scoreParts({ onTimeRate: 1, avgDeviation: 0.1, fcReturnRate: 0.1, priceCertainty: 0 }, caps);
    expect(p).toEqual({ onTime: 30, deviation: 0, fcReturn: 0, certainty: 0 });
  });
  it('광고·특수관계를 넣어도 점수가 안 바뀐다', () => {
    const i = { onTimeRate: 0.9, avgDeviation: 0.02, fcReturnRate: 0.01, priceCertainty: 0.8 };
    const withAd = { ...i, isAd: true, relatedParty: true } as typeof i;
    expect(recommendScore(withAd, caps)).toBe(recommendScore(i, caps));
  });
  it('실측 없음은 중립', () => {
    expect(recommendScore({ onTimeRate: null, avgDeviation: null, fcReturnRate: null, priceCertainty: 0.5 }, caps)).toBe(50);
  });
  it('청구 편차', () => {
    expect(billingDeviation(100000, 108000)).toBeCloseTo(0.08);
    expect(() => billingDeviation(0, 1)).toThrow();
  });
  it('FC 입고 준비 인증 — 60건 이상 · 30일 회송률 3.5% 이하', () => {
    const rule = { minFcInbound: 60, maxReturnRate30d: 0.035 };
    expect(isFcReady(60, 0.035, rule)).toBe(true);
    expect(isFcReady(59, 0.01, rule)).toBe(false);
    expect(isFcReady(200, 0.036, rule)).toBe(false);
    expect(isFcReady(200, null, rule)).toBe(false);
  });
});

describe('사전 판정', () => {
  const rules = [
    { code: 'battery', name: '배터리', needsCapability: true, blockedModes: ['AIR'] },
    { code: 'dg_gas', name: '가스 위험물', needsCapability: true, blockedModes: ['AIR', 'FERRY'] },
    { code: 'kc', name: 'KC', needsCapability: false, blockedModes: [] },
  ];
  const c = { orgId: 'x', capabilities: ['battery'], mode: 'LCL', validFrom: '2026-09-01', validTo: '2026-10-31', status: 'active' as const };
  it('취급 가능하면 사유 없음', () => {
    expect(exclusionReasons(c, ['battery', 'kc'], rules, '2026-09-25')).toEqual([]);
  });
  it('만료·능력 없음·방식 불가를 모두 적는다', () => {
    const r = exclusionReasons({ ...c, mode: 'FERRY', validTo: '2026-09-24' }, ['dg_gas'], rules, '2026-09-25');
    expect(r.map((x) => x.kind)).toEqual(['expired', 'mode_blocked']);
    expect(exclusionReasons(c, ['dg_gas'], rules, '2026-09-25').map((x) => x.kind)).toEqual(['capability']);
  });
  it('남은 날', () => {
    expect(daysUntil('2026-10-05', '2026-09-25')).toBe(10);
    expect(daysUntil('2026-09-24', '2026-09-25')).toBe(-1);
  });
});

import { cleanDatabaseUrl } from '@/lib/db/driver';
describe('DB 연결 문자열', () => {
  it('Vercel·Supabase 연동이 붙이는 도구용 매개변수를 뗀다', () => {
    const u = cleanDatabaseUrl('postgres://postgres.abc:pw@aws-0-ap-northeast-2.pooler.supabase.com:6543/postgres?sslmode=require&supa=base-pooler.x&pgbouncer=true');
    expect(u).toContain('sslmode=require');
    expect(u).not.toContain('supa=');
    expect(u).not.toContain('pgbouncer');
  });
});
