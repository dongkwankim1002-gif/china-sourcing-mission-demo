/**
 * 공개 후기 읽기 — 오늘(KST) 이후 날짜의 후기는 싣지 않는다(시드·시계 어긋남으로 미래 날짜가 보이던 문제).
 * 서버 전용 표시가 없는 모듈이라 시험이 같은 SQL 을 그대로 돌린다. 부르는 쪽이 asPublic 으로 연 연결을 넘긴다.
 */
import type { Queryable } from './db/driver';

export interface PublicReview {
  id: string;
  rating: number;
  body: string;
  author_label: string;
  created_at: string;
  partner_name: string;
  partner_slug: string;
  on_time_ok: boolean;
  billing_ok: boolean;
  /** v2 trust — 어떤 끝으로 끝난 선적의 후기인가(delivered·fc_returned·fc_rejected·lost) */
  outcome: string | null;
  /** 업체 공개 답변(현재 판) */
  reply_body: string | null;
  reply_version: number | null;
  reply_at: string | null;
}

/** outcomes 를 주면 그 끝으로 끝난 선적의 후기만(v2 trust — 반려·분실 후기가 최근 후기에 밀려 가려지지 않게 따로 읽는다) */
export function queryPublicReviews(q: Queryable, opts: { limit: number; partnerId?: string | null; today: string; outcomes?: string[] | null }): Promise<PublicReview[]> {
  return q.query<PublicReview>(
    `select r.id, r.rating, r.body, r.author_label, r.created_at, o.name partner_name, o.slug partner_slug, r.on_time_ok, r.billing_ok,
            fcd.review_outcome(r.id) outcome, a.body reply_body, a.version reply_version, a.created_at reply_at
       from fcd.reviews r join fcd.orgs o on o.id = r.partner_org_id
       left join fcd.v_review_replies_current a on a.review_id = r.id
      where ($2::uuid is null or r.partner_org_id = $2) and length(r.body) > 30
        and r.created_at < (($3::date + 1)::timestamp at time zone 'Asia/Seoul')
        and ($4::text[] is null or fcd.review_outcome(r.id) = any($4::text[]))
      order by r.created_at desc limit $1`,
    [opts.limit, opts.partnerId ?? null, opts.today, opts.outcomes?.length ? opts.outcomes : null],
  );
}
