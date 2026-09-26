import 'server-only';
/**
 * 통관·입고 알리미(v2 5차 tracker) 서버 쪽 — docs/tracker-plan.md.
 *
 *   · 조회: 공개(저장 없음, 인스턴스 메모리 캐시) · 저장한 번호(단계 기록 쌓기)
 *   · 폴링: 알림 켠 번호만, 캐시 시간 안이면 건너뜀, 하루 호출 상한. UNIPASS_ENABLED 꺼짐이면 예시 조직 번호만 흉내로
 *   · 통계: 실측으로 p50·p90 새 판(예시·실제 따로)
 * 관세청 호출은 UnipassHttpAdapter 하나로만(스위치 꺼짐이면 부르기 전에 막힌다). 번호·키는 기록·로그에 싣지 않는다.
 */
import { asPublic, asSystem, asUser, todayKst, type Queryable } from '../db';
import { env } from '../env';
import { kstYmd } from '../tracker/calendar';
import type { StatLike } from '../tracker/leadtime';
import { EFFECTIVE_PORT_SQL, recomputeLeadTimeStats } from '../tracker/store';
import { callBudgets, readTrackerConfig, type TrackerConfig } from '../tracker/settings';
import { buildTrackView, type TrackView, type ViewEvent } from '../tracker/view';
import { UnipassHttpAdapter } from '../unipass/http';
import { defaultArrival, MockUnipassAdapter, querySeed } from '../unipass/mock';
import { PORT_FROM_UNLOCODE, portFromCode } from '../unipass/parse';
import { eventFingerprint, normalizeStage, stageRank, stageTimes, TRACK_STAGE_LABEL } from '../unipass/stages';
import { TRACK_STAGES, UnipassError, type LookupResult, type TrackKind, type TrackQuery, type TrackStage, type UnipassAdapter } from '../unipass/types';
import type { Viewer } from './viewer';

export async function loadTrackerConfig(q: Queryable): Promise<TrackerConfig> {
  const rows = await q.query<{ key: string; value: unknown }>(
    `select key, value from fcd.v_current_settings where key in ('tracker.rules', 'calendar.kr_holidays', 'tracker.arrival_promise_enabled', 'tracker.partner_public_enabled')`,
  );
  return readTrackerConfig(new Map(rows.map((r) => [r.key, r.value])));
}

export interface SwitchState {
  enabled: boolean;
  keyPresent: boolean;
  cronSecretPresent: boolean;
}
export function switchState(): SwitchState {
  return { enabled: env.unipassEnabled, keyPresent: !!env.unipassApiKey, cronSecretPresent: !!env.cronSecret };
}

const UNLOCODE_FROM_PORT: Record<string, 'KRINC' | 'KRPTK'> = Object.fromEntries(Object.entries(PORT_FROM_UNLOCODE).map(([code, port]) => [port, code])) as Record<string, 'KRINC' | 'KRPTK'>;

/**
 * 어댑터 고르기 — 켜짐이면 실제(키가 없으면 조회 때 오류), 꺼짐이면 흉내.
 * 예시(데모) 조직 번호는 켜짐이어도 늘 흉내 — 지어낸 예시 번호를 관세청에 보내지 않는다(하루 상한도 쓰지 않는다).
 * 흉내는 번호의 항구(port)를 양륙항으로 쓴다 — 항구 이름과 코드가 어긋나지 않게.
 */
export function adapterFor(
  cfg: TrackerConfig,
  o: { isDemo?: boolean; onCall?: () => void; arrivalOf?: (q: TrackQuery) => number | null | undefined; port?: string | null; now?: () => number } = {},
): UnipassAdapter {
  if (env.unipassEnabled && !o.isDemo) return new UnipassHttpAdapter({ enabled: true, apiKey: env.unipassApiKey, onCall: o.onCall });
  const code = o.port ? (UNLOCODE_FROM_PORT[o.port] ?? null) : null;
  return new MockUnipassAdapter({ now: o.now ?? (() => Date.now()), holidays: cfg.calendar, arrivalOf: o.arrivalOf, portOf: code ? () => code : undefined });
}

// ─── 통계 읽기 ─────────────────────────────────────────────────────────

export interface PublicStat extends StatLike {
  hist: number[];
  is_example: boolean;
  window_days: number;
  computed_at: string;
}

/**
 * 공개 통계 — 표본 기준 이상만(보기가 거른다). 같은 판(지표·수준·업체·항구·방식)에 실제 판과 예시 판이 함께 있으면 실제 판을 쓴다.
 */
