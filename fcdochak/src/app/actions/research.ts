'use server';
/**
 * 셀러 인터뷰 행동.
 *   링크를 받은 셀러(로그인 없음) — 동의·진행 저장·미리 계산. 표 권한 없이 security definer 함수로만(asPublic).
 *   운영(플랫폼 관리자) — 대상 넣기·링크 만들기/거두기·연락처 보기/지우기·구두 동의·대신 적기·물량 단가 넣기(asUser, RLS).
 *   /check 퍼널 — 기기 번호 해시 한 줄.
 * 밖으로 보내는 것은 없다 — 링크는 화면에 한 번 보이고 운영이 복사해 전한다.
 */
import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { asPublic, asUser } from '@/lib/db';
import { requireViewer, getViewer } from '@/lib/server/viewer';
import { allow, clientIp } from '@/lib/server/rate-limit';
import { interviewPreview, loadResearchRules, publicResearchRules, recordCheckFunnel, type FunnelKind, type InterviewPreview } from '@/lib/server/research';
import { hashInviteToken, inviteExpiry, isInviteToken, newInviteToken } from '@/lib/workspace/invite';
import { Lane, SaveInput, type LaneT, type SaveInputT } from '@/lib/research/answers';

export interface RsResult<T = undefined> {
  ok: boolean;
  error?: string;
  data?: T;
}

const RESULT_TEXT: Record<string, string> = {
  not_found: '인터뷰 링크를 찾을 수 없습니다. 받은 링크를 다시 확인해 주세요.',
  revoked: '거둔 링크입니다. 새 링크를 받아 주세요.',
  expired: '기한이 지난 링크입니다. 새 링크를 받아 주세요.',
  completed: '이미 끝낸 인터뷰입니다. 고맙습니다.',
  no_consent: '동의하신 뒤에 답을 저장할 수 있습니다.',
  bad_answers: '답을 읽지 못했습니다. 다시 눌러 주세요.',
  bad_version: '동의 문구 판이 올바르지 않습니다.',
};

async function publicLimited(key: string): Promise<boolean> {
  const rules = await publicResearchRules();
  const ip = clientIp(await headers());
  return !allow(`${key}:${ip}`, rules.publicPerMinute);
}

// ─── 링크를 받은 셀러 ─────────────────────────────────────────────
export async function consentInterview(token: string, agree: boolean): Promise<RsResult> {
  if (!isInviteToken(token)) return { ok: false, error: RESULT_TEXT.not_found };
  if (await publicLimited('research')) return { ok: false, error: '잠시 뒤 다시 눌러 주세요.' };
  const rules = await publicResearchRules();
  const r = await asPublic((q) => q.query<{ r: string }>(`select fcd.research_consent($1, $2, $3) r`, [hashInviteToken(token), agree, rules.consentVersion]));
  const res = r[0]?.r ?? 'not_found';
  if (res !== 'ok' && res !== 'declined') return { ok: false, error: RESULT_TEXT[res] ?? RESULT_TEXT.not_found };
  return { ok: true };
}

export async function saveInterview(token: string, input: SaveInputT): Promise<RsResult<{ id: string; version: number }>> {
  if (!isInviteToken(token)) return { ok: false, error: RESULT_TEXT.not_found };
  if (await publicLimited('research')) return { ok: false, error: '잠시 뒤 다시 눌러 주세요(1분에 너무 많이 눌렀습니다).' };
  const p = SaveInput.safeParse(input);
  if (!p.success) return { ok: false, error: `답을 확인해 주세요: ${p.error.issues[0].path.join('.')}` };
  const r = await asPublic((q) =>
    q.query<{ result: string; id: string | null; version: number | null }>(`select * from fcd.research_save($1, $2, $3::jsonb, $4)`, [
      hashInviteToken(token),
      p.data.step,
      JSON.stringify(p.data.answers),
      p.data.complete,
    ]),
  );
  const x = r[0];
  if (!x || x.result !== 'ok' || !x.id) return { ok: false, error: RESULT_TEXT[x?.result ?? 'not_found'] ?? '저장하지 못했습니다. 다시 눌러 주세요.' };
  return { ok: true, data: { id: x.id, version: x.version ?? 1 } };
}

