/**
 * 점수·후기 정직하게(v2 trust) — 표본 기준·편차 분포·후기 답변을 읽는다.
 * 계산은 순수 함수(src/lib/money/trust.ts). 여기서는 읽기만 한다. 서버 전용 표시가 없는 모듈이라 시험이 같은 쿼리를 그대로 돌린다(서버 쪽은 src/lib/server/trust.ts 로 부른다).
 * 부르는 쪽이 연 연결(asPublic·asUser)의 RLS 를 그대로 받는다.
 */
import type { Queryable } from './db/driver';
import { deviationSummary, sampleVerdict, type DeviationSummary, type ReviewOutcome, type SampleRule, type SampleVerdict } from './money';

export interface TrustRule {
  sample: SampleRule;
  lostAfterDays: number;
}

/** jsonb 가 글자로 한 번 더 감싸여 저장된 운영 DB 도 읽는다(DECISIONS: postgres.js 이중 JSON) */
function unwrap(v: unknown): unknown {
  if (typeof v === 'string') {
    try {
      return JSON.parse(v);
    } catch {
      return v;
    }
  }
  return v;
}

export async function loadTrustRule(q: Queryable): Promise<TrustRule> {
  const rows = await q.query<{ key: string; value: unknown }>(
    `select key, value from fcd.v_current_settings where key = any($1::text[])`,
    [['score_min_sample', 'review_lost_after_days']],
  );
  const m = new Map(rows.map((r) => [r.key, unwrap(r.value)]));
  const sample = m.get('score_min_sample') as SampleRule | undefined;
  const lost = m.get('review_lost_after_days');
  if (!sample || typeof sample.days !== 'number' || typeof sample.count !== 'number') throw new Error('설정 score_min_sample 가 없습니다. 참조 시드를 올려 주세요.');
  if (lost == null || !Number.isFinite(Number(lost))) throw new Error('설정 review_lost_after_days 가 없습니다. 참조 시드를 올려 주세요.');
  return { sample, lostAfterDays: Number(lost) };
}

export interface TrustFacts {
  sample: SampleVerdict;
  delivered: number;
  returned: number;
  rejected: number;
  lost: number;
  deviation: DeviationSummary;
}

export function emptyTrust(rule: TrustRule): TrustFacts {
  return { sample: sampleVerdict(0, rule.sample), delivered: 0, returned: 0, rejected: 0, lost: 0, deviation: deviationSummary([]) };
}

/** 업체별 표본·끝별 건수·청구 편차 분포(fcd.partner_trust_facts — 숫자만 낸다) */
export async function loadTrustFacts(q: Queryable, orgIds: string[], rule: TrustRule): Promise<Map<string, TrustFacts>> {
  const out = new Map<string, TrustFacts>();
  if (orgIds.length === 0) return out;
  const rows = await q.query<{ org_id: string; sample_n: number; delivered_n: number; returned_n: number; rejected_n: number; lost_n: number; devs: string | null }>(
    // 편차 목록은 JSON 글자로 받는다(드라이버마다 float8[] 푸는 방식이 달라서)
    `select org_id, sample_n, delivered_n, returned_n, rejected_n, lost_n, array_to_json(deviations)::text devs
       from fcd.partner_trust_facts($1::uuid[], $2::int)`,
    [orgIds, rule.sample.days],
  );
  for (const r of rows) {
    out.set(r.org_id, {
      sample: sampleVerdict(r.sample_n, rule.sample),
      delivered: r.delivered_n,
      returned: r.returned_n,
      rejected: r.rejected_n,
      lost: r.lost_n,
      deviation: deviationSummary(r.devs ? (JSON.parse(r.devs) as unknown[]).map(Number) : []),
    });
  }
  return out;
}

/** 선적 하나의 끝(평가할 수 있으면 값) */
export async function shipmentOutcome(q: Queryable, shipmentId: string): Promise<ReviewOutcome | null> {
  const r = await q.query<{ o: ReviewOutcome | null }>('select fcd.shipment_outcome($1::uuid) as o', [shipmentId]);
  return r[0]?.o ?? null;
}

export interface ReplyRow {
  id: string;
  review_id: string;
  version: number;
  body: string;
  created_at: string;
}

export interface PartnerReviewRow {
  id: string;
  shipment_id: string;
  shipment_no: string;
  rating: number;
  body: string;
  author_label: string;
  on_time_ok: boolean;
  billing_ok: boolean;
  published: boolean;
  created_at: string;
  outcome: ReviewOutcome | null;
  reply_id: string | null;
  reply_version: number | null;
  reply_body: string | null;
  reply_at: string | null;
}

/** 물류사 — 내 업체에 달린 후기와 현재 답변 */
export async function partnerReviews(q: Queryable, orgId: string, limit = 200): Promise<PartnerReviewRow[]> {
  return q.query<PartnerReviewRow>(
    `select r.id, r.shipment_id, s.shipment_no, r.rating, r.body, r.author_label, r.on_time_ok, r.billing_ok, r.published, r.created_at,
            fcd.review_outcome(r.id) outcome,
            a.id reply_id, a.version reply_version, a.body reply_body, a.created_at reply_at
       from fcd.reviews r
       join fcd.shipments s on s.id = r.shipment_id
       left join fcd.v_review_replies_current a on a.review_id = r.id
      where r.partner_org_id = $1
      order by (a.id is null) desc, r.created_at desc
      limit $2`,
    [orgId, limit],
  );
}

/** 한 후기의 답변 판 전부(오래된 것부터) */
export async function replyHistory(q: Queryable, reviewId: string): Promise<ReplyRow[]> {
  return q.query<ReplyRow>(
    `select id, review_id, version, body, created_at from fcd.review_replies where review_id = $1 order by version`,
    [reviewId],
  );
}
