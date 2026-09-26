import 'server-only';
/**
 * 물류사 성적표(v2 6차 scorecard) 서버 쪽 — docs/scorecard-plan.md.
 *   · 읽기: 로그인 사용자는 v_scorecard_named(RLS — 이름 붙은 성적은 로그인 화주·그 업체·운영자), 비로그인은 v_scorecard_public(이름 없는 집계)
 *   · 새 판 계산: 신뢰 경로(asSystem) — src/lib/scorecard/store.ts
 *   · 물류사 제출: 제출 기록은 asUser(RLS), 단계 기록을 쌓을 번호(물류사 조직 소유 cargo_tracks)는 신뢰 경로가 만들고 5차 refreshTrack 로 조회
 *   · 이의 제기·처리(쌓기만) · 부호 연결(새 판) · 관세사 기본 정보(새 판)
 * 관세청 호출은 5차 어댑터 규칙(UNIPASS_ENABLED 꺼짐이면 흉내, 실제 조직 번호는 흉내로 채우지 않음)을 그대로 따른다.
 */
import { asPublic, asSystem, asUser, todayKst, type Queryable } from '../db';
import { env } from '../env';
import { readScorecardConfig, type ScorecardConfig } from '../scorecard/settings';
import { recomputeScorecards } from '../scorecard/store';
import type { EntityKind, ScoreMetrics, SourceCounts, Submission } from '../scorecard/engine';
import { loadTrackerConfig, lookupReady, refreshTrack } from './tracker';
import { HttpForwarderAdapter, MockForwarderAdapter, type ForwarderAdapter } from '../unipass/forwarders';
import { validateTrackInput } from '../unipass/validate';
import type { TrackQuery } from '../unipass/types';
import type { Viewer } from './viewer';

export async function loadScorecardConfig(q: Queryable): Promise<ScorecardConfig> {
  const rows = await q.query<{ key: string; value: unknown }>(`select key, value from fcd.v_current_settings where key in ('scorecard.rules', 'scorecard.public_named')`);
  return readScorecardConfig(new Map(rows.map((r) => [r.key, r.value])));
}

export interface Snap {
  entity_kind: EntityKind;
  entity_org_id: string | null;
  port: string | null;
  mode: string | null;
  window_days: number;
  from_on: string;
  to_on: string;
  n: number;
  metrics: ScoreMetrics;
  sources: SourceCounts;
  submission: Submission | null;
  certified: boolean;
  is_example: boolean;
  computed_at: string;
}

const SNAP_COLS = `entity_kind, entity_org_id, port, mode, window_days, from_on, to_on, n, metrics, sources, submission, certified, is_example, computed_at`;

function norm(rows: Snap[]): Snap[] {
  const j = <T,>(v: T | string): T => (typeof v === 'string' ? (JSON.parse(v) as T) : v);
  const all = rows.map((r) => ({ ...r, metrics: j(r.metrics), sources: j(r.sources), submission: r.submission == null ? null : j(r.submission) }));
  // 같은 판에 실제 판과 예시 판이 함께 있으면 실제 판을 쓴다(5차 publicStats 와 같은 규칙)
  const key = (r: Snap) => [r.entity_kind, r.entity_org_id, r.port, r.mode].join('|');
  const real = new Set(all.filter((r) => !r.is_example).map(key));
  return all.filter((r) => !r.is_example || !real.has(key(r)));
}

/** 로그인 사용자가 볼 수 있는 성적 — RLS 가 이름 붙은 판을 거른다(표본 기준 미만은 보기가 거른다) */
export async function namedSnaps(q: Queryable): Promise<Snap[]> {
  return norm(await q.query<Snap>(`select ${SNAP_COLS} from fcd.v_scorecard_named`));
}

/** 비로그인 — 이름 없는 집계(스위치가 켜지면 이름 붙은 판도) */
export async function publicSnaps(q: Queryable): Promise<Snap[]> {
  return norm(await q.query<Snap>(`select ${SNAP_COLS} from fcd.v_scorecard_public`));
}

