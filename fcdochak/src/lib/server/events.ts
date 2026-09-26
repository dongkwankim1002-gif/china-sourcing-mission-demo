import 'server-only';
/**
 * 이벤트 한 줄 쓰기(fcd.events) — 행동이 끝난 뒤 따로 쓴다.
 * 기록이 실패해도 행동은 이미 끝났으므로 되돌리지 않고 로그만 남긴다(지표가 한 줄 빠질 뿐).
 * 로그인한 본인(asUser)으로 쓰므로 RLS 가 「자기 조직 이름으로만」을 지킨다.
 */
import { asUser } from '../db';
import type { EventKind } from '../metrics';

export interface EventInput {
  orgId: string;
  sellerOrgId?: string | null;
  kind: EventKind;
  targetKind?: 'org' | 'quote_request' | 'shipment' | null;
  targetId?: string | null;
  detail?: Record<string, unknown> | null;
}

export async function recordEvent(actorId: string, e: EventInput): Promise<boolean> {
  try {
    await asUser({ id: actorId }, (q) =>
      q.query(
        `insert into fcd.events (org_id, seller_org_id, actor_id, kind, target_kind, target_id, detail) values ($1,$2,$3,$4,$5,$6,$7::jsonb)`,
        [e.orgId, e.sellerOrgId ?? null, actorId, e.kind, e.targetKind ?? null, e.targetId ?? null, e.detail ? JSON.stringify(e.detail) : null],
      ),
    );
    return true;
  } catch (err) {
    console.error(`[events] ${e.kind} 기록 실패: ${(err as Error).message}`);
    return false;
  }
}

/** 가입 — 방금 만든 사람의 소속 조직으로 */
export async function recordSignup(userId: string, orgKind: 'shipper' | 'partner', via: 'direct' | 'invite' = 'direct') {
  try {
    const org = await asUser({ id: userId }, (q) => q.query<{ id: string }>(`select home_org_id id from fcd.profiles where id = $1`, [userId]));
    if (!org[0]) return false;
    return recordEvent(userId, {
      orgId: org[0].id,
      sellerOrgId: orgKind === 'shipper' ? org[0].id : null,
      kind: 'signed_up',
      targetKind: 'org',
      targetId: org[0].id,
      detail: { orgKind, via },
    });
  } catch (err) {
    console.error(`[events] signed_up 기록 실패: ${(err as Error).message}`);
    return false;
  }
}
