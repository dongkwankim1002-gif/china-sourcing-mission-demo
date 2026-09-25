'use server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { asUser, todayKst } from '@/lib/db';
import { requireViewer } from '@/lib/server/viewer';
import { loadSettings } from '@/lib/server/settings';
import { autoQuote } from '@/lib/server/partner';
import { REQUEST_SELECT, type RequestRow } from '@/lib/server/shipper';
import { insertRateCard, newNo, reviseRateCard } from '@/lib/server/rate-cards';
import { notifyMany } from '@/lib/server/notify';
import { recordEvent } from '@/lib/server/events';
import { RateCardInput, type RateCardInputT } from '@/lib/schemas';
import { SEGMENTS, sumAmounts, type Certainty } from '@/lib/money';
import { STAGES } from '@/lib/terms';

export interface Result<T = undefined> {
  ok: boolean;
  error?: string;
  data?: T;
  issues?: { path: (string | number)[]; message: string }[];
}

const BidInput = z.object({
  requestId: z.string().uuid(),
  kind: z.enum(['auto', 'adjusted']),
  amounts: z.record(z.string(), z.number().int().min(0).max(1_000_000_000).nullable()).optional(),
  validDays: z.number().int().min(1).max(30),
  note: z.string().trim().max(300).optional(),
});

/** 응찰 — 자동이면 서버가 요금표로 다시 계산한다(화면 값을 믿지 않는다). 다시 응찰하면 새 판. */
export async function submitBid(input: z.infer<typeof BidInput>): Promise<Result<{ id: string }>> {
  const v = await requireViewer('partner');
  const p = BidInput.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0].message };
  const d = p.data;
  const today = todayKst();
  const res = await asUser(v, async (q) => {
    const r = (await q.query<RequestRow>(`${REQUEST_SELECT} where id = $1`, [d.requestId]))[0];
    if (!r) return { error: '요청을 찾을 수 없습니다' };
    if (!['waiting', 'bidding', 'closing_soon'].includes(r.display_status)) return { error: '응찰이 마감된 요청입니다' };
    const s = await loadSettings(q);
    const auto = await autoQuote(q, v.org.id, r, s, today);
    if (!auto) return { error: '이 구간(출발·도착항·방식)에 유효한 내 요금표가 없습니다. 요금표를 먼저 추가하세요.' };
    const caps = (await q.query<{ trait: string }>('select trait from fcd.org_capabilities where org_id = $1', [v.org.id])).map((x) => x.trait);
    const rules = await q.query<{ code: string; name_ko: string; needs_capability: boolean; blocked_modes: string[] }>('select code, name_ko, needs_capability, blocked_modes from fcd.cargo_traits');
    for (const t of r.traits) {
      const rule = rules.find((x) => x.code === t);
      if (!rule) continue;
      if (rule.blocked_modes.includes(auto.mode)) return { error: `${rule.name_ko} 화물은 이 방식으로 보낼 수 없어 응찰할 수 없습니다` };
      if (rule.needs_capability && !caps.includes(t)) return { error: `${rule.name_ko} 취급 등록이 없어 응찰할 수 없습니다. 회사 프로필에서 취급 능력을 등록하세요.` };
    }
    const amounts: Record<string, number | null> = {};
    const certs: Record<string, Certainty | null> = {};
    for (const seg of auto.quote.segments) {
      let a = seg.amount;
      let c = seg.certainty;
      if (d.kind === 'adjusted' && d.amounts && seg.segment in d.amounts) {
        a = d.amounts[seg.segment] ?? null;
        if (a != null && c == null) c = 'estimated';
      }
      amounts[seg.segment] = a;
      certs[seg.segment] = a == null ? null : c;
    }
    const total = sumAmounts(amounts);
    if (total <= 0) return { error: '응찰 금액이 0원입니다' };
    const confirmed = SEGMENTS.reduce((t, sg) => t + (certs[sg] === 'confirmed' ? (amounts[sg] ?? 0) : 0), 0);
    const prev = (await q.query<{ id: string; bid_no: string; version: number }>(`select id, bid_no, version from fcd.v_bids_current where request_id = $1 and org_id = $2`, [d.requestId, v.org.id]))[0];
    const row = await q.query<{ id: string }>(
      `insert into fcd.bids (request_id, org_id, bid_no, version, supersedes_id, rate_card_id, kind, mode, amounts, certainties, total, confirmed_total,
         transit_days_min, transit_days_max, valid_until, status, note, created_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11,$12,$13,$14, now() + ($15::int * interval '1 day'), 'submitted', $16, $17) returning id`,
      [d.requestId, v.org.id, prev?.bid_no ?? newNo('BD'), prev ? prev.version + 1 : 1, prev?.id ?? null, auto.cardId, d.kind, auto.mode, JSON.stringify(amounts), JSON.stringify(certs), total, confirmed, auto.transit[0], auto.transit[1], d.validDays, d.note || null, v.id],
    );
    await q.query(`insert into fcd.quote_request_events (request_id, kind, detail, actor_id) values ($1,'bid',$2,$3)`, [d.requestId, `${v.org.name} ${prev ? '새 판 응찰' : '응찰'}`, v.id]);
    return { id: row[0].id, shipperOrg: r.org_id, reqNo: r.req_no, total };
  });
  if ('error' in res) return { ok: false, error: res.error };
  await recordEvent(v.id, { orgId: v.org.id, sellerOrgId: res.shipperOrg, kind: 'bid_submitted', targetKind: 'quote_request', targetId: d.requestId, detail: { bidId: res.id } });
  await notifyMany([{ orgId: res.shipperOrg, kind: 'bid_arrived', title: `응찰 도착 — ${res.reqNo}`, body: `${v.org.name}: ${res.total.toLocaleString('ko-KR')}원`, link: `/app/requests/${input.requestId}` }]);
  revalidatePath(`/partner/inbox/${input.requestId}`);
  return { ok: true, data: { id: res.id } };
}