/** 보는 사람에 맞춰 — 로그인이면 named, 아니면 public. named = 이름 붙은 성적을 볼 수 있는가 */
export async function snapsFor(v: Viewer | null): Promise<{ snaps: Snap[]; named: 'all' | 'own' | 'none'; config: ScorecardConfig }> {
  if (!v) {
    return asPublic(async (q) => {
      const config = await loadScorecardConfig(q);
      return { snaps: await publicSnaps(q), named: config.publicNamed ? 'all' : 'none', config };
    });
  }
  return asUser(v, async (q) => {
    const config = await loadScorecardConfig(q);
    const shipper = v.orgs.some((o) => o.kind === 'shipper') || v.orgs.some((o) => o.kind === 'platform');
    return { snaps: await namedSnaps(q), named: shipper || config.publicNamed ? 'all' : 'own', config };
  });
}

export type SnapIndex = Map<string, Snap>;
export const snapKey = (kind: EntityKind, entity: string | null, port: string | null = null, mode: string | null = null) => `${kind}|${entity ?? ''}|${port ?? ''}|${mode ?? ''}`;
export function indexSnaps(rows: readonly Snap[]): SnapIndex {
  return new Map(rows.map((r) => [snapKey(r.entity_kind, r.entity_org_id, r.port, r.mode), r]));
}

// ─── 거래 지표(기존) — 견적 응답 속도만 새로 셈한다 ─────────────────────────────

/** 업체별 견적 응답 시간(시간) 중앙값 — 요청 → 첫 응찰. 신뢰 경로(여러 조직의 요청·응찰을 세지만 수 하나만 낸다) */
export async function quoteResponseHours(orgIds: string[]): Promise<Map<string, { hours: number; n: number }>> {
  if (!orgIds.length) return new Map();
  const rows = await asSystem((q) =>
    q.query<{ org_id: string; hours: number; n: number }>(
      `with f as (
         select b.org_id, b.request_id, min(b.created_at) at from fcd.bids b where b.org_id = any($1::uuid[]) and b.supersedes_id is null group by 1, 2
       )
       select f.org_id, (percentile_cont(0.5) within group (order by extract(epoch from f.at - r.created_at) / 3600))::float8 hours, count(*)::int n
         from f join fcd.quote_requests r on r.id = f.request_id where f.at >= r.created_at group by f.org_id`,
      [orgIds],
    ),
  );
  return new Map(rows.map((r) => [r.org_id, { hours: Math.round(Number(r.hours) * 10) / 10, n: r.n }]));
}

// ─── 새 판 계산 ────────────────────────────────────────────────────────────

export async function recomputeScorecardsNow(q: Queryable, today = todayKst()) {
  const [cfg, tcfg] = await Promise.all([loadScorecardConfig(q), loadTrackerConfig(q)]);
  return recomputeScorecards(q, { rules: cfg.rules, calendar: tcfg.calendar }, today);
}

/** 예약 경로용 — 마지막 판이 staleHours 보다 오래됐을 때만 */
export async function recomputeScorecardsIfStale(q: Queryable, staleHours = 6) {
  const r = await q.query<{ fresh: boolean }>(`select exists (select 1 from fcd.scorecard_snapshots where computed_at > now() - make_interval(hours => $1::int)) fresh`, [staleHours]);
  return r[0].fresh ? null : recomputeScorecardsNow(q);
}

// ─── 물류사 제출 ────────────────────────────────────────────────────────────

export const SUBMIT_MAX_LINES = 200;
export const SUBMIT_LOOKUP_NOW = 20;

export interface ParsedLine {
  line: number;
  raw: string;
  ok: boolean;
  query?: TrackQuery;
  error?: string;
}

/**
 * 붙여 넣은 글 → 번호들(순수). 한 줄에 하나: 「번호」 또는 「번호 연도」(쉼표·탭·공백). 연도가 없으면 기본 연도.
 * 영문·숫자만 있고 연도 두 자리로 시작하는 15~22자는 화물관리번호, 그 밖은 기본 종류(H B/L).
 * 개인통관고유부호는 줄째 거절하고 값을 돌려주지 않는다.
 */