export async function previewInterview(token: string, lane: LaneT): Promise<RsResult<InterviewPreview>> {
  if (!isInviteToken(token)) return { ok: false, error: RESULT_TEXT.not_found };
  if (await publicLimited('research-preview')) return { ok: false, error: '잠시 뒤 다시 눌러 주세요.' };
  const l = Lane.safeParse(lane);
  if (!l.success) return { ok: false, error: '선적 조건을 확인해 주세요.' };
  // 열린 링크에서만 계산한다(계산기가 아무에게나 열리지 않게)
  const st = await asPublic((q) => q.query<{ status: string; consent_state: string | null }>(`select status, consent_state from fcd.research_invite_open($1)`, [hashInviteToken(token)]));
  if (st[0]?.status !== 'open') return { ok: false, error: RESULT_TEXT[st[0]?.status ?? 'not_found'] ?? RESULT_TEXT.not_found };
  if (st[0]?.consent_state !== 'agreed') return { ok: false, error: RESULT_TEXT.no_consent };
  try {
    return { ok: true, data: await interviewPreview(l.data) };
  } catch {
    return { ok: false, error: '미리 계산하지 못했습니다. 조건을 바꿔 다시 눌러 주세요.' };
  }
}

// ─── 운영 ─────────────────────────────────────────────────────────
async function admin() {
  return requireViewer('admin');
}

const Participant = z.object({
  label: z.string().trim().min(1, '부르는 이름을 적어 주세요').max(60),
  contact: z.string().trim().max(120).optional(),
  chinaSourcing: z.boolean(),
  rocketGrowth: z.boolean(),
  lcl: z.boolean(),
  monthlyShipments: z.number().int().min(0).max(1000).nullable(),
  channel: z.string().trim().max(60).optional(),
  scheduledAt: z.string().max(40).optional(),
  note: z.string().trim().max(400).optional(),
});

export async function addParticipant(input: z.infer<typeof Participant>): Promise<RsResult<{ id: string; code: string }>> {
  const v = await admin();
  const p = Participant.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0].message };
  const d = p.data;
  const when = d.scheduledAt ? new Date(d.scheduledAt) : null;
  if (when && Number.isNaN(when.getTime())) return { ok: false, error: '일정 날짜를 확인해 주세요' };
  const recruit = { chinaSourcing: d.chinaSourcing, rocketGrowth: d.rocketGrowth, lcl: d.lcl, ...(d.monthlyShipments != null ? { monthlyShipments: d.monthlyShipments } : {}), ...(d.channel ? { channel: d.channel } : {}) };
  try {
    const r = await asUser(v, async (q) => {
      const n = await q.query<{ n: number }>(`select coalesce(max(substring(code from 3)::int), 0)::int n from fcd.research_participants where org_id = $1`, [v.org.id]);
      const code = `P-${String((n[0]?.n ?? 0) + 1).padStart(2, '0')}`;
      const ins = await q.query<{ id: string }>(
        `insert into fcd.research_participants (org_id, code, label, contact, recruit, scheduled_at, note, created_by) values ($1,$2,$3,$4,$5::jsonb,$6,$7,$8) returning id`,
        [v.org.id, code, d.label, d.contact || null, JSON.stringify(recruit), when ? when.toISOString() : null, d.note || null, v.id],
      );
      await q.query(`insert into fcd.audit_log (actor_id, org_id, action, target, detail) values ($1,$2,'research.participant_added',$3,null)`, [v.id, v.org.id, `research_participant:${ins[0].id}`]);
      return { id: ins[0].id, code };
    });
    revalidatePath('/admin/research');
    return { ok: true, data: r };
  } catch {
    return { ok: false, error: '넣지 못했습니다. 운영 조직으로 들어왔는지 확인해 주세요.' };
  }
}

