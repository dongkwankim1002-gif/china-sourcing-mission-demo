'use server';
/**
 * 청구서 점검 — 공개 점검(로그인 없이, 저장하지 않음)과 로그인한 화주의 보관.
 * 공개 점검은 IP 당 분당 횟수를 설정(invoice_check_rule.publicPerMinute)에서 읽어 막는다.
 */
import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { asPublic } from '@/lib/db';
import { CheckInput, type CheckInputT, type CheckOutcome } from '@/lib/invoice-check-input';
import { allow } from '@/lib/server/rate-limit';
import { getMyCheck, loadCheckRule, runInvoiceCheck, saveInvoiceCheck } from '@/lib/server/invoice-check';
import { getViewer } from '@/lib/server/viewer';

export interface CheckActionResult<T> {
  ok: boolean;
  error?: string;
  path?: string;
  data?: T;
}

async function limited(key: string): Promise<boolean> {
  const rule = await asPublic(loadCheckRule);
  const ip = (await headers()).get('x-forwarded-for')?.split(',')[0]?.trim() || 'local';
  return !allow(`${key}:${ip}`, rule.publicPerMinute);
}

function parse(input: unknown) {
  const p = CheckInput.safeParse(input);
  if (!p.success) return { error: p.error.issues[0].message, path: p.error.issues[0].path.join('.') } as const;
  return { data: p.data } as const;
}

/** 점검만 — 결과를 돌려주고 아무것도 저장하지 않는다 */
export async function runCheck(input: CheckInputT): Promise<CheckActionResult<CheckOutcome & { canSave: boolean }>> {
  if (await limited('check')) return { ok: false, error: '잠시 뒤 다시 점검해 주세요(1분에 너무 많이 눌렀습니다).' };
  const p = parse(input);
  if ('error' in p) return { ok: false, error: p.error, path: p.path };
  try {
    const out = await runInvoiceCheck(p.data);
    const v = await getViewer();
    return { ok: true, data: { ...out, canSave: !!v?.orgs.some((o) => o.kind === 'shipper') } };
  } catch {
    return { ok: false, error: '점검하지 못했습니다. 입력을 확인하고 다시 눌러 주세요.' };
  }
}

/** 로그인한 화주가 결과를 보관 — 서버에서 다시 계산해 넣는다(화면의 결과를 그대로 믿지 않는다) */
export async function saveCheck(input: CheckInputT, supersedesId: string | null = null): Promise<CheckActionResult<{ id: string }>> {
  const v = await getViewer();
  if (!v) return { ok: false, error: '로그인하면 결과를 보관할 수 있습니다.' };
  const org = v.org.kind === 'shipper' ? v.org : v.orgs.find((o) => o.kind === 'shipper');
  if (!org) return { ok: false, error: '화주 계정으로 로그인하면 결과를 보관할 수 있습니다.' };
  const rule = await asPublic(loadCheckRule);
  if (!allow(`check-save:${v.id}`, rule.publicPerMinute)) return { ok: false, error: '잠시 뒤 다시 보관해 주세요.' };
  const p = parse(input);
  if ('error' in p) return { ok: false, error: p.error, path: p.path };
  if (supersedesId != null && !/^[0-9a-f-]{36}$/i.test(supersedesId)) return { ok: false, error: '이전 점검 번호가 올바르지 않습니다.' };
  try {
    const r = await saveInvoiceCheck(v, org.id, p.data, supersedesId);
    revalidatePath('/app/checks');
    return { ok: true, data: { id: r.id } };
  } catch (e) {
    const msg = (e as Error).message;
    return { ok: false, error: /새 판|찾지 못/.test(msg) ? msg : '보관하지 못했습니다. 다시 눌러 주세요.' };
  }
}

/** 보관한 점검을 다시 불러오기(고쳐서 다시 점검) — 본인 것만 */
export async function loadSavedInput(id: string): Promise<CheckActionResult<{ input: CheckInputT; title: string; newerId: string | null }>> {
  const v = await getViewer();
  if (!v) return { ok: false, error: '로그인이 풀렸습니다. 다시 로그인해 주세요.' };
  const c = await getMyCheck(v, id);
  if (!c) return { ok: false, error: '보관한 점검을 찾지 못했습니다.' };
  const cargo = c.cargo;
  return {
    ok: true,
    data: {
      title: c.title,
      newerId: c.newer_id,
      input: {
        title: c.title,
        hub: c.origin_hub,
        port: c.port as CheckInputT['port'],
        mode: (c.mode ?? 'ANY') as CheckInputT['mode'],
        units: cargo.units,
        cartons: cargo.cartons,
        kg: cargo.kg,
        cbm: cargo.cbm,
        goods: cargo.goodsValue,
        cur: cargo.goodsCurrency,
        lines: c.lines,
      },
    },
  };
}