export async function withdrawBid(requestId: string): Promise<Result> {
  const v = await requireViewer('partner');
  const r = await asUser(v, async (q) => {
    const prev = (await q.query<{ id: string; bid_no: string; version: number; status: string }>(`select id, bid_no, version, status from fcd.v_bids_current where request_id = $1 and org_id = $2`, [requestId, v.org.id]))[0];
    if (!prev || prev.status !== 'submitted') return false;
    await q.query(
      `insert into fcd.bids (request_id, org_id, bid_no, version, supersedes_id, rate_card_id, kind, mode, amounts, certainties, total, confirmed_total, transit_days_min, transit_days_max, valid_until, status, note, created_by)
       select request_id, org_id, bid_no, version + 1, id, rate_card_id, kind, mode, amounts, certainties, total, confirmed_total, transit_days_min, transit_days_max, valid_until, 'withdrawn', '업체가 거둠', $2
         from fcd.bids where id = $1`,
      [prev.id, v.id],
    );
    return true;
  });
  if (!r) return { ok: false, error: '거둘 응찰이 없습니다' };
  revalidatePath(`/partner/inbox/${requestId}`);
  return { ok: true };
}

export async function addRateCard(input: RateCardInputT): Promise<Result<{ id: string }>> {
  const v = await requireViewer('partner');
  const p = RateCardInput.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0].message, issues: p.error.issues.map((i) => ({ path: i.path, message: i.message })) };
  const id = await asUser(v, async (q) => {
    const id = await insertRateCard(q, v.org.id, p.data, v.id);
    await q.query(`insert into fcd.audit_log (actor_id, org_id, action, target) values ($1,$2,'rate_card.created',$3)`, [v.id, v.org.id, id]);
    return id;
  });
  revalidatePath('/partner/rates');
  return { ok: true, data: { id } };
}

/** 엑셀로 여러 장 — 카드마다 9구간이 모두 있어야 한다(포함/제외 필수) */
export async function importRateCards(cards: RateCardInputT[]): Promise<Result<{ created: number }>> {
  const v = await requireViewer('partner');
  if (cards.length === 0 || cards.length > 100) return { ok: false, error: '한 번에 1~100장까지 올릴 수 있습니다' };
  for (let i = 0; i < cards.length; i++) {
    const p = RateCardInput.safeParse(cards[i]);
    if (!p.success) return { ok: false, error: `${i + 1}번째 요금표: ${p.error.issues[0].message}` };
  }
  await asUser(v, async (q) => {
    for (const c of cards) await insertRateCard(q, v.org.id, c, v.id, null, '엑셀 올리기');
    await q.query(`insert into fcd.audit_log (actor_id, org_id, action, target, detail) values ($1,$2,'rate_card.imported','excel',$3::jsonb)`, [v.id, v.org.id, JSON.stringify({ n: cards.length })]);
  });
  revalidatePath('/partner/rates');
  return { ok: true, data: { created: cards.length } };
}

