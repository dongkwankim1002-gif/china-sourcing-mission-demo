import 'server-only';
/**
 * WING 키 만료 알림 넣기(v2 3차 sales) — 알림 표는 신뢰 경로(asSystem)만 쓰므로 여기서 좁게 쓴다.
 * 같은 (조직·발급일·종류)는 한 번만(fcd.wing_key_alerts unique). 화면 안 알림만 — sendOutbound 를 부르지 않는다(발송 없음).
 */
import { asSystem } from '../db';
import { expiryAlertFor, type ExpiryAlert } from '../sales/alerts';
import { notifyOrg } from './notify';

export async function ensureKeyExpiryAlert(orgId: string, conn: { has_key: boolean; issued_on: string | null } | null, set: { keyValidDays: number; keyWarnDays: number }, today: string): Promise<ExpiryAlert | null> {
  const a = expiryAlertFor(conn, set, today);
  if (!a) return null;
  try {
    await asSystem(async (q) => {
      const r = await q.query<{ id: string }>(
        `insert into fcd.wing_key_alerts (org_id, issued_on, kind, expires_on) values ($1,$2::date,$3,$4::date) on conflict (org_id, issued_on, kind) do nothing returning id`,
        [orgId, a.issuedOn, a.kind, a.expiresOn],
      );
      if (!r.length) return;
      // notifyOrg 는 밖으로 보낼 목록을 돌려주지만 보내지 않는다(발송 없음 — docs/sales-plan.md 4절 ⑧)
      await notifyOrg(q, orgId, { kind: 'system', title: a.title, body: a.body, link: '/app/integrations/wing' });
    });
  } catch {
    // 알림을 못 넣어도 화면은 연다(화면에 같은 경고가 따로 보인다)
  }
  return a;
}
