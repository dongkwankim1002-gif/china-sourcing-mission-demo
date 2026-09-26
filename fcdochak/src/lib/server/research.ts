import 'server-only';
/**
 * 셀러 인터뷰 — 서버 쪽.
 *   loadResearchRules      설정 research.rules
 *   interviewPreview       셀러 조건으로 v2 화면 셋(청구서 점검·확정가 카드·판매손익)을 미리 계산 — 비공개 요금표까지 쓰므로
 *                          asSystem 이지만, 공개 도착원가·청구서 점검과 같은 규칙으로 집계 숫자만 내보낸다
 *   researchBoard          운영 결정 보드 자료(asUser — RLS: 운영만)
 *   recordCheckFunnel      /check 퍼널 한 줄(익명 기기 번호 해시)
 * 계산은 src/lib/money/research·seller·assure 순수 함수.
 */
import { createHash } from 'node:crypto';
import { asPublic, asSystem, todayKst, type Queryable } from '../db';
import { env } from '../env';
import { computeQuote, firmPrice, SEGMENTS_TO_KR_PORT } from '../money';
import { sellerPnl } from '../money/seller';
import {
  consolidationReads,
  overallVerdict,
  parseResearchRules,
  readLadder,
  scoreSummary,
  tally,
  totalVsMedian,
  uploadRate,
  volumeCurves,
  wtpCurve,
  type ResearchRules,
  type VendorQuote,
} from '../money/research';
import { buildArrivalResponse } from '../tools-arrival';
import { cargoSummaryText } from '../standard-cargo';
import { readAssureConfig } from '../assure-settings';
import { parseInvoiceCheckRule } from '../invoice-market';
import { COUNTER, METHOD, ONESTOP, PAIN, PAST_EXTRA, SCREENS, laneOrDefault, progressOf, type AnswersT, type LaneT, type ProgressState } from '../research/answers';
import { compare } from './compare';
import { loadSettings } from './settings';
import { loadArrivalRule, loadToolBasis } from './tools';
import { basisFromOffers } from './assure';

export async function loadResearchRules(q: Queryable): Promise<ResearchRules> {
  const r = await q.query<{ value: unknown }>(`select value from fcd.v_current_settings where key = 'research.rules'`);
  return parseResearchRules(r[0]?.value);
}

export function publicResearchRules(): Promise<ResearchRules> {
  return asPublic(loadResearchRules);
}

// ─── 미리 계산 ───────────────────────────────────────────────────
export interface InterviewPreview {
  lane: { hub: string; port: string; mode: string; hubName: string; portName: string; modeName: string; cargoText: string; usedDefault: boolean };
  arrival: { basis: 'market' | 'reference'; count: number; median: number; perUnit: number };
  check:
    | { given: false }
    | { given: true; total: number; median: number | null; overMedianBp: number | null; tone: 'high' | 'typical' | 'low' | 'unknown' };
  firm:
    | { ok: false }
    | { ok: true; base: number; premium: number; premiumBp: number; firmPrice: number; n: number; lowSample: boolean; offerable: boolean };
  pnl: { price: number | null; arrivalPerUnit: number; logisticsPerUnit: number; profit: number | null; marginBp: number | null; breakEvenPrice: number; example: boolean };
}

