'use server';
/**
 * 쿠팡 WING 연동 행동 — 키 저장·폐기 · 입고 요청 가져오기(흉내·파일·API) · 선적과 짝 확정·풀기 · 바코드 PDF 를 서류함으로.
 * 쓰기 API(입고 요청 만들기 등)는 없다. WING_ENABLED 가 꺼져 있으면 쿠팡을 한 번도 부르지 않는다.
 * 키 값은 응답·로그·오류 문구에 싣지 않는다.
 */
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { asUser, todayKst, type Queryable } from '@/lib/db';
import { env } from '@/lib/env';
import { requireViewer, type Viewer } from '@/lib/server/viewer';
import { coupangFcs, currentConnection, currentMatches, logWing, wingSettings, wingShipments } from '@/lib/server/wing';
import { decryptCredentials, encryptCredentials, kekFingerprint, last4 } from '@/lib/wing/crypto';
import { WingHttpAdapter } from '@/lib/wing/http';
import { inboundChanged, normalizeInboundRow } from '@/lib/wing/import';
import { scorePair } from '@/lib/wing/match';
import { DEMO_WING_SEED, demoWingHints, mockInbounds } from '@/lib/wing/mock';
import { API_KEY_RE, VENDOR_ID_RE } from '@/lib/wing/settings';
import { WingDisabledError, WingHttpError, type WingInbound } from '@/lib/wing/types';
import { uploadDocument } from './docs';

export interface WingResult<T = undefined> {
  ok: boolean;
  error?: string;
  data?: T;
}

const PATH = '/app/integrations/wing';
const done = () => {
  revalidatePath(PATH);
};

// 키 ---------------------------------------------------------------------------------
const KeyInput = z.object({
  method: z.enum(['self_key', 'partner_solution']),
  vendorId: z.string().trim(),
  accessKey: z.string().trim(),
  secretKey: z.string().trim(),
  issuedOn: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional()
    .or(z.literal('')),
});

const NOT_ADMIN = 'WING 키는 조직 관리자만 넣고 거둘 수 있습니다';
const isAdmin = (v: Viewer) => v.org.role === 'shipper_admin';

export async function saveWingKey(input: z.infer<typeof KeyInput>): Promise<WingResult<{ status: 'saved'; enabled: boolean }>> {
  const v = await requireViewer('app');
  if (!isAdmin(v)) return { ok: false, error: NOT_ADMIN };
  const p = KeyInput.safeParse(input);
  if (!p.success) return { ok: false, error: '입력이 올바르지 않습니다' };
  const d = p.data;
  if (!VENDOR_ID_RE.test(d.vendorId)) return { ok: false, error: '업체 코드는 영문·숫자 4~20자입니다(WING 키 발급 화면의 「업체코드」)' };
  if (!API_KEY_RE.test(d.accessKey)) return { ok: false, error: 'Access Key 모양이 아닙니다 — 발급 화면에서 그대로 복사해 주세요' };
  if (!API_KEY_RE.test(d.secretKey)) return { ok: false, error: 'Secret Key 모양이 아닙니다 — 발급 화면에서 그대로 복사해 주세요' };
  if (d.accessKey === d.secretKey) return { ok: false, error: 'Access Key 와 Secret Key 가 같습니다 — 두 칸을 확인해 주세요' };
  const issuedOn = d.issuedOn ? d.issuedOn : null;
  if (issuedOn && issuedOn > todayKst()) return { ok: false, error: '발급일이 오늘보다 뒤입니다' };
  const kek = env.wingKeyEncryptionKey;
  if (!kek) return { ok: false, error: '운영자가 암호화 키를 설정하기 전까지 키를 받지 않습니다(보관하지 않았습니다).' };
  const blob = encryptCredentials({ vendorId: d.vendorId, accessKey: d.accessKey, secretKey: d.secretKey }, v.org.id, kek);
  try {
    await asUser(v, async (q) => {
      const cur = await currentConnection(q, v.org.id);
      const r = await q.query<{ id: string }>(
        `insert into fcd.wing_connections (org_id, version, supersedes_id, method, status, key_blob, kek_id, vendor_last4, access_last4, issued_on, created_by)
         values ($1,$2,$3,$4,'saved',$5,$6,$7,$8,$9::date,$10) returning id`,
        [v.org.id, (cur?.version ?? 0) + 1, cur?.id ?? null, d.method, blob, kekFingerprint(kek), last4(d.vendorId), last4(d.accessKey), issuedOn, v.id],
      );
      await logWing(q, { orgId: v.org.id, actorId: v.id, kind: 'wing_connected', connectionId: r[0].id, detail: { method: d.method, version: (cur?.version ?? 0) + 1, replaced: !!cur?.has_key } });
    });
  } catch {
    return { ok: false, error: '저장하지 못했습니다 — 화면을 새로 고친 뒤 다시 해 주세요(화주 조직만 넣을 수 있습니다)' };
  }
  done();
  return { ok: true, data: { status: 'saved', enabled: env.wingEnabled } };
}

