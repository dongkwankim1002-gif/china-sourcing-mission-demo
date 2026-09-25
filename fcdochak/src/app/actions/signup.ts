'use server';
/**
 * 가입·입점 — 서버의 신뢰 경로(asSystem)로 조직·사람·소속을 한 번에 만든다.
 * 확인 메일은 보내지 않는다(OUTBOUND_ENABLED 스위치 뒤). 물류사는 「인증 대기」로 시작한다.
 */
import { randomBytes } from 'node:crypto';
import { asSystem } from '@/lib/db';
import { createAuthUser, storeLocalPassword } from '@/lib/auth/provider';
import { createSession } from '@/lib/auth/session';
import { PartnerSignup, ShipperSignup, slugify, type PartnerSignupT, type ShipperSignupT } from '@/lib/schemas';
import { insertRateCard } from '@/lib/server/rate-cards';
import { recordSignup } from '@/lib/server/events';
import { notifyInviteAccepted } from '@/lib/server/workspace';
import { hashInviteToken, isInviteToken } from '@/lib/workspace/invite';

export interface SignupResult {
  ok?: boolean;
  redirect?: string;
  error?: string;
  path?: string;
}

async function emailTaken(email: string) {
  const r = await asSystem((q) => q.query<{ n: number }>('select count(*)::int n from fcd.profiles where lower(email) = $1', [email.toLowerCase()]));
  return r[0].n > 0;
}

export async function signupShipper(input: ShipperSignupT): Promise<SignupResult> {
  const p = ShipperSignup.safeParse(input);
  if (!p.success) return { error: p.error.issues[0].message, path: p.error.issues[0].path.join('.') };
  const d = p.data;
  if (await emailTaken(d.email)) return { error: '이미 가입된 이메일입니다. 로그인해 주세요.', path: 'email' };
  let userId: string;
  try {
    userId = await createAuthUser(d.email, d.password);
  } catch (e) {
    return { error: (e as Error).message, path: 'email' };
  }
  await asSystem(async (q) => {
    const org = await q.query<{ id: string }>(
      `insert into fcd.orgs (kind, name, slug, status, biz_reg_no, hq_city) values ('shipper', $1, $2, 'active', $3, null) returning id`,
      [d.company, slugify(d.company, randomBytes(3).toString('hex')), d.bizRegNo || null],
    );
    const orgId = org[0].id;
    await q.query(`insert into fcd.profiles (id, home_org_id, email, name, phone, locale) values ($1,$2,$3,$4,$5,'ko')`, [userId, orgId, d.email.toLowerCase(), d.name, d.phone || null]);
    await q.query(`insert into fcd.memberships (user_id, org_id, role) values ($1,$2,'shipper_admin')`, [userId, orgId]);
    await storeLocalPassword(q, userId, d.password);
    await q.query(`insert into fcd.notifications (user_id, org_id, kind, title, body, link) values ($1,$2,'system',$3,$4,$5)`, [
      userId,
      orgId,
      '가입을 환영합니다',
      '저장한 SKU 로 같은 조건 비교를 해 보거나, 바로 견적 요청을 올려 보세요.',
      '/app/compare',
    ]);
    await q.query(`insert into fcd.audit_log (actor_id, org_id, action, target, detail) values ($1,$2,'org.signup','shipper',$3::jsonb)`, [
      userId,
      orgId,
      JSON.stringify({ hubs: d.hubs, category: d.category ?? null }),
    ]);
  });
  await recordSignup(userId, 'shipper');
  await createSession(userId);
  return { ok: true, redirect: '/app?welcome=1' };
}