export async function interviewPreview(input: LaneT | undefined): Promise<InterviewPreview> {
  const l = laneOrDefault(input);
  const today = todayKst();
  return asSystem(async (q) => {
    const [s, arrivalRule, tool] = await Promise.all([loadSettings(q), loadArrivalRule(q), loadToolBasis(q)]);
    const cmpInput = { hub: l.hub, port: l.port, mode: l.mode, cargo: l.cargo, traits: [] as string[], fc: l.fc };
    const r = await compare(q, cmpInput, s, today);
    const ref = computeQuote(s.referenceLines, l.cargo, s.quoteParams);
    const refTotal = ref.segments.reduce((a, x) => a + (x.amount ?? 0), 0);
    const okOrg = (p: { status: string; is_demo: boolean }) => (p.status === 'official' || p.status === 'pending_verification') && (env.demoMode || !p.is_demo);
    const built = buildArrivalResponse(r, {
      okOrg,
      units: l.cargo.units,
      rule: arrivalRule,
      reference: {
        total: refTotal,
        toPort: ref.segments.filter((x) => SEGMENTS_TO_KR_PORT.includes(x.segment)).reduce((a, x) => a + (x.amount ?? 0), 0),
        segments: ref.segments.map((x) => ({ segment: x.segment, amount: x.amount })),
      },
    });
    // 이 조건에 요금표가 하나도 없으면(데모 없는 새 DB 등) 플랫폼 참고치로 — 0원 도착원가를 보이지 않게
    const refToPort = ref.segments.filter((x) => SEGMENTS_TO_KR_PORT.includes(x.segment)).reduce((a, x) => a + (x.amount ?? 0), 0);
    const arrival = built.count > 0 ? built : { ...built, basis: 'reference' as const, median: refTotal, toPortMedian: refToPort, perUnitMedian: Math.round(refTotal / Math.max(1, l.cargo.units)) };

    // 확정가 카드 — 업체가 적으면(공개 도착원가와 같은 기준) 플랫폼 참고치 하나로(최소 프리미엄만)
    const rows = await q.query<{ key: string; value: unknown }>(`select key, value from fcd.v_current_settings where key like 'v2.%'`);
    const cfg = readAssureConfig(new Map(rows.map((x) => [x.key, x.value])));
    const basis = basisFromOffers(r.offers.filter((o) => okOrg(o.partner)));
    const totals = arrival.basis === 'reference' || !basis.totals.length ? [refTotal] : basis.totals;
    const fp = cfg.firmRates ? firmPrice(totals, cfg.firmRates) : null;
    const firm: InterviewPreview['firm'] =
      fp && fp.ok
        ? { ok: true, base: fp.base, premium: fp.premium, premiumBp: fp.premiumBp, firmPrice: fp.firmPrice, n: fp.stats.n, lowSample: fp.lowSample, offerable: fp.offerable }
        : { ok: false };

    // 청구서 점검 — 지난번 물류비 총액 한 줄을 이 구간 분포와 견준다(항목이 없어 구간별로는 못 가른다)
    let check: InterviewPreview['check'] = { given: false };
    if (input?.lastTotal) {
      const rule = parseInvoiceCheckRule((await q.query<{ value: unknown }>(`select value from fcd.v_current_settings where key = 'invoice_check_rule'`))[0]?.value);
      const v = totalVsMedian(input.lastTotal, arrival.median, rule);
      check = { given: true, total: input.lastTotal, median: arrival.median || null, overMedianBp: v.overMedianBp, tone: v.tone };
    }

    // 판매손익 — 판매가를 넣었으면 개당 이익, 아니면 손익분기 판매가만
    const duty = tool.dutyRates.find((d) => d.category === 'general') ?? tool.dutyRates[0];
    const p = sellerPnl({
      units: l.cargo.units,
      price: input?.price ?? 0,
      goodsKrw: Math.round(l.cargo.goodsValue * (s.fx[l.cargo.goodsCurrency] ?? 1)),
      logisticsTotal: arrival.median,
      freightToPortKrw: arrival.toPortMedian,
      extraCostTotal: 0,
      dutyRateBp: duty?.rate_bp ?? 0,
      vatRateBp: tool.vatRateBp,
      insuranceBp: tool.insuranceBp,
      saleFeeBp: tool.fee.saleFeeBp,
      adBp: tool.fee.adBp,
      inboundPerUnit: tool.fee.rgInboundPerUnit,
      shippingPerUnit: tool.fee.rgShippingPerUnit,
    });

    const names = await q.query<{ kind: string; code: string; name_ko: string }>(
      `select 'hub' kind, code, name_ko from fcd.hubs where code = $1
       union all select 'port', code, name_ko from fcd.ports where code = $2
       union all select 'mode', code, name_ko from fcd.modes where code = $3`,
      [l.hub, l.port, l.mode],
    );
    const nm = (k: string, f: string) => names.find((n) => n.kind === k)?.name_ko ?? f;
    return {
      lane: { hub: l.hub, port: l.port, mode: l.mode, hubName: nm('hub', l.hub), portName: nm('port', l.port), modeName: nm('mode', l.mode), cargoText: cargoSummaryText(l.cargo), usedDefault: l.usedDefault },
      arrival: { basis: arrival.basis, count: arrival.count, median: arrival.median, perUnit: arrival.perUnitMedian },
      check,
      firm,
      pnl: {
        price: input?.price ?? null,
        arrivalPerUnit: p.arrivalPerUnit,
        logisticsPerUnit: p.logisticsPerUnit,
        profit: input?.price ? p.pnl.profit : null,
        marginBp: input?.price ? p.pnl.marginBp : null,
        breakEvenPrice: p.breakEvenPrice,
        example: tool.fee.example,
      },
    };
  });
}