const Id = z.string().uuid();

/** 1회용 링크 만들기 — 그 참여자의 열린 옛 링크는 거둔다. 토큰은 지금 한 번만 돌려준다(해시만 저장). */
export async function makeResearchLink(participantId: string): Promise<RsResult<{ token: string; expiresAt: string }>> {
  const v = await admin();
  if (!Id.safeParse(participantId).success) return { ok: false, error: '요청이 올바르지 않습니다' };
  const token = newInviteToken();
  const r = await asUser(v, async (q) => {
    const rules = await loadResearchRules(q);
    const p = await q.query<{ id: string; org_id: string; consent_state: string }>(`select id, org_id, consent_state from fcd.v_research_participants where id = $1`, [participantId]);
    if (!p[0]) return { error: '참여자를 찾을 수 없습니다' };
    if (p[0].consent_state === 'declined' || p[0].consent_state === 'withdrawn') return { error: '동의하지 않은 참여자에게는 링크를 만들지 않습니다' };
    const done = await q.query<{ n: number }>(`select count(*)::int n from fcd.research_responses where participant_id = $1 and completed`, [participantId]);
    if (done[0].n > 0) return { error: '이미 인터뷰를 끝낸 참여자입니다' };
    await q.query(`update fcd.research_invites set revoked_at = now() where participant_id = $1 and revoked_at is null`, [participantId]);
    const exp = inviteExpiry(new Date(), rules.inviteDays);
    try {
      await q.query(`insert into fcd.research_invites (org_id, participant_id, token_hash, expires_at, created_by) values ($1,$2,$3,$4,$5)`, [
        p[0].org_id,
        participantId,
        hashInviteToken(token),
        exp.toISOString(),
        v.id,
      ]);
    } catch {
      return { error: '링크를 만들 권한이 없습니다(그 참여자의 운영 조직 사람만 만들 수 있습니다)' };
    }
    await q.query(`insert into fcd.audit_log (actor_id, org_id, action, target, detail) values ($1,$2,'research.invite_created',$3,$4::jsonb)`, [
      v.id,
      p[0].org_id,
      `research_participant:${participantId}`,
      JSON.stringify({ days: rules.inviteDays }),
    ]);
    return { exp: exp.toISOString() };
  });
  if ('error' in r) return { ok: false, error: r.error };
  revalidatePath('/admin/research');
  return { ok: true, data: { token, expiresAt: r.exp } };
}

export async function revokeResearchLinks(participantId: string): Promise<RsResult> {
  const v = await admin();
  if (!Id.safeParse(participantId).success) return { ok: false, error: '요청이 올바르지 않습니다' };
  const n = await asUser(v, (q) => q.query<{ id: string }>(`update fcd.research_invites set revoked_at = now() where participant_id = $1 and revoked_at is null returning id`, [participantId]));
  if (!n.length) return { ok: false, error: '거둘 링크가 없습니다' };
  revalidatePath('/admin/research');
  return { ok: true };
}

export async function revealContact(participantId: string): Promise<RsResult<{ contact: string | null }>> {
  const v = await admin();
  if (!Id.safeParse(participantId).success) return { ok: false, error: '요청이 올바르지 않습니다' };
  const r = await asUser(v, (q) => q.query<{ c: string | null }>(`select fcd.research_contact($1) c`, [participantId]));
  return { ok: true, data: { contact: r[0]?.c ?? null } };
}

