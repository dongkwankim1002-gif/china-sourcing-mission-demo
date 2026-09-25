'use server';
/**
 * 제휴 주선사 — 물류사 신청·서류 올리기, 운영자 후보 등록·요건 확인·상태·계약 조건 판·정산 명세.
 * 계약서 서명·돈의 이동·밖으로 나가는 연락은 하지 않는다(사람이 한다). 모든 쓰기는 감사 기록을 남긴다.
 * 요건·계약·정산은 고치지 않고 새 판으로만 쌓는다. 정산 금액은 화면이 보낸 합계를 믿지 않고 서버가 다시 셈한다.
 */
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { asUser, type Queryable } from '@/lib/db';
import { requireViewer } from '@/lib/server/viewer';
import { loadSettings } from '@/lib/server/settings';
import { loadAllianceConfig } from '@/lib/server/alliance';
import { DOC_MAX_BYTES, putDoc, safeFileName } from '@/lib/server/doc-storage';
import { newNo } from '@/lib/server/rate-cards';
import { ALLIANCE_STATUS, LiabilitySchema, REQUIREMENT_KINDS, TERMS_MODELS, termsModelOk } from '@/lib/alliance-settings';
import { linesToInput, settleAlliance, validateTerms, type Liability, type SettlementLine } from '@/lib/money/alliance';
import { parseSettlementLines } from '@/lib/alliance-lines';

interface R {
  ok: boolean;
  error?: string;
  id?: string;
}

const uuid = z.string().uuid();
const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '날짜는 YYYY-MM-DD');

async function audit(q: Queryable, actor: string, orgId: string | null, action: string, target: string, detail: unknown) {
  await q.query(`insert into fcd.audit_log (actor_id, org_id, action, target, detail) values ($1,$2,$3,$4,$5::jsonb)`, [actor, orgId, action, target, JSON.stringify(detail)]);
}

function refresh() {
  revalidatePath('/admin/alliance');
  revalidatePath('/partner/alliance');
}

// 물류사 ------------------------------------------------------------------------

const Apply = z.object({ registrationNo: z.string().trim().min(4, '등록번호를 적어 주세요').max(60), note: z.string().trim().max(600).optional() });

/** 제휴 신청 — 스위치가 켜졌을 때만. 한 물류사에 한 번 */
export async function applyAlliance(input: z.infer<typeof Apply>): Promise<R> {
  const v = await requireViewer('partner');
  const p = Apply.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0].message };
  const out = await asUser(v, async (q): Promise<R> => {
    const cfg = await loadAllianceConfig(q);
    if (!cfg.on) return { ok: false, error: '제휴 신청은 아직 받지 않습니다(준비 중)' };
    const r = await q.query<{ id: string }>(
      `insert into fcd.alliance_partners (partner_org_id, status, registration_no, applied_note, applied_by)
       values ($1, 'applied', $2, $3, $4) on conflict (partner_org_id) do nothing returning id`,
      [v.org.id, p.data.registrationNo, p.data.note || null, v.id],
    );
    if (!r[0]) return { ok: false, error: '이미 제휴 기록이 있습니다' };
    await audit(q, v.id, v.org.id, 'alliance.apply', `alliance:${r[0].id}`, { registrationNo: p.data.registrationNo });
    return { ok: true, id: r[0].id };
  });
  if (out.ok) refresh();
  return out;
}