export async function publicStats(q: Queryable): Promise<PublicStat[]> {
  const rows = await q.query<{
    metric: StatLike['metric']; level: StatLike['level']; partner_org_id: string | null; broker_org_id: string | null; port: string; mode: string;
    p50: number; p90: number; n: number; hist: number[]; is_example: boolean; window_days: number; computed_at: string;
  }>(`select metric, level, partner_org_id, broker_org_id, port, mode, p50, p90, n, hist, is_example, window_days, computed_at from fcd.v_lead_time_public`);
  const key = (r: (typeof rows)[number]) => [r.metric, r.level, r.partner_org_id, r.broker_org_id, r.port, r.mode].join('|');
  const real = new Set(rows.filter((r) => !r.is_example).map(key));
  return rows
    .filter((r) => !r.is_example || !real.has(key(r)))
    .map((r) => ({ metric: r.metric, level: r.level, partner: r.partner_org_id, broker: r.broker_org_id, port: r.port, mode: r.mode, p50: r.p50, p90: r.p90, n: r.n, hist: r.hist, is_example: r.is_example, window_days: r.window_days, computed_at: r.computed_at }));
}

export async function sameDay(q: Queryable, port: string | null, mode: string | null, day: string | null) {
  if (!port || !day) return null;
  const r = await q.query<{ total: number; cleared: number }>(`select total, cleared from fcd.track_same_day($1, $2, $3::date)`, [port, mode, day]);
  return r[0] ?? null;
}

// ─── 공개 조회(저장 없음) ────────────────────────────────────────────────

type G = typeof globalThis & { __fcdTrackCache?: Map<string, { at: number; r: LookupResult }> };
const g = globalThis as G;

export interface LookupOutcome {
  result: LookupResult;
  view: TrackView | null;
  port: string | null;
  mode: string | null;
  mock: boolean;
  cached: boolean;
}

async function recordRun(q: Queryable, r: { trigger: 'cron' | 'manual' | 'lookup' | 'save'; mode: 'http' | 'mock' | 'off'; seen?: number; calls?: number; failures?: number; skipped?: number; changed?: number; note?: string | null; actor?: string | null; startedAt?: string }) {
  await q.query(
    `insert into fcd.unipass_poll_runs (trigger, mode, started_at, finished_at, tracks_seen, calls, failures, skipped, changed, note, actor_id)
     values ($1,$2,coalesce($3::timestamptz, now()),now(),$4,$5,$6,$7,$8,$9,$10)`,
    [r.trigger, r.mode, r.startedAt ?? null, r.seen ?? 0, r.calls ?? 0, r.failures ?? 0, r.skipped ?? 0, r.changed ?? 0, r.note ?? null, r.actor ?? null],
  );
}

/** 오늘(KST) 관세청 호출 수 — 전체 · 공개 조회(trigger = lookup) · 저장한 번호(그 밖) */
async function callsToday(q: Queryable): Promise<{ total: number; public: number; poll: number }> {
  const r = await q.query<{ total: number; pub: number }>(
    `select coalesce(sum(calls), 0)::int total, coalesce(sum(calls) filter (where trigger = 'lookup'), 0)::int pub
       from fcd.unipass_poll_runs where mode = 'http' and started_at >= (date_trunc('day', now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul')`,
  );
  return { total: r[0].total, public: r[0].pub, poll: r[0].total - r[0].pub };
}

/** 저장한 번호 몫이 오늘 얼마나 남았나 */
function pollBudgetLeft(cfg: TrackerConfig, used: { total: number; poll: number }) {
  const b = callBudgets(cfg.rules);
  return Math.min(b.poll - used.poll, b.total - used.total);
}

/** 조회 결과의 단계 기록 → 화면 자료 */
export function viewEvents(r: LookupResult): ViewEvent[] {
  return r.status === 'found' ? r.events.map((e) => ({ stage: normalizeStage(e.rawType), rawType: e.rawType, at: e.at, summary: e.summary })) : [];
}

/**
 * 공개 조회 — 결과만 돌려주고 번호를 저장하지 않는다. 같은 번호는 캐시 시간 동안 다시 부르지 않는다(인스턴스 메모리).
 * 호출 수는 회차 기록에 한 줄(번호 없이) — 하루 상한을 넘으면 부르지 않는다.
 */
