'use server';
import { z } from 'zod';
import { asPublic, asSystem } from '@/lib/db';

export interface FormState {
  ok?: boolean;
  error?: string;
  fields?: Record<string, string>;
}

const Verify = z.object({
  orgId: z.string().uuid(),
  name: z.string().trim().min(2, '이름을 두 글자 이상 적어 주세요').max(40),
  email: z.string().trim().email('회사 이메일 형식이 아닙니다'),
  phone: z.string().trim().max(30).optional(),
  message: z.string().trim().max(500).optional(),
});

/** 담당자 인증 요청 — 운영 큐로 간다. 밖으로 보내는 것은 없다. */
export async function requestVerification(_: FormState, form: FormData): Promise<FormState> {
  const raw = Object.fromEntries(form) as Record<string, string>;
  const p = Verify.safeParse(raw);
  if (!p.success) return { error: p.error.issues[0].message, fields: raw };
  try {
    await asPublic((q) =>
      q.query(
        `insert into fcd.verification_requests (org_id, requester_name, requester_email, requester_phone, message) values ($1,$2,$3,$4,$5)`,
        [p.data.orgId, p.data.name, p.data.email.toLowerCase(), p.data.phone || null, p.data.message || null],
      ),
    );
  } catch {
    return { error: '접수하지 못했습니다. 이 업체는 지금 인증 요청을 받을 수 없는 상태입니다. 문의 메일로 알려 주세요.', fields: raw };
  }
  return { ok: true };
}

const Delete = z.object({
  orgId: z.string().uuid(),
  name: z.string().trim().min(2, '이름을 두 글자 이상 적어 주세요').max(40),
  email: z.string().trim().email('이메일 형식이 아닙니다'),
  reason: z.string().trim().min(5, '사유를 다섯 글자 이상 적어 주세요').max(500),
});

export async function requestDeletion(_: FormState, form: FormData): Promise<FormState> {
  const raw = Object.fromEntries(form) as Record<string, string>;
  const p = Delete.safeParse(raw);
  if (!p.success) return { error: p.error.issues[0].message, fields: raw };
  try {
    await asPublic((q) =>
      q.query(`insert into fcd.deletion_requests (org_id, requester_name, requester_email, reason) values ($1,$2,$3,$4)`, [
        p.data.orgId,
        p.data.name,
        p.data.email.toLowerCase(),
        p.data.reason,
      ]),
    );
  } catch {
    return { error: '접수하지 못했습니다. 잠시 뒤 다시 시도하거나 문의 메일로 알려 주세요.', fields: raw };
  }
  // 공개정보 기준 게시물은 접수 즉시 공개 목록에서 가린다(지우는 것은 운영자 확인 뒤).
  await asSystem((q) =>
    q.query(`update fcd.orgs set status = 'deletion_requested' where id = $1 and status = 'public_info'`, [p.data.orgId]),
  );
  return { ok: true };
}
