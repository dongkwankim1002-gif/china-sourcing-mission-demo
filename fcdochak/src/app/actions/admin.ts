'use server';
/** 운영 행동 — 모두 감사 기록을 남긴다. 설정·등급은 새 판으로만 쌓인다. 자료를 지우지 않는다(삭제 요청도 상태만 바꾼다). */
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { asUser, type Queryable } from '@/lib/db';
import { requireViewer } from '@/lib/server/viewer';
import { loadSettings } from '@/lib/server/settings';
import { notifyMany } from '@/lib/server/notify';
import { isFcReady } from '@/lib/money';

interface R {
  ok: boolean;
  error?: string;
  n?: number;
}

async function audit(q: Queryable, actor: string, orgId: string | null, action: string, target: string, detail: unknown = null) {
  await q.query(`insert into fcd.audit_log (actor_id, org_id, action, target, detail) values ($1,$2,$3,$4,$5::jsonb)`, [actor, orgId, action, target, detail == null ? null : JSON.stringify(detail)]);
}

export async function decideVerification(id: string, approve: boolean, note: string): Promise<R> {
  const v = await requireViewer('admin');
  const org = await asUser(v, async (q) => {
    const r = (await q.query<{ org_id: string; status: string }>(`select org_id, status from fcd.verification_requests where id = $1`, [id]))[0];
    if (!r || r.status !== 'pending') return null;
    await q.query(`update fcd.verification_requests set status = $2, decided_at = now(), decided_by = $3, decision_note = $4 where id = $1`, [id, approve ? 'approved' : 'rejected', v.id, note || null]);
    if (approve) await q.query(`update fcd.orgs set status = 'official' where id = $1 and status in ('public_info','pending_verification')`, [r.org_id]);
    await audit(q, v.id, r.org_id, approve ? 'verification.approved' : 'verification.rejected', `verification:${id}`, { note });
    return r.org_id;
  });
  if (!org) return { ok: false, error: '이미 처리된 요청입니다' };
  if (approve) await notifyMany([{ orgId: org, kind: 'system', title: '공식 등록이 되었습니다', body: '이제 업체 공개 페이지에 요금표와 실측 점수가 실립니다.', link: '/partner/profile' }]);
  revalidatePath('/admin/queues');
  return { ok: true };
}

export async function decideDeletion(id: string, done: boolean, note: string): Promise<R> {
  const v = await requireViewer('admin');
  const ok = await asUser(v, async (q) => {
    const r = (await q.query<{ org_id: string; status: string }>(`select org_id, status from fcd.deletion_requests where id = $1`, [id]))[0];
    if (!r || r.status !== 'pending') return false;
    await q.query(`update fcd.deletion_requests set status = $2, decided_at = now(), decided_by = $3, decision_note = $4 where id = $1`, [id, done ? 'done' : 'rejected', v.id, note || null]);
    // 「삭제」는 상태로 한다 — 공개 면에서 사라지고, 기록은 남는다(자료를 지우는 SQL 은 사람이 따로 판단).
    await q.query(`update fcd.orgs set status = $2 where id = $1`, [r.org_id, done ? 'deleted' : 'public_info']);
    await audit(q, v.id, r.org_id, done ? 'listing.deleted' : 'listing.deletion_rejected', `deletion:${id}`, { note });
    return true;
  });
  if (!ok) return { ok: false, error: '이미 처리된 요청입니다' };
  revalidatePath('/admin/queues');
  return { ok: true };
}

export async function adminResolveException(id: string, resolution: string): Promise<R> {
  const v = await requireViewer('admin');
  if (resolution.trim().length < 2) return { ok: false, error: '처리 내용을 적어 주세요' };
  await asUser(v, async (q) => {
    await q.query(`update fcd.exceptions set resolved_at = now(), resolution = $2 where id = $1 and resolved_at is null`, [id, `운영: ${resolution.trim()}`]);
    await audit(q, v.id, null, 'exception.resolved', `exception:${id}`, { resolution });
  });
  revalidatePath('/admin/queues');
  return { ok: true };
}