export async function publicLookup(query: TrackQuery, mode: string | null): Promise<LookupOutcome> {
  const cfg = await asPublic(loadTrackerConfig);
  const k = querySeed(query);
  const cache = (g.__fcdTrackCache ??= new Map());
  const hit = cache.get(k);
  const fresh = hit && Date.now() - hit.at < cfg.rules.cacheMinutes * 60_000;
  let result: LookupResult;
  let calls = 0;
  if (fresh) result = hit!.r;
  else {
    if (env.unipassEnabled) {
      // 공개 조회는 따로 묶은 몫만 쓴다 — 비로그인 조회가 저장한 번호의 폴링 몫을 다 쓰지 못하게
      const used = await asSystem(callsToday);
      const b = callBudgets(cfg.rules);
      if (used.public >= b.public || used.total >= b.total) throw new UnipassError(429, '오늘 공개 조회 한도에 닿았습니다. 내일 다시 해 주세요(화주로 저장한 번호는 계속 봅니다).');
    }
    try {
      result = await adapterFor(cfg, { onCall: () => calls++ }).lookup(query);
    } finally {
      if (env.unipassEnabled) await asSystem((q) => recordRun(q, { trigger: 'lookup', mode: 'http', seen: 1, calls })).catch(() => {});
    }
    cache.set(k, { at: Date.now(), r: result });
    if (cache.size > 2000) for (const [kk, v] of cache) if (Date.now() - v.at > cfg.rules.cacheMinutes * 60_000) cache.delete(kk);
  }
  const port = result.status === 'found' ? portFromCode(result.summary.portCode) : null;
  const view = result.status === 'found' ? await asPublic(async (q) => {
    const stats = await publicStats(q);
    const evs = viewEvents(result);
    const arrival = stageTimes(evs).first.arrival;
    const sd = await sameDay(q, port, mode, arrival ? kstYmd(arrival) : null);
    return buildTrackView({ events: evs, key: { partner: null, broker: null, port, mode }, stats, rules: cfg.rules, calendar: cfg.calendar, today: todayKst(), sameDay: sd });
  }) : null;
  return { result, view, port, mode, mock: !env.unipassEnabled, cached: !!fresh };
}

// ─── 저장한 번호 ─────────────────────────────────────────────────────────

export interface TrackRow {
  id: string;
  org_id: string;
  kind: TrackKind;
  number: string;
  bl_year: number | null;
  label: string | null;
  mode: string | null;
  port: string | null;
  port_raw: string | null;
  shipment_id: string | null;
  shipment_no: string | null;
  partner_org_id: string | null;
  partner_name: string | null;
  broker_org_id: string | null;
  broker_name: string | null;
  stage: TrackStage | null;
  status_raw: string | null;
  arrival_on: string | null;
  last_checked_at: string | null;
  last_error: string | null;
  archived_at: string | null;
  created_at: string;
  watching: boolean;
  is_demo: boolean;
}

// port = 쓰는 항구(번호의 항구 → 조회 전이면 이은 선적의 항구) — 예상일·같은 항구 분포·같은 날 완료율이 같은 값을 쓴다
const TRACK_COLS = `t.id, t.org_id, t.kind, t.number, t.bl_year, t.label, t.mode, ${EFFECTIVE_PORT_SQL} port, t.port_raw, t.shipment_id, s.shipment_no,
  t.partner_org_id, p.name partner_name, t.broker_org_id, b.name broker_name, t.stage, t.status_raw, t.arrival_on, t.last_checked_at, t.last_error,
  t.archived_at, t.created_at, coalesce(w.enabled, false) watching, o.is_demo`;
const TRACK_FROM = `fcd.cargo_tracks t join fcd.orgs o on o.id = t.org_id
  left join fcd.shipments s on s.id = t.shipment_id
  left join fcd.orgs p on p.id = t.partner_org_id
  left join fcd.orgs b on b.id = t.broker_org_id
  left join fcd.v_track_watch_current w on w.track_id = t.id and w.user_id = fcd.uid()`;

export async function myTracks(q: Queryable, orgId: string, includeArchived = false): Promise<TrackRow[]> {
  return q.query<TrackRow>(
    `select ${TRACK_COLS} from ${TRACK_FROM} where t.org_id = $1 ${includeArchived ? '' : 'and t.archived_at is null'}
      order by t.archived_at nulls first, coalesce(fcd.track_stage_rank(t.stage), 0) >= 7, t.created_at desc limit 300`,
    [orgId],
  );
}

export async function trackById(q: Queryable, id: string): Promise<TrackRow | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  return (await q.query<TrackRow>(`select ${TRACK_COLS} from ${TRACK_FROM} where t.id = $1`, [id]))[0] ?? null;
}

export async function trackEvents(q: Queryable, trackId: string): Promise<(ViewEvent & { source: string })[]> {
  const r = await q.query<{ stage: TrackStage | null; raw_type: string; occurred_at: string; raw_summary: string | null; source: string }>(
    `select stage, raw_type, occurred_at, raw_summary, source from fcd.cargo_track_events where track_id = $1 order by occurred_at`,
    [trackId],
  );
  return r.map((e) => ({ stage: e.stage, rawType: e.raw_type, at: e.occurred_at, summary: e.raw_summary, source: e.source }));
}

