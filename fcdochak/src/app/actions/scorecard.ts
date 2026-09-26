'use server';
/**
 * 물류사 성적표(v2 6차 scorecard) — 물류사: 화물번호 일괄 제출 · 이의 제기/거두기. 운영: 이의 처리 · 새 판 계산 · 제출 번호 조회 · 부호 연결 · 관세사 기본 정보.
 * 관세청 호출은 UNIPASS_ENABLED 꺼짐이면 없다(흉내). 밖으로 보내는 것은 없다.
 */
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { asSystem, asUser, todayKst, type Queryable } from '@/lib/db';
import { allow } from '@/lib/server/rate-limit';
import { requireViewer } from '@/lib/server/viewer';
import { customsCodes, forwarderAdapter, parseSubmission, recomputeScorecardsNow, refreshSubmitted, submitCargoNumbers, type SubmitResult } from '@/lib/server/scorecard';
import type { ForwarderRecord } from '@/lib/unipass/forwarders';
import { disputeRefOk } from '@/lib/scorecard/engine';
import { UnipassError } from '@/lib/unipass/types';

const PORTS = new Set(['ICN', 'PTK']);

const MODES = new Set(['LCL', 'FCL', 'FERRY', 'AIR']);
const uuid = (x: unknown) => (typeof x === 'string' && /^[0-9a-f-]{36}$/i.test(x) ? x : null);

function revalidateAll() {
  for (const p of ['/partner/scorecard', '/admin/scorecard', '/partners', '/brokers', '/market/customs', '/app/compare']) revalidatePath(p);
}

async function audit(q: Queryable, actor: string, orgId: string | null, action: string, target: string, detail: unknown = null) {
  await q.query(`insert into fcd.audit_log (actor_id, org_id, action, target, detail) values ($1,$2,$3,$4,$5::jsonb)`, [actor, orgId, action, target, detail == null ? null : JSON.stringify(detail)]);
}

// ─── 물류사 ────────────────────────────────────────────────────────────────

export async function submitNumbersAction(input: { text: string; kind: string; year: string | number; port?: string | null; mode?: string | null }): Promise<{ ok: boolean; error?: string; result?: SubmitResult }> {
  const v = await requireViewer('partner');
  if (!allow(`sc-submit:${v.id}`, 6)) return { ok: false, error: '잠시 뒤 다시 제출해 주세요 / 请稍后再提交' };
  const thisYear = Number(todayKst().slice(0, 4));
  const year = Number(input.year);
  if (!Number.isInteger(year) || year < 2000 || year > thisYear + 1) return { ok: false, error: `B/L 연도는 2000 ~ ${thisYear + 1} / 提单年份` };
  const text = String(input.text ?? '').slice(0, 20_000);
  const lines = parseSubmission(text, { kind: input.kind === 'mbl' ? 'mbl' : 'hbl', year, thisYear });
  if (!lines.length) return { ok: false, error: '화물번호를 한 줄에 하나씩 붙여 넣어 주세요 / 请每行粘贴一个单号' };
  const port = input.port && PORTS.has(input.port) ? input.port : null;
  const mode = input.mode && MODES.has(input.mode) ? input.mode : null;
  try {
    const result = await submitCargoNumbers(v, v.org.id, lines, { port, mode });
    revalidateAll();
    return { ok: true, result };
  } catch (e) {
    return { ok: false, error: (e as Error).message.includes('구성원') ? (e as Error).message : '제출하지 못했습니다. 잠시 뒤 다시 해 주세요.' };
  }
}

const Dispute = z.object({
  metric: z.enum(['clearance', 'inspection', 'bonded_release', 'release_fc', 'submission', 'other']),
  cargoRef: z.string().trim().max(40).optional().nullable(),
  body: z.string().trim().min(5, '사유를 다섯 글자 이상 / 请填写理由').max(1000),
});

export async function openDisputeAction(input: z.infer<typeof Dispute>): Promise<{ ok: boolean; error?: string }> {
  const v = await requireViewer('partner');
  const p = Dispute.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0].message };
  const ref = p.data.cargoRef ? p.data.cargoRef.normalize('NFKC').toUpperCase().replace(/\s+/g, '') : null;
  if (ref && !/^[A-Z0-9-]{4,40}$/.test(ref)) return { ok: false, error: '화물번호는 영문·숫자·하이픈 4~40자 / 单号格式' };
  // 숫자만 여섯 자 미만(연도 「2026」 같은 값)은 화물 하나를 가리키지 못한다 — 받아들이면 엉뚱한 화물이 빠질 수 있어 받지 않는다(검토 고침)
  if (ref && !disputeRefOk(ref)) return { ok: false, error: '화물번호 전체를 적어 주세요(연도·짧은 숫자만으로는 화물을 가리킬 수 없습니다) / 请填写完整单号' };
  if (!allow(`sc-dispute:${v.id}`, 5)) return { ok: false, error: '잠시 뒤 다시 해 주세요' };
  await asUser(v, (q) =>
    q.query(`insert into fcd.scorecard_disputes (partner_org_id, kind, metric, cargo_ref, body, created_by) values ($1,'open',$2,$3,$4,$5)`, [v.org.id, p.data.metric, ref, p.data.body, v.id]),
  );
  revalidatePath('/partner/scorecard');
  revalidatePath('/admin/scorecard');
  return { ok: true };
}