export async function reviseCards(ids: string[], change: { kind: 'extend'; validTo: string } | { kind: 'expire' } | { kind: 'withdraw' }): Promise<Result<{ n: number }>> {
  const v = await requireViewer('partner');
  const today = todayKst();
  if (change.kind === 'extend' && !/^\d{4}-\d{2}-\d{2}$/.test(change.validTo)) return { ok: false, error: '새 끝나는 날을 고르세요' };
  if (change.kind === 'extend' && change.validTo < today) return { ok: false, error: '끝나는 날이 오늘보다 앞입니다' };
  const yesterday = new Date(Date.parse(today) - 86400_000).toISOString().slice(0, 10);
  const n = await asUser(v, async (q) => {
    let n = 0;
    for (const id of ids) {
      const own = await q.query<{ id: string }>(`select id from fcd.v_rate_cards_current where id = $1 and org_id = $2`, [id, v.org.id]);
      if (!own[0]) continue;
      await reviseRateCard(
        q,
        id,
        v.id,
        change.kind === 'extend'
          ? { validTo: change.validTo, note: `유효기간 연장 → ${change.validTo}` }
          : change.kind === 'expire'
            ? { validTo: yesterday, note: '지금 만료' }
            : { status: 'withdrawn', note: '업체가 거둠' },
      );
      n++;
    }
    return n;
  });
  revalidatePath('/partner/rates');
  return { ok: true, data: { n } };
}

const StageInput = z.object({
  shipmentId: z.string().uuid(),
  stage: z.number().int().min(1).max(9),
  raw: z.string().trim().max(60).optional(),
  note: z.string().trim().max(300).optional(),
  occurredAt: z.string().min(10),
  returned: z.number().int().min(0).optional(),
});

export async function updateStage(input: z.infer<typeof StageInput>): Promise<Result> {
  const v = await requireViewer('partner');
  const p = StageInput.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0].message };
  const d = p.data;
  const at = new Date(d.occurredAt);
  if (Number.isNaN(at.getTime())) return { ok: false, error: '일시가 올바르지 않습니다' };
  if (at.getTime() > Date.now() + 10 * 60_000) return { ok: false, error: '앞날의 일시는 넣을 수 없습니다' };
  const r = await asUser(v, async (q) => {
    const s = (await q.query<{ stage: number; shipper_org_id: string; shipment_no: string; units: number }>(`select stage, shipper_org_id, shipment_no, units from fcd.shipments where id = $1 and partner_org_id = $2`, [d.shipmentId, v.org.id]))[0];
    if (!s) return { error: '선적을 찾을 수 없습니다' };
    if (d.stage < s.stage) return { error: `지금 ${s.stage}단계입니다. 단계를 되돌릴 수 없습니다` };
    if (d.returned != null && d.returned > s.units) return { error: '회송 수량이 선적 수량보다 많습니다' };
    await q.query(`insert into fcd.shipment_events (shipment_id, stage, raw_status, note, occurred_at, created_by) values ($1,$2,$3,$4,$5,$6)`, [d.shipmentId, d.stage, d.raw || null, d.note || null, at.toISOString(), v.id]);
    await q.query(
      `update fcd.shipments set stage = $2::int, delivered_at = case when $2::int = 9 then coalesce(delivered_at, $3::timestamptz) else delivered_at end,
              fc_returned_units = coalesce($4::int, fc_returned_units) where id = $1`,
      [d.shipmentId, d.stage, at.toISOString(), d.stage === 9 ? (d.returned ?? 0) : null],
    );
    if (d.stage === 9 && d.returned) {
      await q.query(`insert into fcd.exceptions (shipment_id, kind, note, created_by) values ($1,'fc_rejected',$2,$3)`, [d.shipmentId, `FC 입고 반려 ${d.returned}개 — ${d.note || '사유 확인 중'}`, v.id]);
    }
    return s;
  });
  if ('error' in r) return { ok: false, error: r.error };
  const ev = { orgId: v.org.id, sellerOrgId: r.shipper_org_id, targetKind: 'shipment' as const, targetId: d.shipmentId };
  if (r.stage < 5 && d.stage >= 5) await recordEvent(v.id, { ...ev, kind: 'shipped' });
  if (r.stage < 9 && d.stage === 9) await recordEvent(v.id, { ...ev, kind: 'fc_inbound' });
  if (d.stage === 9 && d.returned) await recordEvent(v.id, { ...ev, kind: 'returned', detail: { units: d.returned } });
  await notifyMany([{ orgId: r.shipper_org_id, kind: d.returned ? 'exception' : 'status', title: `${d.stage === 9 ? 'FC 입고 완료' : '상태 갱신'} — ${r.shipment_no}`, body: `${d.stage}. ${STAGES[d.stage]}${d.raw ? ` (${d.raw})` : ''}`, link: `/app/shipments/${d.shipmentId}` }]);
  revalidatePath(`/partner/shipments/${d.shipmentId}`);
  return { ok: true };
}