/** 이은 선적의 국내 창고(8)·FC 입고(9) 시각 */
export async function shipmentLegs(q: Queryable, shipmentId: string | null): Promise<{ domesticAt: string | null; fcAt: string | null } | null> {
  if (!shipmentId) return null;
  const r = await q.query<{ d: string | null; f: string | null; delivered_at: string | null }>(
    `select (select min(occurred_at) from fcd.shipment_events e where e.shipment_id = s.id and e.stage = 8) d,
            (select min(occurred_at) from fcd.shipment_events e where e.shipment_id = s.id and e.stage = 9) f, s.delivered_at
       from fcd.shipments s where s.id = $1`,
    [shipmentId],
  );
  if (!r[0]) return null;
  return { domesticAt: r[0].d, fcAt: r[0].f ?? r[0].delivered_at };
}

export async function trackView(q: Queryable, t: TrackRow, cfg: TrackerConfig): Promise<{ view: TrackView; events: (ViewEvent & { source: string })[] }> {
  const [events, legs, stats] = await Promise.all([trackEvents(q, t.id), shipmentLegs(q, t.shipment_id), publicStats(q)]);
  const sd = await sameDay(q, t.port, t.mode, t.arrival_on);
  const view = buildTrackView({
    events,
    shipment: legs,
    key: { partner: t.partner_org_id, broker: t.broker_org_id, port: t.port, mode: t.mode },
    stats,
    rules: cfg.rules,
    calendar: cfg.calendar,
    today: todayKst(),
    sameDay: sd,
  });
  return { view, events };
}

/**
 * 조회 결과를 번호에 쌓는다(신뢰 경로 — asSystem 안에서만 부른다). 같은 기록은 지문으로 건너뛴다.
 * 돌려주는 값: 지금 단계가 바뀌었으면 { from, to }.
 * 항구는 관세청 양륙항이 있으면 그 값을 앞세운다(우리가 모르는 항구면 없음) — 사용자·선적 값보다 관세청이 먼저.
 */
export async function ingestLookup(q: Queryable, track: { id: string; org_id: string; stage: TrackStage | null }, r: LookupResult) {
  if (r.status !== 'found') {
    await q.query(`update fcd.cargo_tracks set last_checked_at = now(), last_error = $2 where id = $1`, [
      track.id,
      r.status === 'multiple' ? '여러 건 — 화물관리번호로 다시 넣어 주세요' : '조회 결과가 없습니다(번호·연도 확인)',
    ]);
    return null;
  }
  for (const e of r.events) {
    await q.query(
      `insert into fcd.cargo_track_events (track_id, org_id, stage, raw_type, raw_summary, occurred_at, source, fingerprint)
       values ($1,$2,$3,$4,$5,$6::timestamptz,$7,$8) on conflict (track_id, fingerprint) do nothing`,
      [track.id, track.org_id, normalizeStage(e.rawType), e.rawType, e.summary, e.at, r.source, eventFingerprint(e)],
    );
  }
  const all = await q.query<{ stage: TrackStage | null; occurred_at: string }>(`select stage, occurred_at from fcd.cargo_track_events where track_id = $1`, [track.id]);
  const st = stageTimes(all.map((x) => ({ stage: x.stage, at: x.occurred_at })));
  const arrival = st.first.arrival ?? st.first.unloading ?? null;
  const code = r.summary.portCode;
  const cargoNo = r.summary.cargoNo && /^[A-Z0-9-]{4,40}$/.test(r.summary.cargoNo) ? r.summary.cargoNo : null;
  await q.query(
    `update fcd.cargo_tracks set stage = $2, status_raw = $3, arrival_on = coalesce($4::date, arrival_on), port_raw = coalesce($5, port_raw),
       port = case when $5::text is not null then $6 else port end, cargo_no = coalesce(cargo_no, $7), last_checked_at = now(), last_error = null where id = $1`,
    [track.id, st.current, r.summary.status, arrival ? kstYmd(arrival) : r.summary.arrivalOn, code, portFromCode(code), cargoNo],
  );
  return stageRank(st.current) > stageRank(track.stage) ? { from: track.stage, to: st.current } : null;
}

const NOTIFY_STAGES: Partial<Record<TrackStage, string>> = { arrival: '입항했습니다', cleared: '수입신고가 수리됐습니다', released: '보세구역에서 반출됐습니다' };

/**
 * 단계가 바뀌면 알림 켠 사람에게 화면 안 알림 한 건(신뢰 경로). 폴링·지금 다시 조회·저장 때 조회 모두 이것을 거친다.
 *   · 여러 단계를 한 번에 건너면(반입 → 반출) 건넌 알림 단계를 한 건에 모아 적는다(수리를 빠뜨리지 않게)
 *   · 알림 설정에서 「진행 상태」 화면 알림을 끈 사람, 이제 그 조직 구성원이 아닌 사람은 뺀다(notify.ts notifyOrg 와 같은 규칙)
 *   · 버튼을 누른 사람(exceptUser)은 뺀다 — 화면에서 바로 본다
 */