export async function withdrawDisputeAction(rootId: string): Promise<{ ok: boolean; error?: string }> {
  const v = await requireViewer('partner');
  const id = uuid(rootId);
  if (!id) return { ok: false, error: '이의를 찾지 못했습니다' };
  try {
    const done = await asUser(v, async (q) => {
      // 열린 이의만 거둔다(받아들여진 뒤 거둬 제외를 푸는 일을 막는다 — 0025 정책도 같은 조건)
      const st = (await q.query<{ s: string }>(`select fcd.dispute_status($1::uuid) s`, [id]))[0]?.s;
      if (st !== 'open') return false;
      await q.query(`insert into fcd.scorecard_disputes (root_id, partner_org_id, kind, body, created_by) values ($1,$2,'withdrawn','업체가 거뒀습니다',$3)`, [id, v.org.id, v.id]);
      return true;
    });
    if (!done) return { ok: false, error: '이미 처리된 이의는 거둘 수 없습니다 / 已处理的异议不能撤回' };
  } catch {
    return { ok: false, error: '거두지 못했습니다' };
  }
  revalidatePath('/partner/scorecard');
  revalidatePath('/admin/scorecard');
  return { ok: true };
}

// ─── 운영 ─────────────────────────────────────────────────────────────────

async function requirePlatform() {
  const v = await requireViewer('admin');
  const ok = await asUser(v, async (q) => (await q.query<{ ok: boolean }>(`select fcd.is_platform() ok`))[0].ok);
  return ok ? v : null;
}

export async function adminDisputeAction(input: { rootId: string; kind: 'accepted' | 'rejected' | 'note'; body: string; recompute?: boolean }): Promise<{ ok: boolean; error?: string }> {
  const v = await requirePlatform();
  if (!v) return { ok: false, error: '운영자만 처리할 수 있습니다.' };
  const id = uuid(input.rootId);
  const body = String(input.body ?? '').trim();
  if (!id || !['accepted', 'rejected', 'note'].includes(input.kind)) return { ok: false, error: '처리할 이의를 찾지 못했습니다' };
  if (body.length < 2 || body.length > 1000) return { ok: false, error: '처리 사유를 적어 주세요(2~1000자)' };
  try {
    await asUser(v, async (q) => {
      const root = (await q.query<{ partner_org_id: string; st: string }>(`select partner_org_id, fcd.dispute_status(id) st from fcd.scorecard_disputes where id = $1 and root_id is null`, [id]))[0];
      if (!root) throw new Error('없음');
      if (input.kind !== 'note' && root.st !== 'open') throw new Error('닫힘');
      await q.query(`insert into fcd.scorecard_disputes (root_id, partner_org_id, kind, body, created_by) values ($1,$2,$3,$4,$5)`, [id, root.partner_org_id, input.kind, body, v.id]);
      await audit(q, v.id, root.partner_org_id, `scorecard.dispute.${input.kind}`, `dispute:${id}`, { body });
    });
  } catch (e) {
    return { ok: false, error: (e as Error).message === '닫힘' ? '이미 처리된 이의입니다(덧붙이기만 됩니다)' : '처리하지 못했습니다' };
  }
  // 받아들이면 그 화물을 빼고 다시 셈한다
  if (input.kind === 'accepted') await asSystem((q) => recomputeScorecardsNow(q));
  revalidateAll();
  return { ok: true };
}

export async function adminRecomputeScorecards(): Promise<{ ok: boolean; error?: string; rows?: number; withSamples?: number }> {
  const v = await requirePlatform();
  if (!v) return { ok: false, error: '운영자만 셀 수 있습니다.' };
  const r = await asSystem((q) => recomputeScorecardsNow(q));
  await asUser(v, (q) => audit(q, v.id, null, 'scorecard.recompute', `batch:${r.batchId}`, { rows: r.rows }));
  revalidateAll();
  return { ok: true, rows: r.rows, withSamples: r.withSamples };
}

