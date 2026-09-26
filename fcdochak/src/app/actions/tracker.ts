'use server';
/**
 * 통관·입고 알리미(v2 5차 tracker) — 공개 조회(저장 없음)·번호 저장·알림 켜고 끄기·선적 잇기·보관 끝내기(화주)·폴링·통계(운영).
 * 관세청 호출은 UNIPASS_ENABLED 꺼짐이면 없다(흉내). 밖으로 보내는 알림은 없다(화면 안 알림만).
 * 막은 개인통관고유부호는 돌려주지도 기록하지도 않는다.
 */
import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { asPublic, asUser, todayKst } from '@/lib/db';
import { allow, clientIp } from '@/lib/server/rate-limit';
import { getViewer, requireViewer } from '@/lib/server/viewer';
import { loadTrackerConfig, lookupReady, pollOnce, publicLookup, recomputeStats, refreshTrack, saveTrack, trackById, type PollSummary } from '@/lib/server/tracker';
import { asSystem } from '@/lib/db';
import { validateTrackInput } from '@/lib/unipass/validate';
import { UnipassError, type CargoSummary } from '@/lib/unipass/types';
import type { TrackView } from '@/lib/tracker/view';

export interface TrackFormInput {
  kind: string;
  number: string;
  year?: string | number | null;
  mode?: string | null;
}

export interface LookupActionResult {
  ok: boolean;
  error?: string;
  field?: 'number' | 'year' | 'kind';
  personal?: boolean;
  data?: {
    status: 'found' | 'multiple' | 'not_found';
    summary: Pick<CargoSummary, 'cargoNo' | 'status' | 'portCode' | 'arrivalOn' | 'packages'> | null;
    cargoNos: string[];
    view: TrackView | null;
    port: string | null;
    mode: string | null;
    mock: boolean;
    /** 화주로 로그인했으면 저장 버튼 */
    canSave: boolean;
    /** 로그인했는가(화주가 아니면 「화주 계정에서만 저장」) */
    loggedIn: boolean;
    /** 저장하면 바로 조회되는가 — 꺼짐이고 실제 조직이면 false(「연결되면 조회를 시작합니다」) */
    saveLooksUp: boolean;
  };
}

const MODES = new Set(['LCL', 'FCL', 'FERRY', 'AIR']);
const thisYear = () => Number(todayKst().slice(0, 4));

/** 공개 조회 — 결과만 돌려주고 번호를 저장하지 않는다. IP 당 분당 횟수 제한 */
export async function lookupTrack(input: TrackFormInput): Promise<LookupActionResult> {
  const v = validateTrackInput({ kind: input.kind, number: input.number, year: input.year ?? null }, thisYear());
  if (!v.ok) return { ok: false, error: v.error, field: v.field, personal: v.personal };
  const cfg = await asPublic(loadTrackerConfig);
  const ip = clientIp(await headers());
  if (!allow(`track:${ip}`, cfg.rules.publicPerMinute)) return { ok: false, error: '잠시 뒤 다시 조회해 주세요(1분에 너무 많이 눌렀습니다).' };
  const mode = input.mode && MODES.has(input.mode) ? input.mode : null;
  try {
    const out = await publicLookup(v.query, mode);
    const viewer = await getViewer();
    const r = out.result;
    return {
      ok: true,
      data: {
        status: r.status,
        summary: r.status === 'found' ? { cargoNo: r.summary.cargoNo, status: r.summary.status, portCode: r.summary.portCode, arrivalOn: r.summary.arrivalOn, packages: r.summary.packages } : null,
        cargoNos: r.status === 'multiple' ? r.cargoNos : [],
        view: out.view,
        port: out.port,
        mode,
        mock: out.mock,
        canSave: !!viewer?.orgs.some((o) => o.kind === 'shipper'),
        loggedIn: !!viewer,
        saveLooksUp: (() => {
          const org = viewer ? (viewer.org.kind === 'shipper' ? viewer.org : viewer.orgs.find((o) => o.kind === 'shipper')) : null;
          return org ? lookupReady(org.is_demo) : false;
        })(),
      },
    };
  } catch (e) {
    return { ok: false, error: e instanceof UnipassError ? e.message : '조회하지 못했습니다. 잠시 뒤 다시 해 주세요.' };
  }
}