/** 요건 서류 올리기 — 파일은 기존 서류 저장소(fcd-docs) 방식. 같은 칸에 이미 판이 있으면 그 위에 새 판 */
export async function submitRequirement(form: FormData): Promise<R> {
  const v = await requireViewer('partner');
  const kind = String(form.get('kind') ?? '');
  if (!(REQUIREMENT_KINDS as readonly string[]).includes(kind)) return { ok: false, error: '서류 종류를 고르세요' };
  const refNo = String(form.get('refNo') ?? '').trim().slice(0, 80) || null;
  const amountRaw = String(form.get('amount') ?? '').replace(/[,\s원]/g, '');
  const amount = amountRaw ? Number(amountRaw) : null;
  if (amount != null && (!Number.isSafeInteger(amount) || amount < 0)) return { ok: false, error: '금액은 원 단위 숫자로' };
  const validUntil = String(form.get('validUntil') ?? '').trim() || null;
  if (validUntil && !ymd.safeParse(validUntil).success) return { ok: false, error: '만료일은 YYYY-MM-DD' };
  const note = String(form.get('note') ?? '').trim().slice(0, 1000) || null;
  const file = form.get('file');
  const hasFile = file instanceof File && file.size > 0;
  if (hasFile && file.size > DOC_MAX_BYTES) return { ok: false, error: '15MB 보다 큰 파일은 올릴 수 없습니다' };
  if (!hasFile && kind !== 'incident_history') return { ok: false, error: '서류 파일을 고르세요' };
  if (kind === 'incident_history' && !note) return { ok: false, error: '사고 이력 설명을 적어 주세요' };
  if (kind === 'guarantee_bond' && (amount == null || !validUntil)) return { ok: false, error: '보험 금액과 보험 기간 끝을 적어 주세요' };
  if (kind === 'registration_cert' && !refNo) return { ok: false, error: '등록번호를 적어 주세요' };

  const pre = await asUser(v, async (q) => {
    const cfg = await loadAllianceConfig(q);
    const a = (await q.query<{ id: string; status: string }>(`select id, status from fcd.alliance_partners where partner_org_id = $1`, [v.org.id]))[0];
    return { on: cfg.on, a };
  });
  if (!pre.on) return { ok: false, error: '제휴 서류는 아직 받지 않습니다(준비 중)' };
  if (!pre.a) return { ok: false, error: '먼저 제휴를 신청해 주세요' };
  if (pre.a.status === 'ended') return { ok: false, error: '끝난 제휴에는 서류를 올릴 수 없습니다' };
  let storagePath: string | null = null;
  if (hasFile) {
    const up = await putDoc(`alliance/${pre.a.id}`, file);
    if (!up.ok) return { ok: false, error: `파일 저장소에 올리지 못했습니다(${up.status})` };
    storagePath = up.storagePath;
  }
  try {
    const id = await asUser(v, async (q) => {
      const cur = (await q.query<{ id: string; version: number }>(`select id, version from fcd.v_alliance_requirements_current where alliance_id = $1 and kind = $2`, [pre.a!.id, kind]))[0];
      const r = await q.query<{ id: string }>(
        `insert into fcd.alliance_requirements (alliance_id, partner_org_id, kind, version, supersedes_id, status, ref_no, amount, valid_until, file_name, storage_path, size_bytes, note, created_by)
         values ($1,$2,$3,$4,$5,'submitted',$6,$7,$8::date,$9,$10,$11,$12,$13) returning id`,
        [pre.a!.id, v.org.id, kind, (cur?.version ?? 0) + 1, cur?.id ?? null, refNo, amount, validUntil, hasFile ? safeFileName(file.name) : null, storagePath, hasFile ? file.size : null, note, v.id],
      );
      await audit(q, v.id, v.org.id, 'alliance.requirement.submit', `alliance_requirement:${r[0].id}`, { kind, version: (cur?.version ?? 0) + 1 });
      return r[0].id;
    });
    refresh();
    return { ok: true, id };
  } catch {
    return { ok: false, error: '올리지 못했습니다 — 다른 사람이 먼저 새 판을 올렸을 수 있습니다. 새로 고친 뒤 다시 해 주세요' };
  }
}

// 운영 ---------------------------------------------------------------------------

const Candidate = z.object({ orgId: uuid, note: z.string().trim().max(600).optional() });

export async function addAllianceCandidate(input: z.infer<typeof Candidate>): Promise<R> {
  const v = await requireViewer('admin');
  const p = Candidate.safeParse(input);
  if (!p.success) return { ok: false, error: '업체를 고르세요' };
  const out = await asUser(v, async (q): Promise<R> => {
    const lic = (await q.query<{ license_no: string | null }>(`select license_no from fcd.orgs where id = $1 and kind = 'partner'`, [p.data.orgId]))[0];
    if (!lic) return { ok: false, error: '물류사가 아닙니다' };
    const r = await q.query<{ id: string }>(
      `insert into fcd.alliance_partners (partner_org_id, status, registration_no, applied_note, applied_by)
       values ($1, 'candidate', $2, $3, $4) on conflict (partner_org_id) do nothing returning id`,
      [p.data.orgId, lic.license_no, p.data.note || '운영자가 후보로 올림', v.id],
    );
    if (!r[0]) return { ok: false, error: '이미 제휴 기록이 있습니다' };
    await audit(q, v.id, p.data.orgId, 'alliance.candidate', `alliance:${r[0].id}`, { note: p.data.note ?? null });
    return { ok: true, id: r[0].id };
  });
  if (out.ok) refresh();
  return out;
}