export async function adminRefreshSubmitted(): Promise<{ ok: boolean; error?: string; seen?: number; candidates?: number }> {
  const v = await requirePlatform();
  if (!v) return { ok: false, error: '운영자만 돌릴 수 있습니다.' };
  const r = await refreshSubmitted({ actorId: v.id });
  revalidatePath('/admin/scorecard');
  return { ok: true, ...r };
}

export async function adminFindCodes(orgId: string): Promise<{ ok: boolean; error?: string; records?: ForwarderRecord[]; mock?: boolean }> {
  const v = await requirePlatform();
  if (!v) return { ok: false, error: '운영자만 찾을 수 있습니다.' };
  const rows = await asUser(v, customsCodes);
  const org = rows.find((r) => r.org_id === uuid(orgId));
  if (!org) return { ok: false, error: '업체를 찾지 못했습니다' };
  if (!allow(`sc-find:${v.id}`, 20)) return { ok: false, error: '잠시 뒤 다시 찾아 주세요' };
  const adapter = forwarderAdapter(rows.filter((r) => r.is_demo).map((r) => r.name));
  try {
    return { ok: true, records: await adapter.search(org.name), mock: adapter.kind === 'mock' };
  } catch (e) {
    return { ok: false, error: e instanceof UnipassError || (e as { code?: string }).code === 'unipass_disabled' ? (e as Error).message : '관세청 목록을 불러오지 못했습니다' };
  }
}

const Link = z.object({
  orgId: z.string().uuid(),
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{2,12}$/, '부호는 영문 대문자·숫자 2~12자').nullable(),
  name: z.string().trim().max(120).nullable(),
  source: z.enum(['unipass', 'mock', 'admin']),
  note: z.string().trim().max(300).nullable(),
});

/** 부호 연결(또는 끊기) — 새 판(앞 판을 supersedes_id 로) */
export async function adminLinkCode(input: z.infer<typeof Link>): Promise<{ ok: boolean; error?: string }> {
  const v = await requirePlatform();
  if (!v) return { ok: false, error: '운영자만 연결할 수 있습니다.' };
  const p = Link.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0].message };
  try {
    await asUser(v, async (q) => {
      const cur = (await q.query<{ id: string }>(`select id from fcd.v_partner_customs_codes_current where org_id = $1 order by created_at desc limit 1`, [p.data.orgId]))[0];
      await q.query(
        `insert into fcd.partner_customs_codes (org_id, code, registered_name, source, status, note, supersedes_id, created_by) values ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [p.data.orgId, p.data.code, p.data.code ? p.data.name : null, p.data.source, p.data.code ? 'linked' : 'unlinked', p.data.note, cur?.id ?? null, v.id],
      );
      await audit(q, v.id, p.data.orgId, p.data.code ? 'scorecard.code.linked' : 'scorecard.code.unlinked', `org:${p.data.orgId}`, { code: p.data.code, source: p.data.source });
    });
  } catch {
    return { ok: false, error: '연결하지 못했습니다' };
  }
  revalidatePath('/admin/scorecard');
  return { ok: true };
}

const Broker = z.object({
  orgId: z.string().uuid(),
  registrationNo: z.string().trim().max(60).nullable(),
  offices: z.string().trim().max(300),
  ports: z.array(z.enum(['ICN', 'PTK'])).max(10),
  specialties: z.string().trim().max(300).nullable(),
});

export async function adminBrokerProfile(input: z.infer<typeof Broker>): Promise<{ ok: boolean; error?: string }> {
  const v = await requirePlatform();
  if (!v) return { ok: false, error: '운영자만 고칠 수 있습니다.' };
  const p = Broker.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0].message };
  const offices = p.data.offices.split(/[,·\n]/).map((s) => s.trim()).filter(Boolean).slice(0, 10);
  try {
    await asUser(v, async (q) => {
      const cur = (await q.query<{ id: string }>(`select id from fcd.v_broker_profiles_current where org_id = $1 order by created_at desc limit 1`, [p.data.orgId]))[0];
      await q.query(
        `insert into fcd.broker_profiles (org_id, registration_no, customs_offices, ports, specialties, source, supersedes_id, created_by) values ($1,$2,$3::text[],$4::text[],$5,'admin',$6,$7)`,
        [p.data.orgId, p.data.registrationNo || null, offices, p.data.ports, p.data.specialties || null, cur?.id ?? null, v.id],
      );
      await audit(q, v.id, p.data.orgId, 'scorecard.broker_profile', `org:${p.data.orgId}`, null);
    });
  } catch {
    return { ok: false, error: '고치지 못했습니다 — 관세사 업체인지 확인해 주세요' };
  }
  revalidatePath('/admin/scorecard');
  revalidatePath('/brokers');
  return { ok: true };
}