export async function clearContact(participantId: string): Promise<RsResult> {
  const v = await admin();
  if (!Id.safeParse(participantId).success) return { ok: false, error: '요청이 올바르지 않습니다' };
  const n = await asUser(v, async (q) => {
    const r = await q.query<{ id: string; org_id: string }>(`update fcd.research_participants set contact = null where id = $1 returning id, org_id`, [participantId]);
    if (r[0]) await q.query(`insert into fcd.audit_log (actor_id, org_id, action, target, detail) values ($1,$2,'research.contact_cleared',$3,null)`, [v.id, r[0].org_id, `research_participant:${participantId}`]);
    return r.length;
  });
  if (!n) return { ok: false, error: '지우지 못했습니다' };
  revalidatePath('/admin/research');
  return { ok: true };
}

/** 인터뷰어 모드 — 통화에서 받은 구두 동의(또는 거부·철회) */
export async function recordVerbalConsent(participantId: string, state: 'agreed' | 'declined' | 'withdrawn'): Promise<RsResult> {
  const v = await admin();
  if (!Id.safeParse(participantId).success || !['agreed', 'declined', 'withdrawn'].includes(state)) return { ok: false, error: '요청이 올바르지 않습니다' };
  const n = await asUser(v, async (q) => {
    const rules = await loadResearchRules(q);
    const p = await q.query<{ org_id: string }>(`select org_id from fcd.research_participants where id = $1`, [participantId]);
    if (!p[0]) return 0;
    const r = await q.query<{ id: string; org_id: string }>(
      `insert into fcd.research_consents (org_id, participant_id, state, method, version, created_by) values ($1,$2,$3,'verbal',$4,$5) returning id, org_id`,
      [p[0].org_id, participantId, state, rules.consentVersion, v.id],
    );
    if (r[0]) await q.query(`insert into fcd.audit_log (actor_id, org_id, action, target, detail) values ($1,$2,'research.consent_recorded',$3,$4::jsonb)`, [v.id, r[0].org_id, `research_participant:${participantId}`, JSON.stringify({ state, method: 'verbal' })]);
    return r.length;
  });
  if (!n) return { ok: false, error: '기록하지 못했습니다' };
  revalidatePath('/admin/research');
  revalidatePath(`/admin/research/${participantId}/conduct`);
  return { ok: true };
}

/** 인터뷰어 모드 — 대신 적기(새 판). 화면이 본 현재 판(expect)을 잇는다 — 다른 창에서 먼저 저장했으면 거절 */
export async function saveAsInterviewer(participantId: string, input: SaveInputT, expect: { id: string | null; version: number }): Promise<RsResult<{ id: string; version: number }>> {
  const v = await admin();
  if (!Id.safeParse(participantId).success) return { ok: false, error: '요청이 올바르지 않습니다' };
  const p = SaveInput.safeParse(input);
  if (!p.success) return { ok: false, error: `답을 확인해 주세요: ${p.error.issues[0].path.join('.')}` };
  const r = await asUser(v, async (q) => {
    const part = await q.query<{ org_id: string; consent_state: string }>(`select org_id, consent_state from fcd.v_research_participants where id = $1`, [participantId]);
    if (!part[0]) return { error: '참여자를 찾을 수 없습니다' };
    if (part[0].consent_state !== 'agreed') return { error: '먼저 동의(구두 동의 포함)를 기록해 주세요' };
    // 이미 끝낸 인터뷰를 고칠 때는 답만 바꾼다 — 끝남(완료·done)은 그대로 두어 보드의 「끝」과 판정 표본에서 빠지지 않게
    const everDone = (await q.query<{ n: number }>(`select count(*)::int n from fcd.research_responses where participant_id = $1 and completed`, [participantId]))[0].n > 0;
    const complete = p.data.complete || everDone;
    try {
      const ins = await q.query<{ id: string; version: number }>(
        `insert into fcd.research_responses (org_id, participant_id, version, supersedes_id, source, step, completed, answers, created_by)
         values ($1,$2,$3,$4,'interviewer',$5,$6,$7::jsonb,$8) returning id, version`,
        [part[0].org_id, participantId, expect.version + 1, expect.id, complete ? 'done' : p.data.step, complete, JSON.stringify(p.data.answers), v.id],
      );
      return { id: ins[0].id, version: ins[0].version };
    } catch {
      return { error: '다른 곳에서 먼저 저장했습니다. 화면을 새로 고쳐 주세요' };
    }
  });
  if ('error' in r) return { ok: false, error: r.error };
  revalidatePath('/admin/research');
  return { ok: true, data: r };
}