export async function notifyTrackChange(
  q: Queryable,
  t: { id: string; org_id: string; number: string; is_demo: boolean },
  ch: { from: TrackStage | null; to: TrackStage | null } | null,
  exceptUser: string | null = null,
): Promise<number> {
  if (!ch?.to) return 0;
  const lo = stageRank(ch.from);
  const hi = stageRank(ch.to);
  const crossed = TRACK_STAGES.filter((s) => NOTIFY_STAGES[s] && stageRank(s) > lo && stageRank(s) <= hi);
  if (!crossed.length) return 0;
  const last = crossed[crossed.length - 1];
  const title = `통관 알림 — ${NOTIFY_STAGES[last]}`;
  const body = `${t.number}${t.is_demo ? ' (예시)' : ''} · ${crossed.length > 1 ? `${crossed.map((s) => TRACK_STAGE_LABEL[s]).join(' → ')} · ` : ''}관세청 UNI-PASS 기준`;
  const watchers = await q.query<{ user_id: string }>(
    `select w.user_id from fcd.v_track_watch_current w
       join fcd.memberships m on m.user_id = w.user_id and m.org_id = w.org_id
       left join fcd.notification_prefs np on np.user_id = w.user_id and np.kind = 'status'
      where w.track_id = $1 and w.enabled and np.in_app is not false and ($2::uuid is null or w.user_id <> $2::uuid)`,
    [t.id, exceptUser],
  );
  for (const w of watchers) {
    await q.query(`insert into fcd.notifications (user_id, org_id, kind, title, body, link) values ($1,$2,'status',$3,$4,$5)`, [w.user_id, t.org_id, title, body, `/app/tracking/${t.id}`]);
  }
  return watchers.length;
}

/** 흉내 어댑터의 입항 기준 — 이미 쌓인 입항 기록, 없으면 번호를 저장한 때의 기본값(저장 때 본 결과와 같게) */
async function mockArrivalOf(q: Queryable, t: { id: string; created_at: string }, query: TrackQuery): Promise<number> {
  const r = await q.query<{ at: string | null }>(`select min(occurred_at) at from fcd.cargo_track_events where track_id = $1 and stage = 'arrival'`, [t.id]);
  return r[0]?.at ? Date.parse(r[0].at) : defaultArrival(querySeed(query), Date.parse(t.created_at));
}

interface TrackCore {
  id: string;
  org_id: string;
  kind: TrackKind;
  number: string;
  bl_year: number | null;
  stage: TrackStage | null;
  port: string | null;
  created_at: string;
  is_demo: boolean;
}

/**
 * 번호 하나 조회해 쌓기. 관세청 호출은 **DB 트랜잭션 밖에서** 한다 — 흉내 기준 읽기 · 호출 · 결과 쓰기(+알림)를 따로 짧게.
 * (호출이 오래 걸려도 트랜잭션을 잡고 있지 않고, 중간에 멈춰도 앞 번호의 기록이 함께 되돌아가지 않는다.)
 */
async function lookupAndIngest(cfg: TrackerConfig, t: TrackCore, o: { now?: number; exceptUser?: string | null }) {
  const query: TrackQuery = { kind: t.kind, number: t.number, year: t.bl_year };
  let calls = 0;
  const http = env.unipassEnabled && !t.is_demo;
  const anchor = http ? null : await asSystem((q) => mockArrivalOf(q, t, query));
  const adapter = adapterFor(cfg, { isDemo: t.is_demo, onCall: () => calls++, arrivalOf: () => anchor, port: t.port, now: o.now ? () => o.now! : undefined });
  try {
    const r = await adapter.lookup(query);
    const ch = await asSystem(async (q) => {
      const c = await ingestLookup(q, t, r);
      await notifyTrackChange(q, t, c, o.exceptUser ?? null);
      return c;
    });
    return { http: adapter.kind === 'http', calls: adapter.kind === 'http' ? calls : 0, changed: ch, failed: false };
  } catch (e) {
    const msg = e instanceof UnipassError ? e.message : '관세청 조회에 실패했습니다';
    await asSystem((q) => q.query(`update fcd.cargo_tracks set last_checked_at = now(), last_error = $2 where id = $1`, [t.id, msg.slice(0, 120)])).catch(() => {});
    return { http: adapter.kind === 'http', calls: adapter.kind === 'http' ? calls : 0, changed: null, failed: true };
  }
}

export interface SaveInput {
  query: TrackQuery;
  label: string | null;
  mode: string | null;
  shipmentId: string | null;
}

/**
 * 번호 저장(화주) → 바로 한 번 조회해 쌓기 → 알림 켜기. 같은 번호가 있으면 그 번호를 돌려준다.
 * 같은 번호를 전에 목록에서 뺐으면(archived) 목록에 되돌리고 알림을 다시 켠다(restored).
 */
