'use server';
/** 모든 면에서 쓰는 행동 — 알림 읽음·설정, 내 정보. */
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { asUser } from '@/lib/db';
import { getViewer } from '@/lib/server/viewer';

async function me() {
  const v = await getViewer();
  if (!v) throw new Error('로그인이 풀렸습니다. 다시 로그인해 주세요.');
  return v;
}

export async function setNotificationsRead(ids: string[], read: boolean) {
  const v = await me();
  await asUser(v, (q) =>
    q.query(`update fcd.notifications set read_at = ${read ? 'now()' : 'null'} where user_id = $1 and id = any($2::uuid[])`, [v.id, ids]),
  );
  revalidatePath('/', 'layout');
  return { ok: true };
}

export async function markAllRead() {
  const v = await me();
  const r = await asUser(v, (q) =>
    q.query<{ id: string }>(`update fcd.notifications set read_at = now() where user_id = $1 and read_at is null returning id`, [v.id]),
  );
  revalidatePath('/', 'layout');
  return { ok: true, ids: r.map((x) => x.id) };
}

const Pref = z.object({
  kind: z.enum(['bid_arrived', 'deadline_soon', 'exception', 'invoice_arrived', 'booking', 'status', 'system']),
  channel: z.enum(['in_app', 'email', 'sms', 'kakao']),
  value: z.boolean(),
});

export async function setPref(input: z.infer<typeof Pref>) {
  const v = await me();
  const p = Pref.parse(input);
  await asUser(v, (q) =>
    q.query(
      `insert into fcd.notification_prefs (user_id, kind, ${p.channel}) values ($1,$2,$3)
       on conflict (user_id, kind) do update set ${p.channel} = excluded.${p.channel}`,
      [v.id, p.kind, p.value],
    ),
  );
  return { ok: true };
}

const Profile = z.object({ name: z.string().trim().min(2, '이름을 두 글자 이상').max(40), phone: z.string().trim().max(30).optional() });

export async function updateProfile(input: z.infer<typeof Profile>) {
  const v = await me();
  const p = Profile.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0].message };
  await asUser(v, (q) => q.query(`update fcd.profiles set name = $2, phone = $3 where id = $1`, [v.id, p.data.name, p.data.phone || null]));
  revalidatePath('/', 'layout');
  return { ok: true };
}

const OrgInfo = z.object({
  bizRegNo: z.string().trim().max(30).optional(),
  address: z.string().trim().max(120).optional(),
  phone: z.string().trim().max(30).optional(),
});

export async function updateOrg(input: z.infer<typeof OrgInfo>) {
  const v = await me();
  const p = OrgInfo.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0].message };
  const n = await asUser(v, (q) =>
    q.query<{ id: string }>(`update fcd.orgs set biz_reg_no = $2, address = $3, phone = $4 where id = $1 returning id`, [v.org.id, p.data.bizRegNo || null, p.data.address || null, p.data.phone || null]),
  );
  if (!n.length) return { ok: false, error: '회사 정보는 관리자만 고칠 수 있습니다' };
  revalidatePath('/', 'layout');
  return { ok: true };
}
