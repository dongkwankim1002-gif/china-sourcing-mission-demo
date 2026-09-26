/**
 * 데모 시드 — 셀러 인터뷰(v2 interview). 데모 운영 조직(is_demo) 아래에만 넣는다 — 걷어내기에 CASCADE 로 사라진다.
 *   · 예시 참여자 14명(「예시 셀러 N」): 끝 12 · 진행 중 1 · 링크만 보냄 1. 연락처는 예시 번호(가짜) 몇 명만
 *   · 끝낸 12명은 판 셋(선적 조건 → 화면 반응 → 끝)으로 쌓는다
 *   · 예시 물량 단가(콘솔사·포워더, 「예시 콘솔사 A」 등 — 실제 회사가 아니다)
 *   · 예시 /check 퍼널 30일(기기 번호는 해시만)
 * 멱등: 데모 운영 조직에 참여자가 이미 있으면 아무것도 넣지 않는다.
 */
import { createHash } from 'node:crypto';
import type { Queryable } from '@/lib/db/driver';
import type { AnswersT } from '@/lib/research/answers';

const DAY = 86_400_000;
const HOUR = 3_600_000;
const LADDER = [100, 300, 500, 800];

type Row = {
  max: number;
  counter: 'agree' | 'disagree' | 'unsure';
  past: AnswersT['pastExtra'];
  pilot: boolean;
  pain: NonNullable<AnswersT['pain']>;
  method: NonNullable<AnswersT['method']>;
  oneStop: NonNullable<AnswersT['oneStop']>;
  ms: number;
  scores: [number, number, number];
  quote: string | null;
  src: 'self' | 'interviewer';
  lane: { hub: string; port: 'ICN' | 'PTK'; mode: 'LCL' | 'FERRY'; cbm: number };
  shown: number;
  why?: string;
  oneStopWhy?: string;
};

/** 끝낸 12명 — +3% 이상 「예」 8명 중 반대 질문 「그렇다」 1명 → 확인된 의향 7/12(58%) = 약한 충족(예시) */
const DONE: Row[] = [
  { max: 500, counter: 'disagree', past: 'few', pilot: true, pain: 'extra_charges', method: 'fixed_forwarder', oneStop: 'never', ms: 2, scores: [5, 4, 4], src: 'self', lane: { hub: 'YIW', port: 'ICN', mode: 'LCL', cbm: 3 }, shown: 310, quote: '견적은 싼데 도착하면 항만비·FC 운송비가 따로 붙어요. 처음부터 한 가격이면 좋겠습니다.', why: '지난번 청구서가 딱 이랬어요' },
  { max: 300, counter: 'disagree', past: 'once', pilot: true, pain: 'extra_charges', method: 'compare', oneStop: 'used_bad', ms: 4, scores: [4, 5, 3], src: 'interviewer', lane: { hub: 'QDG', port: 'PTK', mode: 'FERRY', cbm: 5 }, shown: 260, quote: '3%까지는 보험이라 생각하고 낼 수 있어요.', oneStopWhy: '편했는데 가격이 어떻게 나온 건지 알 수가 없었어요' },
  { max: 100, counter: 'unsure', past: 'none', pilot: false, pain: 'hard_compare', method: 'fixed_forwarder', oneStop: 'never', ms: 1, scores: [3, 2, 4], src: 'self', lane: { hub: 'YIW', port: 'ICN', mode: 'LCL', cbm: 1.5 }, shown: 500, quote: '지금 포워더가 크게 문제는 없어서 굳이 더 낼 이유는 모르겠어요.' },
  { max: 800, counter: 'disagree', past: 'many', pilot: true, pain: 'extra_charges', method: 'baedaeji', oneStop: 'used_bad', ms: 6, scores: [5, 5, 4], src: 'self', lane: { hub: 'YIW', port: 'ICN', mode: 'LCL', cbm: 8 }, shown: 180, quote: '배대지는 편한데 청구서가 늘 예상보다 20% 넘게 나왔어요.', oneStopWhy: '물건 사 주고 보내 주는 건 편한데 청구가 불투명했습니다' },
  { max: 0, counter: 'agree', past: 'none', pilot: false, pain: 'fc_reject', method: 'fixed_forwarder', oneStop: 'never', ms: 1, scores: [2, 1, 3], src: 'self', lane: { hub: 'WEH', port: 'PTK', mode: 'FERRY', cbm: 2 }, shown: 420, quote: null },
  { max: 300, counter: 'agree', past: 'once', pilot: false, pain: 'extra_charges', method: 'compare', oneStop: 'never', ms: 2, scores: [4, 3, 4], src: 'interviewer', lane: { hub: 'YIW', port: 'ICN', mode: 'LCL', cbm: 3 }, shown: 310, quote: '좋긴 한데 나중에 따지는 게 더 싸게 먹힐 때도 있어서요.' },
  { max: 500, counter: 'disagree', past: 'few', pilot: true, pain: 'customs_docs', method: 'baedaeji', oneStop: 'used_good', ms: 3, scores: [4, 4, 5], src: 'self', lane: { hub: 'QDG', port: 'ICN', mode: 'LCL', cbm: 4 }, shown: 240, quote: '원스톱은 편했지만 가격을 비교할 수가 없었어요.', oneStopWhy: '한 번에 끝나는 건 좋았어요' },
  { max: 300, counter: 'unsure', past: 'few', pilot: true, pain: 'extra_charges', method: 'fixed_forwarder', oneStop: 'used_bad', ms: 5, scores: [5, 4, 3], src: 'self', lane: { hub: 'YIW', port: 'PTK', mode: 'LCL', cbm: 6 }, shown: 200, quote: null },
  { max: 100, counter: 'disagree', past: 'none', pilot: false, pain: 'delay_contact', method: 'compare', oneStop: 'never', ms: 1, scores: [3, 3, 4], src: 'self', lane: { hub: 'YIW', port: 'ICN', mode: 'LCL', cbm: 2 }, shown: 380, quote: '일정 연락만 잘 돼도 좋겠어요.' },
  { max: 500, counter: 'disagree', past: 'many', pilot: true, pain: 'extra_charges', method: 'compare', oneStop: 'used_bad', ms: 8, scores: [5, 5, 5], src: 'interviewer', lane: { hub: 'QDG', port: 'PTK', mode: 'FERRY', cbm: 7 }, shown: 190, quote: '월 여덟 번 보내면 3%는 커요. 그래도 추가비용 싸움보다는 낫습니다.', why: '매번 청구서를 대조하는 데 반나절이 걸려요' },
  { max: 0, counter: 'disagree', past: 'unknown', pilot: false, pain: 'hard_compare', method: 'fixed_forwarder', oneStop: 'never', ms: 1, scores: [3, 2, 3], src: 'self', lane: { hub: 'WEH', port: 'ICN', mode: 'LCL', cbm: 1 }, shown: 500, quote: null },
  { max: 300, counter: 'disagree', past: 'once', pilot: true, pain: 'fc_reject', method: 'baedaeji', oneStop: 'used_good', ms: 2, scores: [4, 4, 4], src: 'self', lane: { hub: 'YIW', port: 'ICN', mode: 'LCL', cbm: 3 }, shown: 310, quote: '회송까지 책임져 주면 더 낼 수 있어요.' },
];