export async function adminPreview(lane: LaneT): Promise<RsResult<InterviewPreview>> {
  await admin();
  const l = Lane.safeParse(lane);
  if (!l.success) return { ok: false, error: '선적 조건을 확인해 주세요.' };
  try {
    return { ok: true, data: await interviewPreview(l.data) };
  } catch {
    return { ok: false, error: '미리 계산하지 못했습니다.' };
  }
}

const VendorQuote = z.object({
  vendorLabel: z.string().trim().min(1, '업체 부르는 이름을 적어 주세요').max(60),
  vendorKind: z.enum(['consolidator', 'forwarder']),
  hub: z.string().regex(/^[A-Z]{3}$/).nullable(),
  port: z.enum(['ICN', 'PTK']).nullable(),
  mode: z.enum(['LCL', 'FERRY', 'FCL', 'AIR']).nullable(),
  includes: z.enum(['sea_cfs', 'to_port', 'to_fc']),
  volumeCbm: z.number({ invalid_type_error: '물량을 넣어 주세요' }).positive('물량은 0보다 커야 합니다').max(10000),
  unitPriceKrw: z.number({ invalid_type_error: '단가를 넣어 주세요' }).int('단가는 원 단위 정수').min(0).max(100_000_000),
  source: z.enum(['call', 'email', 'quote_doc', 'other']),
  quotedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '받은 날을 넣어 주세요'),
  note: z.string().trim().max(400).optional(),
  supersedesId: z.string().uuid().nullable().optional(),
});

export async function addVendorQuote(input: z.infer<typeof VendorQuote>): Promise<RsResult> {
  const v = await admin();
  const p = VendorQuote.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0].message };
  const d = p.data;
  try {
    await asUser(v, (q) =>
      q.query(
        `insert into fcd.research_vendor_quotes (org_id, vendor_label, vendor_kind, hub, port, mode, includes, volume_cbm, unit_price_krw, source, quoted_on, note, supersedes_id, created_by)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        [v.org.id, d.vendorLabel, d.vendorKind, d.hub, d.port, d.mode, d.includes, d.volumeCbm, d.unitPriceKrw, d.source, d.quotedOn, d.note || null, d.supersedesId ?? null, v.id],
      ),
    );
  } catch {
    return { ok: false, error: d.supersedesId ? '이미 새 판이 있는 단가입니다. 화면을 새로 고쳐 주세요' : '넣지 못했습니다' };
  }
  revalidatePath('/admin/research');
  return { ok: true };
}

// ─── /check 퍼널 ─────────────────────────────────────────────────
const Track = z.object({
  kind: z.enum(['check_visit', 'check_input', 'check_run', 'check_saved']),
  method: z.enum(['paste', 'excel', 'manual']).nullable(),
  vid: z.string().regex(/^[A-Za-z0-9_-]{16,64}$/),
});

/** 기록이 실패해도 점검 흐름은 그대로 — 결과만 돌려준다 */
export async function trackCheck(kind: FunnelKind, method: 'paste' | 'excel' | 'manual' | null, vid: string): Promise<{ ok: boolean }> {
  const p = Track.safeParse({ kind, method, vid });
  if (!p.success) return { ok: false };
  if (await publicLimited('check-funnel')) return { ok: false };
  const v = await getViewer().catch(() => null);
  return { ok: await recordCheckFunnel(p.data.kind, p.data.method, p.data.vid, !!v) };
}
