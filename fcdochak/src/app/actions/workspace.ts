'use server';
/**
 * 셀러 공간 행동 — 청구 승인/이의, 거래처 초대·거두기, (로그인한 물류사의) 초대 받기.
 * 초대 링크는 밖으로 보내지 않는다(OUTBOUND_ENABLED 꺼짐). 화면에 한 번 보여 주고 화주가 복사해 전한다.
 */
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { asUser } from '@/lib/db';
import { getViewer, requireViewer } from '@/lib/server/viewer';
import { notifyMany } from '@/lib/server/notify';
import { notifyInviteAccepted, workspaceSettings } from '@/lib/server/workspace';
import { billingDiff } from '@/lib/money/billing-diff';
import { ACCEPT_RESULT_TEXT, hashInviteToken, inviteExpiry, isInviteToken, newInviteToken } from '@/lib/workspace/invite';

export interface WsResult<T = undefined> {
  ok: boolean;
  error?: string;
  data?: T;
}

const Decision = z.object({
  shipmentId: z.string().uuid(),
  invoiceId: z.string().uuid(),
  decision: z.enum(['approved', 'disputed']),
  reason: z.string().trim().max(1000).optional(),
  supersedesId: z.string().uuid().nullable().optional(),
});

export async function decideInvoice(input: z.infer<typeof Decision>): Promise<WsResult> {
  const v = await requireViewer('app');
  const p = Decision.safeParse(input);
  if (!p.success) return { ok: false, error: '요청이 올바르지 않습니다' };
  const d = p.data;
  const reason = d.reason?.trim() || null;
  if (d.decision === 'disputed' && (!reason || reason.length < 5)) return { ok: false, error: '이의 사유를 다섯 글자 이상 적어 주세요' };
  const r = await asUser(v, async (q) => {
    const x = (
      await q.query<{ partner_org_id: string; shipment_no: string; bid_amounts: Record<string, number | null>; inv_amounts: Record<string, number | null>; invoice_no: string }>(
        `select s.partner_org_id, s.shipment_no, bd.amounts bid_amounts, i.amounts inv_amounts, i.invoice_no
           from fcd.shipments s join fcd.bookings b on b.id = s.booking_id join fcd.bids bd on bd.id = b.bid_id
           join fcd.v_invoices_current i on i.shipment_id = s.id and i.id = $2
          where s.id = $1 and s.shipper_org_id = $3`,
        [d.shipmentId, d.invoiceId, v.org.id],
      )
    )[0];
    if (!x) return { error: '현재 청구서를 찾을 수 없습니다. 화면을 새로 고쳐 주세요' };
    const set = await workspaceSettings(q);
    const diff = billingDiff(x.bid_amounts, x.inv_amounts, set.billingFlagBp);
    try {
      await q.query(
        `insert into fcd.invoice_decisions (invoice_id, shipment_id, shipper_org_id, decision, reason, quote_total, invoice_total, supersedes_id, created_by)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [d.invoiceId, d.shipmentId, v.org.id, d.decision, reason, diff.quoteTotal, diff.invoiceTotal, d.supersedesId ?? null, v.id],
      );
    } catch {
      return { error: '이미 다른 결정이 들어왔습니다. 화면을 새로 고쳐 주세요' };
    }
    // 이의는 물류사가 처리하는 예외(청구 편차)로도 연다 — 물류사 화면의 예외 처리 흐름을 그대로 쓴다
    // 이미 열린 청구 편차 예외가 있으면(청구서를 올릴 때 연 것·앞선 이의) 새로 열지 않는다 — 같은 선적에 열린 예외가 겹치지 않게.
    // 새 사유는 알림 본문으로 물류사에 간다.
    if (d.decision === 'disputed') {
      await q.query(
        `insert into fcd.exceptions (shipment_id, kind, note, created_by)
         select $1,'billing_deviation',$2,$3
          where not exists (select 1 from fcd.exceptions e where e.shipment_id = $1 and e.kind = 'billing_deviation' and e.resolved_at is null)`,
        [d.shipmentId, `청구 이의: ${reason}`, v.id],
      );
    }
    return { x, diff };
  });
  if ('error' in r) return { ok: false, error: r.error };
  const pctText = r.diff.deviationBp == null ? '' : ` (견적 대비 ${r.diff.deviationBp >= 0 ? '+' : ''}${(r.diff.deviationBp / 100).toFixed(1)}%)`;
  await notifyMany([
    {
      orgId: r.x.partner_org_id,
      kind: d.decision === 'disputed' ? 'exception' : 'system',
      title: d.decision === 'approved' ? `청구 승인 — ${r.x.invoice_no}` : `청구 이의 — ${r.x.invoice_no}`,
      body: d.decision === 'approved' ? `${r.x.shipment_no} 청구서를 화주가 승인했습니다${pctText}` : `${r.x.shipment_no}${pctText} · ${reason}`,
      link: `/partner/shipments/${d.shipmentId}?tab=invoice`,
    },
  ]);
  revalidatePath(`/app/shipments/${d.shipmentId}`);
  revalidatePath(`/partner/shipments/${d.shipmentId}`);
  return { ok: true };
}

const Invite = z.object({
  partnerName: z.string().trim().min(1, '물류사 이름을 적어 주세요').max(80),
  contactEmail: z.union([z.literal(''), z.string().trim().email('이메일 형식이 아닙니다').max(120)]).optional(),
  note: z.string().trim().max(400).optional(),
});

export async function createInvite(input: z.infer<typeof Invite>): Promise<WsResult<{ token: string; expiresAt: string }>> {
  const v = await requireViewer('app');
  const p = Invite.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0].message };
  const token = newInviteToken();
  const r = await asUser(v, async (q) => {
    const set = await workspaceSettings(q);
    const exp = inviteExpiry(new Date(), set.inviteDays);
    try {
      await q.query(
        `insert into fcd.partner_invites (shipper_org_id, token_hash, partner_name, contact_email, note, expires_at, created_by) values ($1,$2,$3,$4,$5,$6,$7)`,
        [v.org.id, hashInviteToken(token), p.data.partnerName, p.data.contactEmail || null, p.data.note || null, exp.toISOString(), v.id],
      );
    } catch {
      return null;
    }
    await q.query(`insert into fcd.audit_log (actor_id, org_id, action, target, detail) values ($1,$2,'partner_invite.created',$3,$4::jsonb)`, [
      v.id,
      v.org.id,
      `invite:${p.data.partnerName}`,
      JSON.stringify({ days: set.inviteDays }),
    ]);
    return exp.toISOString();
  });
  if (!r) return { ok: false, error: '초대를 만들 권한이 없습니다' };
  revalidatePath('/app/partners');
  return { ok: true, data: { token, expiresAt: r } };
}

export async function revokeInvite(id: string): Promise<WsResult> {
  const v = await requireViewer('app');
  if (!z.string().uuid().safeParse(id).success) return { ok: false, error: '요청이 올바르지 않습니다' };
  const n = await asUser(v, (q) =>
    q.query<{ id: string }>(`update fcd.partner_invites set revoked_at = now() where id = $1 and shipper_org_id = $2 and revoked_at is null returning id`, [id, v.org.id]),
  );
  if (!n.length) return { ok: false, error: '거둘 수 있는 초대가 없습니다' };
  revalidatePath('/app/partners');
  return { ok: true };
}

/** 이미 가입한 물류사가 초대 링크를 열었을 때 — 지금 조직으로 받기 */
export async function acceptInvite(token: string): Promise<WsResult<{ redirect: string }>> {
  const v = await getViewer();
  if (!v) return { ok: false, error: '로그인이 풀렸습니다' };
  if (!isInviteToken(token)) return { ok: false, error: ACCEPT_RESULT_TEXT.not_found };
  // 링크 화면이 「거래처로 연결」 버튼을 보이는 조직(관리자로 있는 물류사)과 같은 곳으로 받는다
  const org = v.orgs.find((o) => o.kind === 'partner' && o.role === 'partner_admin');
  if (!org) return { ok: false, error: ACCEPT_RESULT_TEXT.not_partner_admin };
  const r = await asUser(v, (q) => q.query<{ r: string }>(`select fcd.accept_partner_invite($1, $2) r`, [hashInviteToken(token), org.id]));
  const res = r[0]?.r ?? 'not_found';
  if (res !== 'ok') return { ok: false, error: ACCEPT_RESULT_TEXT[res] ?? ACCEPT_RESULT_TEXT.not_found };
  await notifyInviteAccepted(hashInviteToken(token), org.name);
  revalidatePath('/app/partners');
  return { ok: true, data: { redirect: '/partner?invited=1' } };
}