const ladderOf = (max: number) => {
  const l: Record<string, boolean> = {};
  for (const b of LADDER) {
    if (b <= max) l[String(b)] = true;
    else {
      l[String(b)] = false;
      break;
    }
  }
  return l;
};

const fakeHash = (s: string) => createHash('sha256').update(`fcd-demo-research:${s}`, 'utf8').digest('hex');

function answersOf(r: Row, upto: 'lane' | 'screens' | 'all'): AnswersT {
  const a: AnswersT = { v: 1, lane: { ...r.lane } };
  if (upto === 'lane') return a;
  a.screens = {
    check: { score: r.scores[0], ...(r.why ? { why: r.why } : {}) },
    firm: { score: r.scores[1] },
    pnl: { score: r.scores[2] },
  };
  a.shownPremiumBp = r.shown;
  if (upto === 'screens') return a;
  return {
    ...a,
    ladder: ladderOf(r.max),
    counter: r.counter,
    pastExtra: r.past,
    pilotWaitlist: r.pilot,
    pain: r.pain,
    method: r.method,
    oneStop: r.oneStop,
    ...(r.oneStopWhy ? { oneStopWhy: r.oneStopWhy } : {}),
    monthlyShipments: r.ms,
    ...(r.quote ? { comment: r.quote, quoteOk: true } : { quoteOk: false }),
  };
}