export function parseSubmission(text: string, o: { kind: 'hbl' | 'mbl'; year: number; thisYear: number }): ParsedLine[] {
  const lines = text.split(/\r?\n/).map((s) => s.trim()).filter(Boolean).slice(0, SUBMIT_MAX_LINES);
  const seen = new Set<string>();
  return lines.map((raw, i) => {
    const parts = raw.split(/[\s,\t]+/).filter(Boolean);
    const num = parts[0] ?? '';
    const yr = parts[1] && /^\d{4}$/.test(parts[1]) ? Number(parts[1]) : o.year;
    const bare = num.normalize('NFKC').toUpperCase().replace(/-/g, '');
    const kind = /^\d{2}[A-Z0-9]{13,20}$/.test(bare) && /^\d{2}[A-Z]/.test(bare) ? 'cargo_no' : o.kind;
    const v = validateTrackInput({ kind, number: num, year: kind === 'cargo_no' ? null : yr }, o.thisYear);
    if (!v.ok) return { line: i + 1, raw: v.personal ? '(개인통관고유부호 — 받지 않음)' : raw.slice(0, 40), ok: false, error: v.error };
    const k = `${v.query.kind}:${v.query.number}:${v.query.year ?? ''}`;
    if (seen.has(k)) return { line: i + 1, raw: raw.slice(0, 40), ok: false, error: '같은 번호가 위에 있습니다' };
    seen.add(k);
    return { line: i + 1, raw: raw.slice(0, 40), ok: true, query: v.query };
  });
}

export interface SubmitResult {
  added: number;
  already: number;
  rejected: { line: number; raw: string; error: string }[];
  lookedUp: number;
  /** 꺼짐이고 실제 조직이면 「연결되면 조회」 */
  waiting: boolean;
}

export async function submitCargoNumbers(v: Viewer, partnerOrgId: string, lines: ParsedLine[], meta: { port: string | null; mode: string | null }): Promise<SubmitResult> {
  const ok = lines.filter((l) => l.ok && l.query);
  const rejected = lines.filter((l) => !l.ok).map((l) => ({ line: l.line, raw: l.raw, error: l.error ?? '틀린 줄' }));
  const org = v.orgs.find((o) => o.id === partnerOrgId && o.kind === 'partner');
  if (!org) throw new Error('물류사 조직 구성원만 제출할 수 있습니다');
  // ① 제출 기록(RLS — 그 물류사 구성원만)
  const batch = (await asUser(v, (q) => q.query<{ id: string }>(`select gen_random_uuid()::text id`)))[0].id;
  const inserted = await asUser(v, async (q) => {
    const out: TrackQuery[] = [];
    for (const l of ok) {
      const r = await q.query<{ id: string }>(
        `insert into fcd.partner_cargo_submissions (partner_org_id, submitted_by, batch_id, kind, number, bl_year, port, mode)
         values ($1,$2,$3::uuid,$4,$5,$6,$7,$8) on conflict do nothing returning id`,
        [partnerOrgId, v.id, batch, l.query!.kind, l.query!.number, l.query!.year, meta.port, meta.mode],
      );
      if (r[0]) out.push(l.query!);
    }
    return out;
  });
  // ② 단계 기록을 쌓을 번호(물류사 조직 소유) — 신뢰 경로. 사용자 넣기 정책은 화주 조직만 허용하므로 서버가 만든다
  const ids = await asSystem(async (q) => {
    const out: string[] = [];
    for (const t of inserted) {
      const r = await q.query<{ id: string }>(
        `insert into fcd.cargo_tracks (org_id, created_by, kind, number, bl_year, mode, port) values ($1,$2,$3,$4,$5,$6,$7)
         on conflict do nothing returning id`,
        [partnerOrgId, v.id, t.kind, t.number, t.year, meta.mode, meta.port],
      );
      if (r[0]) out.push(r[0].id);
    }
    return out;
  });
  const ready = lookupReady(org.is_demo);
  let lookedUp = 0;
  if (ready) {
    const cfg = await asSystem(loadTrackerConfig);
    for (const id of ids.slice(0, SUBMIT_LOOKUP_NOW)) {
      await refreshTrack(id, { trigger: 'save', actorId: v.id, cfg }).catch(() => null);
      lookedUp++;
    }
  }
  return { added: inserted.length, already: ok.length - inserted.length, rejected, lookedUp, waiting: !ready };
}

/** 제출한 번호 중 아직 반출 전인 것을 조회(신뢰 경로 — 운영 버튼·예약 경로). 꺼짐이면 예시 조직만 흉내 */
export async function refreshSubmitted(o: { actorId: string | null; limit?: number }) {
  const rows = await asSystem((q) =>
    q.query<{ id: string; is_demo: boolean }>(
      `select t.id, o.is_demo from fcd.cargo_tracks t join fcd.orgs o on o.id = t.org_id
        where o.kind = 'partner' and t.archived_at is null and coalesce(fcd.track_stage_rank(t.stage), 0) < 7
        order by t.last_checked_at nulls first, t.created_at limit $1`,
      [o.limit ?? 30],
    ),
  );
  let seen = 0;
  for (const r of rows) {
    if (!lookupReady(r.is_demo)) continue;
    await refreshTrack(r.id, { trigger: 'manual', actorId: o.actorId }).catch(() => null);
    seen++;
  }
  return { candidates: rows.length, seen };
}