export async function saveTrack(v: Viewer, orgId: string, i: SaveInput): Promise<{ ok: true; id: string; already: boolean; restored?: boolean } | { ok: false; error: string }> {
  const cfg = await asUser(v, loadTrackerConfig);
  const pre = await asUser(v, async (q) => {
    const dup = await q.query<{ id: string; archived: boolean }>(
      `select id, archived_at is not null archived from fcd.cargo_tracks where org_id = $1 and kind = $2 and number = $3 and coalesce(bl_year, 0) = coalesce($4::smallint, 0)`,
      [orgId, i.query.kind, i.query.number, i.query.year],
    );
    if (dup[0]) {
      if (dup[0].archived) {
        await q.query(`update fcd.cargo_tracks set archived_at = null where id = $1`, [dup[0].id]);
        await q.query(`insert into fcd.track_watches (track_id, org_id, user_id, enabled) values ($1,$2,$3,true)`, [dup[0].id, orgId, v.id]);
      }
      return { dup: dup[0].id, restored: dup[0].archived };
    }
    const n = await q.query<{ n: number }>(`select count(*)::int n from fcd.cargo_tracks where org_id = $1 and archived_at is null`, [orgId]);
    if (n[0].n >= cfg.rules.maxTracksPerOrg) return { error: `번호는 한 조직에 ${cfg.rules.maxTracksPerOrg}개까지 저장합니다. 끝난 번호를 「목록에서 빼기」 해 주세요.` };
    let partner: string | null = null;
    let mode = i.mode;
    let port: string | null = null;
    if (i.shipmentId) {
      const s = await q.query<{ partner_org_id: string; mode: string; port: string }>(`select partner_org_id, mode, port from fcd.shipments where id = $1 and shipper_org_id = $2`, [i.shipmentId, orgId]);
      if (!s[0]) return { error: '이을 선적을 찾지 못했습니다' };
      partner = s[0].partner_org_id;
      mode = s[0].mode;
      port = s[0].port;
    }
    const row = await q.query<{ id: string; created_at: string }>(
      `insert into fcd.cargo_tracks (org_id, created_by, kind, number, bl_year, label, mode, port, shipment_id, partner_org_id)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id, created_at`,
      [orgId, v.id, i.query.kind, i.query.number, i.query.year, i.label, mode, port, i.shipmentId, partner],
    );
    await q.query(`insert into fcd.track_watches (track_id, org_id, user_id, enabled) values ($1,$2,$3,true)`, [row[0].id, orgId, v.id]);
    return { id: row[0].id, created_at: row[0].created_at };
  });
  if ('error' in pre) return { ok: false, error: pre.error! };
  if ('dup' in pre) return { ok: true, id: pre.dup!, already: true, restored: pre.restored };
  // 바로 한 번 조회해 쌓는다(신뢰 경로). 실패해도 번호는 남고 다음 폴링에서 다시 본다
  await refreshTrack(pre.id, { trigger: 'save', actorId: v.id, cfg }).catch(() => {});
  return { ok: true, id: pre.id, already: false };
}

/** 이 번호를 지금 조회할 수 있나 — 꺼짐이면 예시 조직 번호만(흉내). 실제 조직 번호는 「연결 준비 중」(오류가 아니다) */
export function lookupReady(isDemo: boolean) {
  return env.unipassEnabled || isDemo;
}

/**
 * 번호 하나 다시 보기(신뢰 경로). 꺼짐이면 흉내 — 단, 실제 조직 번호는 흉내 기록을 쌓지 않는다(실측이 섞이지 않게).
 * 꺼짐 때문에 못 본 것은 오류(last_error)로 적지 않는다 — 화면이 스위치·예시 여부로 「연결 준비 중」을 따로 보인다.
 */
export async function refreshTrack(id: string, o: { trigger: 'save' | 'manual'; actorId: string | null; cfg?: TrackerConfig; reservePollBp?: number }) {
  const pre = await asSystem(async (q) => {
    const cfg = o.cfg ?? (await loadTrackerConfig(q));
    const t = (await q.query<TrackCore>(
      `select t.id, t.org_id, t.kind, t.number, t.bl_year, t.stage, ${EFFECTIVE_PORT_SQL} port, t.created_at, o.is_demo
         from fcd.cargo_tracks t join fcd.orgs o on o.id = t.org_id left join fcd.shipments s on s.id = t.shipment_id where t.id = $1`,
      [id],
    ))[0];
    if (!t) return null;
    if (!lookupReady(t.is_demo)) {
      await recordRun(q, { trigger: o.trigger, mode: 'off', seen: 1, skipped: 1, actor: o.actorId, note: '꺼짐 — 실제 조직 번호는 흉내로 채우지 않음' });
      return null;
    }
    const http = env.unipassEnabled && !t.is_demo;
    // v2 6차 scorecard — 물류사 제출 번호는 하루 몫의 일부만 쓴다(reservePollBp = 셀러 알림 폴링 몫으로 남길 비율)
    const floor = o.reservePollBp ? Math.ceil((callBudgets(cfg.rules).poll * o.reservePollBp) / 10_000) : 0;
    if (http && pollBudgetLeft(cfg, await callsToday(q)) <= floor) {
      await recordRun(q, { trigger: o.trigger, mode: 'http', seen: 1, skipped: 1, actor: o.actorId, note: '하루 호출 상한' });
      return null;
    }
    return { cfg, t };
  });
  if (!pre) return null;
  const startedAt = new Date().toISOString();
  const r = await lookupAndIngest(pre.cfg, pre.t, { exceptUser: o.actorId });
  await asSystem((q) =>
    recordRun(q, { trigger: o.trigger, mode: r.http ? 'http' : 'mock', seen: 1, calls: r.calls, failures: r.failed ? 1 : 0, changed: r.changed ? 1 : 0, actor: o.actorId, startedAt }),
  );
  return r.changed;
}