const ExInput = z.object({
  shipmentId: z.string().uuid(),
  kind: z.enum(['customs_hold', 'inspection', 'fc_rejected', 'ferry_cancelled', 'billing_deviation']),
  note: z.string().trim().min(5, '무슨 일인지 다섯 글자 이상 적어 주세요').max(300),
});

export async function openException(input: z.infer<typeof ExInput>): Promise<Result> {
  const v = await requireViewer('partner');
  const p = ExInput.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0].message };
  const s = await asUser(v, async (q) => {
    const x = (await q.query<{ shipper_org_id: string; shipment_no: string }>(`select shipper_org_id, shipment_no from fcd.shipments where id = $1 and partner_org_id = $2`, [p.data.shipmentId, v.org.id]))[0];
    if (!x) return null;
    await q.query(`insert into fcd.exceptions (shipment_id, kind, note, created_by) values ($1,$2,$3,$4)`, [p.data.shipmentId, p.data.kind, p.data.note, v.id]);
    return x;
  });
  if (!s) return { ok: false, error: '선적을 찾을 수 없습니다' };
  await notifyMany([{ orgId: s.shipper_org_id, kind: 'exception', title: `예외 발생 — ${s.shipment_no}`, body: p.data.note, link: `/app/shipments/${p.data.shipmentId}` }]);
  revalidatePath(`/partner/shipments/${p.data.shipmentId}`);
  return { ok: true };
}

export async function resolveException(id: string, shipmentId: string, resolution: string): Promise<Result> {
  const v = await requireViewer('partner');
  if (resolution.trim().length < 2) return { ok: false, error: '어떻게 해결했는지 적어 주세요' };
  const s = await asUser(v, async (q) => {
    const x = (await q.query<{ shipper_org_id: string; shipment_no: string }>(`select s.shipper_org_id, s.shipment_no from fcd.exceptions e join fcd.shipments s on s.id = e.shipment_id where e.id = $1 and s.partner_org_id = $2 and e.resolved_at is null`, [id, v.org.id]))[0];
    if (!x) return null;
    await q.query(`update fcd.exceptions set resolved_at = now(), resolution = $2 where id = $1`, [id, resolution.trim()]);
    return x;
  });
  if (!s) return { ok: false, error: '이미 해결됐거나 찾을 수 없습니다' };
  await notifyMany([{ orgId: s.shipper_org_id, kind: 'status', title: `예외 해결 — ${s.shipment_no}`, body: resolution.trim(), link: `/app/shipments/${shipmentId}` }]);
  revalidatePath(`/partner/shipments/${shipmentId}`);
  return { ok: true };
}

const InvInput = z.object({
  shipmentId: z.string().uuid(),
  amounts: z.record(z.string(), z.number().int().min(0).max(1_000_000_000).nullable()),
  issuedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  note: z.string().trim().max(300).optional(),
});

