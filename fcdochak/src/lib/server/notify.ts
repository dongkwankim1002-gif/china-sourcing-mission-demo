import 'server-only';
/**
 * 알림 — 화면 안 알림 센터는 늘 쌓는다(설정에서 끈 종류는 빼고).
 * 메일·문자·카톡은 OUTBOUND_ENABLED 스위치 뒤. 기본 꺼짐이면 아무것도 밖으로 나가지 않고 로그 한 줄만 남긴다.
 */
import { asSystem, type Queryable } from '../db';
import { env } from '../env';

export type NotifKind = 'bid_arrived' | 'deadline_soon' | 'exception' | 'invoice_arrived' | 'booking' | 'status' | 'system';

export interface Outbound {
  channel: 'email' | 'sms' | 'kakao';
  to: string;
  title: string;
  body: string;
}

/** 밖으로 보내기 — 스위치가 꺼져 있으면 보내지 않는다. 켜져 있어도 1차에는 발송 공급자가 연결되어 있지 않다. */
export async function sendOutbound(msgs: Outbound[]): Promise<{ sent: number; skipped: number }> {
  if (msgs.length === 0) return { sent: 0, skipped: 0 };
  if (!env.outboundEnabled) {
    console.info(`[fcdochak] 밖으로 보내기 꺼짐(OUTBOUND_ENABLED=false) — ${msgs.length}건 보내지 않음`);
    return { sent: 0, skipped: msgs.length };
  }
  // 공급자(메일·문자·알림톡) 연결은 docs/DEPLOY.md 「밖으로 보내기」 참고. 연결 전에는 보내지 않는다.
  console.info(`[fcdochak] 발송 공급자가 연결되지 않아 ${msgs.length}건을 보내지 않았습니다`);
  return { sent: 0, skipped: msgs.length };
}

export async function notifyOrg(
  q: Queryable,
  orgId: string,
  n: { kind: NotifKind; title: string; body?: string | null; link?: string | null },
  opts: { exceptUser?: string | null } = {},
) {
  const members = await q.query<{ user_id: string; email: string; phone: string | null; in_app: boolean | null; email_on: boolean | null; sms_on: boolean | null; kakao_on: boolean | null }>(
    `select m.user_id, p.email, p.phone, np.in_app, np.email email_on, np.sms sms_on, np.kakao kakao_on
       from fcd.memberships m join fcd.profiles p on p.id = m.user_id
       left join fcd.notification_prefs np on np.user_id = m.user_id and np.kind = $2
      where m.org_id = $1`,
    [orgId, n.kind],
  );
  const out: Outbound[] = [];
  for (const m of members) {
    if (m.user_id === opts.exceptUser) continue;
    if (m.in_app !== false) {
      await q.query(`insert into fcd.notifications (user_id, org_id, kind, title, body, link) values ($1,$2,$3,$4,$5,$6)`, [
        m.user_id,
        orgId,
        n.kind,
        n.title,
        n.body ?? null,
        n.link ?? null,
      ]);
    }
    if (m.email_on) out.push({ channel: 'email', to: m.email, title: n.title, body: n.body ?? '' });
    if (m.sms_on && m.phone) out.push({ channel: 'sms', to: m.phone, title: n.title, body: n.body ?? '' });
    if (m.kakao_on && m.phone) out.push({ channel: 'kakao', to: m.phone, title: n.title, body: n.body ?? '' });
  }
  return out;
}

/** 여러 조직에 알리고 밖으로 보낼 것은 모아서 한 번에 */
export async function notifyMany(targets: { orgId: string; kind: NotifKind; title: string; body?: string | null; link?: string | null }[], exceptUser?: string | null) {
  if (targets.length === 0) return;
  const out = await asSystem(async (q) => {
    const all: Outbound[] = [];
    for (const t of targets) all.push(...(await notifyOrg(q, t.orgId, t, { exceptUser })));
    return all;
  });
  await sendOutbound(out);
}