// ─── 폴링 ───────────────────────────────────────────────────────────────

export interface PollSummary {
  mode: 'http' | 'mock';
  seen: number;
  calls: number;
  failures: number;
  skipped: number;
  changed: number;
  /** 시간 한도에 닿아 남은 번호를 다음 회차로 넘겼나 */
  stoppedEarly?: boolean;
}

/** 한 회차의 시간 한도(밀리초) — 예약 경로 maxDuration(60초)보다 짧게. 남은 번호는 다음 회차가 본다 */
export const POLL_TIME_LIMIT_MS = 45_000;

/**
 * 폴링 한 회차(신뢰 경로 — 예약 경로·운영자 버튼). 알림 켠 번호 중 반출 전·목록에 있는 것만, 오래 안 본 순, 캐시 시간 지난 것만.
 * 켜짐이면 실제 조직 번호는 관세청으로, 예시 조직 번호는 흉내로. 꺼짐이면 예시 조직 번호만 흉내로.
 * 후보 고르기는 짧은 트랜잭션 하나, 번호마다 호출은 트랜잭션 밖 · 쓰기는 번호마다 따로(lookupAndIngest).
 * 시간 한도(timeLimitMs)에 닿으면 멈추고, 회차 기록은 멈춰도 꼭 남긴다(하루 상한 셈이 빠지지 않게).
 */
export async function pollOnce(o: { trigger: 'cron' | 'manual'; actorId: string | null; now?: number; timeLimitMs?: number }): Promise<PollSummary> {
  const deadline = Date.now() + (o.timeLimitMs ?? POLL_TIME_LIMIT_MS);
  const startedAt = new Date().toISOString();
  const http = env.unipassEnabled;
  const { cfg, cands, used } = await asSystem(async (q) => {
    const cfg = await loadTrackerConfig(q);
    const cands = await q.query<TrackCore & { fresh: boolean }>(
      `select t.id, t.org_id, t.kind, t.number, t.bl_year, t.stage, ${EFFECTIVE_PORT_SQL} port, t.created_at, o.is_demo,
              (t.last_checked_at is not null and t.last_checked_at > now() - make_interval(mins => $1::int)) fresh
         from fcd.cargo_tracks t join fcd.orgs o on o.id = t.org_id left join fcd.shipments s on s.id = t.shipment_id
        where t.archived_at is null and coalesce(fcd.track_stage_rank(t.stage), 0) < 7
          and exists (select 1 from fcd.v_track_watch_current w where w.track_id = t.id and w.enabled)
          and ($2::boolean or o.is_demo)
        order by t.last_checked_at nulls first, t.created_at
        limit $3`,
      [cfg.rules.cacheMinutes, http, cfg.rules.batchLimit],
    );
    return { cfg, cands, used: http ? await callsToday(q) : { total: 0, public: 0, poll: 0 } };
  });
  const sum: PollSummary = { mode: http ? 'http' : 'mock', seen: cands.length, calls: 0, failures: 0, skipped: 0, changed: 0 };
  let budget = http ? pollBudgetLeft(cfg, used) : Infinity;
  try {
    for (const t of cands) {
      const real = http && !t.is_demo;
      if (Date.now() > deadline) {
        sum.stoppedEarly = true;
        sum.skipped++;
        continue;
      }
      if (t.fresh || (real && budget <= 0)) {
        sum.skipped++;
        continue;
      }
      const r = await lookupAndIngest(cfg, t, { now: o.now });
      if (r.failed) sum.failures++;
      if (r.changed) sum.changed++;
      sum.calls += r.calls;
      budget -= r.calls;
    }
  } finally {
    const note = [http ? null : '꺼짐 — 예시 조직 번호만 흉내로', sum.stoppedEarly ? '시간 한도 — 남은 번호는 다음 회차' : null].filter(Boolean).join(' · ') || null;
    await asSystem((q) =>
      recordRun(q, { trigger: o.trigger, mode: sum.mode, seen: sum.seen, calls: sum.calls, failures: sum.failures, skipped: sum.skipped, changed: sum.changed, actor: o.actorId, startedAt, note }),
    ).catch((e) => console.error(`[tracker] 폴링 회차 기록 실패: ${(e as Error).message}`));
  }
  return sum;
}