// ─── 퍼널 ──────────────────────────────────────────────────────
export type FunnelKind = 'check_visit' | 'check_input' | 'check_run' | 'check_saved';

export const VISITOR_RE = /^[A-Za-z0-9_-]{16,64}$/;

/** 브라우저의 기기 번호는 저장하지 않고 해시만 */
export function visitorHash(vid: string): string {
  return createHash('sha256').update(`fcd-check-funnel:${vid}`, 'utf8').digest('hex');
}

export async function recordCheckFunnel(kind: FunnelKind, method: 'paste' | 'excel' | 'manual' | null, vid: string, loggedIn: boolean): Promise<boolean> {
  if (!VISITOR_RE.test(vid)) return false;
  try {
    const r = await asPublic((q) => q.query<{ ok: boolean }>(`select fcd.record_check_event($1, $2, $3, $4) ok`, [kind, method, visitorHash(vid), loggedIn]));
    return !!r[0]?.ok;
  } catch (e) {
    console.error(`[research] 점검 퍼널 기록 실패: ${(e as Error).message}`);
    return false;
  }
}

// ─── 운영 보드 ───────────────────────────────────────────────────
export interface ParticipantRow {
  id: string;
  code: string;
  label: string;
  contact_masked: string | null;
  has_contact: boolean;
  recruit: { chinaSourcing?: boolean; rocketGrowth?: boolean; lcl?: boolean; monthlyShipments?: number; channel?: string };
  scheduled_at: string | null;
  note: string | null;
  consent_state: string;
  consent_at: string | null;
  consent_method: string | null;
  is_demo: boolean;
  created_at: string;
  invites: number;
  open_invite_expires: string | null;
  opened: boolean;
  head_id: string | null;
  head_version: number | null;
  head_step: string | null;
  head_source: string | null;
  completed: boolean;
  /** 처음 끝낸 때 — 보관 기간(research.rules.retentionDays)을 여기서 센다 */
  completed_at: string | null;
  answers: AnswersT | null;
  progress: ProgressState;
}

/** includeDemo=false 이면 데모 운영 조직(is_demo)의 예시 참여자를 뺀다 — 실제 판정에 예시가 섞이지 않게 */
export async function listParticipants(q: Queryable, includeDemo = false): Promise<ParticipantRow[]> {
  const rows = await q.query<Omit<ParticipantRow, 'progress'>>(
    `select p.id, p.code, p.label, p.contact_masked, p.has_contact, p.recruit, p.scheduled_at, p.note, p.consent_state, p.consent_at, p.consent_method, p.is_demo, p.created_at,
        (select count(*)::int from fcd.research_invites i where i.participant_id = p.id) invites,
        (select max(i.expires_at) from fcd.research_invites i where i.participant_id = p.id and i.revoked_at is null and i.expires_at > now()) open_invite_expires,
        (p.consent_state <> 'none') opened,
        h.id head_id, h.version head_version, h.step head_step, h.source head_source,
        exists (select 1 from fcd.research_responses x where x.participant_id = p.id and x.completed) completed, h.answers,
        (select min(x.created_at) from fcd.research_responses x where x.participant_id = p.id and x.completed) completed_at
       from fcd.v_research_participants p
       left join fcd.v_research_responses_current h on h.participant_id = p.id
      where ($1 or not p.is_demo)
      order by p.code`,
    [includeDemo],
  );
  return rows.map((r) => ({ ...r, progress: progressOf({ consent_state: r.consent_state, invites: r.invites, opened: r.opened, head_step: r.head_step, completed: r.completed }) }));
}

export interface VendorQuoteRow {
  id: string;
  vendor_label: string;
  vendor_kind: 'consolidator' | 'forwarder';
  hub: string | null;
  port: string | null;
  mode: string | null;
  includes: 'sea_cfs' | 'to_port' | 'to_fc';
  volume_cbm: number;
  unit_price_krw: number;
  source: string;
  quoted_on: string;
  note: string | null;
  supersedes_id: string | null;
  created_at: string;
}