const Status = z.object({ allianceId: uuid, status: z.enum(ALLIANCE_STATUS), note: z.string().trim().min(2, '바꾸는 이유를 적어 주세요').max(600) });

/** 상태 바꾸기 — 「제휴 중」은 필수 요건이 모두 확인되고 서명한 계약 판이 있을 때만 */
export async function setAllianceStatus(input: z.infer<typeof Status>): Promise<R> {
  const v = await requireViewer('admin');
  const p = Status.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0].message };
  const out = await asUser(v, async (q): Promise<R> => {
    if (p.data.status === 'active') {
      const ok = await q.query<{ n: number }>(
        `select count(*)::int n from fcd.v_alliance_terms_current where alliance_id = $1 and status = 'agreed'`,
        [p.data.allianceId],
      );
      if (!ok[0].n) return { ok: false, error: '서명한 계약 판이 없어 「제휴 중」으로 바꿀 수 없습니다' };
    }
    const r = await q.query<{ id: string; partner_org_id: string }>(
      `update fcd.alliance_partners set status = $2, status_note = $3, decided_at = now(), decided_by = $4 where id = $1 returning id, partner_org_id`,
      [p.data.allianceId, p.data.status, p.data.note, v.id],
    );
    if (!r[0]) return { ok: false, error: '제휴 기록을 찾지 못했습니다' };
    await audit(q, v.id, r[0].partner_org_id, 'alliance.status', `alliance:${r[0].id}`, { status: p.data.status, note: p.data.note });
    return { ok: true, id: r[0].id };
  });
  if (out.ok) refresh();
  return out;
}

const Review = z.object({ requirementId: uuid, decision: z.enum(['verified', 'rejected']), note: z.string().trim().max(1000).optional() });

/** 요건 확인·반려 — 물류사가 올린 현재 판 위에 운영자 판을 잇는다(고치지 않는다) */
export async function reviewRequirement(input: z.infer<typeof Review>): Promise<R> {
  const v = await requireViewer('admin');
  const p = Review.safeParse(input);
  if (!p.success) return { ok: false, error: '요청을 읽지 못했습니다' };
  if (p.data.decision === 'rejected' && (p.data.note ?? '').length < 2) return { ok: false, error: '반려 사유를 적어 주세요' };
  try {
    const out = await asUser(v, async (q): Promise<R> => {
      const c = (await q.query<{ id: string; alliance_id: string; partner_org_id: string; kind: string; version: number; ref_no: string | null; amount: number | null; valid_until: string | null; file_name: string | null; storage_path: string | null; size_bytes: number | null; status: string }>(
        `select id, alliance_id, partner_org_id, kind, version, ref_no, amount::float8 amount, valid_until::text valid_until, file_name, storage_path, size_bytes, status
           from fcd.v_alliance_requirements_current where id = $1`,
        [p.data.requirementId],
      ))[0];
      if (!c) return { ok: false, error: '현재 판이 아닙니다 — 새로 고쳐 보세요' };
      const r = await q.query<{ id: string }>(
        `insert into fcd.alliance_requirements (alliance_id, partner_org_id, kind, version, supersedes_id, status, ref_no, amount, valid_until, file_name, storage_path, size_bytes, note, created_by)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9::date,$10,$11,$12,$13,$14) returning id`,
        [c.alliance_id, c.partner_org_id, c.kind, c.version + 1, c.id, p.data.decision, c.ref_no, c.amount, c.valid_until, c.file_name, c.storage_path, c.size_bytes, p.data.note || null, v.id],
      );
      await audit(q, v.id, c.partner_org_id, `alliance.requirement.${p.data.decision}`, `alliance_requirement:${r[0].id}`, { kind: c.kind, note: p.data.note ?? null });
      return { ok: true, id: r[0].id };
    });
    if (out.ok) refresh();
    return out;
  } catch {
    return { ok: false, error: '저장하지 못했습니다 — 다른 판이 먼저 올라왔을 수 있습니다' };
  }
}

