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
import { recomputeLeadTimeStats } from '../tracker/store';
import { readTrackerConfig, type TrackerConfig } from '../tracker/settings';
import { buildTrackView, type TrackView, type ViewEvent } from '../tracker/view';
import { UnipassHttpAdapter } from '../unipass/http';
import { defaultArrival, MockUnipassAdapter, querySeed } from '../unipass/mock';
import { portFromCode } from '../unipass/parse';
import { eventFingerprint, normalizeStage, stageRank, stageTimes } from '../unipass/stages';
import { UnipassError, type LookupResult, type TrackKind, type TrackQuery, type TrackStage, type UnipassAdapter } from '../unipass/types';
import type { Viewer } from './viewer';

export async function loadTrackerConfig(q: Queryable): Promise<TrackerConfig> {
  const rows = await q.query<{ key: string; value: unknown }>(
    `select key, value from fcd.v_current_settings where key in ('tracker.rules', 'calendar.kr_holidays', 'tracker.arrival_promise_enabled')`,
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

/** 어댑터 고르기 — 켜짐이면 실제(키가 없으면 조회 때 오류), 꺼짐이면 흉내 */
export function adapterFor(cfg: TrackerConfig, o: { onCall?: () => void; arrivalOf?: (q: TrackQuery) => number | null | undefined; now?: () => number } = {}): UnipassAdapter {
  if (env.unipassEnabled) return new UnipassHttpAdapter({ enabled: true, apiKey: env.unipassApiKey, onCall: o.onCall });
  return new MockUnipassAdapter({ now: o.now ?? (() => Date.now()), holidays: cfg.calendar, arrivalOf: o.arrivalOf });
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

async function callsToday(q: Queryable): Promise<number> {
  const r = await q.query<{ n: number }>(
    `select coalesce(sum(calls), 0)::int n from fcd.unipass_poll_runs where mode = 'http' and started_at >= (date_trunc('day', now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul')`,
  );
  return r[0].n;
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
    if (env.unipassEnabled && (await asSystem(callsToday)) >= cfg.rules.dailyCallBudget) {
      throw new UnipassError(429, '오늘 관세청 조회 한도에 닿았습니다. 내일 다시 해 주세요.');
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

const TRACK_COLS = `t.id, t.org_id, t.kind, t.number, t.bl_year, t.label, t.mode, t.port, t.port_raw, t.shipment_id, s.shipment_no,
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
 */
export async function ingestLookup(q: Queryable, track: { id: string; org_id: string; stage: TrackStage | null; port: string | null }, r: LookupResult) {
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
  const port = portFromCode(r.summary.portCode);
  await q.query(
    `update fcd.cargo_tracks set stage = $2, status_raw = $3, arrival_on = coalesce($4::date, arrival_on), port_raw = coalesce($5, port_raw),
       port = coalesce(port, $6), last_checked_at = now(), last_error = null where id = $1`,
    [track.id, st.current, r.summary.status, arrival ? kstYmd(arrival) : r.summary.arrivalOn, r.summary.portCode, port],
  );
  return stageRank(st.current) > stageRank(track.stage) ? { from: track.stage, to: st.current } : null;
}

/** 흉내 어댑터의 입항 기준 — 이미 쌓인 입항 기록, 없으면 번호를 저장한 때의 기본값(저장 때 본 결과와 같게) */
async function mockArrivalOf(q: Queryable, t: { id: string; created_at: string }, query: TrackQuery): Promise<number> {
  const r = await q.query<{ at: string | null }>(`select min(occurred_at) at from fcd.cargo_track_events where track_id = $1 and stage = 'arrival'`, [t.id]);
  return r[0]?.at ? Date.parse(r[0].at) : defaultArrival(querySeed(query), Date.parse(t.created_at));
}

export interface SaveInput {
  query: TrackQuery;
  label: string | null;
  mode: string | null;
  shipmentId: string | null;
}

/** 번호 저장(화주) → 바로 한 번 조회해 쌓기 → 알림 켜기. 같은 번호가 있으면 그 번호를 돌려준다 */
export async function saveTrack(v: Viewer, orgId: string, i: SaveInput): Promise<{ ok: true; id: string; already: boolean } | { ok: false; error: string }> {
  const cfg = await asUser(v, loadTrackerConfig);
  const pre = await asUser(v, async (q) => {
    const dup = await q.query<{ id: string }>(
      `select id from fcd.cargo_tracks where org_id = $1 and kind = $2 and number = $3 and coalesce(bl_year, 0) = coalesce($4::smallint, 0)`,
      [orgId, i.query.kind, i.query.number, i.query.year],
    );
    if (dup[0]) return { dup: dup[0].id };
    const n = await q.query<{ n: number }>(`select count(*)::int n from fcd.cargo_tracks where org_id = $1 and archived_at is null`, [orgId]);
    if (n[0].n >= cfg.rules.maxTracksPerOrg) return { error: `번호는 한 조직에 ${cfg.rules.maxTracksPerOrg}개까지 저장합니다. 끝난 번호를 보관 끝내기 해 주세요.` };
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
  if ('dup' in pre) return { ok: true, id: pre.dup!, already: true };
  // 바로 한 번 조회해 쌓는다(신뢰 경로). 실패해도 번호는 남고 다음 폴링에서 다시 본다
  await refreshTrack(pre.id, { trigger: 'save', actorId: v.id, cfg }).catch(() => {});
  return { ok: true, id: pre.id, already: false };
}

/**
 * 번호 하나 다시 보기(신뢰 경로). 꺼짐이면 흉내 — 단, 실제 조직 번호는 흉내 기록을 쌓지 않는다(실측이 섞이지 않게).
 */
export async function refreshTrack(id: string, o: { trigger: 'save' | 'manual'; actorId: string | null; cfg?: TrackerConfig }) {
  return asSystem(async (q) => {
    const cfg = o.cfg ?? (await loadTrackerConfig(q));
    const t = (await q.query<{ id: string; org_id: string; kind: TrackKind; number: string; bl_year: number | null; stage: TrackStage | null; port: string | null; created_at: string; is_demo: boolean }>(
      `select t.id, t.org_id, t.kind, t.number, t.bl_year, t.stage, t.port, t.created_at, o.is_demo from fcd.cargo_tracks t join fcd.orgs o on o.id = t.org_id where t.id = $1`,
      [id],
    ))[0];
    if (!t) return null;
    const query: TrackQuery = { kind: t.kind, number: t.number, year: t.bl_year };
    if (!env.unipassEnabled && !t.is_demo) {
      await q.query(`update fcd.cargo_tracks set last_error = $2 where id = $1`, [t.id, '관세청 조회가 아직 꺼져 있습니다(연결 준비 중)']);
      await recordRun(q, { trigger: o.trigger, mode: 'off', seen: 1, skipped: 1, actor: o.actorId, note: '꺼짐 — 실제 조직 번호는 흉내로 채우지 않음' });
      return null;
    }
    if (env.unipassEnabled && (await callsToday(q)) >= cfg.rules.dailyCallBudget) {
      await recordRun(q, { trigger: o.trigger, mode: 'http', seen: 1, skipped: 1, actor: o.actorId, note: '하루 호출 상한' });
      return null;
    }
    let calls = 0;
    const anchor = env.unipassEnabled ? null : await mockArrivalOf(q, t, query);
    const adapter = adapterFor(cfg, { onCall: () => calls++, arrivalOf: () => anchor });
    try {
      const r = await adapter.lookup(query);
      const ch = await ingestLookup(q, t, r);
      await recordRun(q, { trigger: o.trigger, mode: adapter.kind === 'http' ? 'http' : 'mock', seen: 1, calls: adapter.kind === 'http' ? calls : 0, changed: ch ? 1 : 0, actor: o.actorId });
      return ch;
    } catch (e) {
      const msg = e instanceof UnipassError ? e.message : '관세청 조회에 실패했습니다';
      await q.query(`update fcd.cargo_tracks set last_checked_at = now(), last_error = $2 where id = $1`, [t.id, msg.slice(0, 120)]);
      await recordRun(q, { trigger: o.trigger, mode: adapter.kind === 'http' ? 'http' : 'mock', seen: 1, calls, failures: 1, actor: o.actorId });
      return null;
    }
  });
}

const NOTIFY_STAGES: Partial<Record<TrackStage, string>> = { arrival: '입항했습니다', cleared: '수입신고가 수리됐습니다', released: '보세구역에서 반출됐습니다' };

// ─── 폴링 ───────────────────────────────────────────────────────────────

export interface PollSummary {
  mode: 'http' | 'mock';
  seen: number;
  calls: number;
  failures: number;
  skipped: number;
  changed: number;
}

/**
 * 폴링 한 회차(신뢰 경로 — 예약 경로·운영자 버튼). 알림 켠 번호 중 반출 전·보관 중인 것만, 오래 안 본 순, 캐시 시간 지난 것만.
 * 꺼짐이면 예시 조직 번호만 흉내로 돌린다.
 */
export async function pollOnce(o: { trigger: 'cron' | 'manual'; actorId: string | null; now?: number }): Promise<PollSummary> {
  return asSystem(async (q) => {
    const cfg = await loadTrackerConfig(q);
    const startedAt = new Date().toISOString();
    const http = env.unipassEnabled;
    const cands = await q.query<{ id: string; org_id: string; kind: TrackKind; number: string; bl_year: number | null; stage: TrackStage | null; port: string | null; created_at: string; is_demo: boolean; fresh: boolean }>(
      `select t.id, t.org_id, t.kind, t.number, t.bl_year, t.stage, t.port, t.created_at, o.is_demo,
              (t.last_checked_at is not null and t.last_checked_at > now() - make_interval(mins => $1::int)) fresh
         from fcd.cargo_tracks t join fcd.orgs o on o.id = t.org_id
        where t.archived_at is null and coalesce(fcd.track_stage_rank(t.stage), 0) < 7
          and exists (select 1 from fcd.v_track_watch_current w where w.track_id = t.id and w.enabled)
          and ($2::boolean or o.is_demo)
        order by t.last_checked_at nulls first, t.created_at
        limit $3`,
      [cfg.rules.cacheMinutes, http, cfg.rules.batchLimit],
    );
    const sum: PollSummary = { mode: http ? 'http' : 'mock', seen: cands.length, calls: 0, failures: 0, skipped: 0, changed: 0 };
    let budget = http ? cfg.rules.dailyCallBudget - (await callsToday(q)) : Infinity;
    for (const t of cands) {
      if (t.fresh || budget <= 0) {
        sum.skipped++;
        continue;
      }
      const query: TrackQuery = { kind: t.kind, number: t.number, year: t.bl_year };
      let calls = 0;
      const anchor = http ? null : await mockArrivalOf(q, t, query);
      const adapter = adapterFor(cfg, { onCall: () => calls++, arrivalOf: () => anchor, now: o.now ? () => o.now! : undefined });
      try {
        const r = await adapter.lookup(query);
        const ch = await ingestLookup(q, t, r);
        if (ch) {
          sum.changed++;
          const msg = ch.to ? NOTIFY_STAGES[ch.to] : undefined;
          if (msg) {
            const watchers = await q.query<{ user_id: string }>(`select user_id from fcd.v_track_watch_current where track_id = $1 and enabled`, [t.id]);
            for (const w of watchers) {
              await q.query(`insert into fcd.notifications (user_id, org_id, kind, title, body, link) values ($1,$2,'status',$3,$4,$5)`, [
                w.user_id, t.org_id, `통관 알림 — ${msg}`, `${t.number}${t.is_demo ? ' (예시)' : ''} · 관세청 UNI-PASS 기준`, `/app/tracking/${t.id}`,
              ]);
            }
          }
        }
      } catch (e) {
        sum.failures++;
        await q.query(`update fcd.cargo_tracks set last_checked_at = now(), last_error = $2 where id = $1`, [t.id, (e instanceof UnipassError ? e.message : '관세청 조회에 실패했습니다').slice(0, 120)]);
      }
      if (http) {
        sum.calls += calls;
        budget -= calls;
      }
    }
    await recordRun(q, { trigger: o.trigger, mode: sum.mode, seen: sum.seen, calls: sum.calls, failures: sum.failures, skipped: sum.skipped, changed: sum.changed, actor: o.actorId, startedAt, note: http ? null : '꺼짐 — 예시 조직 번호만 흉내로' });
    return sum;
  });
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

/** 업체 화면 — 그 업체의 실측 입항→수리 소요(표본 기준 이상만) */
export async function partnerLeadTimes(q: Queryable, orgId: string) {
  return (await publicStats(q)).filter((r) => r.partner === orgId && r.level === 'partner');
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
            count(*) filter (where exists (select 1 from fcd.v_track_watch_current w where w.track_id = t.id and w.enabled))::int watched,
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