export async function seedResearchDemo(q: Queryable, opts: { now: number }): Promise<number> {
  const org = (await q.query<{ id: string }>(`select id from fcd.orgs where kind = 'platform' and is_demo order by created_at limit 1`))[0];
  if (!org) return 0;
  const has = await q.query<{ n: number }>(`select count(*)::int n from fcd.research_participants where org_id = $1`, [org.id]);
  if (has[0].n > 0) return 0;
  const admin = (await q.query<{ user_id: string }>(`select user_id from fcd.memberships where org_id = $1 and role = 'platform_admin' order by user_id limit 1`, [org.id]))[0]?.user_id ?? null;
  const now = opts.now;
  const ts = (ms: number) => new Date(ms).toISOString();
  let n = 0;

  const addParticipant = async (i: number, recruit: Record<string, unknown>, contact: string | null, consent: { state: string; at: number; method: string } | null, scheduled: number | null) => {
    const r = await q.query<{ id: string }>(
      `insert into fcd.research_participants (org_id, code, label, contact, recruit, scheduled_at, created_by, created_at)
       values ($1,$2,$3,$4,$5::jsonb,$6,$7,$8) returning id`,
      [org.id, `P-${String(i).padStart(2, '0')}`, `예시 셀러 ${i}`, contact, JSON.stringify(recruit), scheduled ? ts(scheduled) : null, admin, ts(now - (20 - i) * DAY)],
    );
    if (consent) {
      await q.query(
        `insert into fcd.research_consents (org_id, participant_id, state, method, version, created_by, created_at) values ($1,$2,$3,$4,'2026-09 초안(법률 검토 전)',$5,$6)`,
        [org.id, r[0].id, consent.state, consent.method, consent.method === 'verbal' ? admin : null, ts(consent.at)],
      );
    }
    n++;
    return r[0].id;
  };
  const addInvite = async (pid: string, i: number, created: number) => {
    const r = await q.query<{ id: string }>(
      `insert into fcd.research_invites (org_id, participant_id, token_hash, expires_at, created_by, created_at) values ($1,$2,$3,$4,$5,$6) returning id`,
      [org.id, pid, fakeHash(`invite:${i}`), ts(created + 14 * DAY), admin, ts(created)],
    );
    return r[0].id;
  };
  const addResponse = async (pid: string, inv: string | null, version: number, sup: string | null, src: 'self' | 'interviewer', step: string, done: boolean, answers: AnswersT, at: number) => {
    const r = await q.query<{ id: string }>(
      `insert into fcd.research_responses (org_id, participant_id, invite_id, version, supersedes_id, source, step, completed, answers, created_by, created_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11) returning id`,
      [org.id, pid, inv, version, sup, src, step, done, JSON.stringify(answers), src === 'interviewer' ? admin : null, ts(at)],
    );
    return r[0].id;
  };

  for (let k = 0; k < DONE.length; k++) {
    const i = k + 1;
    const r = DONE[k];
    const start = now - (14 - k) * DAY - 3 * HOUR;
    const recruit = { chinaSourcing: true, rocketGrowth: i !== 11, lcl: true, monthlyShipments: r.ms, channel: i % 3 === 0 ? '기존 가입 화주' : '셀러 커뮤니티 공지(예시)' };
    const contact = i % 4 === 1 ? `010-0000-${String(1000 + i * 37).slice(-4)}` : null; // 예시 번호(가짜)
    const pid = await addParticipant(i, recruit, contact, { state: 'agreed', at: start, method: r.src === 'self' ? 'self' : 'verbal' }, r.src === 'interviewer' ? start : null);
    const inv = r.src === 'self' ? await addInvite(pid, i, start - 2 * DAY) : null;
    const v1 = await addResponse(pid, inv, 1, null, r.src, 'screens', false, answersOf(r, 'lane'), start + 2 * 60_000);
    const v2 = await addResponse(pid, inv, 2, v1, r.src, 'ladder', false, answersOf(r, 'screens'), start + 5 * 60_000);
    await addResponse(pid, inv, 3, v2, r.src, 'done', true, answersOf(r, 'all'), start + 9 * 60_000);
  }
  // 13 — 진행 중(화면 셋까지)
  {
    const r: Row = { ...DONE[0], lane: { hub: 'YIW', port: 'ICN', mode: 'LCL', cbm: 2.5 }, scores: [4, 3, 4], shown: 330 };
    const start = now - 1 * DAY;
    const pid = await addParticipant(13, { chinaSourcing: true, rocketGrowth: true, lcl: true, monthlyShipments: 3, channel: '셀러 커뮤니티 공지(예시)' }, null, { state: 'agreed', at: start, method: 'self' }, null);
    const inv = await addInvite(pid, 13, start - DAY);
    const v1 = await addResponse(pid, inv, 1, null, 'self', 'screens', false, answersOf(r, 'lane'), start + 2 * 60_000);
    await addResponse(pid, inv, 2, v1, 'self', 'ladder', false, answersOf(r, 'screens'), start + 6 * 60_000);
  }
  // 14 — 링크만 보냄(안 열림) · 일정 잡힘
  {
    const pid = await addParticipant(14, { chinaSourcing: true, rocketGrowth: true, lcl: true, monthlyShipments: 5, channel: '기존 가입 화주' }, '010-0000-5014', null, now + 2 * DAY);
    await addInvite(pid, 14, now - 6 * HOUR);
  }

  // 예시 물량 단가(원/CBM) — 실제 업체가 아니다
  const quotes: [string, 'consolidator' | 'forwarder', 'sea_cfs' | 'to_port' | 'to_fc', number, number, string][] = [
    ['예시 콘솔사 A', 'consolidator', 'sea_cfs', 1, 64000, 'call'],
    ['예시 콘솔사 A', 'consolidator', 'sea_cfs', 3, 60000, 'call'],
    ['예시 콘솔사 A', 'consolidator', 'sea_cfs', 5, 56000, 'call'],
    ['예시 콘솔사 A', 'consolidator', 'sea_cfs', 10, 52000, 'call'],
    ['예시 콘솔사 A', 'consolidator', 'sea_cfs', 20, 49000, 'call'],
    ['예시 콘솔사 A', 'consolidator', 'sea_cfs', 40, 47000, 'call'],
    ['예시 콘솔사 B', 'consolidator', 'sea_cfs', 3, 62000, 'email'],
    ['예시 콘솔사 B', 'consolidator', 'sea_cfs', 10, 54000, 'email'],
    ['예시 콘솔사 B', 'consolidator', 'sea_cfs', 20, 50000, 'email'],
    ['예시 포워더 A', 'forwarder', 'sea_cfs', 1, 68000, 'quote_doc'],
    ['예시 포워더 A', 'forwarder', 'sea_cfs', 5, 61000, 'quote_doc'],
    ['예시 포워더 B', 'forwarder', 'sea_cfs', 1, 72000, 'call'],
    ['예시 포워더 B', 'forwarder', 'sea_cfs', 3, 65000, 'call'],
    ['예시 포워더 B', 'forwarder', 'sea_cfs', 10, 58000, 'call'],
    ['예시 포워더 C', 'forwarder', 'sea_cfs', 2, 66000, 'email'],
    ['예시 포워더 C', 'forwarder', 'to_fc', 3, 98000, 'email'],
  ];
  for (const [label, kind, inc, vol, price, src] of quotes) {
    await q.query(
      `insert into fcd.research_vendor_quotes (org_id, vendor_label, vendor_kind, hub, port, mode, includes, volume_cbm, unit_price_krw, source, quoted_on, note, created_by, created_at)
       values ($1,$2,$3,'YIW','ICN','LCL',$4,$5,$6,$7,$8,'예시 자료',$9,$10)`,
      [org.id, label, kind, inc, vol, price, src, new Date(now - 7 * DAY + 9 * HOUR).toISOString().slice(0, 10), admin, ts(now - 7 * DAY)],
    );
  }
  // 새 판 하나 — 포워더 A 3 CBM: 처음 66,000 → 다시 받은 63,000
  const old = await q.query<{ id: string }>(
    `insert into fcd.research_vendor_quotes (org_id, vendor_label, vendor_kind, hub, port, mode, includes, volume_cbm, unit_price_krw, source, quoted_on, note, created_by, created_at)
     values ($1,'예시 포워더 A','forwarder','YIW','ICN','LCL','sea_cfs',3,66000,'call',$2,'예시 자료 · 첫 통화',$3,$4) returning id`,
    [org.id, new Date(now - 10 * DAY).toISOString().slice(0, 10), admin, ts(now - 10 * DAY)],
  );
  await q.query(
    `insert into fcd.research_vendor_quotes (org_id, vendor_label, vendor_kind, hub, port, mode, includes, volume_cbm, unit_price_krw, source, quoted_on, note, supersedes_id, created_by, created_at)
     values ($1,'예시 포워더 A','forwarder','YIW','ICN','LCL','sea_cfs',3,63000,'quote_doc',$2,'예시 자료 · 견적서로 다시 받음',$3,$4,$5)`,
    [org.id, new Date(now - 4 * DAY).toISOString().slice(0, 10), old[0].id, admin, ts(now - 4 * DAY)],
  );

  // 예시 /check 퍼널 30일 — 기기 380대 · 입력 32% · 점검 25% · 보관 4%
  await q.query(
    `insert into fcd.check_funnel_events (org_id, kind, method, visitor_hash, logged_in, occurred_at)
     select $1, k.kind,
            case when k.kind = 'check_visit' then null else (array['paste','excel','manual'])[1 + i % 3] end,
            encode(sha256(convert_to('fcd-demo-visitor:' || i, 'UTF8')), 'hex'),
            k.kind = 'check_saved',
            $2::timestamptz - make_interval(days => i % 30, hours => i % 20) + make_interval(mins => k.lag)
       from generate_series(0, 379) i
       cross join (values ('check_visit', 100, 0), ('check_input', 32, 2), ('check_run', 25, 3), ('check_saved', 4, 5)) k(kind, pct, lag)
      where i % 100 < k.pct`,
    [org.id, ts(now)],
  );
  return n;
}