export async function revokeWingKey(): Promise<WingResult> {
  const v = await requireViewer('app');
  if (!isAdmin(v)) return { ok: false, error: NOT_ADMIN };
  const r = await asUser(v, async (q) => {
    const cur = await currentConnection(q, v.org.id);
    if (!cur || !cur.has_key) return { error: '폐기할 키가 없습니다' };
    const n = await q.query<{ id: string }>(
      `insert into fcd.wing_connections (org_id, version, supersedes_id, method, status, key_blob, kek_id, vendor_last4, access_last4, issued_on, created_by)
       values ($1,$2,$3,$4,'revoked',null,null,$5,$6,$7::date,$8) returning id`,
      [v.org.id, cur.version + 1, cur.id, cur.method, cur.vendor_last4, cur.access_last4, cur.issued_on, v.id],
    );
    await logWing(q, { orgId: v.org.id, actorId: v.id, kind: 'key_revoked', connectionId: n[0].id, detail: { version: cur.version + 1 } });
    return { ok: true };
  }).catch(() => ({ error: '폐기하지 못했습니다 — 화면을 새로 고쳐 주세요' }));
  if ('error' in r) return { ok: false, error: r.error };
  done();
  return { ok: true };
}

// 가져오기 --------------------------------------------------------------------------
export interface ImportSummary {
  rows: number;
  created: number;
  updated: number;
  skipped: number;
}