/** 퍼널 — 실제 방문은 org_id 가 비어 있고, 데모 자료만 데모 운영 조직 아래에 있다. includeDemo=false 이면 데모 조직 줄을 뺀다 */
export async function funnelCounts(q: Queryable, days: number, includeDemo = false) {
  const demo = `($2 or f.org_id is null or not exists (select 1 from fcd.orgs o where o.id = f.org_id and o.is_demo))`;
  const r = await q.query<{ visitors: number; inputters: number; runners: number; savers: number }>(
    `select count(distinct visitor_hash) filter (where kind = 'check_visit')::int visitors,
            count(distinct visitor_hash) filter (where kind = 'check_input')::int inputters,
            count(distinct visitor_hash) filter (where kind = 'check_run')::int runners,
            count(distinct visitor_hash) filter (where kind = 'check_saved')::int savers
       from fcd.check_funnel_events f where occurred_at > now() - make_interval(days => $1) and ${demo}`,
    [days, includeDemo],
  );
  const byMethod = await q.query<{ method: string; n: number }>(
    `select method, count(distinct visitor_hash)::int n from fcd.check_funnel_events f
      where kind = 'check_input' and method is not null and occurred_at > now() - make_interval(days => $1) and ${demo} group by method order by method`,
    [days, includeDemo],
  );
  // 이상치 살피기 — 한 기기가 너무 많이 들어왔거나(같은 기기 번호로 부풀리기), 방문만 하고 아무것도 넣지 않은 기기
  const odd = await q.query<{ heavy: number; visit_only: number; max_events: number }>(
    `with per as (
       select visitor_hash, count(*)::int n, bool_or(kind <> 'check_visit') acted
         from fcd.check_funnel_events f where occurred_at > now() - make_interval(days => $1) and ${demo}
        group by visitor_hash)
     select count(*) filter (where n >= 20)::int heavy, count(*) filter (where not acted)::int visit_only, coalesce(max(n), 0)::int max_events from per`,
    [days, includeDemo],
  );
  const saved = await q.query<{ n: number }>(
    `select count(*)::int n from fcd.invoice_checks c join fcd.orgs o on o.id = c.org_id
      where c.created_at > now() - make_interval(days => $1) and ($2 or not o.is_demo)`,
    [days, includeDemo],
  );
  return {
    counts: r[0] ?? { visitors: 0, inputters: 0, runners: 0, savers: 0 },
    byMethod,
    savedChecks: saved[0]?.n ?? 0,
    outliers: odd[0] ?? { heavy: 0, visit_only: 0, max_events: 0 },
  };
}

/** 보관 기간이 지난(처음 끝낸 날 + retentionDays) 참여자와 철회한 참여자 — 사람이 지울 대상(docs/research-plan.md §7) */
export function retentionDue(participants: ParticipantRow[], retentionDays: number, now = Date.now()) {
  const expired = participants.filter((p) => p.completed_at && new Date(p.completed_at).getTime() + retentionDays * 86_400_000 < now);
  const withdrawn = participants.filter((p) => p.consent_state === 'withdrawn');
  return { expired, withdrawn };
}

/**
 * 결정 보드. includeDemo 기본 꺼짐 — 실제 운영자의 판정에 예시 셀러·예시 퍼널·예시 단가가 섞이지 않게.
 * 판정 표본은 끝낸 인터뷰만(중간에 멈춘 답은 progress 에만 보인다).
 */