// ─── 통계 새 판 ─ src/lib/tracker/store.ts(시드와 함께 쓴다)

export async function recomputeStats(q: Queryable, o: { today?: string } = {}) {
  return recomputeLeadTimeStats(q, await loadTrackerConfig(q), o.today ?? todayKst());
}

/** 예약 경로용 — 마지막 판이 staleHours 보다 오래됐을 때만 새 판(30분마다 판이 쌓이지 않게) */
export async function recomputeIfStale(q: Queryable, staleHours = 6) {
  const r = await q.query<{ fresh: boolean }>(`select exists (select 1 from fcd.lead_time_stats where computed_at > now() - make_interval(hours => $1::int)) fresh`, [staleHours]);
  return r[0].fresh ? null : recomputeStats(q);
}

// ─── 화면 도움 ─────────────────────────────────────────────────────────────

/** 선적 화면 — 이은 번호(가장 최근 하나)와 관세청 단계 첫 시각 */
export async function trackForShipment(q: Queryable, shipmentId: string) {
  const t = (await q.query<{ id: string; kind: TrackKind; number: string; stage: TrackStage | null; last_checked_at: string | null; is_demo: boolean }>(
    `select t.id, t.kind, t.number, t.stage, t.last_checked_at, o.is_demo from fcd.cargo_tracks t join fcd.orgs o on o.id = t.org_id
      where t.shipment_id = $1 and t.archived_at is null order by t.created_at desc limit 1`,
    [shipmentId],
  ))[0];
  if (!t) return null;
  const ev = await trackEvents(q, t.id);
  const st = stageTimes(ev);
  return { ...t, first: st.first, source: ev.some((e) => e.source === 'unipass') ? ('unipass' as const) : ev.length ? ('mock' as const) : null };
}

/**
 * 업체 화면 — 그 업체의 실측 입항→수리 소요(표본 기준 이상만).
 * 실제 판은 설정 tracker.partner_public_enabled 가 켜졌을 때만(업체 동의·답변권·약관이 정해지기 전에는 꺼짐) — 꺼짐이면 예시 판만.
 */
export async function partnerLeadTimes(q: Queryable, orgId: string) {
  const cfg = await loadTrackerConfig(q);
  return (await publicStats(q)).filter((r) => r.partner === orgId && r.level === 'partner' && (r.is_example || cfg.partnerPublicOn));
}

export interface AdminTrackerStatus {
  runs: { id: string; trigger: string; mode: string; started_at: string; finished_at: string | null; tracks_seen: number; calls: number; failures: number; skipped: number; changed: number; note: string | null }[];
  today: { calls: number; failures: number; runs: number };
  counts: { tracks: number; watched: number; open: number; errors: number; demo: number };
  stats: { computed_at: string | null; rows: number };
}

export async function adminTrackerStatus(q: Queryable): Promise<AdminTrackerStatus> {
  const runs = await q.query<AdminTrackerStatus['runs'][number]>(
    `select id, trigger, mode, started_at, finished_at, tracks_seen, calls, failures, skipped, changed, note from fcd.unipass_poll_runs order by started_at desc limit 30`,
  );
  const today = (await q.query<AdminTrackerStatus['today']>(
    `select coalesce(sum(calls) filter (where mode = 'http'), 0)::int calls, coalesce(sum(failures), 0)::int failures, count(*)::int runs
       from fcd.unipass_poll_runs where started_at >= (date_trunc('day', now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul')`,
  ))[0];
  const counts = (await q.query<AdminTrackerStatus['counts']>(
    `select count(*)::int tracks,
            count(*) filter (where t.archived_at is null and exists (select 1 from fcd.v_track_watch_current w where w.track_id = t.id and w.enabled))::int watched,
            count(*) filter (where t.archived_at is null and coalesce(fcd.track_stage_rank(t.stage), 0) < 7)::int open,
            count(*) filter (where t.last_error is not null)::int errors,
            count(*) filter (where o.is_demo)::int demo
       from fcd.cargo_tracks t join fcd.orgs o on o.id = t.org_id`,
  ))[0];
  const stats = (await q.query<{ computed_at: string | null; rows: number }>(
    `with cur as (select batch_id, computed_at from fcd.lead_time_stats order by computed_at desc limit 1)
     select (select computed_at from cur) computed_at, (select count(*)::int from fcd.lead_time_stats s where s.batch_id = (select batch_id from cur)) rows`,
  ))[0];
  return { runs, today, counts, stats };
}