async function storeInbounds(q: Queryable, v: Viewer, source: 'mock' | 'file' | 'api', rows: WingInbound[]): Promise<ImportSummary> {
  const batch = (await q.query<{ id: string }>(`select gen_random_uuid() id`))[0].id;
  const cur = await q.query<{ id: string; version: number; external_no: string; center_name: string | null; fc_code: string | null; planned_on: string | null; sku_count: number | null; units: number | null; boxes: number | null; status_raw: string | null; received_units: number | null; returned_units: number | null }>(
    `select id, version, external_no, center_name, fc_code, planned_on, sku_count, units, boxes, status_raw, received_units, returned_units
       from fcd.v_wing_inbound_current where org_id = $1 and external_no = any($2::text[])`,
    [v.org.id, rows.map((r) => r.externalNo)],
  );
  const byNo = new Map(cur.map((c) => [c.external_no, c]));
  const s: ImportSummary = { rows: rows.length, created: 0, updated: 0, skipped: 0 };
  const seen = new Set<string>();
  for (const x of rows) {
    if (seen.has(x.externalNo)) {
      s.skipped++;
      continue;
    }
    seen.add(x.externalNo);
    const c = byNo.get(x.externalNo);
    if (c) {
      const prev: WingInbound = { externalNo: c.external_no, centerName: c.center_name, fcCode: c.fc_code, plannedOn: c.planned_on, skuCount: c.sku_count, units: c.units, boxes: c.boxes, statusRaw: c.status_raw, receivedUnits: c.received_units, returnedUnits: c.returned_units };
      if (!inboundChanged(prev, x)) {
        s.skipped++;
        continue;
      }
    }
    await q.query(
      `insert into fcd.wing_inbound_requests (org_id, source, batch_id, external_no, center_name, fc_code, planned_on, sku_count, units, boxes, status_raw, received_units, returned_units, version, supersedes_id, created_by)
       values ($1,$2,$3,$4,$5,$6,$7::date,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
      [v.org.id, source, batch, x.externalNo, x.centerName, x.fcCode, x.plannedOn, x.skuCount, x.units, x.boxes, x.statusRaw, x.receivedUnits, x.returnedUnits, (c?.version ?? 0) + 1, c?.id ?? null, v.id],
    );
    if (c) s.updated++;
    else s.created++;
  }
  await logWing(q, { orgId: v.org.id, actorId: v.id, kind: 'wing_imported', detail: { source, batch, ...s } });
  return s;
}

/** 예시 입고 요청 가져오기 — 흉내 어댑터. 데모 조직에서만(실제 셀러의 목록에 가짜가 섞이지 않게) */
export async function importWingMock(): Promise<WingResult<ImportSummary>> {
  const v = await requireViewer('app');
  if (!v.org.is_demo) return { ok: false, error: '예시 가져오기는 데모 계정에서만 됩니다. WING 에서 내려받은 파일을 올려 주세요.' };
  try {
    const s = await asUser(v, async (q) => {
      const ships = await wingShipments(q, v.org.id);
      const fcs = await coupangFcs(q);
      const rows = mockInbounds({
        // 데모 시드(seed/demo/wing.ts)와 같은 씨앗 — 다시 눌러도 같은 번호가 나와 「그대로」로 끝난다(같은 선적에 입고 요청이 두 번 붙지 않게)
        seed: DEMO_WING_SEED,
        fcs,
        today: todayKst(),
        hints: demoWingHints(ships).map((x) => ({ id: x.id, fcCode: x.fc_code, etaFc: x.eta_fc, units: x.units, cartons: x.cartons, stage: x.stage, returnedUnits: x.fc_returned_units })),
        strays: 2,
      });
      return storeInbounds(q, v, 'mock', rows);
    });
    done();
    return { ok: true, data: s };
  } catch {
    return { ok: false, error: '가져오지 못했습니다' };
  }
}

const MAX_FILE_ROWS = 500;

/** WING 에서 내려받은 입고 목록 파일 — 화면(엑셀 올리기)이 칸을 이은 줄을 서버가 다시 검사한다 */
export async function importWingFile(rows: Record<string, unknown>[]): Promise<WingResult<ImportSummary & { errors: { line: number; error: string }[] }>> {
  const v = await requireViewer('app');
  if (!Array.isArray(rows) || rows.length === 0) return { ok: false, error: '올릴 줄이 없습니다' };
  if (rows.length > MAX_FILE_ROWS) return { ok: false, error: `한 번에 ${MAX_FILE_ROWS}줄까지 올릴 수 있습니다` };
  try {
    const r = await asUser(v, async (q) => {
      const fcs = await coupangFcs(q);
      const good: WingInbound[] = [];
      const errors: { line: number; error: string }[] = [];
      rows.forEach((row, i) => {
        const n = normalizeInboundRow(row ?? {}, fcs);
        if (n.ok) good.push(n.value);
        else errors.push({ line: i + 2, error: n.error });
      });
      if (!good.length) return { errors, s: null };
      return { errors, s: await storeInbounds(q, v, 'file', good) };
    });
    if (!r.s) return { ok: false, error: r.errors[0]?.error ?? '올릴 줄이 없습니다' };
    done();
    return { ok: true, data: { ...r.s, errors: r.errors } };
  } catch {
    return { ok: false, error: '올리지 못했습니다 — 화면을 새로 고친 뒤 다시 해 주세요' };
  }
}

/** WING 에서 바로 가져오기 — 스위치가 꺼져 있으면 부르지 않고 「연동 준비 중」 */
export async function syncWingApi(): Promise<WingResult<ImportSummary>> {
  const v = await requireViewer('app');
  if (!env.wingEnabled) {
    await asUser(v, (q) => logWing(q, { orgId: v.org.id, actorId: v.id, kind: 'wing_api_blocked', detail: { reason: 'WING_ENABLED off' } })).catch(() => {});
    return { ok: false, error: '연동 준비 중입니다 — 쿠팡 WING 호출이 아직 꺼져 있습니다. WING 에서 내려받은 파일을 올려 주세요.' };
  }
  if (!isAdmin(v)) return { ok: false, error: '쿠팡에서 바로 가져오기는 조직 관리자만 할 수 있습니다(키를 꺼내야 해서). 파일 올리기는 누구나 됩니다.' };
  const kek = env.wingKeyEncryptionKey;
  try {
    const r = await asUser(v, async (q) => {
      const cur = await currentConnection(q, v.org.id);
      if (!cur || !cur.has_key) return { error: '먼저 WING 키를 넣어 주세요' };
      const blob = (await q.query<{ b: string | null }>(`select fcd.wing_key_blob($1) b`, [cur.id]))[0]?.b;
      if (!blob || !kek) return { error: '키를 꺼내지 못했습니다 — 키를 다시 넣어 주세요' };
      const set = await wingSettings(q);
      const adapter = new WingHttpAdapter({ enabled: env.wingEnabled, credentials: decryptCredentials(blob, v.org.id, kek), rule: set.call });
      const today = todayKst();
      // 키 상태를 새 판으로 쌓는다(고치지 않는다) — 같은 암호문·지문을 그대로 잇는다
      const stack = async (status: 'verified' | 'failed') => {
        const kid = (await q.query<{ kek_id: string | null }>(`select kek_id from fcd.v_wing_connections_current where id = $1`, [cur.id]))[0]?.kek_id ?? kekFingerprint(kek);
        await q.query(
          `insert into fcd.wing_connections (org_id, version, supersedes_id, method, status, key_blob, kek_id, vendor_last4, access_last4, issued_on, created_by)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::date,$11)`,
          [v.org.id, cur.version + 1, cur.id, cur.method, status, blob, kid, cur.vendor_last4, cur.access_last4, cur.issued_on, v.id],
        );
      };
      try {
        const rows = await adapter.listInboundRequests({ from: today, to: today });
        await logWing(q, { orgId: v.org.id, actorId: v.id, kind: 'api_called', connectionId: cur.id, detail: { rows: rows.length } });
        if (cur.status !== 'verified') await stack('verified');
        return { s: await storeInbounds(q, v, 'api', rows) };
      } catch (e) {
        const msg = e instanceof WingDisabledError ? e.message : (e as Error).message;
        const status = e instanceof WingHttpError ? e.status : null;
        await logWing(q, { orgId: v.org.id, actorId: v.id, kind: 'api_failed', connectionId: cur.id, detail: { code: (e as { code?: string }).code ?? 'error', status } });
        // 쿠팡이 키를 받지 않았으면(401·403) 「확인 실패」 판 — 셀러에게 키를 다시 넣으라고 보인다
        if ((status === 401 || status === 403) && cur.status !== 'failed') await stack('failed');
        return { error: msg, refresh: status === 401 || status === 403 };
      }
    });
    if ('error' in r) {
      if ('refresh' in r && r.refresh) done();
      return { ok: false, error: r.error };
    }
    done();
    return { ok: true, data: r.s };
  } catch {
    return { ok: false, error: '가져오지 못했습니다' };
  }
}

// 짝 -----------------------------------------------------------------------------
const MatchInput = z.object({ externalNo: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{2,39}$/), shipmentId: z.string().uuid() });

export async function confirmWingMatch(input: z.infer<typeof MatchInput>): Promise<WingResult> {
  const v = await requireViewer('app');
  const p = MatchInput.safeParse(input);
  if (!p.success) return { ok: false, error: '요청이 올바르지 않습니다' };
  const { externalNo, shipmentId } = p.data;
  const r = await asUser(v, async (q) => {
    const inb = (await q.query<{ id: string; fc_code: string | null; planned_on: string | null; units: number | null; boxes: number | null }>(
      `select id, fc_code, planned_on, units, boxes from fcd.v_wing_inbound_current where org_id = $1 and external_no = $2`,
      [v.org.id, externalNo],
    ))[0];
    const ship = (await wingShipments(q, v.org.id)).find((s) => s.id === shipmentId);
    if (!inb || !ship) return { error: '입고 요청이나 선적을 찾을 수 없습니다 — 화면을 새로 고쳐 주세요' };
    const set = await wingSettings(q);
    // 점수는 화면이 보낸 값을 믿지 않고 서버가 다시 셈한다
    const c = scorePair(
      { id: inb.id, externalNo, fcCode: inb.fc_code, plannedOn: inb.planned_on, units: inb.units, boxes: inb.boxes },
      { id: ship.id, shipmentNo: ship.shipment_no, fcCode: ship.fc_code, etaFc: ship.eta_fc, units: ship.units, cartons: ship.cartons },
      set.match,
    );
    const cur = (await currentMatches(q, v.org.id)).find((m) => m.external_no === externalNo);
    if (cur?.action === 'confirmed' && cur.shipment_id === shipmentId) return { error: '이미 이 선적과 짝입니다' };
    // 같은 규칙(fcd.wing_match_ok)을 먼저 물어 알아듣게 거절한다 — 넣다가 막히면 트랜잭션이 깨진다
    const okRow = (await q.query<{ ok: boolean }>(`select fcd.wing_match_ok($1,$2,$3,$4) ok`, [v.org.id, externalNo, shipmentId, cur?.id ?? null]))[0];
    if (!okRow?.ok) return { error: '이 선적은 다른 입고 요청과 이미 짝입니다(또는 방금 바뀌었습니다). 화면을 새로 고쳐 주세요' };
    await q.query(
      `insert into fcd.wing_matches (org_id, external_no, shipment_id, action, score, reason, supersedes_id, created_by) values ($1,$2,$3,'confirmed',$4,$5::jsonb,$6,$7)`,
      [v.org.id, externalNo, shipmentId, c.score, JSON.stringify(c.reason), cur?.id ?? null, v.id],
    );
    await logWing(q, { orgId: v.org.id, actorId: v.id, kind: 'wing_matched', detail: { externalNo, shipmentId, score: c.score, replaced: !!cur } });
    return { ok: true };
  }).catch(() => ({ error: '짝을 남기지 못했습니다' }));
  if ('error' in r) return { ok: false, error: r.error };
  done();
  revalidatePath(`/app/shipments/${shipmentId}`);
  return { ok: true };
}

export async function unlinkWingMatch(input: { externalNo: string }): Promise<WingResult> {
  const v = await requireViewer('app');
  const p = MatchInput.pick({ externalNo: true }).safeParse(input);
  if (!p.success) return { ok: false, error: '요청이 올바르지 않습니다' };
  const r = await asUser(v, async (q) => {
    const cur = (await currentMatches(q, v.org.id)).find((m) => m.external_no === p.data.externalNo);
    if (!cur || cur.action !== 'confirmed') return { error: '풀 짝이 없습니다' };
    await q.query(`insert into fcd.wing_matches (org_id, external_no, shipment_id, action, supersedes_id, created_by) values ($1,$2,null,'unlinked',$3,$4)`, [
      v.org.id,
      p.data.externalNo,
      cur.id,
      v.id,
    ]);
    await logWing(q, { orgId: v.org.id, actorId: v.id, kind: 'wing_unlinked', detail: { externalNo: p.data.externalNo, shipmentId: cur.shipment_id } });
    return { ok: true };
  }).catch(() => ({ error: '짝을 풀지 못했습니다 — 화면을 새로 고쳐 주세요' }));
  if ('error' in r) return { ok: false, error: r.error };
  done();
  return { ok: true };
}

/** 짝 맞은 입고 요청의 바코드 PDF → 그 선적 서류함의 「쿠팡 바코드 PDF」 칸(서류 올리기를 그대로 쓴다) */
export async function fileWingBarcode(form: FormData): Promise<WingResult> {
  const v = await requireViewer('app');
  const ext = String(form.get('externalNo') ?? '');
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{2,39}$/.test(ext)) return { ok: false, error: '입고 요청을 고르세요' };
  const file = form.get('file');
  if (file instanceof File && file.size > 0 && !/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') return { ok: false, error: '바코드는 PDF 파일로 올려 주세요' };
  const m = await asUser(v, async (q) => (await currentMatches(q, v.org.id)).find((x) => x.external_no === ext && x.action === 'confirmed'));
  if (!m?.shipment_id) return { ok: false, error: '먼저 선적과 짝을 확정해 주세요' };
  const fd = new FormData();
  fd.set('shipmentId', m.shipment_id);
  fd.set('option', 'coupang_barcode:other');
  if (file) fd.set('file', file);
  const r = await uploadDocument(fd);
  if (!r.ok) return r;
  await asUser(v, (q) => logWing(q, { orgId: v.org.id, actorId: v.id, kind: 'wing_barcode_filed', detail: { externalNo: ext, shipmentId: m.shipment_id } })).catch(() => {});
  done();
  return { ok: true };
}