/** inviteToken — 화주가 보낸 거래처 초대 링크로 들어왔을 때. 가입과 같은 트랜잭션에서 그 화주의 거래처로 연결한다. */
export async function signupPartner(input: PartnerSignupT, inviteToken?: string | null): Promise<SignupResult> {
  const p = PartnerSignup.safeParse(input);
  if (!p.success) return { error: p.error.issues[0].message, path: p.error.issues[0].path.join('.') };
  const d = p.data;
  if (await emailTaken(d.email)) return { error: '이미 가입된 이메일입니다. 로그인해 주세요.', path: 'email' };
  let userId: string;
  try {
    userId = await createAuthUser(d.email, d.password);
  } catch (e) {
    return { error: (e as Error).message, path: 'email' };
  }
  const inviteHash = isInviteToken(inviteToken) ? hashInviteToken(inviteToken) : null;
  let invited = false;
  await asSystem(async (q) => {
    const org = await q.query<{ id: string }>(
      `insert into fcd.orgs (kind, name, name_zh, slug, status, business_type, biz_reg_no, license_no, cargo_insurance, hq_city, address, phone, default_locale)
       values ('partner', $1, $2, $3, 'pending_verification', $4, $5, $6, $7, $8, $9, $10, $11) returning id`,
      [d.company, d.companyZh || null, slugify(d.company, randomBytes(3).toString('hex')), d.businessType, d.bizRegNo, d.licenseNo || null, d.insurance || null, d.city, d.address || null, d.phone || null, d.locale],
    );
    const orgId = org[0].id;
    for (const h of d.hubs) await q.query('insert into fcd.org_hubs (org_id, hub) values ($1,$2)', [orgId, h]);
    for (const m of d.modes) await q.query('insert into fcd.org_modes (org_id, mode) values ($1,$2)', [orgId, m]);
    for (const c of d.caps) await q.query('insert into fcd.org_capabilities (org_id, trait) values ($1,$2)', [orgId, c]);
    await q.query(`insert into fcd.profiles (id, home_org_id, email, name, locale) values ($1,$2,$3,$4,$5)`, [userId, orgId, d.email.toLowerCase(), d.name, d.locale]);
    await q.query(`insert into fcd.memberships (user_id, org_id, role) values ($1,$2,'partner_admin')`, [userId, orgId]);
    await storeLocalPassword(q, userId, d.password);
    await insertRateCard(q, orgId, d.card, userId, null, '입점 때 첫 요금표');
    await q.query(
      `insert into fcd.verification_requests (org_id, requester_name, requester_email, requester_phone, message) values ($1,$2,$3,$4,'입점 신청')`,
      [orgId, d.name, d.email.toLowerCase(), d.phone || null],
    );
    await q.query(`insert into fcd.notifications (user_id, org_id, kind, title, body, link) values ($1,$2,'system',$3,$4,'/partner/profile')`, [
      userId,
      orgId,
      d.locale === 'zh' ? '入驻申请已提交' : '입점 신청을 받았습니다',
      d.locale === 'zh' ? '运营方确认营业执照后将改为「正式入驻」。在此之前运价表也会参与比较（显示为认证中）。' : '운영자가 사업자 정보를 확인하면 「공식 등록」으로 바뀝니다. 그 전에도 요금표는 「인증 대기」 표시로 비교에 나옵니다.',
    ]);
    await q.query(`insert into fcd.audit_log (actor_id, org_id, action, target) values ($1,$2,'org.signup','partner')`, [userId, orgId]);
    if (inviteHash) {
      // 방금 만든 소속으로 받는다(app.user_id = 새 사용자). 초대가 만료·사용됨이면 가입만 된다.
      const r = await q.query<{ r: string }>(`select fcd.accept_partner_invite($1, $2) r`, [inviteHash, orgId]);
      invited = r[0]?.r === 'ok';
      if (invited) {
        await q.query(`insert into fcd.audit_log (actor_id, org_id, action, target) values ($1,$2,'partner_invite.accepted','signup')`, [userId, orgId]);
      }
    }
  }, userId);
  if (invited && inviteHash) await notifyInviteAccepted(inviteHash, d.company);
  await recordSignup(userId, 'partner', invited ? 'invite' : 'direct');
  await createSession(userId);
  return { ok: true, redirect: invited ? '/partner?welcome=1&invited=1' : '/partner?welcome=1' };
}