export async function mySubmissions(q: Queryable, orgId: string, limit = 30) {
  return q.query<{ kind: string; number: string; bl_year: number | null; created_at: string; stage: string | null }>(
    `select x.kind, x.number, x.bl_year, x.created_at,
            (select t.stage from fcd.cargo_tracks t where t.org_id = x.partner_org_id and t.kind = x.kind and t.number = x.number and coalesce(t.bl_year, 0) = coalesce(x.bl_year, 0)) stage
       from fcd.partner_cargo_submissions x where x.partner_org_id = $1 order by x.created_at desc limit $2`,
    [orgId, limit],
  );
}

// ─── 이의 제기 ─────────────────────────────────────────────────────────────

export interface DisputeRow {
  id: string;
  partner_org_id: string;
  partner_name: string;
  metric: string | null;
  cargo_ref: string | null;
  body: string;
  created_at: string;
  status: 'open' | 'accepted' | 'rejected' | 'withdrawn';
  thread: { kind: string; body: string; created_at: string }[];
  is_demo: boolean;
}

export async function disputes(q: Queryable, orgId: string | null, limit = 50): Promise<DisputeRow[]> {
  const rows = await q.query<Omit<DisputeRow, 'status' | 'thread'> & { thread: DisputeRow['thread'] | string | null }>(
    `select d.id, d.partner_org_id, o.name partner_name, d.metric, d.cargo_ref, d.body, d.created_at, o.is_demo,
            (select json_agg(json_build_object('kind', x.kind, 'body', x.body, 'created_at', x.created_at) order by x.created_at, x.id)
               from fcd.scorecard_disputes x where x.root_id = d.id) thread
       from fcd.scorecard_disputes d join fcd.orgs o on o.id = d.partner_org_id
      where d.root_id is null and ($1::uuid is null or d.partner_org_id = $1::uuid)
      order by d.created_at desc limit $2`,
    [orgId, limit],
  );
  return rows.map((r) => {
    const thread = (typeof r.thread === 'string' ? JSON.parse(r.thread) : r.thread) ?? [];
    const last = [...thread].reverse().find((t: { kind: string }) => t.kind !== 'note');
    return { ...r, thread, status: (last?.kind ?? 'open') as DisputeRow['status'] };
  });
}

export const DISPUTE_METRIC_LABEL: Record<string, string> = {
  clearance: '입항 → 수리',
  inspection: '검사 비율',
  bonded_release: '반입 → 반출',
  release_fc: '반출 → FC 입고',
  submission: '제출률',
  other: '그 밖',
};
export const DISPUTE_STATUS_LABEL: Record<DisputeRow['status'], string> = { open: '검토 중', accepted: '받아들임', rejected: '돌려보냄', withdrawn: '거둠' };

// ─── 부호 연결 · 관세사 기본 정보 ──────────────────────────────────────────────

/** 부호 목록 어댑터 — 켜짐이면 실제(키가 없으면 조회 때 오류), 꺼짐이면 흉내(넘겨받은 업체 이름들로) */
export function forwarderAdapter(catalog: readonly string[]): ForwarderAdapter {
  if (env.unipassEnabled) return new HttpForwarderAdapter({ enabled: true, apiKey: env.unipassApiKey });
  return new MockForwarderAdapter(catalog);
}

export interface CodeRow {
  org_id: string;
  name: string;
  slug: string | null;
  status: string;
  business_type: string | null;
  is_demo: boolean;
  code: string | null;
  registered_name: string | null;
  source: string | null;
  link_status: string | null;
  note: string | null;
  linked_at: string | null;
  current_id: string | null;
}