/** 청구서 — 고치지 않고 새 판. 응찰 대비 5% 넘으면 「청구 편차」 예외를 연다. */
export async function addInvoice(input: z.infer<typeof InvInput>): Promise<Result> {
  const v = await requireViewer('partner');
  const p = InvInput.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0].message };
  const d = p.data;
  const amounts = Object.fromEntries(SEGMENTS.map((s) => [s, d.amounts[s] ?? null]));
  const total = sumAmounts(amounts);
  if (total <= 0) return { ok: false, error: '청구 금액이 0원입니다' };
  const r = await asUser(v, async (q) => {
    const s = (await q.query<{ shipper_org_id: string; shipment_no: string; bid_total: number }>(
      `select s.shipper_org_id, s.shipment_no, bd.total bid_total from fcd.shipments s join fcd.bookings b on b.id = s.booking_id join fcd.bids bd on bd.id = b.bid_id where s.id = $1 and s.partner_org_id = $2`,
      [d.shipmentId, v.org.id],
    ))[0];
    if (!s) return { error: '선적을 찾을 수 없습니다' };
    const prev = (await q.query<{ id: string; invoice_no: string; version: number }>(`select id, invoice_no, version from fcd.v_invoices_current where shipment_id = $1`, [d.shipmentId]))[0];
    await q.query(
      `insert into fcd.invoices (invoice_no, version, supersedes_id, shipment_id, partner_org_id, amounts, total, note, issued_on, created_by) values ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9::date,$10)`,
      [prev?.invoice_no ?? newNo('IV'), prev ? prev.version + 1 : 1, prev?.id ?? null, d.shipmentId, v.org.id, JSON.stringify(amounts), total, d.note || (prev ? '정정' : null), d.issuedOn, v.id],
    );
    const dev = (total - s.bid_total) / s.bid_total;
    if (Math.abs(dev) >= 0.05) {
      await q.query(`insert into fcd.exceptions (shipment_id, kind, note, created_by) values ($1,'billing_deviation',$2,$3)`, [d.shipmentId, `청구 금액이 응찰 대비 ${(dev * 100).toFixed(1)}% ${dev > 0 ? '높음' : '낮음'} — 근거 확인 필요`, v.id]);
    }
    return { ...s, dev };
  });
  if ('error' in r) return { ok: false, error: r.error };
  await recordEvent(v.id, { orgId: v.org.id, sellerOrgId: r.shipper_org_id, kind: 'invoiced', targetKind: 'shipment', targetId: d.shipmentId }); // 금액은 이벤트에 복사하지 않는다(지표가 청구서에서 읽는다)
  await notifyMany([{ orgId: r.shipper_org_id, kind: 'invoice_arrived', title: `청구서 도착 — ${r.shipment_no}`, body: `${v.org.name} · ${total.toLocaleString('ko-KR')}원 (응찰 대비 ${(r.dev * 100).toFixed(1)}%)`, link: `/app/shipments/${d.shipmentId}?tab=billing` }]);
  revalidatePath(`/partner/shipments/${d.shipmentId}`);
  return { ok: true };
}

const ProfileInput = z.object({
  intro: z.string().trim().max(600).optional(),
  website: z.string().trim().max(120).optional(),
  phone: z.string().trim().max(30).optional(),
  address: z.string().trim().max(120).optional(),
  insurance: z.string().trim().max(80).optional(),
  licenseNo: z.string().trim().max(60).optional(),
  locale: z.enum(['ko', 'zh']),
  hubs: z.array(z.string()).min(1, '거점을 하나 이상'),
  modes: z.array(z.string()).min(1, '운송 방식을 하나 이상'),
  caps: z.array(z.string()),
});

export async function savePartnerProfile(input: z.infer<typeof ProfileInput>): Promise<Result> {
  const v = await requireViewer('partner');
  const p = ProfileInput.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0].message };
  const d = p.data;
  if (d.website && !/^https?:\/\//.test(d.website)) return { ok: false, error: '누리집은 http:// 또는 https:// 로 시작해야 합니다' };
  const ok = await asUser(v, async (q) => {
    const r = await q.query<{ id: string }>(
      `update fcd.orgs set intro = $2, website = $3, phone = $4, address = $5, cargo_insurance = $6, license_no = $7, default_locale = $8 where id = $1 returning id`,
      [v.org.id, d.intro || null, d.website || null, d.phone || null, d.address || null, d.insurance || null, d.licenseNo || null, d.locale],
    );
    if (!r.length) return false;
    for (const [table, col, vals] of [['org_hubs', 'hub', d.hubs], ['org_modes', 'mode', d.modes], ['org_capabilities', 'trait', d.caps]] as const) {
      await q.query(`delete from fcd.${table} where org_id = $1 and not (${col} = any($2::text[]))`, [v.org.id, vals]);
      for (const x of vals) await q.query(`insert into fcd.${table} (org_id, ${col}) values ($1,$2) on conflict do nothing`, [v.org.id, x]);
    }
    await q.query(`insert into fcd.audit_log (actor_id, org_id, action, target) values ($1,$2,'org.profile_updated','partner')`, [v.id, v.org.id]);
    return true;
  });
  if (!ok) return { ok: false, error: '회사 프로필은 관리자만 고칠 수 있습니다' };
  revalidatePath('/partner/profile');
  return { ok: true };
}