/** FC 입고 준비 인증 재평가 — 실측이 기준을 넘나들면 새 등급 기록을 쌓는다 */
export async function reevaluateGrades(_note?: string): Promise<R> {
  void _note;
  const v = await requireViewer('admin');
  const n = await asUser(v, async (q) => {
    const s = await loadSettings(q);
    const rows = await q.query<{ org_id: string; shipments_done: number; return_rate_30d: number | null; last: boolean | null }>(
      `select m.org_id, m.shipments_done, m.return_rate_30d,
              (select granted from fcd.grade_records g where g.org_id = m.org_id and g.grade = 'fc_ready' order by created_at desc limit 1) last
         from fcd.v_partner_metrics m join fcd.orgs o on o.id = m.org_id where o.status = 'official'`,
    );
    let n = 0;
    for (const r of rows) {
      const ok = isFcReady(r.shipments_done, r.return_rate_30d, s.fcReadyRule);
      if (r.last === ok) continue;
      if (r.last == null && !ok) continue;
      await q.query(`insert into fcd.grade_records (org_id, grade, granted, basis, note, created_by) values ($1,'fc_ready',$2,$3::jsonb,$4,$5)`, [
        r.org_id,
        ok,
        JSON.stringify({ fcInbound: r.shipments_done, returnRate30d: r.return_rate_30d, rule: s.fcReadyRule }),
        ok ? '기준 충족(재평가)' : '기준 미달(재평가)',
        v.id,
      ]);
      await audit(q, v.id, r.org_id, ok ? 'grade.granted' : 'grade.revoked', 'grade:fc_ready', { fcInbound: r.shipments_done, returnRate30d: r.return_rate_30d });
      n++;
    }
    return n;
  });
  revalidatePath('/admin/grades');
  return { ok: true, n };
}

const Ad = z.object({ orgId: z.string().uuid(), hub: z.string().nullable(), port: z.string().nullable(), startsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), endsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) });

export async function createAd(input: z.infer<typeof Ad>): Promise<R> {
  const v = await requireViewer('admin');
  const p = Ad.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0].message };
  if (p.data.startsOn > p.data.endsOn) return { ok: false, error: '끝나는 날이 시작일보다 앞입니다' };
  const clash = await asUser(v, async (q) => {
    // 광고는 한 구간에 한 자리 — 겹치는 기간의 광고가 있으면 막는다
    const c = await q.query<{ n: number }>(
      `select count(*)::int n from fcd.ad_slots where status = 'active' and coalesce(lane_hub,'*') = coalesce($1,'*') and coalesce(lane_port,'*') = coalesce($2,'*')
         and starts_on <= $4::date and ends_on >= $3::date`,
      [p.data.hub, p.data.port, p.data.startsOn, p.data.endsOn],
    );
    if (c[0].n) return true;
    await q.query(`insert into fcd.ad_slots (org_id, lane_hub, lane_port, starts_on, ends_on, created_by) values ($1,$2,$3,$4,$5,$6)`, [p.data.orgId, p.data.hub, p.data.port, p.data.startsOn, p.data.endsOn, v.id]);
    await audit(q, v.id, p.data.orgId, 'ad.created', `lane:${p.data.hub ?? '*'}-${p.data.port ?? '*'}`, p.data);
    return false;
  });
  if (clash) return { ok: false, error: '이 구간·기간에 이미 광고가 있습니다(한 자리만)' };
  revalidatePath('/admin/ads');
  return { ok: true };
}

export async function endAd(id: string, _note?: string): Promise<R> {
  void _note;
  const v = await requireViewer('admin');
  await asUser(v, async (q) => {
    await q.query(`update fcd.ad_slots set status = 'ended' where id = $1`, [id]);
    await audit(q, v.id, null, 'ad.ended', `ad:${id}`);
  });
  revalidatePath('/admin/ads');
  return { ok: true };
}