const Terms = z.object({
  allianceId: uuid,
  supersedesId: uuid.nullable().optional(),
  model: z.enum(TERMS_MODELS),
  commissionBp: z.number().int().min(0).max(3000),
  reserveBp: z.number().int().min(0).max(10000),
  liability: LiabilitySchema,
  validFrom: ymd,
  validUntil: ymd,
  status: z.enum(['draft', 'agreed', 'ended']),
  signedOn: ymd.nullable().optional(),
  note: z.string().trim().max(1000).optional(),
});

/** 계약 조건 새 판 — 첫 판이면 새 번호, 아니면 같은 번호 다음 판 */
export async function addAllianceTerms(input: z.infer<typeof Terms>): Promise<R> {
  const v = await requireViewer('admin');
  const p = Terms.safeParse(input);
  if (!p.success) return { ok: false, error: `${p.error.issues[0].path.join('.')} ${p.error.issues[0].message}` };
  const d = p.data;
  if (d.validUntil < d.validFrom) return { ok: false, error: '유효기간 끝이 시작보다 앞섭니다' };
  if (d.status === 'agreed' && !d.signedOn) return { ok: false, error: '서명함이면 서명일을 적어 주세요' };
  if (!termsModelOk(d.model, d.reserveBp, d.liability as Liability)) return { ok: false, error: '영업 대리(②)는 준비금·플랫폼 부담이 0 이어야 합니다' };
  try {
    validateTerms({ commissionBp: d.commissionBp, reserveBp: d.reserveBp, liability: d.liability as Liability });
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
  try {
    const out = await asUser(v, async (q): Promise<R> => {
      const a = (await q.query<{ partner_org_id: string }>(`select partner_org_id from fcd.alliance_partners where id = $1`, [d.allianceId]))[0];
      if (!a) return { ok: false, error: '제휴 기록을 찾지 못했습니다' };
      let termsNo = newNo('AT');
      let version = 1;
      if (d.supersedesId) {
        const prev = (await q.query<{ terms_no: string; version: number }>(`select terms_no, version from fcd.v_alliance_terms_current where id = $1 and alliance_id = $2`, [d.supersedesId, d.allianceId]))[0];
        if (!prev) return { ok: false, error: '현재 판이 아닙니다 — 새로 고쳐 보세요' };
        termsNo = prev.terms_no;
        version = prev.version + 1;
      }
      const r = await q.query<{ id: string }>(
        `insert into fcd.alliance_terms (alliance_id, partner_org_id, terms_no, version, supersedes_id, model, commission_bp, reserve_bp, liability, valid_from, valid_until, status, signed_on, note, created_by)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::date,$11::date,$12,$13::date,$14,$15) returning id`,
        [d.allianceId, a.partner_org_id, termsNo, version, d.supersedesId ?? null, d.model, d.commissionBp, d.reserveBp, JSON.stringify(d.liability), d.validFrom, d.validUntil, d.status, d.signedOn ?? null, d.note || null, v.id],
      );
      await audit(q, v.id, a.partner_org_id, 'alliance.terms', `alliance_terms:${r[0].id}`, { termsNo, version, status: d.status, commissionBp: d.commissionBp, reserveBp: d.reserveBp });
      return { ok: true, id: r[0].id };
    });
    if (out.ok) refresh();
    return out;
  } catch {
    return { ok: false, error: '저장하지 못했습니다 — 다른 판이 먼저 올라왔을 수 있습니다' };
  }
}

const Settlement = z.object({
  allianceId: uuid,
  supersedesId: uuid.nullable().optional(),
  periodStart: ymd,
  periodEnd: ymd,
  /** 붙여 넣은 줄(새 명세). 새 판에서 비우면 앞 판의 줄을 그대로 다시 셈한다 */
  text: z.string().max(200_000).optional(),
  status: z.enum(['draft', 'issued', 'void']),
  taxInvoiceNo: z.string().trim().max(60).optional(),
  note: z.string().trim().max(1000).optional(),
});

/** 정산 명세 새 판 — 현재 계약 판(서명함)의 요율로 서버가 다시 셈한다. 기초 준비금 = 앞 기간 명세의 기말 */
export async function addAllianceSettlement(input: z.infer<typeof Settlement>): Promise<R> {
  const v = await requireViewer('admin');
  const p = Settlement.safeParse(input);
  if (!p.success) return { ok: false, error: `${p.error.issues[0].path.join('.')} ${p.error.issues[0].message}` };
  const d = p.data;
  if (d.periodEnd < d.periodStart) return { ok: false, error: '기간 끝이 시작보다 앞섭니다' };
  try {
    const out = await asUser(v, async (q): Promise<R> => {
      const a = (await q.query<{ partner_org_id: string }>(`select partner_org_id from fcd.alliance_partners where id = $1`, [d.allianceId]))[0];
      if (!a) return { ok: false, error: '제휴 기록을 찾지 못했습니다' };
      const terms = (await q.query<{ id: string; commission_bp: number; reserve_bp: number; liability: Liability }>(
        `select id, commission_bp, reserve_bp, liability from fcd.v_alliance_terms_current where alliance_id = $1 and status = 'agreed' order by created_at desc limit 1`,
        [d.allianceId],
      ))[0];
      if (!terms) return { ok: false, error: '서명한 계약 판이 없어 정산 명세를 만들 수 없습니다' };
      let statementNo = newNo('AS');
      let version = 1;
      let opening: number;
      let lines;
      if (d.supersedesId) {
        const prev = (await q.query<{ statement_no: string; version: number; reserve_opening: number; lines: SettlementLine[] }>(
          `select statement_no, version, reserve_opening::float8 reserve_opening, lines from fcd.v_alliance_settlements_current where id = $1 and alliance_id = $2`,
          [d.supersedesId, d.allianceId],
        ))[0];
        if (!prev) return { ok: false, error: '현재 판이 아닙니다 — 새로 고쳐 보세요' };
        statementNo = prev.statement_no;
        version = prev.version + 1;
        opening = prev.reserve_opening;
        lines = d.text?.trim() ? null : linesToInput(prev.lines);
      } else {
        const last = (await q.query<{ reserve_closing: number }>(
          `select reserve_closing::float8 reserve_closing from fcd.v_alliance_settlements_current where alliance_id = $1 and status = 'issued' and period_end < $2::date order by period_end desc, created_at desc limit 1`,
          [d.allianceId, d.periodStart],
        ))[0];
        opening = last?.reserve_closing ?? 0;
        lines = null;
      }
      if (!lines) {
        const parsed = parseSettlementLines(d.text ?? '');
        if (parsed.errors.length) return { ok: false, error: parsed.errors[0] };
        if (!parsed.lines.length) return { ok: false, error: '선적 줄을 한 줄 이상 넣어 주세요' };
        lines = parsed.lines;
      }
      const s = await loadSettings(q);
      const r = settleAlliance(lines, { commissionBp: terms.commission_bp, reserveBp: terms.reserve_bp, liability: terms.liability }, s.vatRateBp, opening);
      const row = await q.query<{ id: string }>(
        `insert into fcd.alliance_settlements (alliance_id, partner_org_id, terms_id, statement_no, version, supersedes_id, period_start, period_end, lines, shipments,
           gross_firm, commission, commission_vat, reserve_in, platform_share, partner_share, seller_share, reserve_opening, reserve_drawn, reserve_shortfall, reserve_closing, net_payable,
           status, tax_invoice_no, note, created_by)
         values ($1,$2,$3,$4,$5,$6,$7::date,$8::date,$9::jsonb,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26) returning id`,
        [
          d.allianceId, a.partner_org_id, terms.id, statementNo, version, d.supersedesId ?? null, d.periodStart, d.periodEnd, JSON.stringify(r.lines), r.count,
          r.grossFirm, r.commission, r.commissionVat, r.reserveIn, r.platformShare, r.partnerShare, r.sellerShare, r.reserveOpening, r.reserveDrawn, r.reserveShortfall, r.reserveClosing, r.netPayable,
          d.status, d.taxInvoiceNo || null, d.note || null, v.id,
        ],
      );
      await audit(q, v.id, a.partner_org_id, 'alliance.settlement', `alliance_settlement:${row[0].id}`, { statementNo, version, netPayable: r.netPayable, status: d.status });
      return { ok: true, id: row[0].id };
    });
    if (out.ok) refresh();
    return out;
  } catch (e) {
    return { ok: false, error: e instanceof RangeError ? e.message : '저장하지 못했습니다 — 다른 판이 먼저 올라왔을 수 있습니다' };
  }
}