export async function customsCodes(q: Queryable): Promise<CodeRow[]> {
  return q.query<CodeRow>(
    `select o.id org_id, o.name, o.slug, o.status, o.business_type, o.is_demo, c.code, c.registered_name, c.source, c.status link_status, c.note, c.created_at linked_at, c.id current_id
       from fcd.orgs o left join lateral (select * from fcd.v_partner_customs_codes_current c where c.org_id = o.id order by c.created_at desc limit 1) c on true
      where o.kind = 'partner' and o.status in ('official', 'pending_verification', 'public_info') and fcd.org_visible(o.id)
      order by (c.code is null) desc, o.name`,
  );
}

export interface BrokerRow {
  id: string;
  name: string;
  name_zh: string | null;
  slug: string | null;
  status: string;
  hq_city: string | null;
  is_demo: boolean;
  related_party_note: string | null;
  registration_no: string | null;
  customs_offices: string[] | null;
  ports: string[] | null;
  specialties: string | null;
  profile_source: string | null;
}

export async function listBrokers(q: Queryable): Promise<BrokerRow[]> {
  return q.query<BrokerRow>(
    `select o.id, o.name, o.name_zh, o.slug, o.status, o.hq_city, o.is_demo, o.related_party_note,
            b.registration_no, b.customs_offices, b.ports, b.specialties, b.source profile_source
       from fcd.orgs o left join lateral (select * from fcd.v_broker_profiles_current b where b.org_id = o.id order by b.created_at desc limit 1) b on true
      where o.kind = 'partner' and o.business_type = 'customs_broker' and fcd.partner_listed(o.id)
      order by (o.status = 'official') desc, o.name`,
  );
}

// ─── 운영 — 자료 품질 ─────────────────────────────────────────────────────────

export interface AdminScorecardStatus {
  computedAt: string | null;
  rows: number;
  overall: Snap | null;
  concentrated: { entity_org_id: string; name: string; topRegistrantBp: number; n: number }[];
  counts: { submissions: number; partnerTracks: number; partnerOpen: number; codesLinked: number; codesMissing: number; disputesOpen: number };
}

export async function adminScorecardStatus(q: Queryable): Promise<AdminScorecardStatus> {
  const snaps = await namedSnaps(q);
  const cfg = await loadScorecardConfig(q);
  const meta = (await q.query<{ computed_at: string | null; rows: number }>(
    `with cur as (select batch_id, computed_at from fcd.scorecard_snapshots order by computed_at desc limit 1)
     select (select computed_at from cur) computed_at, (select count(*)::int from fcd.scorecard_snapshots s where s.batch_id = (select batch_id from cur)) rows`,
  ))[0];
  const names = new Map((await q.query<{ id: string; name: string }>(`select id, name from fcd.orgs where kind = 'partner'`)).map((r) => [r.id, r.name]));
  const concentrated = snaps
    .filter((s) => s.entity_org_id && s.port == null && s.mode == null && s.n >= cfg.rules.minSamples && s.sources.topRegistrantBp >= 5000)
    .map((s) => ({ entity_org_id: s.entity_org_id!, name: names.get(s.entity_org_id!) ?? '—', topRegistrantBp: s.sources.topRegistrantBp, n: s.n }));
  const counts = (await q.query<AdminScorecardStatus['counts']>(
    `select (select count(*)::int from fcd.partner_cargo_submissions) submissions,
            (select count(*)::int from fcd.cargo_tracks t join fcd.orgs o on o.id = t.org_id where o.kind = 'partner') "partnerTracks",
            (select count(*)::int from fcd.cargo_tracks t join fcd.orgs o on o.id = t.org_id where o.kind = 'partner' and coalesce(fcd.track_stage_rank(t.stage), 0) < 7) "partnerOpen",
            (select count(*)::int from fcd.v_partner_customs_codes_current where status = 'linked') "codesLinked",
            (select count(*)::int from fcd.orgs o where o.kind = 'partner' and o.status = 'official'
                and not exists (select 1 from fcd.v_partner_customs_codes_current c where c.org_id = o.id and c.status = 'linked')) "codesMissing",
            (select count(*)::int from fcd.scorecard_disputes d where d.root_id is null
                and coalesce((select x.kind from fcd.scorecard_disputes x where x.root_id = d.id and x.kind <> 'note' order by x.created_at desc limit 1), 'open') = 'open') "disputesOpen"`,
  ))[0];
  return { computedAt: meta.computed_at, rows: meta.rows, overall: snaps.find((s) => s.entity_kind === 'overall' && s.port == null && s.mode == null) ?? null, concentrated, counts };
}