export async function setRelatedParty(orgId: string, note: string): Promise<R> {
  const v = await requireViewer('admin');
  await asUser(v, async (q) => {
    await q.query(`update fcd.orgs set related_party_note = $2 where id = $1`, [orgId, note.trim() || null]);
    await audit(q, v.id, orgId, note.trim() ? 'related_party.disclosed' : 'related_party.cleared', `org:${orgId}`, { note });
  });
  revalidatePath('/admin/related');
  return { ok: true };
}

const SETTING_SCHEMAS: Record<string, z.ZodTypeAny> = {
  fx: z.object({ KRW: z.literal(1), RMB: z.number().min(50).max(500), USD: z.number().min(500).max(3000) }),
  commission_rate_bp: z.number().int().min(0).max(3000),
  fc_ready_rule: z.object({ minFcInbound: z.number().int().min(1), maxReturnRate30d: z.number().min(0).max(1) }),
  score_caps: z.object({ deviationCap: z.number().min(0.01).max(1), fcReturnCap: z.number().min(0.01).max(1) }),
  quote_params: z.object({ volumetricKgPerCbm: z.number().min(100).max(400), palletCbm: z.number().min(0.5).max(3), containerCbm: z.number().min(10).max(80) }),
  vat_rate_bp: z.number().int().min(0).max(3000),
  insurance_bp: z.number().int().min(0).max(500),
  sale_fee_bp: z.number().int().min(0).max(5000),
  fulfillment_per_unit: z.number().int().min(0).max(100000),
  expiring_days: z.number().int().min(1).max(60),
  reference_lines: z.array(z.object({ segment: z.string(), included: z.boolean(), basis: z.string(), unitPrice: z.number().min(0), currency: z.enum(['KRW', 'RMB', 'USD']), minCharge: z.number().nullable().optional(), certainty: z.string() })).length(9),
};

/** 설정 새 판 — 고치지 않고 쌓는다. 값은 키별 규칙으로 검사한다. */
export async function addSetting(key: string, raw: string, note: string): Promise<R> {
  const v = await requireViewer('admin');
  const schema = SETTING_SCHEMAS[key];
  if (!schema) return { ok: false, error: '모르는 설정 키입니다' };
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return { ok: false, error: '값을 읽지 못했습니다(JSON 형식)' };
  }
  const p = schema.safeParse(value);
  if (!p.success) return { ok: false, error: `${p.error.issues[0].path.join('.')} ${p.error.issues[0].message}` };
  if (note.trim().length < 2) return { ok: false, error: '바꾸는 이유를 적어 주세요(감사 기록에 남습니다)' };
  await asUser(v, async (q) => {
    await q.query(`insert into fcd.settings (key, value, note, created_by) values ($1,$2::jsonb,$3,$4)`, [key, JSON.stringify(p.data), note.trim(), v.id]);
    await audit(q, v.id, null, 'settings.new_version', `settings:${key}`, { value: p.data, note });
  });
  revalidatePath('/admin/settings');
  return { ok: true };
}

export async function addDutyRate(category: string, name: string, rateBp: number, note: string): Promise<R> {
  const v = await requireViewer('admin');
  if (!/^[a-z_]{2,30}$/.test(category)) return { ok: false, error: '분류 코드는 영문 소문자' };
  if (!Number.isInteger(rateBp) || rateBp < 0 || rateBp > 10000) return { ok: false, error: '관세율은 0~100%' };
  await asUser(v, async (q) => {
    await q.query(`insert into fcd.duty_rates (category, name_ko, rate_bp, note, created_by) values ($1,$2,$3,$4,$5)`, [category, name, rateBp, note || null, v.id]);
    await audit(q, v.id, null, 'duty_rate.new_version', `duty:${category}`, { rateBp, note });
  });
  revalidatePath('/admin/settings');
  return { ok: true };
}