interface R {
  ok: boolean;
  error?: string;
  id?: string;
  already?: boolean;
  /** 전에 목록에서 뺀 번호를 되돌렸다 */
  restored?: boolean;
  field?: 'number' | 'year' | 'kind';
  personal?: boolean;
}

/** 번호 저장(화주) — 저장하면 바로 한 번 조회해 쌓고 알림을 켠다 */
export async function saveTrackAction(input: TrackFormInput & { label?: string | null; shipmentId?: string | null }): Promise<R> {
  const viewer = await getViewer();
  if (!viewer) return { ok: false, error: '로그인하면 번호를 저장하고 알림을 받을 수 있습니다.' };
  const org = viewer.org.kind === 'shipper' ? viewer.org : viewer.orgs.find((o) => o.kind === 'shipper');
  if (!org) return { ok: false, error: '화주 계정으로 로그인하면 번호를 저장할 수 있습니다.' };
  const v = validateTrackInput({ kind: input.kind, number: input.number, year: input.year ?? null }, thisYear());
  if (!v.ok) return { ok: false, error: v.error, field: v.field, personal: v.personal };
  if (!allow(`track-save:${viewer.id}`, 20)) return { ok: false, error: '잠시 뒤 다시 저장해 주세요.' };
  const label = input.label?.trim().slice(0, 60) || null;
  const shipmentId = input.shipmentId && /^[0-9a-f-]{36}$/i.test(input.shipmentId) ? input.shipmentId : null;
  const mode = input.mode && MODES.has(input.mode) ? input.mode : null;
  const r = await saveTrack(viewer, org.id, { query: v.query, label, mode, shipmentId });
  if (!r.ok) return { ok: false, error: r.error };
  revalidatePath('/app/tracking');
  revalidatePath(`/app/tracking/${r.id}`);
  return { ok: true, id: r.id, already: r.already, restored: r.restored };
}

async function mine(id: string) {
  const v = await requireViewer('app');
  const t = await asUser(v, (q) => trackById(q, id));
  if (!t || t.org_id !== v.org.id) return null;
  return { v, t };
}

export async function setTrackWatch(id: string, enabled: boolean): Promise<R> {
  const m = await mine(id);
  if (!m) return { ok: false, error: '번호를 찾지 못했습니다.' };
  await asUser(m.v, (q) => q.query(`insert into fcd.track_watches (track_id, org_id, user_id, enabled) values ($1,$2,$3,$4)`, [id, m.t.org_id, m.v.id, !!enabled]));
  revalidatePath('/app/tracking');
  revalidatePath(`/app/tracking/${id}`);
  return { ok: true };
}

/** 잇기 — 선적(이으면 그 선적의 물류사·방식·항구를 따른다)·물류사·관세사·방식·별명 */
export async function linkTrack(id: string, input: { label?: string | null; mode?: string | null; shipmentId?: string | null; partnerId?: string | null; brokerId?: string | null }): Promise<R> {
  const m = await mine(id);
  if (!m) return { ok: false, error: '번호를 찾지 못했습니다.' };
  const uuid = (x: string | null | undefined) => (x && /^[0-9a-f-]{36}$/i.test(x) ? x : null);
  const shipmentId = uuid(input.shipmentId);
  let partnerId = uuid(input.partnerId);
  let mode = input.mode && MODES.has(input.mode) ? input.mode : null;
  try {
    await asUser(m.v, async (q) => {
      if (shipmentId) {
        const s = await q.query<{ partner_org_id: string; mode: string }>(`select partner_org_id, mode from fcd.shipments where id = $1 and shipper_org_id = $2`, [shipmentId, m.t.org_id]);
        if (!s[0]) throw new Error('이을 선적을 찾지 못했습니다');
        partnerId = s[0].partner_org_id;
        mode = s[0].mode;
      }
      await q.query(
        `update fcd.cargo_tracks set label = $2, mode = $3, shipment_id = $4, partner_org_id = $5, broker_org_id = $6 where id = $1`,
        [id, input.label?.trim().slice(0, 60) || null, mode, shipmentId, partnerId, uuid(input.brokerId)],
      );
    });
  } catch (e) {
    const msg = (e as Error).message;
    return { ok: false, error: /찾지 못/.test(msg) ? msg : '잇지 못했습니다. 고른 선적·업체를 확인해 주세요.' };
  }
  revalidatePath('/app/tracking');
  revalidatePath(`/app/tracking/${id}`);
  if (shipmentId) revalidatePath(`/app/shipments/${shipmentId}`);
  return { ok: true };
}

