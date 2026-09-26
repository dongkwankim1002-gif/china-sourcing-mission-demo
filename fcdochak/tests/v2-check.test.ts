/**
 * v2 check — 청구서 점검. 항목 분류·붙여넣기 읽기·비교 계산(순수 함수)과 보관 표(RLS·새 판)·데모 시드.
 * 화면 흐름은 e2e/v2-check.spec.ts.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Driver } from '@/lib/db/driver';
import { seedDemo } from '@seed/demo';
import { SETTINGS } from '@seed/reference/data';
import {
  benchmarkFrom,
  checkInvoice,
  distribution,
  groupLines,
  showSpread,
  SEGMENTS,
  toKrw,
  type Benchmark,
  type InvoiceCheckRule,
  type InvoiceLine,
  type QuoteParams,
  type RateLine,
  type Segment,
} from '@/lib/money';
import { classifyItem, detectCurrency, lineFromRow, parseInvoiceText } from '@/lib/invoice-parse';
import { laneMarket, marketFromCards, parseInvoiceCheckRule } from '@/lib/invoice-market';
import { CheckInput } from '@/lib/invoice-check-input';
import { checkHeadline, segmentFinding, totalFinding } from '@/lib/check-text';
import { demoCounts, DEMO_TABLES } from '@/lib/server/demo-status';
import { STANDARD_CARGO } from '@/lib/standard-cargo';
import { asRole, hazardDb, todayKst } from './helpers';

const FX = { KRW: 1, RMB: 190.5, USD: 1380 };
const RULE: InvoiceCheckRule = { minSamples: 3, highOverMedianBp: 2000, lowUnderMedianBp: 3000, missingCoverageBp: 5000, publicPerMinute: 20, minSpreadSamples: 4 };
const none: Benchmark = { source: 'none', n: 0, median: null, q1: null, q3: null, min: null, coverageBp: null };
const mkt = (median: number, q1: number, q3: number, min: number, n = 10, coverageBp = 10000): Benchmark => ({ source: 'market', n, median, q1, q3, min, coverageBp });
const bench = (over: Partial<Record<Segment, Benchmark>>) => Object.fromEntries(SEGMENTS.map((s) => [s, over[s] ?? none])) as Record<Segment, Benchmark>;
const line = (label: string, amount: number, segment: InvoiceLine['segment'], currency: InvoiceLine['currency'] = 'KRW'): InvoiceLine => ({ label, amount, currency, segment });

describe('항목 이름 → 9구간', () => {
  const cases: [string, ReturnType<typeof classifyItem>][] = [
    ['중국 내륙 집하', 'pickup'],
    ['Pick-up charge', 'pickup'],
    ['提货费', 'pickup'],
    ['창고 입고·검수', 'cn_warehouse'],
    ['贴标 打包', 'cn_warehouse'],
    ['수출 통관', 'export_customs'],
    ['出口报关费', 'export_customs'],
    ['LCL 해상운임', 'freight'],
    ['O/F', 'freight'],
    ['유류할증료 BAF', 'freight'],
    ['海运费', 'freight'],
    ['카페리 운임', 'freight'],
    ['THC·CFS', 'port'],
    ['D/O fee', 'port'],
    ['관세사 통관수수료', 'broker'],
    ['통관 수수료', 'broker'],
    ['韩国报关行', 'broker'],
    ['국내 창고 입고 작업', 'kr_warehouse'],
    ['3PL 보관료', 'kr_warehouse'],
    ['쿠팡 FC 입고 운송', 'fc_delivery'],
    ['밀크런', 'fc_delivery'],
    ['FC 회송 대비', 'return_reserve'],
    ['관세', 'tax'],
    ['부가세', 'tax'],
    ['VAT', 'tax'],
    ['기타 비용', null],
  ];
  it.each(cases)('%s → %s', (label, seg) => {
    expect(classifyItem(label)).toBe(seg);
  });
  it('관세사는 세금이 아니고, 수출통관은 관세사가 아니며, 국내 창고는 중국 창고가 아니다', () => {
    expect(classifyItem('관세사 보수')).toBe('broker');
    expect(classifyItem('수출통관 대행')).toBe('export_customs');
    expect(classifyItem('국내 창고 작업')).toBe('kr_warehouse');
    expect(classifyItem('중국 창고 작업')).toBe('cn_warehouse');
  });
});

describe('붙여넣은 표 읽기', () => {
  it('탭 표 — 머리글·합계 줄은 빼고, 통화는 칸·기호·기본값 순', () => {
    const t = ['항목\t금액\t통화', '중국 내륙 집하\t350\tRMB', 'LCL 해상운임\t262,000\t원', '달러 운임 할증\t$60', 'THC  95,000', '합계\t999,999\t원', '소계 12,000'].join('\n');
    const got = parseInvoiceText(t, 'KRW');
    expect(got.map((g) => [g.label, g.amount, g.currency, g.segment])).toEqual([
      ['중국 내륙 집하', 350, 'RMB', 'pickup'],
      ['LCL 해상운임', 262000, 'KRW', 'freight'],
      ['달러 운임 할증', 60, 'USD', 'freight'],
      ['THC', 95000, 'KRW', 'port'],
    ]);
  });
  it('수량×단가=금액 줄은 마지막 숫자를 금액으로, 음수(할인)도 읽는다', () => {
    const got = parseInvoiceText('해상운임 3 CBM × 60,000 = 180,000\n할인 -10,000원', 'KRW');
    expect(got[0].amount).toBe(180000);
    expect(got[0].segment).toBe('freight');
    expect(got[1].amount).toBe(-10000);
  });
  it('통화를 금액 앞에 적어도 읽는다(중국 포워더 청구서) — 항목 이름에서는 뺀다', () => {
    const got = parseInvoiceText('해상운임 USD 1,200\nO/F\tUSD\t850\n수출통관 RMB 300\n보관 CNY: 90\n인원 3 12,000', 'KRW');
    expect(got.map((g) => [g.label, g.amount, g.currency, g.segment])).toEqual([
      ['해상운임', 1200, 'USD', 'freight'],
      ['O/F', 850, 'USD', 'freight'],
      ['수출통관', 300, 'RMB', 'export_customs'],
      ['보관', 90, 'RMB', 'kr_warehouse'],
      ['인원 3', 12000, 'KRW', null],
    ]);
  });
  it('숫자 없는 줄뿐이면 빈 목록, 기본 통화는 위안으로도', () => {
    expect(parseInvoiceText('안녕하세요\n청구서입니다')).toEqual([]);
    expect(parseInvoiceText('창고 작업 280', 'RMB')[0].currency).toBe('RMB');
  });
  it('통화 알아보기', () => {
    expect(detectCurrency('¥3,600')).toBe('RMB');
    expect(detectCurrency('USD 200')).toBe('USD');
    expect(detectCurrency('12,000원')).toBe('KRW');
    expect(detectCurrency('12,000')).toBeNull();
  });
  it('엑셀 한 줄', () => {
    expect(lineFromRow({ item: '수출 통관', amount: 300, currency: 'RMB' })).toEqual({ label: '수출 통관', amount: 300, currency: 'RMB', segment: 'export_customs' });
    expect(lineFromRow({ item: '합계', amount: 1 })).toBeNull();
    expect(lineFromRow({ item: '', amount: 1 })).toBeNull();
  });
});

describe('비교 계산(순수 함수)', () => {
  it('분포 — 가까운 순위 분위수', () => {
    expect(distribution([])).toBeNull();
    expect(distribution([5, 1, 3, 2, 4])).toEqual({ n: 5, min: 1, q1: 2, median: 3, q3: 4, max: 5 });
    expect(distribution([100, 200])!.median).toBe(150);
  });
  it('원 환산은 원 단위 반올림', () => {
    expect(toKrw(350, 'RMB', FX)).toBe(66675);
    expect(toKrw(0.5, 'RMB', FX)).toBe(95); // 95.25
    expect(toKrw(60, 'USD', FX)).toBe(82800);
    expect(toKrw(-10000, 'KRW', FX)).toBe(-10000);
  });
  it('기준 — 표본이 넉넉하면 시장, 모자라면 참고치(최저를 싣지 않음), 둘 다 없으면 없음', () => {
    expect(benchmarkFrom([100, 200, 300, 400], 8, 250, RULE)).toMatchObject({ source: 'market', n: 4, median: 250, min: 100, coverageBp: 5000 });
    expect(benchmarkFrom([100, 200], 8, 250, RULE)).toEqual({ source: 'reference', n: 2, median: 250, q1: 250, q3: 250, min: null, coverageBp: 2500 });
    expect(benchmarkFrom([], 0, null, RULE)).toMatchObject({ source: 'none', median: null, coverageBp: null });
  });
  it('표본이 퍼짐 기준보다 적으면 중간값만 — 요금표 3장의 금액이 분위로 다 드러나지 않게', () => {
    const amounts = [100, 200, 300];
    const b = benchmarkFrom(amounts, 3, 250, RULE); // minSamples 3 ≤ n < minSpreadSamples 4
    expect(b).toEqual({ source: 'market', n: 3, median: 200, q1: null, q3: null, min: null, coverageBp: 10000 });
    // 응답에 남는 금액은 중간값 하나뿐
    const shown = [b.median, b.q1, b.q3, b.min].filter((x) => x != null);
    expect(amounts.filter((a) => shown.includes(a))).toEqual([200]);
    expect(benchmarkFrom(amounts, 3, 250, { minSamples: 3 })).toMatchObject({ q1: null, q3: null, min: null }); // 기준이 없으면 싣지 않는다
    expect(showSpread(4, RULE)).toBe(true);
    expect(showSpread(3, RULE)).toBe(false);
    // 비싼 쪽 경계가 없으면 「과함」은 중간값 기준만 본다
    const r = checkInvoice({
      lines: [line('운임', 260, 'freight')],
      fx: FX,
      benchmarks: bench({ freight: b }),
      market: { cards: 3, totals: distribution([100, 200, 300]) },
      rule: RULE,
    });
    expect(r.segments.find((x) => x.segment === 'freight')!.verdict).toBe('high');
    expect(r.market).toMatchObject({ median: 200, q1: null, min: null });
  });
  it('구간별 모으기 — 세금·못 정한 줄은 따로', () => {
    const g = groupLines([line('a', 100, 'freight'), line('b', 1, 'freight', 'RMB'), line('관세', 50, 'tax'), line('?', 7, null)], FX);
    expect(g.bySeg.get('freight')).toEqual({ amount: 100 + 191, lines: 2 });
    expect(g.taxTotal).toBe(50);
    expect(g.unclassified).toEqual([{ label: '?', amount: 7 }]);
  });

  const benchmarks = bench({
    pickup: mkt(60000, 50000, 70000, 40000),
    freight: mkt(250000, 220000, 290000, 200000),
    port: mkt(90000, 80000, 100000, 70000),
    broker: mkt(33000, 33000, 35000, 30000),
    fc_delivery: mkt(80000, 70000, 90000, 60000, 9, 9000),
    return_reserve: mkt(15000, 12000, 18000, 10000, 3, 3000),
    kr_warehouse: { source: 'reference', n: 1, median: 40000, q1: 40000, q3: 40000, min: null, coverageBp: 1000 },
  });
  const market = { cards: 10, totals: { n: 10, min: 500000, q1: 560000, median: 600000, q3: 650000, max: 800000 } };

  it('과함·시세 안·낮음·빠짐·따로·기준 없음', () => {
    const r = checkInvoice({
      lines: [
        line('집하', 65000, 'pickup'), // +8% → 시세 안
        line('해상운임', 360000, 'freight'), // +44%, q3(290,000) 초과 → 과함
        line('THC', 50000, 'port'), // −44% → 낮음
        line('관세사', 33000, 'broker'),
        line('관세', 300000, 'tax'),
        line('창고 작업', 20000, 'cn_warehouse'), // 기준 없음
        line('기타', 5000, null),
      ],
      fx: FX,
      benchmarks,
      market,
      rule: RULE,
    });
    const v = Object.fromEntries(r.segments.map((s) => [s.segment, s.verdict]));
    expect(v).toEqual({
      pickup: 'typical',
      cn_warehouse: 'unknown',
      export_customs: 'unknown',
      freight: 'high',
      port: 'low',
      broker: 'typical',
      kr_warehouse: 'missing', // 참고치 기준이면 비율을 믿지 않고 빠짐으로
      fc_delivery: 'missing', // 요금표 90% 가 맡음
      return_reserve: 'separate', // 30% 만 맡음 — 보통 따로
    });
    const fr = r.segments.find((s) => s.segment === 'freight')!;
    expect(fr.diffFromMedian).toBe(110000);
    expect(fr.overMedianBp).toBe(4400);
    expect(fr.diffFromMin).toBe(160000);
    expect(r.highExcess).toBe(110000);
    expect(r.missingRisk).toBe(40000 + 80000);
    expect(r.separateExpected).toBe(15000);
    expect(r.taxTotal).toBe(300000);
    expect(r.classifiedTotal).toBe(65000 + 360000 + 50000 + 33000 + 20000);
    expect(r.invoiceTotal).toBe(r.classifiedTotal + 5000);
    expect(r.projectedTotal).toBe(r.invoiceTotal + 120000);
    expect(r.market.median).toBe(600000);
    expect(r.market.overMedianBp).toBe(Math.round(((r.projectedTotal - 600000) * 10000) / 600000));
    expect(r.referenceCount).toBe(1);
    expect(r.counts).toEqual({ high: 1, typical: 2, low: 1, missing: 2, separate: 1, unknown: 2 });
  });

  it('중간값보다 높아도 비싼 쪽 25% 경계를 넘지 않으면 과함이 아니다', () => {
    const b = bench({ freight: mkt(100000, 90000, 130000, 80000) });
    const r = checkInvoice({ lines: [line('운임', 125000, 'freight')], fx: FX, benchmarks: b, market: { cards: 0, totals: null }, rule: RULE });
    expect(r.segments.find((s) => s.segment === 'freight')!.verdict).toBe('typical');
    const r2 = checkInvoice({ lines: [line('운임', 131000, 'freight')], fx: FX, benchmarks: b, market: { cards: 0, totals: null }, rule: RULE });
    expect(r2.segments.find((s) => s.segment === 'freight')!.verdict).toBe('high');
    expect(r2.market.median).toBeNull();
    expect(r2.market.overMedianBp).toBeNull();
  });

  it('판정선은 규칙(설정)에서 — 기준을 올리면 과함이 사라진다', () => {
    const b = bench({ freight: mkt(100000, 90000, 110000, 80000) });
    const args = { lines: [line('운임', 125000, 'freight')], fx: FX, benchmarks: b, market: { cards: 0, totals: null } };
    expect(checkInvoice({ ...args, rule: RULE }).counts.high).toBe(1);
    expect(checkInvoice({ ...args, rule: { ...RULE, highOverMedianBp: 3000 } }).counts.high).toBe(0);
  });

  it('0원 줄만 있는 구간은 청구서에 없는 것으로 본다', () => {
    const r = checkInvoice({ lines: [line('FC 운송', 0, 'fc_delivery')], fx: FX, benchmarks: bench({ fc_delivery: mkt(80000, 70000, 90000, 60000) }), market: { cards: 0, totals: null }, rule: RULE });
    expect(r.segments.find((s) => s.segment === 'fc_delivery')!.verdict).toBe('missing');
  });

  it('문장 — 과함·빠짐·따로, 요약, 합계', () => {
    const r = checkInvoice({ lines: [line('해상운임', 360000, 'freight')], fx: FX, benchmarks, market, rule: RULE });
    const fr = r.segments.find((s) => s.segment === 'freight')!;
    expect(segmentFinding(fr)).toBe('국제운송 — 요금표 10장 중간값보다 44% 높습니다(+110,000원). 비싼 쪽 25% 경계(290,000원)도 넘습니다. 단가·수량 근거를 물어보세요.');
    expect(segmentFinding(r.segments.find((s) => s.segment === 'fc_delivery')!)).toMatch(/청구서에 없습니다\. 같은 구간 요금표 90%가 이 구간을 맡습니다\. 나중에 따로 약 80,000원이 청구될 수 있습니다/);
    expect(segmentFinding(r.segments.find((s) => s.segment === 'return_reserve')!)).toMatch(/보통 따로 맡깁니다/);
    expect(checkHeadline(r)).toMatch(/^과한 구간 1곳\(중간값보다 \+110,000원\) · 빠진 구간 \d곳/);
    expect(totalFinding(r)).toMatch(/빠진 구간 예상을 더한 .*원은 같은 조건 요금표 10장 중간값 600,000원보다/);
  });

  it('시장 분포 — 요금표 줄 묶음에서(운송 없는 요금표는 뺀다)', () => {
    const qp: QuoteParams = { fx: FX, volumetricKgPerCbm: 167, palletCbm: 1.5, containerCbm: 28 };
    const ref = SETTINGS.find((s) => s.key === 'reference_lines')!.value as RateLine[];
    const card = (freight: number, withFc: boolean): RateLine[] => [
      { segment: 'freight', included: true, basis: 'per_cbm', unitPrice: freight, currency: 'KRW', certainty: 'confirmed' },
      { segment: 'port', included: true, basis: 'per_shipment', unitPrice: 90000, currency: 'KRW', certainty: 'confirmed' },
      ...(withFc ? [{ segment: 'fc_delivery' as const, included: true, basis: 'per_shipment' as const, unitPrice: 80000, currency: 'KRW' as const, certainty: 'estimated' as const }] : []),
    ];
    const brokerOnly: RateLine[] = [{ segment: 'broker', included: true, basis: 'per_shipment', unitPrice: 33000, currency: 'KRW', certainty: 'confirmed' }];
    const m = marketFromCards(
      [card(60000, true), card(70000, true), card(80000, true), card(90000, false), { lines: brokerOnly, tiers: [] }].map((l) => (Array.isArray(l) ? { lines: l, tiers: [] } : l)),
      STANDARD_CARGO,
      { quoteParams: qp, referenceLines: ref, rule: RULE },
    );
    expect(m.market.cards).toBe(4);
    expect(m.benchmarks.freight).toMatchObject({ source: 'market', n: 4, median: 225000, min: 180000, coverageBp: 10000 });
    expect(m.benchmarks.fc_delivery).toMatchObject({ source: 'market', n: 3, median: 80000, coverageBp: 7500 });
    expect(m.benchmarks.broker.source).toBe('reference'); // 종합 요금표 중 관세사를 맡는 곳 없음 → 참고치
    expect(m.benchmarks.broker.min).toBeNull();
    expect(m.reference.freight).toBeGreaterThan(0);
  });

  it('규칙 읽기 — 빠진 칸이 있으면 알린다(기본값을 박지 않는다)', () => {
    const v = SETTINGS.find((s) => s.key === 'invoice_check_rule')!.value;
    expect(parseInvoiceCheckRule(v)).toEqual({ minSamples: 3, highOverMedianBp: 2000, lowUnderMedianBp: 3000, missingCoverageBp: 5000, publicPerMinute: 20, minSpreadSamples: 5 });
    // 퍼짐 기준이 없는 옛 판 — 퍼짐을 싣지 않는 쪽으로
    expect(parseInvoiceCheckRule({ minSamples: 3, highOverMedianBp: 2000, lowUnderMedianBp: 3000, missingCoverageBp: 5000, publicPerMinute: 20 }).minSpreadSamples).toBeUndefined();
    expect(() => parseInvoiceCheckRule({ minSamples: 3 })).toThrow(/invoice_check_rule/);
  });

  it('입력 검사', () => {
    const ok = { hub: 'YIW', port: 'ICN', mode: 'ANY', units: 1, cartons: 1, kg: 1, cbm: 1, goods: 0, cur: 'RMB', lines: [{ label: '운임', amount: 1, currency: 'KRW', segment: 'freight' }] };
    expect(CheckInput.safeParse(ok).success).toBe(true);
    expect(CheckInput.safeParse({ ...ok, lines: [] }).success).toBe(false);
    expect(CheckInput.safeParse({ ...ok, lines: [{ ...ok.lines[0], segment: 'nope' }] }).success).toBe(false);
    expect(CheckInput.safeParse({ ...ok, lines: [{ ...ok.lines[0], segment: 'tax' }] }).success).toBe(true);
    expect(CheckInput.safeParse({ ...ok, lines: [{ ...ok.lines[0], segment: null }] }).success).toBe(true);
  });
});

describe('보관 표(fcd.invoice_checks) — 본인만, 새 판만', () => {
  let db: Driver;
  const ORG = '20000000-0000-4000-8000-000000000001';
  const ORG2 = '20000000-0000-4000-8000-000000000002';
  const P_ORG = '20000000-0000-4000-8000-000000000003';
  const A = '20000000-0000-4000-8000-0000000000a1';
  const B = '20000000-0000-4000-8000-0000000000b1'; // 같은 조직 동료
  const X = '20000000-0000-4000-8000-0000000000c1'; // 다른 조직
  const P = '20000000-0000-4000-8000-0000000000d1'; // 물류사 사람
  const ins = (supersedes: string | null, org = ORG, user = A) =>
    `insert into fcd.invoice_checks (org_id, user_id, version, supersedes_id, title, origin_hub, port, mode, cargo, lines, result, invoice_total)
     values ('${org}', '${user}', ${supersedes ? 2 : 1}, ${supersedes ? `'${supersedes}'` : 'null'}, '시험 점검', 'YIW', 'ICN', 'LCL', '{}'::jsonb, '[]'::jsonb, '{}'::jsonb, 100000) returning id`;

  beforeAll(async () => {
    db = await hazardDb();
    await db.exec(`
      insert into fcd.orgs (id, kind, name, slug) values ('${ORG}', 'shipper', '시험화주', 'ck-a'), ('${ORG2}', 'shipper', '다른화주', 'ck-b'), ('${P_ORG}', 'partner', '시험물류', 'ck-p');
      insert into fcd.profiles (id, home_org_id, email, name) values
        ('${A}', '${ORG}', 'a@ck.test', '가'), ('${B}', '${ORG}', 'b@ck.test', '나'), ('${X}', '${ORG2}', 'x@ck.test', '다'), ('${P}', '${P_ORG}', 'p@ck.test', '라');
      insert into fcd.memberships (user_id, org_id, role) values ('${A}', '${ORG}', 'shipper_admin'), ('${B}', '${ORG}', 'shipper_member'), ('${X}', '${ORG2}', 'shipper_admin'), ('${P}', '${P_ORG}', 'partner_admin');
    `);
  });
  afterAll(async () => {
    await db.close();
  });

  it('본인이 넣고 본인만 읽는다 — 같은 조직 동료·다른 조직·비로그인은 못 본다', async () => {
    const id = await asRole(db, 'fcd_user', A, false, async (q) => (await q.query<{ id: string }>(ins(null)))[0].id);
    expect(id).toBeTruthy();
    const mine = await asRole(db, 'fcd_user', A, false, (q) => q.query('select id from fcd.invoice_checks'));
    expect(mine).toHaveLength(1);
    for (const u of [B, X, P]) expect(await asRole(db, 'fcd_user', u, false, (q) => q.query('select id from fcd.invoice_checks'))).toEqual([]);
    await expect(asRole(db, 'fcd_public', null, false, (q) => q.query('select id from fcd.invoice_checks'))).rejects.toThrow(/permission denied/);
  });

  it('남의 이름·남의 조직·물류사 조직으로는 넣지 못한다', async () => {
    await expect(asRole(db, 'fcd_user', A, false, (q) => q.query(ins(null, ORG, B)))).rejects.toThrow(/row-level security/);
    await expect(asRole(db, 'fcd_user', A, false, (q) => q.query(ins(null, ORG2, A)))).rejects.toThrow(/row-level security/);
    await expect(asRole(db, 'fcd_user', P, false, (q) => q.query(ins(null, P_ORG, P)))).rejects.toThrow(/row-level security/);
    await expect(asRole(db, 'fcd_public', null, false, (q) => q.query(ins(null)))).rejects.toThrow(/permission denied/);
  });

  it('고치거나 지우지 못한다 — 새 판(supersedes_id)으로만, 남의 판 위에는 못 쌓는다', async () => {
    const first = (await asRole(db, 'fcd_user', A, false, (q) => q.query<{ id: string }>(`select id from fcd.invoice_checks`)))[0].id;
    await expect(asRole(db, 'fcd_user', A, false, (q) => q.query(`update fcd.invoice_checks set title = '고침' where id = '${first}'`))).rejects.toThrow(/permission denied/);
    await expect(asRole(db, 'fcd_user', A, false, (q) => q.query(`delete from fcd.invoice_checks where id = '${first}'`))).rejects.toThrow(/permission denied/);
    await expect(asRole(db, 'fcd_user', X, false, (q) => q.query(ins(first, ORG2, X)))).rejects.toThrow(/row-level security/);
    const second = await asRole(db, 'fcd_user', A, false, async (q) => (await q.query<{ id: string }>(ins(first)))[0].id);
    // 한 판 뒤에는 새 판 하나만
    await expect(asRole(db, 'fcd_user', A, false, (q) => q.query(ins(first)))).rejects.toThrow(/duplicate|unique/);
    const current = await asRole(db, 'fcd_user', A, false, (q) => q.query<{ id: string }>('select id from fcd.v_invoice_checks_current'));
    expect(current.map((c) => c.id)).toEqual([second]);
    const all = await asRole(db, 'fcd_user', A, false, (q) => q.query('select id from fcd.invoice_checks'));
    expect(all).toHaveLength(2);
  });
});

describe('데모 시드와 걷어내기 목록', () => {
  let db: Driver;
  beforeAll(async () => {
    db = await hazardDb();
    await seedDemo(db, { today: todayKst(), password: 'test-only-password' });
  });
  afterAll(async () => {
    await db.close();
  });

  it('참조 시드에 점검 규칙이 들어간다', async () => {
    const r = await db.query<{ value: unknown }>(`select value from fcd.v_current_settings where key = 'invoice_check_rule'`);
    expect(parseInvoiceCheckRule(r[0].value).minSamples).toBeGreaterThan(0);
  });

  it('데모 화주의 보관 점검이 데모 조직 아래에 있고, 새 판이 이전 판을 잇는다', async () => {
    expect(DEMO_TABLES.map((t) => t.table)).toContain('invoice_checks');
    const counts = await db.transaction((tx) => demoCounts(tx));
    expect(counts.find((c) => c.table === 'invoice_checks')).toMatchObject({ demo: 3, real: 0 });
    const rows = await db.query<{ title: string; version: number; supersedes_id: string | null; invoice_total: number; missing_count: number; result: { result: { segments: unknown[] } } }>(
      `select title, version, supersedes_id, invoice_total, missing_count, result from fcd.invoice_checks order by created_at`,
    );
    expect(rows[1].supersedes_id).toBeTruthy();
    expect(rows[1].version).toBe(2);
    expect(rows[0].result.result.segments).toHaveLength(9);
    // 수정본은 국내 창고·FC 운송을 넣어 빠진 구간이 줄었다
    expect(rows[1].missing_count).toBeLessThan(rows[0].missing_count);
    const cur = await db.query<{ n: number }>('select count(*)::int n from fcd.v_invoice_checks_current');
    expect(cur[0].n).toBe(2);
  });

  it('구간 분포 — 데모 요금표로 이우→인천에 표본이 선다(개별 가격 없이 집계만)', async () => {
    const s = (k: string) => SETTINGS.find((x) => x.key === k)!.value;
    // 앱은 asSystem(신뢰 경로)으로 부른다 — 시험도 같은 권한(마이그레이션 역할)으로
    const m = await laneMarket(db, { hub: 'YIW', port: 'ICN', mode: null, cargo: STANDARD_CARGO }, {
      quoteParams: { fx: s('fx') as QuoteParams['fx'], ...(s('quote_params') as Omit<QuoteParams, 'fx'>) },
      referenceLines: s('reference_lines') as RateLine[],
      rule: parseInvoiceCheckRule(s('invoice_check_rule')),
      today: todayKst(),
      demoMode: true,
    });
    expect(m.market.cards).toBeGreaterThanOrEqual(3);
    expect(m.benchmarks.freight.source).toBe('market');
    expect(m.benchmarks.freight.median).toBeGreaterThan(0);
    expect(Object.keys(m.benchmarks)).toEqual([...SEGMENTS]);
    // 데모를 끄면 데모 요금표는 빠진다
    const off = await laneMarket(db, { hub: 'YIW', port: 'ICN', mode: null, cargo: STANDARD_CARGO }, {
      quoteParams: { fx: s('fx') as QuoteParams['fx'], ...(s('quote_params') as Omit<QuoteParams, 'fx'>) },
      referenceLines: s('reference_lines') as RateLine[],
      rule: parseInvoiceCheckRule(s('invoice_check_rule')),
      today: todayKst(),
      demoMode: false,
    });
    expect(off.market.cards).toBe(0);
    expect(off.benchmarks.freight.source).toBe('reference');
  });
});
