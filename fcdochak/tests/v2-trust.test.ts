/**
 * v2 trust — 점수·후기 정직하게.
 *   ① 추천 점수 항목별(scoreBreakdown) ② 표본 부족 ③ 청구 편차 평균 + 나쁜 쪽 10%
 *   ④ 회송·반려·분실(미도착) 선적 평가(outcome) ⑤ 업체 공개 답변(새 판·RLS) · 데모 걷어내기 표
 * 화면 흐름은 e2e/v2-trust.spec.ts.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Driver } from '@/lib/db/driver';
import { seedDemo } from '@seed/demo';
import { SETTINGS } from '@seed/reference/data';
import {
  SCORE_WEIGHTS,
  deviationSummary,
  outcomeOf,
  percentile,
  recommendScore,
  sampleVerdict,
  scoreBreakdown,
  scoreLabel,
  scoreParts,
} from '@/lib/money';
import { rankOffers, sortOffers, type Rankable } from '@/lib/ranking';
import { buildQuoteResponse } from '@/lib/public-quote';
import { loadTrustFacts, loadTrustRule, partnerReviews } from '@/lib/trust-query';
import { queryPublicReviews } from '@/lib/reviews-query';
import { DEMO_TABLES, demoCounts } from '@/lib/server/demo-status';
import { asRole, hazardDb, todayKst } from './helpers';

const caps = { deviationCap: 0.1, fcReturnCap: 0.1 };

describe('① 추천 점수 항목별', () => {
  it('항목 넷(정시 입고·청구 편차·FC 회송·가격 확실성)의 합이 추천 점수', () => {
    const input = { onTimeRate: 0.92, avgDeviation: 0.031, fcReturnRate: 0.018, priceCertainty: 0.74 };
    const items = scoreBreakdown(scoreParts(input, caps));
    expect(items.map((i) => i.label)).toEqual(['정시 입고', '청구 편차', 'FC 회송', '가격 확실성']);
    expect(items.map((i) => i.max)).toEqual([SCORE_WEIGHTS.onTime, SCORE_WEIGHTS.deviation, SCORE_WEIGHTS.fcReturn, SCORE_WEIGHTS.certainty]);
    const sum = items.reduce((s, i) => s + scoreParts(input, caps)[i.key], 0);
    expect(Math.round(sum * 10) / 10).toBe(recommendScore(input, caps));
    expect(items[0].points).toBe(27.6);
    expect(items.every((i) => i.ratio >= 0 && i.ratio <= 1)).toBe(true);
  });
  it('실측 없는 항목은 중립(만점의 절반)이고 그 표시가 붙는다', () => {
    const items = scoreBreakdown(scoreParts({ onTimeRate: null, avgDeviation: null, fcReturnRate: null, priceCertainty: 1 }, caps), {
      onTime: false,
      deviation: false,
      fcReturn: false,
    });
    expect(items.slice(0, 3).map((i) => [i.points, i.neutral])).toEqual([[15, true], [12.5, true], [12.5, true]]);
    expect(items[3]).toMatchObject({ points: 20, neutral: false });
  });
});

describe('② 표본 부족', () => {
  const rule = { days: 30, count: 20 };
  it('기준 미만이면 점수 대신 「표본 부족(N건)」', () => {
    expect(sampleVerdict(19, rule)).toEqual({ enough: false, n: 19, min: 20, days: 30 });
    expect(sampleVerdict(20, rule).enough).toBe(true);
    expect(sampleVerdict(Number.NaN, rule).n).toBe(0);
    expect(scoreLabel(88.4, sampleVerdict(3, rule))).toBe('표본 부족(3건)');
    expect(scoreLabel(88.4, sampleVerdict(25, rule))).toBe('추천 88.4점');
  });
  it('기준은 설정(fcd.settings)에 있다 — 코드에 박지 않는다', () => {
    expect(SETTINGS.find((s) => s.key === 'score_min_sample')?.value).toEqual({ days: 30, count: 20 });
    expect(SETTINGS.find((s) => s.key === 'review_lost_after_days')?.value).toBe(14);
  });
  it('추천순에서 표본이 모자란 업체는 점수가 높아도 뒤로(가격순은 그대로)', () => {
    type F = Rankable & { id: string };
    const mk = (id: string, score: number, total: number, enough?: boolean): F => ({
      id, score, quote: { total }, transit: [5, 8], metrics: null, partner: { related_party_note: null }, sampleEnough: enough,
    });
    const list = [mk('few', 95, 100, false), mk('ok', 70, 120, true), mk('old', 80, 110)];
    expect(sortOffers(list, 'recommend').map((o) => o.id)).toEqual(['old', 'ok', 'few']);
    expect(sortOffers(list, 'cheapest').map((o) => o.id)).toEqual(['few', 'old', 'ok']);
    expect(rankOffers(list, { sort: 'recommend', includeRelated: false }).list[2].id).toBe('few');
  });
  it('공개 계산기 응답에 표본 여부가 실린다', () => {
    const seg = [{ segment: 'freight' as const, included: true, amount: 100, certainty: 'confirmed' as const, basis: null, qty: null, discountBp: 0, minApplied: false, filled: false }];
    const offer = {
      score: 90, transit: [5, 8], metrics: null, mode: 'LCL', sampleEnough: false,
      trust: { sample: { enough: false, n: 4, min: 20, days: 30 } },
      partner: { id: 'a', name: 'A', name_zh: null, slug: 'a', status: 'official', business_type: null, logo_path: null, related_party_note: null, is_demo: true },
      quote: { segments: seg, total: 100, confirmedTotal: 100, estimatedTotal: 0, extraPossible: [], excluded: [], filled: [], perUnit: 1 },
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = buildQuoteResponse({ offers: [offer], excluded: [], verdicts: [] } as any, { sort: 'recommend', includeRelated: false, detail: false });
    expect(r.top[0]).toMatchObject({ sampleEnough: false, sampleN: 4 });
  });
});

describe('③ 청구 편차 — 평균 + 나쁜 쪽 10%(상위 10% 건 평균)', () => {
  it('백분위수는 선형 보간(percentile_cont 와 같은 정의)', () => {
    expect(percentile([], 0.9)).toBeNull();
    expect(percentile([5], 0.9)).toBe(5);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.9)).toBeCloseTo(9.1, 10);
    expect(percentile([10, 1, 5], 0.5)).toBe(5);
  });
  it('평균이 낮아도 큰 초과 청구가 나쁜 쪽 10% 에 드러난다', () => {
    const devs = [...Array(18).fill(0.005), 0.12, 0.15];
    const s = deviationSummary(devs);
    expect(s.n).toBe(20);
    expect(s.avgAbs).toBeCloseTo((18 * 0.005 + 0.27) / 20, 10);
    expect(s.avgAbs!).toBeLessThan(0.02);
    expect(s.worstCount).toBe(2);
    expect(s.worst10!).toBeCloseTo(0.135, 10); // 가장 나쁜 2건(0.12·0.15)의 평균
    // 90번째 백분위수였다면 두 건이 묻혀 1.65% 로 보였다 — 쓰지 않는 까닭
    expect(percentile(devs, 0.9)!).toBeLessThan(0.02);
    expect(s.max).toBe(0.15);
    expect(deviationSummary([])).toMatchObject({ n: 0, avgAbs: null, worst10: null });
    expect(deviationSummary([-0.02, 0.02]).avgSigned).toBe(0);
  });
});

describe('④ 선적의 끝(outcome) — 순수 규칙', () => {
  const base = { stage: 5, returnedUnits: 0, rejected: false, etaFc: '2026-09-01', lostAfterDays: 14, today: '2026-09-25' };
  it('9단계는 입고 완료 / 회송 있음', () => {
    expect(outcomeOf({ ...base, stage: 9 })).toBe('delivered');
    expect(outcomeOf({ ...base, stage: 9, returnedUnits: 3 })).toBe('fc_returned');
  });
  it('9단계 전: 반려 예외가 있으면 반려, 도착 예정일 + 기준일이 지나면 분실·미도착, 아니면 아직', () => {
    expect(outcomeOf({ ...base, rejected: true })).toBe('fc_rejected');
    expect(outcomeOf(base)).toBe('lost');
    expect(outcomeOf({ ...base, etaFc: '2026-09-11' })).toBeNull(); // 9/11 + 14 = 9/25 — 오늘은 아직
    expect(outcomeOf({ ...base, etaFc: '2026-09-10' })).toBe('lost');
    expect(outcomeOf({ ...base, lostAfterDays: null })).toBeNull();
    expect(outcomeOf({ ...base, etaFc: null })).toBeNull();
  });
});

describe('DB — 0007_reviews_v2', () => {
  let db: Driver;
  let ids: { shipper: string; partner: string; admin: string };
  const today = todayKst();
  beforeAll(async () => {
    db = await hazardDb();
    const r = await seedDemo(db, { today, password: 'test-only-password' });
    ids = r.demoIds!;
  });
  afterAll(async () => {
    await db.close();
  });

  it('SQL 규칙(fcd.outcome_of)과 순수 함수(outcomeOf)가 같다', async () => {
    const cases = [
      { stage: 9, returnedUnits: 0, rejected: false, etaFc: '2026-09-01' },
      { stage: 9, returnedUnits: 2, rejected: true, etaFc: '2026-09-01' },
      { stage: 8, returnedUnits: 0, rejected: true, etaFc: '2026-09-20' },
      { stage: 6, returnedUnits: 0, rejected: false, etaFc: '2026-09-01' },
      { stage: 6, returnedUnits: 0, rejected: false, etaFc: '2026-09-11' },
      { stage: 3, returnedUnits: 0, rejected: false, etaFc: null },
    ];
    for (const c of cases) {
      const r = await db.query<{ o: string | null }>(`select fcd.outcome_of($1::smallint, $2::int, $3::boolean, $4::date, 14, '2026-09-25'::date) o`, [c.stage, c.returnedUnits, c.rejected, c.etaFc]);
      expect(r[0].o, JSON.stringify(c)).toBe(outcomeOf({ ...c, lostAfterDays: 14, today: '2026-09-25' }));
    }
  });

  it('데모에 회송·반려·분실 후기와 업체 답변(고친 판 포함)이 있고, 미래 날짜가 없다', async () => {
    const rows = await asRole(db, 'fcd_public', null, true, (q) =>
      q.query<{ outcome: string; n: number }>(`select fcd.review_outcome(id) outcome, count(*)::int n from fcd.reviews group by 1`),
    );
    const by = Object.fromEntries(rows.map((r) => [r.outcome, r.n]));
    expect(by.delivered).toBeGreaterThan(100);
    expect(by.fc_returned).toBeGreaterThan(0);
    expect(by.fc_rejected).toBeGreaterThanOrEqual(2);
    expect(by.lost).toBeGreaterThanOrEqual(2);
    const future = await db.query<{ n: number }>(
      `select (select count(*) from fcd.reviews where created_at > now())::int + (select count(*) from fcd.review_replies where created_at > now())::int n`,
    );
    expect(future[0].n).toBe(0);
    const replies = await db.query<{ n: number; v2: number; before: number }>(
      `select count(*)::int n, count(*) filter (where version = 2)::int v2,
              count(*) filter (where x.created_at < r.created_at)::int before
         from fcd.review_replies x join fcd.reviews r on r.id = x.review_id`,
    );
    expect(replies[0].n).toBeGreaterThanOrEqual(4);
    expect(replies[0].v2).toBeGreaterThanOrEqual(1);
    expect(replies[0].before).toBe(0);
    // 평가를 남기지 않은 분실·미도착 선적이 데모 화주에게 하나 있다(직접 평가해 볼 자리)
    const open = await asRole(db, 'fcd_user', ids.shipper, true, (q) =>
      q.query<{ n: number }>(`select count(*)::int n from fcd.shipments s where s.stage < 9 and fcd.shipment_outcome(s.id) = 'lost' and not exists (select 1 from fcd.reviews r where r.shipment_id = s.id)`),
    );
    expect(open[0].n).toBeGreaterThanOrEqual(1);
  });

  it('공개 후기에 끝(outcome)과 현재 판 답변이 실린다', async () => {
    const list = await asRole(db, 'fcd_public', null, true, (q) => queryPublicReviews(q, { limit: 2000, today }));
    const lost = list.find((r) => r.outcome === 'lost');
    expect(lost).toBeTruthy();
    expect(lost!.reply_body).toBeTruthy();
    const edited = list.find((r) => (r.reply_version ?? 0) >= 2);
    expect(edited).toBeTruthy();
    expect(edited!.reply_body).toContain('재입고 예약이 확정');
    // 업체 화면은 나쁜 끝의 후기를 따로 읽어 최근 후기에 밀리지 않게 한다
    const hard = await asRole(db, 'fcd_public', null, true, (q) => queryPublicReviews(q, { limit: 50, today, outcomes: ['fc_rejected', 'lost'] }));
    expect(hard.length).toBeGreaterThanOrEqual(4);
    expect(hard.every((r) => r.outcome === 'fc_rejected' || r.outcome === 'lost')).toBe(true);
  });

  it('표본·편차 분포 — 편차 평균은 v_partner_metrics 와 같고, 표본 = 30일 입고 + 반려·미도착', async () => {
    const out = await asRole(db, 'fcd_public', null, true, async (q) => {
      const rule = await loadTrustRule(q);
      const m = await q.query<{ org_id: string; avg_deviation: number | null; invoiced_count: number; done_30d: number }>('select org_id, avg_deviation, invoiced_count, done_30d from fcd.v_partner_metrics where shipments_done > 0');
      const facts = await loadTrustFacts(q, m.map((x) => x.org_id), rule);
      const p90 = await q.query<{ org_id: string; p90: number | null }>(
        `select org_id, (select avg(d) from (select d from unnest(deviations) d order by d desc limit greatest(1, ceil(cardinality(deviations) * 0.1)::int)) t) p90
           from fcd.partner_trust_facts($1::uuid[], 30)`,
        [m.map((x) => x.org_id)],
      );
      return { rule, m, facts, p90 };
    });
    expect(out.rule).toEqual({ sample: { days: 30, count: 20 }, lostAfterDays: 14 });
    let enough = 0;
    let lacking = 0;
    for (const x of out.m) {
      const f = out.facts.get(x.org_id)!;
      expect(f.deviation.n).toBe(x.invoiced_count);
      if (x.avg_deviation != null) expect(f.deviation.avgAbs!).toBeCloseTo(x.avg_deviation, 9);
      expect(f.sample.n - f.rejected - f.lost).toBe(x.done_30d);
      expect(f.delivered + f.returned).toBe(x.done_30d);
      const sql = out.p90.find((p) => p.org_id === x.org_id)!.p90;
      if (sql != null) expect(f.deviation.worst10!).toBeCloseTo(sql, 9);
      if (f.sample.enough) enough++;
      else lacking++;
    }
    // 데모는 두 경우가 다 보이게 — 표본이 넉넉한 곳과 모자란 곳
    expect(enough).toBeGreaterThan(0);
    expect(lacking).toBeGreaterThan(0);
  });

  it('데모를 끄면 데모 업체의 표본·편차는 공개에 나오지 않는다', async () => {
    const orgs = await db.query<{ id: string }>(`select id from fcd.orgs where is_demo and kind = 'partner'`);
    const rows = await asRole(db, 'fcd_public', null, false, (q) => q.query('select * from fcd.partner_trust_facts($1::uuid[], 30)', [orgs.map((o) => o.id)]));
    expect(rows).toEqual([]);
  });

  describe('⑤ 업체 공개 답변 — RLS·새 판', () => {
    let reviewId = '';
    let otherPartnerUser = '';
    beforeAll(async () => {
      const r = await db.query<{ id: string }>(
        `select r.id from fcd.reviews r join fcd.memberships m on m.org_id = r.partner_org_id
          where m.user_id = $1 and not exists (select 1 from fcd.review_replies x where x.review_id = r.id) order by r.created_at desc limit 1`,
        [ids.partner],
      );
      reviewId = r[0].id;
      const o = await db.query<{ user_id: string }>(
        `select m.user_id from fcd.memberships m join fcd.orgs o on o.id = m.org_id
          where o.kind = 'partner' and m.org_id <> (select partner_org_id from fcd.reviews where id = $1) limit 1`,
        [reviewId],
      );
      otherPartnerUser = o[0].user_id;
    });
    const orgOf = async (user: string) => (await db.query<{ org_id: string }>('select org_id from fcd.memberships where user_id = $1 limit 1', [user]))[0].org_id;
    const insert = (user: string, org: string, version: number, supersedes: string | null, body: string) =>
      asRole(db, 'fcd_user', user, true, (q) =>
        q.query<{ id: string }>(
          `insert into fcd.review_replies (review_id, partner_org_id, version, supersedes_id, body, created_by) values ($1,$2,$3,$4,$5,$6) returning id`,
          [reviewId, org, version, supersedes, body, user],
        ),
      );

    it('자기 업체 후기에만 답한다 — 다른 업체·비로그인은 못 쓴다', async () => {
      const other = await orgOf(otherPartnerUser);
      await expect(insert(otherPartnerUser, other, 1, null, '다른 업체가 대신 답변')).rejects.toThrow();
      const mine = await orgOf(ids.partner);
      await expect(insert(otherPartnerUser, mine, 1, null, '남의 이름으로 답변')).rejects.toThrow();
      await expect(
        asRole(db, 'fcd_public', null, true, (q) => q.query(`insert into fcd.review_replies (review_id, partner_org_id, body) values ($1,$2,'비로그인 답변')`, [reviewId, mine])),
      ).rejects.toThrow();
    });

    it('첫 판 → 고친 판(새 판). 고쳐 쓰기·지우기 권한은 없다. 갈래·건너뛴 판은 막힌다', async () => {
      const mine = await orgOf(ids.partner);
      const v1 = (await insert(ids.partner, mine, 1, null, '확인해 보겠습니다. 불편을 드려 죄송합니다.'))[0].id;
      await expect(insert(ids.partner, mine, 1, null, '첫 판을 하나 더')).rejects.toThrow();
      await expect(insert(ids.partner, mine, 3, v1, '판 번호 건너뛰기')).rejects.toThrow();
      const v2 = (await insert(ids.partner, mine, 2, v1, '확인 결과 라벨 위치 문제였습니다. 재작업 비용은 저희가 냅니다.'))[0].id;
      await expect(insert(ids.partner, mine, 2, v1, '같은 판을 두 번 잇기')).rejects.toThrow();
      await expect(asRole(db, 'fcd_user', ids.partner, true, (q) => q.query(`update fcd.review_replies set body = '몰래 고치기' where id = $1`, [v2]))).rejects.toThrow();
      await expect(asRole(db, 'fcd_user', ids.partner, true, (q) => q.query(`delete from fcd.review_replies where id = $1`, [v1]))).rejects.toThrow();
      const cur = await asRole(db, 'fcd_public', null, true, (q) => q.query<{ id: string; version: number }>('select id, version from fcd.v_review_replies_current where review_id = $1', [reviewId]));
      expect(cur).toEqual([{ id: v2, version: 2 }]);
      // 물류사 화면 쿼리도 현재 판만
      const rows = await asRole(db, 'fcd_user', ids.partner, true, (q) => partnerReviews(q, mine));
      expect(rows.find((r) => r.id === reviewId)?.reply_version).toBe(2);
    });

    it('비공개 후기의 답변은 공개에 안 보인다', async () => {
      const hidden = await db.query<{ n: number }>(
        `select count(*)::int n from fcd.review_replies x join fcd.reviews r on r.id = x.review_id where not r.published`,
      );
      expect(hidden[0].n).toBe(0); // 데모에는 비공개 후기에 단 답변이 없다
      const pub = await asRole(db, 'fcd_public', null, false, (q) => q.query('select id from fcd.review_replies'));
      expect(pub).toEqual([]); // 데모를 끄면 데모 답변은 공개에 없다
    });
  });

  describe('④ 평가 넣기 — 끝이 있는 선적만, 끝은 선적 기록과 같아야', () => {
    const insertReview = (shipmentId: string, outcome: string | null) =>
      asRole(db, 'fcd_user', ids.shipper, true, async (q) => {
        const s = (await q.query<{ shipper_org_id: string; partner_org_id: string }>('select shipper_org_id, partner_org_id from fcd.shipments where id = $1', [shipmentId]))[0];
        return q.query(
          `insert into fcd.reviews (shipment_id, shipper_org_id, partner_org_id, rating, on_time_ok, billing_ok, body, author_label, created_by, outcome)
           values ($1,$2,$3,1,false,true,'시험 평가입니다 — 열 글자 넘게','화주 · 시험',$4,$5)`,
          [shipmentId, s.shipper_org_id, s.partner_org_id, ids.shipper, outcome],
        );
      });
    const pick = (where: string) =>
      asRole(db, 'fcd_user', ids.shipper, true, async (q) =>
        (await q.query<{ id: string }>(`select s.id from fcd.shipments s where ${where} and not exists (select 1 from fcd.reviews r where r.shipment_id = s.id) limit 1`))[0]?.id,
      );

    it('진행 중(끝 없음) 선적은 평가할 수 없다', async () => {
      const id = await pick(`s.stage between 2 and 7 and fcd.shipment_outcome(s.id) is null`);
      expect(id).toBeTruthy();
      await expect(insertReview(id!, 'delivered')).rejects.toThrow();
      await expect(insertReview(id!, null)).rejects.toThrow();
    });

    it('분실·미도착 선적은 평가할 수 있고, 끝을 다르게 적으면 막힌다', async () => {
      const id = await pick(`fcd.shipment_outcome(s.id) = 'lost'`);
      expect(id).toBeTruthy();
      await expect(insertReview(id!, 'delivered')).rejects.toThrow();
      await insertReview(id!, 'lost');
      const r = await db.query<{ outcome: string }>('select outcome from fcd.reviews where shipment_id = $1', [id]);
      expect(r[0].outcome).toBe('lost');
    });
  });

  it('새 표(review_replies)는 데모 건수 표에 있고 데모 자료가 잡힌다(걷어내기 시험이 같은 표를 본다)', async () => {
    expect(DEMO_TABLES.map((t) => t.table)).toContain('review_replies');
    const c = await db.transaction((tx) => demoCounts(tx));
    expect(c.find((x) => x.table === 'review_replies')!.demo).toBeGreaterThan(0);
  });
});