export async function researchBoard(q: Queryable, days = 30, opts: { includeDemo?: boolean } = {}) {
  const includeDemo = opts.includeDemo ?? false;
  const rules = await loadResearchRules(q);
  const participants = await listParticipants(q, includeDemo);
  const answered = participants.filter((p) => p.answers && p.completed && p.consent_state === 'agreed');
  const a = answered.map((p) => p.answers!);
  const wtp = wtpCurve(a.map((x) => ({ ladder: x.ladder, counter: x.counter })), rules);
  const bySource = (['self', 'interviewer'] as const).map((src) => ({
    source: src,
    curve: wtpCurve(answered.filter((p) => p.head_source === src).map((p) => ({ ladder: p.answers!.ladder, counter: p.answers!.counter })), rules),
  }));
  // 층(월 선적 수)별 — 참여자의 모집 기준 칸, 없으면 응답의 월 선적 수
  const tier = (p: ParticipantRow) => {
    const m = p.recruit.monthlyShipments ?? p.answers?.monthlyShipments;
    return m == null ? 'unknown' : m <= 1 ? 't1' : m <= 3 ? 't2' : 't3';
  };
  const byTier = (['t1', 't2', 't3'] as const).map((t) => ({
    tier: t,
    curve: wtpCurve(answered.filter((p) => tier(p) === t).map((p) => ({ ladder: p.answers!.ladder, counter: p.answers!.counter })), rules),
  }));
  const extra = a.filter((x) => readLadder(x.ladder, rules.ladderBp).answered);
  const signals = {
    pastExtra: tally(extra.map((x) => x.pastExtra), PAST_EXTRA),
    pilot: { yes: a.filter((x) => x.pilotWaitlist === true).length, n: a.filter((x) => x.pilotWaitlist != null).length },
    // 사다리 한도 대 그 셀러 조건에서 본 참고 프리미엄
    shownVsMax: extra
      .filter((x) => x.shownPremiumBp != null)
      .map((x) => ({ shown: x.shownPremiumBp as number, max: readLadder(x.ladder, rules.ladderBp).maxBp })),
    counter: tally(a.map((x) => x.counter), COUNTER),
  };
  const pain = tally(a.map((x) => x.pain), PAIN);
  const method = tally(a.map((x) => x.method), METHOD);
  const oneStop = tally(a.map((x) => x.oneStop), ONESTOP);
  const screens = SCREENS.map((k) => ({ key: k, s: scoreSummary(a.map((x) => x.screens?.[k]?.score)) }));
  const quotes: { code: string; text: string; kind: 'comment' | 'why' | 'oneStop'; screen?: string }[] = [];
  for (const p of answered) {
    const x = p.answers!;
    if (!x.quoteOk) continue;
    if (x.comment?.trim()) quotes.push({ code: p.code, text: x.comment.trim(), kind: 'comment' });
    if (x.oneStopWhy?.trim()) quotes.push({ code: p.code, text: x.oneStopWhy.trim(), kind: 'oneStop' });
    for (const k of SCREENS) if (x.screens?.[k]?.why?.trim()) quotes.push({ code: p.code, text: x.screens[k]!.why!.trim(), kind: 'why', screen: k });
  }
  const funnel = await funnelCounts(q, days, includeDemo);
  const upload = uploadRate(funnel.counts, rules);
  const vq = await q.query<VendorQuoteRow>(
    `select id, vendor_label, vendor_kind, hub, port, mode, includes, volume_cbm::float8 volume_cbm, unit_price_krw::bigint unit_price_krw, source, to_char(quoted_on, 'YYYY-MM-DD') quoted_on, note, supersedes_id, created_at
       from fcd.v_research_vendor_quotes_current v
      where ($1 or not exists (select 1 from fcd.orgs o where o.id = v.org_id and o.is_demo))
      order by vendor_kind, vendor_label, volume_cbm`,
    [includeDemo],
  );
  const vqs: VendorQuote[] = vq.map((v) => ({ kind: v.vendor_kind, includes: v.includes, volumeCbm: Number(v.volume_cbm), unitPriceKrw: Number(v.unit_price_krw) }));
  const curves = volumeCurves(vqs, rules.volumeBucketsCbm);
  const consolidation = consolidationReads(vqs, rules);
  return {
    rules,
    includeDemo,
    participants,
    retention: retentionDue(participants, rules.retentionDays),
    inProgressAnswered: participants.filter((p) => p.answers && !p.completed && p.consent_state === 'agreed').length,
    progress: {
      total: participants.length,
      done: participants.filter((p) => p.progress === 'done').length,
      inProgress: participants.filter((p) => p.progress === 'in_progress' || p.progress === 'opened').length,
      declined: participants.filter((p) => p.progress === 'declined').length,
    },
    wtp,
    bySource,
    byTier,
    signals,
    pain,
    method,
    oneStop,
    screens,
    quotes,
    funnel: { ...funnel, upload, days },
    vendor: { rows: vq.map((v) => ({ ...v, volume_cbm: Number(v.volume_cbm), unit_price_krw: Number(v.unit_price_krw) })), curves, consolidation, verdict: overallVerdict(consolidation.map((c) => c.verdict)) },
  };
}

export type ResearchBoard = Awaited<ReturnType<typeof researchBoard>>;
