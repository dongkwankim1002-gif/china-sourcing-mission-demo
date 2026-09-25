'use server';
/** 후기 공개 답변(v2 trust) — 물류사가 쓴다. 고치면 새 판(supersedes_id)으로 쌓이고, 이전 판은 기록에 남는다. */
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { asUser } from '@/lib/db';
import { requireViewer } from '@/lib/server/viewer';
import { notifyMany } from '@/lib/server/notify';
import type { ActionResult } from './shipper';

const ReplyInput = z.object({
  reviewId: z.string().uuid(),
  body: z.string().trim().min(5, '다섯 글자 이상 적어 주세요').max(600, '600자까지 적을 수 있습니다'),
});

export async function replyToReview(input: z.infer<typeof ReplyInput>): Promise<ActionResult<{ version: number }>> {
  const v = await requireViewer('partner');
  const p = ReplyInput.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0].message };
  const d = p.data;
  const r = await asUser(v, async (q) => {
    const rv = (
      await q.query<{ partner_org_id: string; shipper_org_id: string; shipment_id: string }>(
        `select partner_org_id, shipper_org_id, shipment_id from fcd.reviews where id = $1`,
        [d.reviewId],
      )
    )[0];
    if (!rv || rv.partner_org_id !== v.org.id) return { error: '내 업체에 달린 후기가 아닙니다' };
    const cur = (
      await q.query<{ id: string; version: number; body: string }>(`select id, version, body from fcd.v_review_replies_current where review_id = $1`, [d.reviewId])
    )[0];
    if (cur && cur.body.trim() === d.body) return { error: '바뀐 내용이 없습니다' };
    const version = cur ? cur.version + 1 : 1;
    await q.query(
      `insert into fcd.review_replies (review_id, partner_org_id, version, supersedes_id, body, created_by) values ($1,$2,$3,$4,$5,$6)`,
      [d.reviewId, v.org.id, version, cur?.id ?? null, d.body, v.id],
    );
    return { version, shipper: rv.shipper_org_id, shipmentId: rv.shipment_id };
  }).catch(() => ({ error: '답변을 남기지 못했습니다 — 다른 사람이 먼저 고쳤을 수 있습니다. 새로 고침 뒤 다시 해 주세요.' }));
  if ('error' in r) return { ok: false, error: r.error };
  await notifyMany([
    { orgId: r.shipper, kind: 'status', title: r.version === 1 ? '남긴 평가에 업체 답변이 달렸습니다' : '업체가 답변을 고쳤습니다', body: d.body.slice(0, 80), link: `/app/shipments/${r.shipmentId}?tab=review` },
  ]);
  revalidatePath('/partner/reviews');
  if (v.org.slug) revalidatePath(`/p/${v.org.slug}`);
  revalidatePath('/');
  return { ok: true, data: { version: r.version } };
}