/** 목록에서 빼기 — 기록은 남고 폴링·알림이 멈춘다(내 알림도 끈 줄 하나를 쌓는다) */
export async function archiveTrack(id: string): Promise<R> {
  const m = await mine(id);
  if (!m) return { ok: false, error: '번호를 찾지 못했습니다.' };
  await asUser(m.v, async (q) => {
    await q.query(`update fcd.cargo_tracks set archived_at = now() where id = $1`, [id]);
    await q.query(`insert into fcd.track_watches (track_id, org_id, user_id, enabled) values ($1,$2,$3,false)`, [id, m.t.org_id, m.v.id]);
  });
  revalidatePath('/app/tracking');
  revalidatePath(`/app/tracking/${id}`);
  return { ok: true };
}

/** 다시 지켜보기 — 목록에서 뺀 번호를 되돌리고 내 알림을 켠다 */
export async function restoreTrack(id: string): Promise<R> {
  const m = await mine(id);
  if (!m) return { ok: false, error: '번호를 찾지 못했습니다.' };
  await asUser(m.v, async (q) => {
    await q.query(`update fcd.cargo_tracks set archived_at = null where id = $1`, [id]);
    await q.query(`insert into fcd.track_watches (track_id, org_id, user_id, enabled) values ($1,$2,$3,true)`, [id, m.t.org_id, m.v.id]);
  });
  revalidatePath('/app/tracking');
  revalidatePath(`/app/tracking/${id}`);
  return { ok: true };
}

/** 지금 다시 조회(화주) — 사람당 분당 몇 번만 */
export async function refreshTrackAction(id: string): Promise<R> {
  const m = await mine(id);
  if (!m) return { ok: false, error: '번호를 찾지 못했습니다.' };
  if (!allow(`track-refresh:${m.v.id}`, 6)) return { ok: false, error: '잠시 뒤 다시 눌러 주세요.' };
  await refreshTrack(id, { trigger: 'manual', actorId: m.v.id });
  revalidatePath(`/app/tracking/${id}`);
  return { ok: true };
}

async function requirePlatform() {
  const v = await requireViewer('admin');
  const ok = await asUser(v, async (q) => (await q.query<{ ok: boolean }>(`select fcd.is_platform() ok`))[0].ok);
  return ok ? v : null;
}

export async function adminPoll(): Promise<{ ok: boolean; error?: string; summary?: PollSummary }> {
  const v = await requirePlatform();
  if (!v) return { ok: false, error: '운영자만 돌릴 수 있습니다.' };
  const summary = await pollOnce({ trigger: 'manual', actorId: v.id });
  revalidatePath('/admin/tracking');
  return { ok: true, summary };
}

export async function adminRecompute(): Promise<{ ok: boolean; error?: string; rows?: number }> {
  const v = await requirePlatform();
  if (!v) return { ok: false, error: '운영자만 셀 수 있습니다.' };
  const r = await asSystem((q) => recomputeStats(q));
  revalidatePath('/admin/tracking');
  revalidatePath('/track/stats');
  return { ok: true, rows: r.rows };
}
