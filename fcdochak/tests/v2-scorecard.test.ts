/**
 * v2 6차 scorecard — 물류사 성적표.
 * 순수 함수(표본 합치기·지표·제출률·인증·전체 대비·정렬·실질 비용·부호 어댑터·제출 글 읽기) ·
 * 메모리 PGlite(운영 DB 아님)에서 RLS(이름 붙은 성적은 로그인 화주·그 업체·운영자, 공개는 집계만)·쌓기만·새 판·데모·걷어내기.
 * 관세청·쿠팡은 부르지 않는다(fetch 는 가짜). 화면 흐름은 e2e/v2-scorecard.spec.ts.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
import type { Driver } from '@/lib/db/driver';
import { setDbForTests } from '@/lib/db';
import { holidaySet } from '@/lib/tracker/calendar';
import { HolidaysSchema } from '@/lib/tracker/settings';
import { computeScorecards, disputeRefOk, hasInspection, isExcluded, mergeSamples, sortByScore, sourceLine, weekStart, type RawSample } from '@/lib/scorecard/engine';
import { readScorecardConfig, SCORECARD_SETTING_SCHEMAS, ScorecardRulesSchema } from '@/lib/scorecard/settings';
import { delayBaseline, delayCost, expectedDelay, realCost, sortByRealCost } from '@/lib/money';
import { HttpForwarderAdapter, MockForwarderAdapter, mockForwarderCode, parseForwarderXml } from '@/lib/unipass/forwarders';
import { UnipassDisabledError } from '@/lib/unipass/types';
import { V2_SETTING_SCHEMAS } from '@/lib/v2-setting-schemas';
import { DEMO_TABLES, demoCounts } from '@/lib/server/demo-status';
import { SCORECARD_SETTINGS, TRACKER_SETTINGS } from '@seed/reference/data';
import { seedDemo } from '@seed/demo';
import { buildPurgeSql, planPurge } from '@seed/demo/purge';
import { asRole, hazardDb, todayKst } from './helpers';

const HOL = holidaySet(HolidaysSchema.parse(TRACKER_SETTINGS.find((s) => s.key === 'calendar.kr_holidays')!.value).days);
const RULES = ScorecardRulesSchema.parse(SCORECARD_SETTINGS.find((s) => s.key === 'scorecard.rules')!.value);

const base: Omit<RawSample, 'key' | 'source' | 'registrant'> = {
  partner: 'P1', broker: null, port: 'ICN', mode: 'LCL', arrival: '2026-09-01', bondedIn: '2026-09-01', cleared: '2026-09-02', released: '2026-09-02', fc: null, inspected: false,
};
const S = (key: string, source: RawSample['source'], x: Partial<RawSample> = {}): RawSample => ({ ...base, key, source, registrant: source === 'partner' ? 'P1' : 'SHIP1', ...x });

describe('표본 합치기', () => {
  it('같은 화물은 한 번 — 출처를 모으고, 업체 귀속은 플랫폼 > 셀러 > 물류사, 서로 다르면 충돌', () => {
    const m = mergeSamples([
      S('A', 'seller', { partner: 'P2' }),
      S('A', 'partner', { partner: 'P1', registrant: 'P1' }),
      S('B', 'platform', { partner: 'P3' }),
      S('B', 'seller', { partner: 'P3', broker: 'BR1' }),
    ]);
    expect(m).toHaveLength(2);
    const a = m.find((x) => x.key === 'A')!;
    expect(a.sources).toEqual(['seller', 'partner']);
    // 셀러가 P2 로 등록한 화물을 P1 이 제출해도 P1 이 가져가지 못한다(검토 고침)
    expect(a.partner).toBe('P2');
    expect(a.conflict).toBe(true);
    expect(a.submittedBy).toEqual(['P1']);
    const b = m.find((x) => x.key === 'B')!;
    expect(b.partner).toBe('P3');
    expect(b.broker).toBe('BR1');
    expect(b.conflict).toBe(false);
  });
  it('검사 낱말(가정) — 보세운송은 검사로 세지 않는다', () => {
    expect(hasInspection(['수입신고', '검사대상 지정'])).toBe(true);
    expect(hasInspection(['보세운송 검사'])).toBe(false);
    expect(hasInspection(['수입신고수리'])).toBe(false);
  });
  it('이의로 뺄 화물 — 열쇠 그대로 또는 번호 조각', () => {
    expect(isExcluded('hbl:EX-1:2026', ['EX-1'])).toBe(true);
    expect(isExcluded('hbl:EX-1:2026', ['EX-2'])).toBe(false);
  });
  it('연도만 적은 이의(2026)는 그해 B/L 을 빼지 않는다 · 짧은 숫자 이의는 받지 않는다', () => {
    expect(isExcluded('hbl:EXHBL0001:2026', ['2026'])).toBe(false);
    const [m] = mergeSamples([S('hbl:EXHBL0001:2026', 'seller', { refs: ['EXHBL0001'] })]);
    expect(isExcluded(m, ['2026'])).toBe(false);
    expect(isExcluded(m, ['EXHBL-0001'])).toBe(true);
    expect(disputeRefOk('2026')).toBe(false);
    expect(disputeRefOk('12345')).toBe(false);
    expect(disputeRefOk('123456789012')).toBe(true);
    expect(disputeRefOk('EX-1')).toBe(false);
    expect(disputeRefOk('EXH1')).toBe(true);
  });
  it('화물관리번호가 채워진 화물도 B/L 번호로 적은 이의로 빠진다(열쇠가 바뀌어도)', () => {
    const [m] = mergeSamples([S('26KE0000AB12345', 'seller', { refs: ['EXHBL0002', '26KE0000AB12345'] }), S('26KE0000AB12345', 'partner', { refs: ['EXHBL0002'] })]);
    expect(m.refs).toEqual(['26KE0000AB12345', 'EXHBL0002']);
    expect(isExcluded(m, ['EXHBL0002'])).toBe(true);
    expect(isExcluded(m, ['26KE0000AB12345'])).toBe(true);
    expect(isExcluded(m, ['EXHBL0003'])).toBe(false);
  });
});

describe('지표 엔진', () => {
  const today = '2026-09-25';
  // P1: 0,0,1,1,2 영업일 · 한 건 검사 · 한 건 이상치(30영업일)
  const mk = (i: number, cleared: string, x: Partial<RawSample> = {}) => S(`K${i}`, 'seller', { cleared, released: cleared, ...x });
  const raw: RawSample[] = [
    mk(1, '2026-09-01'),
    mk(2, '2026-09-01'),
    mk(3, '2026-09-02'),
    mk(4, '2026-09-02', { inspected: true }),
    mk(5, '2026-09-03'),
    mk(6, '2026-09-01', { arrival: '2026-07-20', cleared: '2026-09-01' }),
    S('K7', 'partner', { registrant: 'P1', cleared: '2026-09-02' }),
    S('K1', 'partner', { registrant: 'P1' }),
    S('K2', 'partner', { registrant: 'P1' }),
    mk(8, '2026-09-01', { partner: 'P2', port: 'PTK', arrival: '2026-09-01', cleared: '2026-09-04' }),
    mk(9, '2025-01-01', { arrival: '2025-01-01' }), // 기간 밖
  ];
  const rows = computeScorecards(mergeSamples(raw), { holidays: HOL, today, rules: { ...RULES, minSamples: 3, certifiedMinSamples: 3, certifiedSubmissionBp: 3000 } });
  const p1 = rows.find((r) => r.entityKind === 'partner' && r.entity === 'P1' && r.port == null)!;
  it('입항 → 수리 p50·p90·늦는 폭 · 이상치는 빼고 센다 · 기간 밖은 뺀다', () => {
    expect(p1.n).toBe(6); // K1~K5, K7 (K6 이상치, K9 기간 밖)
    expect(p1.metrics.clear!.p50).toBe(1);
    expect(p1.metrics.clear!.p90).toBe(1.5);
    expect(p1.metrics.clear!.spread).toBe(0.5);
    expect(p1.sources.outliers).toBe(1);
  });
  it('검사 비율 · 출처별 수 · 교차 확인', () => {
    expect(p1.metrics.inspected).toBe(1);
    expect(p1.metrics.inspectRate).toBeCloseTo(1 / 7, 3);
    expect(p1.sources).toMatchObject({ seller: 6, partner: 3, crossChecked: 2 });
    expect(sourceLine(p1.sources)).toBe('셀러 6 · 물류사 3 · 교차 확인 2');
  });
  it('제출률 = 셀러·선적 등록 중 업체도 낸 비율 · 인증', () => {
    expect(p1.submission).toEqual({ registered: 6, submitted: 2, rate: 0.333, partnerOnly: 1 });
    expect(p1.certified).toBe(true);
    const strict = computeScorecards(mergeSamples(raw), { holidays: HOL, today, rules: RULES });
    expect(strict.find((r) => r.entity === 'P1' && r.port == null)!.certified).toBe(false);
  });
  it('전체 평균 대비 · 항구×방식 판 · 추이(주 시작 월요일)', () => {
    const p2 = rows.find((r) => r.entityKind === 'partner' && r.entity === 'P2' && r.port === 'PTK')!;
    expect(p2.metrics.clear!.p50).toBe(3);
    const all = rows.find((r) => r.entityKind === 'overall' && r.port == null)!;
    expect(p1.metrics.vsOverall.overallP50).toBe(all.metrics.clear!.p50);
    expect(weekStart('2026-09-25')).toBe('2026-09-21');
    expect(p1.metrics.trend).toHaveLength(RULES.trendWeeks);
    expect(p1.metrics.trend.find((t) => t.week === '2026-08-31')!.n).toBe(6);
  });
  it('표본이 하나도 없어도 전체 판 한 줄(n = 0)은 남는다 — 옛 판이 최근 판으로 남지 않게', () => {
    const none = computeScorecards([], { holidays: HOL, today, rules: RULES });
    expect(none).toHaveLength(1);
    expect(none[0]).toMatchObject({ entityKind: 'overall', port: null, mode: null, n: 0 });
    expect(none[0].metrics.clear).toBeNull();
    const allOut = computeScorecards(mergeSamples(raw), { holidays: HOL, today, rules: RULES, excluded: ['2026'] });
    expect(allOut.find((r) => r.entityKind === 'overall' && r.port == null)!.n).toBeGreaterThan(0);
  });
  it('이의를 받아들인 화물은 빠진다', () => {
    const ex = computeScorecards(mergeSamples(raw), { holidays: HOL, today, rules: { ...RULES, minSamples: 3 }, excluded: ['K5'] });
    expect(ex.find((r) => r.entity === 'P1' && r.port == null)!.n).toBe(5);
  });
  it('정렬 — 빠른 통관순 · 안정적인 순 · 표본 부족은 뒤로', () => {
    const a = { n: 10, metrics: { clear: { p50: 2, p90: 3, spread: 1, n: 10, hist: [] }, inspectRate: 0.1 } };
    const b = { n: 10, metrics: { clear: { p50: 1, p90: 5, spread: 4, n: 10, hist: [] }, inspectRate: 0.3 } };
    const c = { n: 2, metrics: { clear: { p50: 0, p90: 0, spread: 0, n: 2, hist: [] }, inspectRate: 0 } };
    const items = ['a', 'b', 'c'];
    const of = (k: string) => ({ a, b, c })[k as 'a'] as never;
    expect(sortByScore(items, of, 'fast', 5)).toEqual(['b', 'a', 'c']);
    expect(sortByScore(items, of, 'stable', 5)).toEqual(['a', 'b', 'c']);
    expect(sortByScore(items, of, 'inspect', 5)).toEqual(['a', 'b', 'c']);
  });
  it('정렬 — 물류사가 혼자 낸 표본만 있는 업체는 순위에 오르지 못한다 · 보이는 값(반올림)으로 먼저 가른다', () => {
    const clear = (p50: number, p90: number) => ({ p50, p90, spread: p90 - p50, n: 10, hist: [] });
    const own = { n: 10, sources: { seller: 1, platform: 0 }, metrics: { clear: clear(0.2, 0.5), inspectRate: 0 } };
    const fair = { n: 10, sources: { seller: 8, platform: 2 }, metrics: { clear: clear(1.4, 4), inspectRate: 0 } };
    const fair2 = { n: 10, sources: { seller: 8, platform: 2 }, metrics: { clear: clear(0.9, 5), inspectRate: 0 } };
    const of = (k: string) => ({ own, fair, fair2 })[k as 'own'] as never;
    // fair(보통 1일 · 늦으면 4일)가 fair2(보통 1일 · 늦으면 5일)보다 앞 — p50 소수(0.9 < 1.4)가 아니라 보이는 값으로
    expect(sortByScore(['own', 'fair2', 'fair'], of, 'fast', 5)).toEqual(['fair', 'fair2', 'own']);
  });
});

describe('실질 비용(money/realcost)', () => {
  it('실질 비용순 — 금액이 있으면 금액, 없으면 지연일 → 견적가, 실측 없는 후보는 뒤', () => {
    const r = (quote: number, days: number | null, priced: boolean) => ({
      quote,
      real: days == null ? null : realCost({ quote, stat: { p50: days, p90: days + 1 }, baselineDays: 0, perDay: priced ? 10 : null, marginPerUnit: priced ? 1000 : null }),
    });
    const priced = { a: r(500_000, 2, true), b: r(400_000, 3, true), c: r(100_000, null, true) };
    // a = 500,000 + 20,000 = 520,000 · b = 400,000 + 30,000 = 430,000
    expect(sortByRealCost(['a', 'b', 'c'], (k) => priced[k as 'a'])).toEqual(['b', 'a', 'c']);
    const days = { a: r(500_000, 1, false), b: r(400_000, 2, false), d: r(300_000, 1, false) };
    expect(sortByRealCost(['a', 'b', 'd'], (k) => days[k as 'a'])).toEqual(['d', 'a', 'b']);
  });
  it('비교 기준 — 가장 빠른 후보, 없으면 전체 중앙값', () => {
    expect(delayBaseline([{ p50: 2, p90: 4 }, { p50: 1, p90: 3 }, null], 1.5)).toEqual({ days: 1, basis: 'fastest' });
    expect(delayBaseline([], 1.5)).toEqual({ days: 1.5, basis: 'overall' });
    expect(delayBaseline([], null)).toBeNull();
  });
  it('예상 지연일 = max(0, p50·p90 − 기준)', () => {
    expect(expectedDelay({ p50: 2.5, p90: 5 }, 1)).toEqual({ usual: 1.5, late: 4 });
    expect(expectedDelay({ p50: 0.5, p90: 1 }, 1)).toEqual({ usual: 0, late: 0 });
    expect(() => expectedDelay({ p50: 3, p90: 2 }, 0)).toThrow();
  });
  it('지연 비용 = 하루 판매량 × 개당 마진 × 지연일(사사오입, 마진 0 이하면 0)', () => {
    expect(delayCost(40, 3000, 2)).toBe(240_000);
    expect(delayCost(12.5, 1999, 1.5)).toBe(37_481); // 12.5 × 1999 × 1.5 = 37,481.25
    expect(delayCost(10, -500, 3)).toBe(0);
    expect(delayCost(0, 3000, 3)).toBe(0);
  });
  it('평소·늦을 때 두 값 · 판매량을 모르면 지연 일수만', () => {
    const r = realCost({ quote: 1_000_000, stat: { p50: 3, p90: 5 }, baselineDays: 1, perDay: 40, marginPerUnit: 3000 });
    expect(r.usual).toEqual({ delayDays: 2, cost: 240_000, total: 1_240_000 });
    expect(r.late).toEqual({ delayDays: 4, cost: 480_000, total: 1_480_000 });
    const n = realCost({ quote: 1_000_000, stat: { p50: 3, p90: 5 }, baselineDays: 1, perDay: null, marginPerUnit: 3000 });
    expect(n).toMatchObject({ priced: false, usual: { delayDays: 2, cost: null, total: null } });
    expect(realCost({ quote: 1, stat: null, baselineDays: 1, perDay: 1, marginPerUnit: 1 })).toEqual({ usual: null, late: null, priced: false });
  });
});

describe('화물운송주선업자 어댑터', () => {
  it('꺼짐이면 fetch 를 부르지 않는다 · 흉내는 결정적(EX 부호)', async () => {
    const f = vi.fn();
    await expect(new HttpForwarderAdapter({ enabled: false, apiKey: 'x', fetch: f }).search('한바다')).rejects.toBeInstanceOf(UnipassDisabledError);
    expect(f).not.toHaveBeenCalled();
    const m = new MockForwarderAdapter(['한바다포워딩', '서해브릿지로지스']);
    const r = await m.search('한바다');
    expect(r[0].code).toBe(mockForwarderCode('한바다포워딩'));
    expect(r[0].code).toMatch(/^EX[A-Z0-9]{6}$/);
    expect(r.length).toBe(2); // 비슷한 이름 하나
    expect(await m.detail(r[0].code)).toMatchObject({ name: '한바다포워딩(예시)' });
  });
  it('가정한 XML — 부호 형식이 틀린 줄은 버리고 DOCTYPE 은 거부, 키는 오류 문구에 없음', async () => {
    const xml = `<r><frwrLstQryRsltVo><frwrSgn>AB12</frwrSgn><frwrConm>예시 &amp; 물류</frwrConm><addr>예시</addr></frwrLstQryRsltVo><frwrLstQryRsltVo><frwrSgn>틀림</frwrSgn><frwrConm>x</frwrConm></frwrLstQryRsltVo></r>`;
    expect(parseForwarderXml(xml)).toEqual([{ code: 'AB12', name: '예시 & 물류', address: '예시', source: 'unipass' }]);
    expect(() => parseForwarderXml('<!DOCTYPE x><r/>')).toThrow();
    const f = vi.fn(async () => ({ status: 500, text: async () => '' }));
    const a = new HttpForwarderAdapter({ enabled: true, apiKey: 'SECRET-KEY-VALUE', fetch: f, sleep: async () => {}, maxRetries: 1 });
    await expect(a.search('예시')).rejects.toThrow(/관세청/);
    await a.search('예시').catch((e: Error) => expect(e.message).not.toContain('SECRET'));
    expect(f).toHaveBeenCalled();
  });
});

describe('설정', () => {
  it('첫 판이 규칙에 맞고, 이름 공개는 꺼짐, 어드민 설정 목록에 있다', () => {
    for (const s of SCORECARD_SETTINGS) expect(SCORECARD_SETTING_SCHEMAS[s.key].safeParse(s.value).success, s.key).toBe(true);
    expect(SCORECARD_SETTINGS.find((s) => s.key === 'scorecard.public_named')!.value).toBe(false);
    expect(V2_SETTING_SCHEMAS['scorecard.rules']).toBeTruthy();
    expect(readScorecardConfig(new Map(SCORECARD_SETTINGS.map((s) => [s.key, s.value]))).publicNamed).toBe(false);
    expect(() => readScorecardConfig(new Map())).toThrow();
  });
});

describe('제출 글 읽기', () => {
  it('한 줄에 하나 · 연도 · 화물관리번호 알아보기 · 개인통관고유부호 거절 · 같은 번호', async () => {
    const { parseSubmission } = await import('@/lib/server/scorecard');
    const r = parseSubmission('EXHBL-1\nEXHBL-2 2025\n26EXMP00ANLU0830001\nP123456789012\nEXHBL-1\n', { kind: 'hbl', year: 2026, thisYear: 2026 });
    expect(r.map((x) => x.ok)).toEqual([true, true, true, false, false]);
    expect(r[1].query).toEqual({ kind: 'hbl', number: 'EXHBL-2', year: 2025 });
    expect(r[2].query!.kind).toBe('cargo_no');
    expect(r[3].raw).not.toContain('123456789012');
    expect(r[4].error).toContain('같은 번호');
  });
});

// ─── DB ─────────────────────────────────────────────────────────────────

let db: Driver;
let ids: { shipper: string; partner: string; admin: string };
let partnerOrg: string;
let otherPartner: string;

beforeAll(async () => {
  db = await hazardDb();
  const r = await seedDemo(db, { today: todayKst(), password: 'test-only-password' });
  ids = r.demoIds!;
  partnerOrg = (await db.query<{ org_id: string }>(`select org_id from fcd.memberships where user_id = $1`, [ids.partner]))[0].org_id;
  otherPartner = (await db.query<{ id: string }>(`select id from fcd.orgs where kind = 'partner' and is_demo and id <> $1 and business_type = 'forwarder' and status = 'official' order by name limit 1`, [partnerOrg]))[0].id;
  setDbForTests(db);
}, 240_000);
afterAll(async () => {
  setDbForTests(undefined);
  await db.close();
});

describe('데모 자료', () => {
  it('물류사·관세사·항구별 성적이 채워진다 · 미래 날짜 없음 · 관세청 기록 없음', async () => {
    const c = await db.query<{ partners: number; brokers: number; ports: number; subs: number; future: number; unipass: number; certified: number }>(
      `select (select count(distinct entity_org_id)::int from fcd.scorecard_snapshots where entity_kind = 'partner' and n >= 5) partners,
              (select count(distinct entity_org_id)::int from fcd.scorecard_snapshots where entity_kind = 'broker' and n >= 5) brokers,
              (select count(distinct port)::int from fcd.scorecard_snapshots where entity_kind = 'overall' and port is not null and n >= 5) ports,
              (select count(*)::int from fcd.partner_cargo_submissions) subs,
              (select count(*)::int from fcd.cargo_track_events where occurred_at > now()) future,
              (select count(*)::int from fcd.cargo_track_events where source = 'unipass') unipass,
              (select count(*)::int from fcd.scorecard_snapshots where certified) certified`,
    );
    expect(c[0].partners).toBeGreaterThanOrEqual(8);
    expect(c[0].brokers).toBeGreaterThanOrEqual(1);
    expect(c[0].ports).toBe(2);
    expect(c[0].subs).toBeGreaterThan(50);
    expect(c[0].future).toBe(0);
    expect(c[0].unipass).toBe(0);
    expect(c[0].certified).toBeGreaterThan(0);
  });
  it('물류사 제출 번호는 5차 소요 통계(항구·방식 판)에 넣지 않는다', async () => {
    const { leadSamples } = await import('@/lib/tracker/store');
    const n = await db.query<{ n: number }>(`select count(*)::int n from fcd.cargo_tracks t join fcd.orgs o on o.id = t.org_id where o.is_demo and o.kind = 'shipper'`);
    const samples = await leadSamples(db, true);
    expect(samples.length).toBeLessThanOrEqual(n[0].n);
  });
});

describe('권한(RLS)', () => {
  it('이름 붙은 성적 — 로그인 화주는 모두, 물류사는 자기 것과 집계만, 비로그인은 집계만', async () => {
    const q = `select count(*) filter (where entity_org_id is not null)::int named, count(*) filter (where entity_org_id is null)::int agg,
                      count(distinct entity_org_id)::int orgs from fcd.v_scorecard_named`;
    const shipper = await asRole(db, 'fcd_user', ids.shipper, true, (x) => x.query<{ named: number; agg: number; orgs: number }>(q));
    expect(shipper[0].named).toBeGreaterThan(10);
    const partner = await asRole(db, 'fcd_user', ids.partner, true, (x) => x.query<{ named: number; agg: number; orgs: number }>(q));
    expect(partner[0].orgs).toBeLessThanOrEqual(1);
    expect(partner[0].agg).toBeGreaterThan(0);
    const pub = await asRole(db, 'fcd_public', null, true, (x) => x.query<{ entity_org_id: string | null }>(`select entity_org_id from fcd.v_scorecard_public`));
    expect(pub.length).toBeGreaterThan(0);
    expect(pub.every((r) => r.entity_org_id == null)).toBe(true);
    await expect(asRole(db, 'fcd_public', null, true, (x) => x.query(`select 1 from fcd.scorecard_snapshots limit 1`))).rejects.toThrow();
    const off = await asRole(db, 'fcd_public', null, false, (x) => x.query(`select 1 from fcd.v_scorecard_public`));
    expect(off).toEqual([]);
  });
  it('이름 공개 스위치를 켜면 공개 보기에도 이름 붙은 판', async () => {
    await db.query(`insert into fcd.settings (key, value, note, created_at) values ('scorecard.public_named', 'true'::jsonb, '시험', now() + interval '1 second')`);
    const pub = await asRole(db, 'fcd_public', null, true, (x) => x.query<{ entity_org_id: string | null }>(`select entity_org_id from fcd.v_scorecard_public`));
    expect(pub.some((r) => r.entity_org_id != null)).toBe(true);
    await db.query(`insert into fcd.settings (key, value, note, created_at) values ('scorecard.public_named', 'false'::jsonb, '시험 끝', now() + interval '2 seconds')`);
    const again = await asRole(db, 'fcd_public', null, true, (x) => x.query<{ entity_org_id: string | null }>(`select entity_org_id from fcd.v_scorecard_public`));
    expect(again.every((r) => r.entity_org_id == null)).toBe(true);
  });
  it('계산 결과는 사용자가 넣거나 고치지 못한다 · 제출은 자기 물류사만 · 쌓기만', async () => {
    await expect(
      asRole(db, 'fcd_user', ids.admin, true, (x) =>
        x.query(`insert into fcd.scorecard_snapshots (batch_id, entity_kind, window_days, from_on, to_on, n, metrics, sources) values (gen_random_uuid(),'overall',1,current_date,current_date,1,'{}','{}')`),
      ),
    ).rejects.toThrow();
    const ok = await asRole(db, 'fcd_user', ids.partner, true, (x) =>
      x.query<{ id: string }>(`insert into fcd.partner_cargo_submissions (partner_org_id, submitted_by, batch_id, kind, number, bl_year) values ($1,$2,gen_random_uuid(),'hbl','EXRLS-SUB-1',2026) returning id`, [partnerOrg, ids.partner]),
    );
    expect(ok[0].id).toBeTruthy();
    await expect(
      asRole(db, 'fcd_user', ids.partner, true, (x) =>
        x.query(`insert into fcd.partner_cargo_submissions (partner_org_id, submitted_by, batch_id, kind, number, bl_year) values ($1,$2,gen_random_uuid(),'hbl','EXRLS-SUB-2',2026)`, [otherPartner, ids.partner]),
      ),
    ).rejects.toThrow();
    await expect(asRole(db, 'fcd_user', ids.shipper, true, (x) => x.query(`insert into fcd.partner_cargo_submissions (partner_org_id, submitted_by, batch_id, kind, number, bl_year) values ($1,$2,gen_random_uuid(),'hbl','EXRLS-SUB-3',2026)`, [partnerOrg, ids.shipper]))).rejects.toThrow();
    await expect(asRole(db, 'fcd_user', ids.partner, true, (x) => x.query(`update fcd.partner_cargo_submissions set number = 'X' where id = $1`, [ok[0].id]))).rejects.toThrow();
    await expect(asRole(db, 'fcd_user', ids.partner, true, (x) => x.query(`delete from fcd.partner_cargo_submissions where id = $1`, [ok[0].id]))).rejects.toThrow();
    const other = await asRole(db, 'fcd_user', ids.shipper, true, (x) => x.query(`select 1 from fcd.partner_cargo_submissions limit 1`));
    expect(other).toEqual([]);
  });
  it('이의 — 업체는 자기 것만 열고, 받아들이기는 운영자만 · 부호 연결은 운영자만(새 판)', async () => {
    const d = await asRole(db, 'fcd_user', ids.partner, true, (x) =>
      x.query<{ id: string }>(`insert into fcd.scorecard_disputes (partner_org_id, kind, metric, body, created_by) values ($1,'open','clearance','시험 이의',$2) returning id`, [partnerOrg, ids.partner]),
    );
    await expect(asRole(db, 'fcd_user', ids.partner, true, (x) => x.query(`insert into fcd.scorecard_disputes (root_id, partner_org_id, kind, body, created_by) values ($1,$2,'accepted','스스로 받아들임',$3)`, [d[0].id, partnerOrg, ids.partner]))).rejects.toThrow();
    await asRole(db, 'fcd_user', ids.admin, true, (x) => x.query(`insert into fcd.scorecard_disputes (root_id, partner_org_id, kind, body, created_by) values ($1,$2,'rejected','근거 부족',$3)`, [d[0].id, partnerOrg, ids.admin]));
    await expect(asRole(db, 'fcd_user', ids.admin, true, (x) => x.query(`insert into fcd.scorecard_disputes (root_id, partner_org_id, kind, body, created_by) values ($1,$2,'note','다른 업체에 매단 답',$3)`, [d[0].id, otherPartner, ids.admin]))).rejects.toThrow();
    await expect(asRole(db, 'fcd_user', ids.partner, true, (x) => x.query(`insert into fcd.partner_customs_codes (org_id, code, source, status, created_by) values ($1,'AB12','admin','linked',$2)`, [partnerOrg, ids.partner]))).rejects.toThrow();
    await asRole(db, 'fcd_user', ids.admin, true, (x) => x.query(`insert into fcd.partner_customs_codes (org_id, code, source, status, created_by) values ($1,'AB12','admin','linked',$2)`, [partnerOrg, ids.admin]));
    const seen = await asRole(db, 'fcd_user', ids.partner, true, (x) => x.query<{ code: string }>(`select code from fcd.v_partner_customs_codes_current where org_id = $1`, [partnerOrg]));
    expect(seen.map((r) => r.code)).toContain('AB12');
    const pubBroker = await asRole(db, 'fcd_public', null, true, (x) => x.query(`select 1 from fcd.v_broker_profiles_current limit 1`));
    expect(pubBroker.length).toBe(1);
  });
});

describe('이의 상태 — 닫힌 이의(0025)', () => {
  it('받아들인 뒤에는 거두기·다시 처리를 받지 않는다 · 덧붙이기(note)는 되지만 제외는 풀리지 않는다', async () => {
    const { acceptedDisputeRefs } = await import('@/lib/scorecard/store');
    const d = await asRole(db, 'fcd_user', ids.partner, true, (x) =>
      x.query<{ id: string }>(`insert into fcd.scorecard_disputes (partner_org_id, kind, metric, cargo_ref, body, created_by) values ($1,'open','clearance','EXNOTE-0001','시험 이의',$2) returning id`, [partnerOrg, ids.partner]),
    );
    await asRole(db, 'fcd_user', ids.admin, true, (x) => x.query(`insert into fcd.scorecard_disputes (root_id, partner_org_id, kind, body, created_by) values ($1,$2,'accepted','맞음',$3)`, [d[0].id, partnerOrg, ids.admin]));
    await expect(asRole(db, 'fcd_user', ids.partner, true, (x) => x.query(`insert into fcd.scorecard_disputes (root_id, partner_org_id, kind, body, created_by) values ($1,$2,'withdrawn','거둠',$3)`, [d[0].id, partnerOrg, ids.partner]))).rejects.toThrow();
    await expect(asRole(db, 'fcd_user', ids.admin, true, (x) => x.query(`insert into fcd.scorecard_disputes (root_id, partner_org_id, kind, body, created_by) values ($1,$2,'rejected','번복',$3)`, [d[0].id, partnerOrg, ids.admin]))).rejects.toThrow();
    await asRole(db, 'fcd_user', ids.partner, true, (x) => x.query(`insert into fcd.scorecard_disputes (root_id, partner_org_id, kind, body, created_by, created_at) values ($1,$2,'note','고맙습니다',$3, now() + interval '1 minute')`, [d[0].id, partnerOrg, ids.partner]));
    expect(await acceptedDisputeRefs(db, true)).toContain('EXNOTE-0001');
  });
});

describe('서버 — 제출·새 판(관세청 꺼짐)', () => {
  it('예시 물류사가 번호를 내면 제출 기록 + 물류사 번호가 생기고 바로 흉내 단계가 쌓인다 · 같은 번호는 한 번', async () => {
    const { parseSubmission, submitCargoNumbers } = await import('@/lib/server/scorecard');
    const v = { id: ids.partner, orgs: [{ id: partnerOrg, kind: 'partner', is_demo: true }], org: { id: partnerOrg, kind: 'partner', is_demo: true } } as never;
    const lines = parseSubmission('EXSUB-T-0001\nEXSUB-T-0002\nP123456789012', { kind: 'hbl', year: 2026, thisYear: 2026 });
    const r = await submitCargoNumbers(v, partnerOrg, lines, { port: 'ICN', mode: 'LCL' });
    expect(r).toMatchObject({ added: 2, already: 0, waiting: false });
    expect(r.rejected).toHaveLength(1);
    const again = await submitCargoNumbers(v, partnerOrg, lines.slice(0, 1), { port: 'ICN', mode: 'LCL' });
    expect(again).toMatchObject({ added: 0, already: 1 });
    const t = await db.query<{ n: number; ev: number }>(
      `select count(*)::int n, (select count(*)::int from fcd.cargo_track_events e join fcd.cargo_tracks x on x.id = e.track_id where x.org_id = $1 and x.number like 'EXSUB-T-%') ev
         from fcd.cargo_tracks where org_id = $1 and number like 'EXSUB-T-%'`,
      [partnerOrg],
    );
    expect(t[0].n).toBe(2);
    expect(t[0].ev).toBeGreaterThan(0);
  });
  it('새 판 — 앞 판을 supersedes_id 로 가리킨다 · 받아들인 이의 화물은 빠진다', async () => {
    const { recomputeScorecardsNow } = await import('@/lib/server/scorecard');
    const r = await recomputeScorecardsNow(db);
    expect(r.rows).toBeGreaterThan(20);
    const s = await db.query<{ n: number }>(`select count(*)::int n from fcd.scorecard_snapshots where batch_id = $1 and supersedes_id is not null`, [r.batchId]);
    expect(s[0].n).toBeGreaterThan(0);
    const acc = await db.query<{ cargo_ref: string }>(`select d.cargo_ref from fcd.scorecard_disputes d where d.root_id is null and exists (select 1 from fcd.scorecard_disputes x where x.root_id = d.id and x.kind = 'accepted')`);
    expect(acc.length).toBeGreaterThanOrEqual(1);
    // 공개정보 기준(public_info) 업체에는 이름 붙은 판을 만들지 않는다
    const pi = await db.query<{ n: number }>(
      `select count(*)::int n from fcd.scorecard_snapshots s join fcd.orgs o on o.id = s.entity_org_id where s.batch_id = $1 and o.status = 'public_info'`,
      [r.batchId],
    );
    expect(pi[0].n).toBe(0);
  });
  it('연도만 적은 이의(2026)를 받아들여도 성적표가 무너지지 않는다', async () => {
    const { recomputeScorecardsNow } = await import('@/lib/server/scorecard');
    const before = await recomputeScorecardsNow(db);
    const n0 = (await db.query<{ n: number }>(`select n from fcd.scorecard_snapshots where batch_id = $1 and entity_kind = 'overall' and port is null and demo_org_id is not null`, [before.batchId]))[0].n;
    const d = await db.query<{ id: string }>(`insert into fcd.scorecard_disputes (partner_org_id, kind, metric, cargo_ref, body, created_by) values ($1,'open','clearance','2026','연도만',$2) returning id`, [partnerOrg, ids.partner]);
    await db.query(`insert into fcd.scorecard_disputes (root_id, partner_org_id, kind, body, created_by) values ($1,$2,'accepted','시험',$3)`, [d[0].id, partnerOrg, ids.admin]);
    const after = await recomputeScorecardsNow(db);
    const n1 = (await db.query<{ n: number }>(`select n from fcd.scorecard_snapshots where batch_id = $1 and entity_kind = 'overall' and port is null and demo_org_id is not null`, [after.batchId]))[0].n;
    expect(n1).toBe(n0);
    expect(after.withSamples).toBeGreaterThan(0);
  });
});

describe('데모 걷어내기 — 새 표도 함께', () => {
  it('DEMO_TABLES 에 다섯 표가 있고, 걷어내면 데모 건수가 0', async () => {
    const names = ['partner_cargo_submissions', 'partner_customs_codes', 'broker_profiles', 'scorecard_snapshots', 'scorecard_disputes'];
    expect(DEMO_TABLES.map((t) => t.table)).toEqual(expect.arrayContaining(names));
    const before = await db.transaction((tx) => demoCounts(tx));
    for (const t of names) expect(before.find((c) => c.table === t)!.demo, t).toBeGreaterThan(0);
    await db.exec(buildPurgeSql(await db.transaction((tx) => planPurge(tx))));
    const after = await db.transaction((tx) => demoCounts(tx));
    for (const t of names) expect(after.find((c) => c.table === t)!.demo, t).toBe(0);
  });
});
