/**
 * v2 interview — 셀러 인터뷰 · 먼저 검증할 실험 셋.
 * 순수 함수(지불 의향 곡선·윌슨 구간·판정·순위·업로드 비율·물량 단가 곡선) +
 * 메모리 PGlite(운영 DB 아님)에서 RLS·권한·토큰 함수·새 판·데모 걷어내기.
 * 화면 흐름은 e2e/v2-interview.spec.ts.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
import type { Driver } from '@/lib/db/driver';
import { setDbForTests } from '@/lib/db';
import {
  bucketOf,
  consolidationReads,
  medianInt,
  overallVerdict,
  parseResearchRules,
  readLadder,
  scoreSummary,
  shareBp,
  tally,
  totalVsMedian,
  uploadRate,
  volumeCurves,
  wilsonBp,
  wtpCurve,
  type ResearchRules,
} from '@/lib/money/research';
import { Answers, PAIN, SaveInput, cargoFromCbm, progressOf, stepRatio } from '@/lib/research/answers';
import { STANDARD_CARGO } from '@/lib/standard-cargo';
import { hashInviteToken, newInviteToken } from '@/lib/workspace/invite';
import { RESEARCH_SETTINGS, SETTINGS } from '@seed/reference/data';
import { DEMO_ACCOUNTS, seedDemo } from '@seed/demo';
import { buildPurgeSql, planPurge } from '@seed/demo/purge';
import { DEMO_TABLES, demoCounts } from '@/lib/server/demo-status';
import { interviewPreview, researchBoard, visitorHash } from '@/lib/server/research';
import { PLATFORM_ORG_ID } from '@seed/reference';
import { asRole, hazardDb, todayKst } from './helpers';

const RULES: ResearchRules = parseResearchRules(RESEARCH_SETTINGS[0].value);

describe('판정선은 설정 표에(첫 판) — 코드에 박지 않는다', () => {
  it('research.rules 가 참조 시드에 있고 읽힌다', () => {
    expect(SETTINGS.find((s) => s.key === 'research.rules')).toBeTruthy();
    expect(RULES.ladderBp).toEqual([100, 300, 500, 800]);
    expect(RULES.thresholdBp).toBe(300);
    expect(RULES.majorityBp).toBe(5000);
    expect(RULES.minSample).toBe(12);
  });
  it('모양이 틀리면 멈춘다', () => {
    expect(() => parseResearchRules(undefined)).toThrow(/research\.rules/);
    expect(() => parseResearchRules({ ...(RESEARCH_SETTINGS[0].value as object), ladderBp: [300, 100] })).toThrow(/ladderBp/);
    expect(() => parseResearchRules({ ...(RESEARCH_SETTINGS[0].value as object), inviteDays: 120 })).toThrow(/inviteDays/);
  });
});

describe('비율·윌슨 구간', () => {
  it('bp 사사오입, 0 분모는 null, 틀린 인자는 거절', () => {
    expect(shareBp(7, 12)).toBe(5833);
    expect(shareBp(1, 8)).toBe(1250);
    expect(shareBp(1, 3)).toBe(3333);
    expect(shareBp(2, 3)).toBe(6667);
    expect(shareBp(0, 0)).toBeNull();
    expect(() => shareBp(3, 2)).toThrow(RangeError);
    expect(() => shareBp(-1, 2)).toThrow(RangeError);
  });
  it('윌슨 95% — 7/12 은 대략 32%~81%, 0/n·n/n 도 0~100 안', () => {
    const [lo, hi] = wilsonBp(7, 12)!;
    expect(lo).toBeGreaterThanOrEqual(3190);
    expect(lo).toBeLessThanOrEqual(3200);
    expect(hi).toBeGreaterThanOrEqual(8063);
    expect(hi).toBeLessThanOrEqual(8073);
    expect(wilsonBp(0, 10)![0]).toBe(0);
    expect(wilsonBp(10, 10)![1]).toBe(10000);
    expect(wilsonBp(0, 0)).toBeNull();
  });
});

describe('가격 사다리 읽기', () => {
  const S = RULES.ladderBp;
  it('낮은 값부터 이어진 「예」까지가 한도', () => {
    expect(readLadder({ '100': true, '300': true, '500': false }, S)).toEqual({ answered: true, maxBp: 300, inconsistent: false, topped: false });
    expect(readLadder({ '100': false }, S)).toMatchObject({ answered: true, maxBp: 0 });
    expect(readLadder({ '100': true, '300': true, '500': true, '800': true }, S)).toMatchObject({ maxBp: 800, topped: true });
  });
  it('묻지 않은 값은 아니오로 — 멈춤 규칙', () => {
    expect(readLadder({ '100': true }, S)).toMatchObject({ maxBp: 100, inconsistent: false });
  });
  it('「아니오」 뒤 「예」는 모순 — 이어진 「예」까지만 인정', () => {
    expect(readLadder({ '100': true, '300': false, '500': true }, S)).toEqual({ answered: true, maxBp: 100, inconsistent: true, topped: false });
  });
  it('첫 값에 답이 없으면 답하지 않은 사람', () => {
    expect(readLadder(undefined, S).answered).toBe(false);
    expect(readLadder({ '300': true }, S).answered).toBe(false);
  });
});

const L = (max: number) => {
  const l: Record<string, boolean> = {};
  for (const b of RULES.ladderBp) {
    if (b <= max) l[String(b)] = true;
    else {
      l[String(b)] = false;
      break;
    }
  }
  return l;
};

describe('지불 의향 곡선 · 판정', () => {
  it('확인된 의향 = 반대 질문에서 「그렇다」가 아닌 사람만. 절반 초과면 충족', () => {
    const rows = [
      ...Array.from({ length: 7 }, () => ({ ladder: L(500), counter: 'disagree' as const })),
      { ladder: L(300), counter: 'agree' as const },
      ...Array.from({ length: 4 }, () => ({ ladder: L(100), counter: 'unsure' as const })),
    ];
    const c = wtpCurve(rows, RULES);
    expect(c.n).toBe(12);
    const t = c.threshold.confirmed!;
    expect(t.bp).toBe(300);
    expect(t.stated).toBe(8);
    expect(t.confirmed).toBe(7);
    expect(t.confirmedBp).toBe(5833);
    expect(c.wavered).toBe(1);
    expect(c.verdict).toBe('met');
    expect(c.strong).toBe(false); // 윌슨 아래 끝 32% < 50%
    expect(c.gapBp).toBe(6667 - 5833);
    expect(c.steps.map((s) => s.stated)).toEqual([12, 8, 7, 0]);
  });
  it('정확히 절반은 미충족(다수 = 절반 초과)', () => {
    const rows = [...Array.from({ length: 6 }, () => ({ ladder: L(300), counter: 'disagree' as const })), ...Array.from({ length: 6 }, () => ({ ladder: L(100), counter: 'disagree' as const }))];
    expect(wtpCurve(rows, RULES).verdict).toBe('not_met');
  });
  it('표본이 기준보다 적으면 숫자가 높아도 「표본 부족」', () => {
    const rows = Array.from({ length: 11 }, () => ({ ladder: L(800), counter: 'disagree' as const }));
    const c = wtpCurve(rows, RULES);
    expect(c.threshold.confirmed!.confirmedBp).toBe(10000);
    expect(c.verdict).toBe('insufficient');
  });
  it('사다리에 답하지 않은 사람은 분모에서 뺀다', () => {
    const rows = [...Array.from({ length: 12 }, () => ({ ladder: L(800), counter: 'disagree' as const })), { ladder: undefined, counter: undefined }];
    const c = wtpCurve(rows, RULES);
    expect(c.n).toBe(12);
    expect(c.verdict).toBe('met');
    expect(c.strong).toBe(true);
  });
  it('기준 값이 사다리에 없으면 그 위 첫 사다리 값으로', () => {
    const c = wtpCurve([{ ladder: L(500), counter: 'disagree' }], { ...RULES, thresholdBp: 400, minSample: 1 });
    expect(c.threshold.confirmed!.bp).toBe(500);
    expect(c.verdict).toBe('met');
  });
});

describe('순위·점수', () => {
  it('많은 순, 같으면 정해 둔 순서', () => {
    const r = tally(['fc_reject', 'extra_charges', 'extra_charges', 'hard_compare', 'fc_reject', null, 'nope' as never], PAIN);
    expect(r.slice(0, 3).map((x) => [x.key, x.n])).toEqual([
      ['extra_charges', 2],
      ['fc_reject', 2],
      ['hard_compare', 1],
    ]);
    expect(r[0].bp).toBe(4000); // 2/5 — 목록 밖 값·빈 값은 분모에서 뺀다
  });
  it('쓸모 점수 평균·분포·4·5 점 비율', () => {
    const s = scoreSummary([5, 4, 4, 3, null, 1, 7 as number]);
    expect(s).toEqual({ n: 5, mean: 3.4, dist: [1, 0, 1, 2, 1], topBoxBp: 6000 });
    expect(scoreSummary([]).mean).toBeNull();
  });
});

describe('실험 ② 업로드 비율', () => {
  it('점검까지 간 기기 ÷ 방문 기기 · 방문이 적으면 표본 부족', () => {
    const r = uploadRate({ visitors: 380, inputters: 124, runners: 95, savers: 16 }, RULES);
    expect(r.runBp).toBe(2500);
    expect(r.inputBp).toBe(3263);
    expect(r.verdict).toBe('met');
    expect(uploadRate({ visitors: 99, inputters: 50, runners: 50, savers: 0 }, RULES).verdict).toBe('insufficient');
    expect(uploadRate({ visitors: 200, inputters: 40, runners: 29, savers: 0 }, RULES).verdict).toBe('not_met'); // 14.5%
    expect(uploadRate({ visitors: 200, inputters: 40, runners: 30, savers: 0 }, RULES).verdict).toBe('met'); // 15% 는 충족(이상)
  });
  it('방문보다 많은 점검 기기는 방문 수로 자른다', () => {
    expect(uploadRate({ visitors: 100, inputters: 120, runners: 130, savers: 0 }, RULES).runBp).toBe(10000);
  });
});

describe('실험 ③ 물량 단가 곡선', () => {
  const Q = (kind: 'consolidator' | 'forwarder', volumeCbm: number, unitPriceKrw: number, includes: 'sea_cfs' | 'to_fc' = 'sea_cfs') => ({ kind, includes, volumeCbm, unitPriceKrw });
  it('구간 = 그 물량 이하 가장 큰 구간 값', () => {
    expect(bucketOf(0.5, RULES.volumeBucketsCbm)).toBe(1);
    expect(bucketOf(3, RULES.volumeBucketsCbm)).toBe(3);
    expect(bucketOf(7.5, RULES.volumeBucketsCbm)).toBe(5);
    expect(bucketOf(100, RULES.volumeBucketsCbm)).toBe(40);
  });
  it('중간값(짝수는 가운데 둘 평균 사사오입)과 첫 구간 대비 할인', () => {
    expect(medianInt([3, 1, 2])).toBe(2);
    expect(medianInt([65000, 66000])).toBe(65500);
    expect(medianInt([1, 2])).toBe(2); // 1.5 → 2
    expect(medianInt([])).toBeNull();
    const c = volumeCurves([Q('consolidator', 1, 64000), Q('consolidator', 10, 52000), Q('consolidator', 12, 50000), Q('forwarder', 3, 65000)], RULES.volumeBucketsCbm);
    expect(c.map((x) => `${x.kind}|${x.includes}`)).toEqual(['consolidator|sea_cfs', 'forwarder|sea_cfs']);
    const p10 = c[0].points.find((p) => p.bucket === 10)!;
    expect(p10).toEqual({ bucket: 10, n: 2, median: 51000, discountBp: 2031 }); // (64000−51000)/64000
    expect(c[1].points.find((p) => p.bucket === 1)!.median).toBeNull();
  });
  it('콘솔사 큰 물량 대 포워더 작은 물량 — 같은 포함 범위끼리, 양쪽 표본 기준', () => {
    const qs = [
      Q('consolidator', 10, 52000), Q('consolidator', 20, 49000), Q('consolidator', 10, 54000),
      Q('forwarder', 1, 68000), Q('forwarder', 3, 65000), Q('forwarder', 2, 66000), Q('forwarder', 10, 58000),
      Q('forwarder', 3, 98000, 'to_fc'),
    ];
    const r = consolidationReads(qs, RULES);
    const sea = r.find((x) => x.includes === 'sea_cfs')!;
    expect(sea.big).toEqual({ n: 3, median: 52000 });
    expect(sea.small).toEqual({ n: 3, median: 66000 });
    expect(sea.discountBp).toBe(2121);
    expect(sea.verdict).toBe('met');
    expect(r.find((x) => x.includes === 'to_fc')!.verdict).toBe('insufficient');
    expect(overallVerdict(r.map((x) => x.verdict))).toBe('met');
    expect(overallVerdict(['insufficient', 'not_met'])).toBe('not_met');
    expect(overallVerdict([])).toBe('insufficient');
  });
  it('틀린 단가는 거절', () => {
    expect(() => volumeCurves([Q('forwarder', 1, 1.5)], RULES.volumeBucketsCbm)).toThrow(RangeError);
    expect(() => volumeCurves([Q('forwarder', 0, 1000)], RULES.volumeBucketsCbm)).toThrow(RangeError);
  });
});

describe('인터뷰 미리 계산 · 답변 모양', () => {
  it('지난 물류비 대 중간값 — 청구서 점검과 같은 판정선', () => {
    const rule = { highOverMedianBp: 2000, lowUnderMedianBp: 3000 };
    expect(totalVsMedian(1_200_000, 1_000_000, rule)).toEqual({ overMedianBp: 2000, tone: 'high' });
    expect(totalVsMedian(1_199_000, 1_000_000, rule).tone).toBe('typical');
    expect(totalVsMedian(700_000, 1_000_000, rule)).toEqual({ overMedianBp: -3000, tone: 'low' });
    expect(totalVsMedian(1, 3, rule).overMedianBp).toBe(-6667);
    expect(totalVsMedian(5, 0, rule).tone).toBe('unknown');
  });
  it('CBM 으로 기준 화물을 비례해 늘린다(없으면 기준 화물 그대로)', () => {
    expect(cargoFromCbm(undefined)).toEqual(STANDARD_CARGO);
    const c = cargoFromCbm(6);
    expect(c).toMatchObject({ units: 2400, cartons: 80, kg: 1300, cbm: 6, goodsValue: 48000, goodsCurrency: 'RMB' });
    expect(cargoFromCbm(0.1).units).toBeGreaterThanOrEqual(1);
  });
  it('답변 모양 — 모르는 칸·범위 밖 값은 거절', () => {
    expect(Answers.safeParse({ v: 1, lane: { cbm: 3 }, ladder: { '100': true }, counter: 'agree' }).success).toBe(true);
    expect(Answers.safeParse({ v: 2 }).success).toBe(false);
    expect(Answers.safeParse({ v: 1, screens: { check: { score: 6 } } }).success).toBe(false);
    expect(Answers.safeParse({ v: 1, pain: 'unknown' }).success).toBe(false);
    expect(SaveInput.safeParse({ step: 'lane', answers: { v: 1 }, complete: false }).success).toBe(true);
    expect(SaveInput.safeParse({ step: 'nope', answers: { v: 1 }, complete: false }).success).toBe(false);
  });
  it('진행 상태', () => {
    expect(progressOf({ consent_state: 'declined', invites: 1, opened: true, head_step: null, completed: false })).toBe('declined');
    expect(progressOf({ consent_state: 'agreed', invites: 1, opened: true, head_step: 'done', completed: true })).toBe('done');
    expect(progressOf({ consent_state: 'agreed', invites: 1, opened: true, head_step: 'ladder', completed: false })).toBe('in_progress');
    expect(progressOf({ consent_state: 'none', invites: 1, opened: false, head_step: null, completed: false })).toBe('invited');
    expect(progressOf({ consent_state: 'none', invites: 0, opened: false, head_step: null, completed: false })).toBe('not_invited');
    expect(stepRatio('done')).toBe(1);
    expect(stepRatio(null)).toBe(0);
  });
  it('기기 번호는 해시로만', () => {
    expect(visitorHash('abcdefghijklmnop')).toMatch(/^[0-9a-f]{64}$/);
    expect(visitorHash('abcdefghijklmnop')).not.toContain('abcdefghijklmnop');
  });
});

describe('DB — RLS·권한·토큰 함수·데모(메모리 PGlite)', () => {
  let db: Driver;
  let adminUser: string;
  let demoPlatform: string;
  let shipperUser: string;
  const REAL_ADMIN = '30000000-0000-4000-8000-0000000000aa';
  let realParticipant: string;

  beforeAll(async () => {
    db = await hazardDb();
    await seedDemo(db, { today: todayKst(), password: 'test-only-password' });
    const a = (await db.query<{ id: string; home_org_id: string }>(`select id, home_org_id from fcd.profiles where email = $1`, [DEMO_ACCOUNTS.admin.email]))[0];
    adminUser = a.id;
    demoPlatform = a.home_org_id;
    shipperUser = (await db.query<{ id: string }>(`select id from fcd.profiles where email = $1`, [DEMO_ACCOUNTS.shipper.email]))[0].id;
    // 걷어내기 뒤에도 남아야 하는 「실제」 운영자와 그 참여자·단가·퍼널
    await db.exec(`
      insert into fcd.profiles (id, home_org_id, email, name) values ('${REAL_ADMIN}', '${PLATFORM_ORG_ID}', 'real-admin@example.com', '실제운영');
      insert into fcd.memberships (user_id, org_id, role) values ('${REAL_ADMIN}', '${PLATFORM_ORG_ID}', 'platform_admin');
    `);
    realParticipant = (
      await asRole(db, 'fcd_user', REAL_ADMIN, false, (q) =>
        q.query<{ id: string }>(`insert into fcd.research_participants (org_id, code, label, contact, created_by) values ($1,'P-01','실제 셀러 한 분','010-1234-5678',$2) returning id`, [PLATFORM_ORG_ID, REAL_ADMIN]),
      )
    )[0].id;
    await asRole(db, 'fcd_user', REAL_ADMIN, false, (q) =>
      q.query(`insert into fcd.research_vendor_quotes (org_id, vendor_label, vendor_kind, includes, volume_cbm, unit_price_krw, source, quoted_on, created_by) values ($1,'실제 콘솔사','consolidator','sea_cfs',10,50000,'call','2026-09-01',$2)`, [PLATFORM_ORG_ID, REAL_ADMIN]),
    );
    await asRole(db, 'fcd_public', null, false, (q) => q.query(`select fcd.record_check_event('check_visit', null, $1, false)`, ['a'.repeat(64)]));
  });
  afterAll(async () => {
    setDbForTests(undefined);
    await db?.close();
  });

  it('새 표 다섯은 RLS 가 켜져 있고, 답변·단가·퍼널에는 UPDATE·DELETE 권한이 없다', async () => {
    const T = ['research_participants', 'research_consents', 'research_invites', 'research_responses', 'research_vendor_quotes', 'check_funnel_events'];
    const rls = await db.query<{ relname: string; relrowsecurity: boolean }>(
      `select c.relname, c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'fcd' and c.relname = any($1::text[])`,
      [T],
    );
    expect(rls).toHaveLength(6);
    for (const r of rls) expect(r.relrowsecurity, r.relname).toBe(true);
    for (const t of ['research_consents', 'research_responses', 'research_vendor_quotes', 'check_funnel_events']) {
      const p = await db.query<{ u: boolean; d: boolean }>(`select has_table_privilege('fcd_user', $1, 'update') u, has_table_privilege('fcd_user', $1, 'delete') d`, [`fcd.${t}`]);
      expect(p[0], t).toEqual({ u: false, d: false });
    }
    for (const t of T) {
      for (const role of ['fcd_public', 'anon', 'authenticated']) {
        const p = await db.query<{ s: boolean; i: boolean }>(`select has_table_privilege($2, $1, 'select') s, has_table_privilege($2, $1, 'insert') i`, [`fcd.${t}`, role]);
        expect(p[0], `${role} ${t}`).toEqual({ s: false, i: false });
      }
    }
    const f = await db.query<{ i: boolean }>(`select has_table_privilege('fcd_user', 'fcd.check_funnel_events', 'insert') i`);
    expect(f[0].i).toBe(false);
  });

  it('데모 보드 — 예시 12명으로 방안 A 약한 충족 · 업로드 충족 · 공동 혼적 충족', async () => {
    const b = await asRole(db, 'fcd_user', adminUser, true, (q) => researchBoard(q, 30, { includeDemo: true }));
    expect(b.participants.filter((p) => /^예시 셀러 \d+$/.test(p.label))).toHaveLength(14);
    expect(b.progress.done).toBe(12);
    expect(b.participants.find((p) => p.code === 'P-13' && p.is_demo)!.progress).toBe('in_progress');
    expect(b.participants.find((p) => p.code === 'P-14' && p.is_demo)!.progress).toBe('invited');
    expect(b.wtp.n).toBe(12);
    expect(b.wtp.threshold.confirmed).toMatchObject({ stated: 8, confirmed: 7, confirmedBp: 5833 });
    expect(b.wtp.verdict).toBe('met');
    expect(b.wtp.strong).toBe(false);
    expect(b.pain[0]).toMatchObject({ key: 'extra_charges', n: 6 });
    expect(b.quotes.length).toBeGreaterThan(5);
    expect(b.quotes.every((q) => q.text.length > 0)).toBe(true);
    expect(b.funnel.upload.verdict).toBe('met');
    expect(b.funnel.counts.visitors).toBe(381);
    const sea = b.vendor.consolidation.find((c) => c.includes === 'sea_cfs')!;
    expect(sea).toMatchObject({ big: { n: 6, median: 50000 }, small: { n: 5, median: 66000 }, verdict: 'met' });
    // 새 판이 나온 옛 단가(66,000)는 곡선에서 빠진다
    expect(b.vendor.rows.some((r) => r.unit_price_krw === 66000 && r.vendor_label === '예시 포워더 A')).toBe(false);
    expect(b.vendor.consolidation.find((c) => c.includes === 'to_fc')!.verdict).toBe('insufficient');
  });

  it('미리 계산 — 셀러 조건으로 확정가·점검·판매손익(집계만)', async () => {
    setDbForTests(db);
    const p = await interviewPreview({ hub: 'YIW', port: 'ICN', mode: 'LCL', cbm: 3, price: 19900, lastTotal: 3_000_000 });
    expect(p.lane).toMatchObject({ hub: 'YIW', port: 'ICN', mode: 'LCL', usedDefault: false });
    expect(p.arrival.median).toBeGreaterThan(0);
    expect(p.firm.ok).toBe(true);
    if (p.firm.ok) {
      expect(p.firm.firmPrice).toBe(p.firm.base + p.firm.premium);
      expect(p.firm.premiumBp).toBeGreaterThan(0);
      expect(Object.keys(p.firm).sort()).toEqual(['base', 'firmPrice', 'lowSample', 'n', 'offerable', 'ok', 'premium', 'premiumBp']); // 최저·경계값은 싣지 않는다
    }
    expect(p.check).toMatchObject({ given: true, total: 3_000_000, median: p.arrival.median });
    expect(p.pnl.profit).not.toBeNull();
    expect(p.pnl.breakEvenPrice).toBeGreaterThan(p.pnl.arrivalPerUnit);
    const d = await interviewPreview(undefined);
    expect(d.lane.usedDefault).toBe(true);
    expect(d.check).toEqual({ given: false });
    expect(d.pnl.profit).toBeNull();
  });

  it('토큰 해시·연락처 칸은 운영자도 표에서 읽지 못하고, 보기에는 가려서 나온다', async () => {
    await expect(asRole(db, 'fcd_user', adminUser, true, (q) => q.query(`select token_hash from fcd.research_invites limit 1`))).rejects.toThrow(/permission/);
    await expect(asRole(db, 'fcd_user', adminUser, true, (q) => q.query(`select contact from fcd.research_participants limit 1`))).rejects.toThrow(/permission/);
    const rows = await asRole(db, 'fcd_user', REAL_ADMIN, false, (q) => q.query<{ contact_masked: string }>(`select contact_masked from fcd.v_research_participants where id = $1`, [realParticipant]));
    expect(rows[0].contact_masked).toBe('010-****-5678');
    const m = await db.query<{ a: string; b: string; c: string | null }>(`select fcd.mask_contact('seller@example.com') a, fcd.mask_contact('abc') b, fcd.mask_contact('  ') c`);
    expect(m[0]).toEqual({ a: 'se***@example.com', b: 'ab*', c: null });
  });

  it('연락처 풀어 보기는 운영자만, 볼 때마다 감사 기록', async () => {
    const before = (await db.query<{ n: number }>(`select count(*)::int n from fcd.audit_log where action = 'research.contact_viewed'`))[0].n;
    const c = await asRole(db, 'fcd_user', REAL_ADMIN, false, (q) => q.query<{ c: string }>(`select fcd.research_contact($1) c`, [realParticipant]));
    expect(c[0].c).toBe('010-1234-5678');
    const after = (await db.query<{ n: number }>(`select count(*)::int n from fcd.audit_log where action = 'research.contact_viewed'`))[0].n;
    expect(after).toBe(before + 1);
    const s = await asRole(db, 'fcd_user', shipperUser, true, (q) => q.query<{ c: string | null }>(`select fcd.research_contact($1) c`, [realParticipant]));
    expect(s[0].c).toBeNull();
  });

  it('화주·비로그인은 인터뷰 표를 보지 못한다', async () => {
    const s = await asRole(db, 'fcd_user', shipperUser, true, (q) => q.query<{ n: number }>(`select (select count(*) from fcd.research_responses)::int + (select count(*) from fcd.v_research_participants)::int + (select count(*) from fcd.check_funnel_events)::int n`));
    expect(s[0].n).toBe(0);
    await expect(asRole(db, 'fcd_user', shipperUser, true, (q) => q.query(`insert into fcd.research_participants (org_id, code, label, created_by) values ($1,'P-99','x',$2)`, [demoPlatform, shipperUser]))).rejects.toThrow();
  });

  it('링크 흐름 — 열기 → 동의 전 저장 막힘 → 동의 → 진행 저장(새 판) → 끝내면 닫힘', async () => {
    const pid = (
      await asRole(db, 'fcd_user', adminUser, true, (q) =>
        q.query<{ id: string }>(`insert into fcd.research_participants (org_id, code, label, created_by) values ($1,'P-90','시험 셀러',$2) returning id`, [demoPlatform, adminUser]),
      )
    )[0].id;
    const token = newInviteToken();
    const h = hashInviteToken(token);
    await asRole(db, 'fcd_user', adminUser, true, (q) =>
      q.query(`insert into fcd.research_invites (org_id, participant_id, token_hash, expires_at, created_by) values ($1,$2,$3, now() + interval '14 days', $4)`, [demoPlatform, pid, h, adminUser]),
    );
    const pub = <T>(sql: string, params: unknown[]) => asRole(db, 'fcd_public', null, true, (q) => q.query<T & Record<string, unknown>>(sql, params));
    const o1 = await pub<{ status: string; consent_state: string; head_id: string | null }>(`select * from fcd.research_invite_open($1)`, [h]);
    expect(o1[0]).toMatchObject({ status: 'open', consent_state: 'none', head_id: null });
    const noc = await pub<{ result: string }>(`select * from fcd.research_save($1,'screens',$2::jsonb,false)`, [h, JSON.stringify({ v: 1 })]);
    expect(noc[0].result).toBe('no_consent');
    expect((await pub<{ r: string }>(`select fcd.research_consent($1, true, 'v-test') r`, [h]))[0].r).toBe('ok');
    const s1 = await pub<{ result: string; version: number }>(`select * from fcd.research_save($1,'screens',$2::jsonb,false)`, [h, JSON.stringify({ v: 1, lane: { cbm: 3 } })]);
    expect(s1[0]).toMatchObject({ result: 'ok', version: 1 });
    const s2 = await pub<{ result: string; version: number }>(`select * from fcd.research_save($1,'ladder',$2::jsonb,false)`, [h, JSON.stringify({ v: 1, lane: { cbm: 4 } })]);
    expect(s2[0]).toMatchObject({ result: 'ok', version: 2 });
    const o2 = await pub<{ status: string; head_version: number; step: string; answers: { lane: { cbm: number } } }>(`select * from fcd.research_invite_open($1)`, [h]);
    expect(o2[0]).toMatchObject({ status: 'open', head_version: 2, step: 'ladder' });
    expect(o2[0].answers.lane.cbm).toBe(4);
    const fin = await pub<{ result: string }>(`select * from fcd.research_save($1,'comment',$2::jsonb,true)`, [h, JSON.stringify({ v: 1, comment: '끝' })]);
    expect(fin[0].result).toBe('ok');
    const last = await db.query<{ step: string; completed: boolean; source: string }>(`select step, completed, source from fcd.v_research_responses_current where participant_id = $1`, [pid]);
    expect(last[0]).toEqual({ step: 'done', completed: true, source: 'self' });
    const o3 = await pub<{ status: string; answers: unknown }>(`select * from fcd.research_invite_open($1)`, [h]);
    expect(o3[0]).toMatchObject({ status: 'completed', answers: null });
    expect((await pub<{ result: string }>(`select * from fcd.research_save($1,'lane',$2::jsonb,false)`, [h, JSON.stringify({ v: 1 })]))[0].result).toBe('completed');
    // 판은 셋, 한 줄기
    const chain = await db.query<{ n: number; roots: number }>(`select count(*)::int n, count(*) filter (where supersedes_id is null)::int roots from fcd.research_responses where participant_id = $1`, [pid]);
    expect(chain[0]).toEqual({ n: 3, roots: 1 });
  });

  it('끝낸 인터뷰를 운영이 대신 고쳐도 끝남은 그대로 — 링크는 닫혀 있고 보드의 「끝」에서 빠지지 않는다', async () => {
    const pid = (await db.query<{ id: string }>(`select id from fcd.research_participants where org_id = $1 and code = 'P-90'`, [demoPlatform]))[0].id;
    const token = newInviteToken();
    const h = hashInviteToken(token);
    await db.query(`insert into fcd.research_invites (org_id, participant_id, token_hash, expires_at) values ($1,$2,$3, now() + interval '1 day')`, [demoPlatform, pid, h]);
    const head = (await db.query<{ id: string; version: number }>(`select id, version from fcd.v_research_responses_current where participant_id = $1`, [pid]))[0];
    // 옛 코드처럼 끝나지 않은 판(completed=false)을 뒤에 쌓아도
    await asRole(db, 'fcd_user', adminUser, true, (q) =>
      q.query(`insert into fcd.research_responses (org_id, participant_id, version, supersedes_id, source, step, completed, answers, created_by) values ($1,$2,$3,$4,'interviewer','screens',false,'{"v":1}'::jsonb,$5)`, [demoPlatform, pid, head.version + 1, head.id, adminUser]),
    );
    const pub = <T>(sql: string, params: unknown[]) => asRole(db, 'fcd_public', null, true, (q) => q.query<T & Record<string, unknown>>(sql, params));
    expect((await pub<{ status: string }>(`select status from fcd.research_invite_open($1)`, [h]))[0].status).toBe('completed');
    expect((await pub<{ result: string }>(`select * from fcd.research_save($1,'ladder','{"v":1}'::jsonb,false)`, [h]))[0].result).toBe('completed');
    const b = await asRole(db, 'fcd_user', adminUser, true, (q) => researchBoard(q, 30, { includeDemo: true }));
    expect(b.participants.find((p) => p.id === pid)!.progress).toBe('done');
  });

  it('결정 보드 기본은 예시를 뺀다 — 실제 운영자에게 데모 참여자·퍼널·단가가 섞이지 않는다', async () => {
    const b = await asRole(db, 'fcd_user', REAL_ADMIN, false, (q) => researchBoard(q, 30));
    expect(b.includeDemo).toBe(false);
    expect(b.participants.every((p) => !p.is_demo)).toBe(true);
    expect(b.participants.map((p) => p.label)).toContain('실제 셀러 한 분');
    expect(b.wtp.n).toBe(0);
    expect(b.wtp.verdict).toBe('insufficient');
    expect(b.funnel.counts.visitors).toBeLessThan(10); // 데모 380대는 빠지고 실제 방문만
    expect(b.vendor.rows.map((r) => r.vendor_label)).toEqual(['실제 콘솔사']);
    // 운영자가 DEMO_MODE 켜짐으로 봐도 기본은 빠진다
    const b2 = await asRole(db, 'fcd_user', adminUser, true, (q) => researchBoard(q, 30));
    expect(b2.participants.some((p) => p.is_demo)).toBe(false);
  });

  it('모르는·거둔·만료된 토큰, 데모 숨김이면 찾을 수 없음', async () => {
    const pub = <T>(sql: string, params: unknown[], demo = true) => asRole(db, 'fcd_public', null, demo, (q) => q.query<T & Record<string, unknown>>(sql, params));
    expect((await pub<{ status: string }>(`select status from fcd.research_invite_open($1)`, ['0'.repeat(64)]))[0].status).toBe('not_found');
    const pid = (await db.query<{ id: string }>(`select id from fcd.research_participants where org_id = $1 and code = 'P-14'`, [demoPlatform]))[0].id;
    const t1 = newInviteToken();
    const t2 = newInviteToken();
    await db.query(`insert into fcd.research_invites (org_id, participant_id, token_hash, expires_at, revoked_at, created_at) values ($1,$2,$3, now() + interval '1 day', now(), now() - interval '1 hour')`, [demoPlatform, pid, hashInviteToken(t1)]);
    await db.query(`insert into fcd.research_invites (org_id, participant_id, token_hash, expires_at, created_at) values ($1,$2,$3, now() - interval '1 hour', now() - interval '2 days')`, [demoPlatform, pid, hashInviteToken(t2)]);
    expect((await pub<{ status: string }>(`select status from fcd.research_invite_open($1)`, [hashInviteToken(t1)]))[0].status).toBe('revoked');
    expect((await pub<{ status: string }>(`select status from fcd.research_invite_open($1)`, [hashInviteToken(t2)]))[0].status).toBe('expired');
    expect((await pub<{ r: string }>(`select fcd.research_consent($1, true, 'v') r`, [hashInviteToken(t2)]))[0].r).toBe('expired');
    // 데모 숨김(DEMO_MODE=off) — 데모 운영 조직의 링크는 없는 것과 같다
    const t3 = newInviteToken();
    await db.query(`insert into fcd.research_invites (org_id, participant_id, token_hash, expires_at) values ($1,$2,$3, now() + interval '1 day')`, [demoPlatform, pid, hashInviteToken(t3)]);
    expect((await pub<{ status: string }>(`select status from fcd.research_invite_open($1)`, [hashInviteToken(t3)], false))[0].status).toBe('not_found');
    expect((await pub<{ status: string }>(`select status from fcd.research_invite_open($1)`, [hashInviteToken(t3)], true))[0].status).toBe('open');
  });

  it('인터뷰어 모드 — 운영자는 현재 판을 잇는 새 판만, 셀러 몫(self)은 못 쓴다', async () => {
    const pid = (
      await asRole(db, 'fcd_user', adminUser, true, (q) =>
        q.query<{ id: string }>(
          `insert into fcd.research_participants (org_id, code, label, created_by) values ($1,'P-91','통화 셀러',$2) returning id`,
          [demoPlatform, adminUser],
        ),
      )
    )[0].id;
    const ins = (version: number, sup: string | null, source = 'interviewer') =>
      asRole(db, 'fcd_user', adminUser, true, (q) =>
        q.query<{ id: string }>(
          `insert into fcd.research_responses (org_id, participant_id, version, supersedes_id, source, step, completed, answers, created_by) values ($1,$2,$3,$4,$5,'lane',false,'{"v":1}'::jsonb,$6) returning id`,
          [demoPlatform, pid, version, sup, source, adminUser],
        ),
      );
    const v1 = (await ins(1, null))[0].id;
    await expect(ins(1, null)).rejects.toThrow(); // 두 번째 뿌리
    const v2 = (await ins(2, v1))[0].id;
    await expect(ins(2, v1)).rejects.toThrow(); // 이미 이어진 판을 또 잇기
    await expect(ins(3, v1)).rejects.toThrow(); // 현재 판이 아닌 것을 잇기
    await expect(ins(3, v2, 'self')).rejects.toThrow(); // 셀러 몫은 함수로만
    expect((await ins(3, v2))[0].id).toBeTruthy();
    await expect(asRole(db, 'fcd_user', adminUser, true, (q) => q.query(`update fcd.research_responses set step = 'done' where id = $1`, [v1]))).rejects.toThrow(/permission/);
  });

  it('동의는 쌓기만 — 운영은 구두 동의만 적고, 지금 상태는 가장 최근 줄. 철회하면 링크 저장이 막힌다', async () => {
    const pid = (
      await asRole(db, 'fcd_user', adminUser, true, (q) =>
        q.query<{ id: string }>(`insert into fcd.research_participants (org_id, code, label, created_by) values ($1,'P-92','철회 셀러',$2) returning id`, [demoPlatform, adminUser]),
      )
    )[0].id;
    const token = newInviteToken();
    const h = hashInviteToken(token);
    await db.query(`insert into fcd.research_invites (org_id, participant_id, token_hash, expires_at) values ($1,$2,$3, now() + interval '1 day')`, [demoPlatform, pid, h]);
    const consent = (state: string, method: string) =>
      asRole(db, 'fcd_user', adminUser, true, (q) => q.query(`insert into fcd.research_consents (org_id, participant_id, state, method, version, created_by) values ($1,$2,$3,$4,'v',$5)`, [demoPlatform, pid, state, method, adminUser]));
    await expect(consent('agreed', 'self')).rejects.toThrow(); // 셀러 스스로의 동의는 함수로만
    await consent('agreed', 'verbal');
    const pub = <T>(sql: string, params: unknown[]) => asRole(db, 'fcd_public', null, true, (q) => q.query<T & Record<string, unknown>>(sql, params));
    expect((await pub<{ result: string }>(`select * from fcd.research_save($1,'screens','{"v":1}'::jsonb,false)`, [h]))[0].result).toBe('ok');
    await new Promise((r) => setTimeout(r, 5));
    await consent('withdrawn', 'verbal');
    expect((await pub<{ consent_state: string }>(`select consent_state from fcd.research_invite_open($1)`, [h]))[0].consent_state).toBe('withdrawn');
    expect((await pub<{ result: string }>(`select * from fcd.research_save($1,'ladder','{"v":1}'::jsonb,false)`, [h]))[0].result).toBe('no_consent');
    const v = await asRole(db, 'fcd_user', adminUser, true, (q) => q.query<{ consent_state: string; n: number }>(`select consent_state, (select count(*)::int from fcd.research_consents where participant_id = $1) n from fcd.v_research_participants where id = $1`, [pid]));
    expect(v[0]).toEqual({ consent_state: 'withdrawn', n: 2 });
    await expect(asRole(db, 'fcd_user', adminUser, true, (q) => q.query(`update fcd.research_consents set state = 'agreed' where participant_id = $1`, [pid]))).rejects.toThrow(/permission/);
  });

  it('퍼널 기록 함수 — 틀린 값은 넣지 않고, 비로그인도 쓸 수 있다', async () => {
    const ok = await asRole(db, 'fcd_public', null, true, (q) => q.query<{ a: boolean; b: boolean; c: boolean }>(
      `select fcd.record_check_event('check_run','paste',$1,false) a, fcd.record_check_event('check_evil',null,$1,false) b, fcd.record_check_event('check_run','paste','short',false) c`,
      ['b'.repeat(64)],
    ));
    expect(ok[0]).toEqual({ a: true, b: false, c: false });
  });

  it('데모를 걷어내면 인터뷰 데모는 0, 실제 참여자·단가·퍼널은 남는다', async () => {
    for (const t of ['research_participants', 'research_consents', 'research_invites', 'research_responses', 'research_vendor_quotes', 'check_funnel_events']) {
      expect(DEMO_TABLES.some((x) => x.table === t), t).toBe(true);
    }
    const before = await db.transaction((tx) => demoCounts(tx));
    const g = (c: typeof before, t: string) => c.find((x) => x.table === t)!;
    expect(g(before, 'research_participants').demo).toBeGreaterThanOrEqual(14);
    expect(g(before, 'research_responses').demo).toBeGreaterThanOrEqual(38);
    expect(g(before, 'check_funnel_events').demo).toBeGreaterThan(500);
    const plan = await db.transaction((tx) => planPurge(tx));
    await db.exec(buildPurgeSql(plan));
    const after = await db.transaction((tx) => demoCounts(tx));
    for (const t of ['research_participants', 'research_consents', 'research_invites', 'research_responses', 'research_vendor_quotes', 'check_funnel_events']) expect(g(after, t).demo, t).toBe(0);
    expect(g(after, 'research_participants').real).toBe(1);
    expect(g(after, 'research_vendor_quotes').real).toBe(1);
    expect(g(after, 'check_funnel_events').real).toBeGreaterThanOrEqual(2);
  });
});
