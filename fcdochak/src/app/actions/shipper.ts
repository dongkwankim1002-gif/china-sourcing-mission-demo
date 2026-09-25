'use server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { asSystem, asUser } from '@/lib/db';
import { requireViewer } from '@/lib/server/viewer';
import { newNo } from '@/lib/server/rate-cards';
import { notifyMany } from '@/lib/server/notify';

export interface ActionResult<T = undefined> {
  ok: boolean;
  error?: string;
  data?: T;
  path?: string;
}

const RequestInput = z.object({
  title: z.string().trim().max(80).optional(),
  hub: z.string().regex(/^[A-Z]{3}$/),
  port: z.enum(['ICN', 'PTK']),
  mode: z.enum(['ANY', 'LCL', 'FERRY', 'FCL', 'AIR']),
  fc: z.string().regex(/^FC-[A-Z]{3}$/),
  units: z.number({ invalid_type_error: '수량을 넣으세요' }).int().min(1, '수량은 1 이상'),
  cartons: z.number({ invalid_type_error: '박스 수를 넣으세요' }).int().min(1, '박스는 1 이상'),
  kg: z.number({ invalid_type_error: '무게를 넣으세요' }).min(0.1, '무게를 넣으세요'),
  cbm: z.number({ invalid_type_error: '부피를 넣으세요' }).min(0.01, '부피를 넣으세요'),
  goods: z.number({ invalid_type_error: '물품가를 넣으세요' }).min(0),
  cur: z.enum(['RMB', 'USD', 'KRW']),
  traits: z.array(z.string()).max(8),
  hsCategory: z.string().max(30).default('general'),
  readyOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '출고 준비일을 고르세요'),
  deadlineHours: z.number().int().min(12, '마감은 12시간 이상').max(240),
  note: z.string().trim().max(500).optional(),
  skuId: z.string().uuid().nullable().optional(),
});
export type RequestInputT = z.infer<typeof RequestInput>;

export async function createRequest(input: RequestInputT): Promise<ActionResult<{ id: string }>> {
  const v = await requireViewer('app');
  const p = RequestInput.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0].message, path: p.error.issues[0].path.join('.') };
  const d = p.data;
  const today = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
  if (d.readyOn < today) return { ok: false, error: '출고 준비일이 지났습니다', path: 'readyOn' };
  const hubName = (await asUser(v, (q) => q.query<{ name_ko: string }>('select name_ko from fcd.hubs where code = $1', [d.hub])))[0]?.name_ko ?? d.hub;
  const title = d.title || `${d.units.toLocaleString('ko-KR')}개 · ${hubName}→${d.port === 'ICN' ? '인천' : '평택'}`;
  const id = await asUser(v, async (q) => {
    const r = await q.query<{ id: string }>(
      `insert into fcd.quote_requests (org_id, req_no, title, sku_id, units, cartons, kg, cbm, goods_value, goods_currency, hs_category, traits,
         origin_hub, port, mode, fc_code, ready_on, bid_deadline, status, note, created_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::text[],$13,$14,$15,$16,$17::date, now() + ($18::int * interval '1 hour'), 'open', $19, $20) returning id`,
      [v.org.id, newNo('RQ'), title, d.skuId ?? null, d.units, d.cartons, d.kg, d.cbm, d.goods, d.cur, d.hsCategory, d.traits, d.hub, d.port, d.mode === 'ANY' ? null : d.mode, d.fc, d.readyOn, d.deadlineHours, d.note || null, v.id],
    );
    await q.query(`insert into fcd.quote_request_events (request_id, kind, detail, actor_id) values ($1,'created','견적 요청을 올렸습니다',$2)`, [r[0].id, v.id]);
    await q.query(`insert into fcd.audit_log (actor_id, org_id, action, target) values ($1,$2,'request.created',$3)`, [v.id, v.org.id, r[0].id]);
    return r[0].id;
  });
  // 이 거점을 맡는 물류사(공식·인증 대기)에 새 요청 알림
  const partners = await asSystem((q) =>
    q.query<{ org_id: string }>(
      `select distinct h.org_id from fcd.org_hubs h join fcd.orgs o on o.id = h.org_id
        where h.hub = $1 and o.kind = 'partner' and o.status in ('official','pending_verification') and o.is_demo = $2`,
      [d.hub, v.org.is_demo],
    ),
  );
  await notifyMany(
    partners.map((x) => ({ orgId: x.org_id, kind: 'system' as const, title: `새 견적 요청 — ${hubName}`, body: `${title} · ${d.cbm} CBM · 마감 ${d.deadlineHours}시간`, link: `/partner/inbox/${id}` })),
  );
  revalidatePath('/app/requests');
  return { ok: true, data: { id } };
}

export async function cancelRequest(id: string): Promise<ActionResult> {
  const v = await requireViewer('app');
  const n = await asUser(v, async (q) => {
    const r = await q.query<{ id: string }>(`update fcd.quote_requests set status = 'cancelled' where id = $1 and org_id = $2 and status = 'open' returning id`, [id, v.org.id]);
    if (r[0]) await q.query(`insert into fcd.quote_request_events (request_id, kind, detail, actor_id) values ($1,'cancelled','요청을 취소했습니다',$2)`, [id, v.id]);
    return r.length;
  });
  if (!n) return { ok: false, error: '이미 마감됐거나 선택한 요청은 취소할 수 없습니다' };
  revalidatePath(`/app/requests/${id}`);
  return { ok: true };
}

/** 응찰을 골라 예약으로 전환 — 예약·선적(1단계)을 만든다. 운송계약은 화주와 물류사가 직접 맺는다. */
export async function selectBid(requestId: string, bidId: string): Promise<ActionResult<{ shipmentId: string }>> {
  const v = await requireViewer('app');
  const res = await asUser(v, async (q) => {
    const r = (await q.query<{ id: string; status: string; req_no: string; title: string; units: number; cartons: number; kg: number; cbm: number; origin_hub: string; port: string; fc_code: string }>(
      `select id, status, req_no, title, units, cartons, kg, cbm, origin_hub, port, fc_code from fcd.quote_requests where id = $1 and org_id = $2`,
      [requestId, v.org.id],
    ))[0];
    if (!r) return { error: '요청을 찾을 수 없습니다' };
    if (r.status !== 'open') return { error: '이미 선택했거나 취소한 요청입니다' };
    const b = (await q.query<{ id: string; org_id: string; mode: string; transit_days_max: number; total: number; valid_until: string; status: string }>(
      `select id, org_id, mode, transit_days_max, total, valid_until, status from fcd.v_bids_current where id = $1 and request_id = $2`,
      [bidId, requestId],
    ))[0];
    if (!b || b.status !== 'submitted') return { error: '이 응찰은 거둬졌거나 새 판으로 바뀌었습니다. 새로 고쳐 주세요.' };
    if (new Date(b.valid_until) < new Date()) return { error: '응찰 유효기간이 지났습니다. 업체에 새 응찰을 요청하세요.' };
    const bk = await q.query<{ id: string }>(
      `insert into fcd.bookings (booking_no, request_id, bid_id, shipper_org_id, partner_org_id, created_by) values ($1,$2,$3,$4,$5,$6) returning id`,
      [newNo('BK'), requestId, bidId, v.org.id, b.org_id, v.id],
    );
    await q.query(`update fcd.quote_requests set status = 'selected' where id = $1`, [requestId]);
    const sh = await q.query<{ id: string; shipment_no: string }>(
      `insert into fcd.shipments (shipment_no, booking_id, shipper_org_id, partner_org_id, origin_hub, port, mode, fc_code, units, cartons, kg, cbm, stage, eta_fc)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,1, ((now() at time zone 'Asia/Seoul')::date + $13::int + 4)) returning id, shipment_no`,
      [newNo('SH'), bk[0].id, v.org.id, b.org_id, r.origin_hub, r.port, b.mode, r.fc_code, r.units, r.cartons, r.kg, r.cbm, b.transit_days_max],
    );
    await q.query(`insert into fcd.shipment_events (shipment_id, stage, raw_status, note, occurred_at, created_by) values ($1,1,null,'화주가 예약으로 전환',now(),$2)`, [sh[0].id, v.id]);
    await q.query(`insert into fcd.quote_request_events (request_id, kind, detail, actor_id) values ($1,'selected','응찰을 골라 예약으로 전환했습니다',$2)`, [requestId, v.id]);
    await q.query(`insert into fcd.audit_log (actor_id, org_id, action, target, detail) values ($1,$2,'booking.created',$3,$4::jsonb)`, [v.id, v.org.id, bk[0].id, JSON.stringify({ bid: bidId, total: b.total })]);
    return { shipmentId: sh[0].id, shipmentNo: sh[0].shipment_no, partner: b.org_id, reqNo: r.req_no };
  });
  if ('error' in res) return { ok: false, error: res.error };
  await notifyMany([{ orgId: res.partner, kind: 'booking', title: `예약 확정 — ${res.reqNo}`, body: `${v.org.name} · 선적 ${res.shipmentNo}`, link: `/partner/shipments/${res.shipmentId}` }]);
  revalidatePath(`/app/requests/${requestId}`);
  return { ok: true, data: { shipmentId: res.shipmentId } };
}

const SkuInput = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1, '상품 이름을 넣으세요').max(80),
  units: z.number({ invalid_type_error: '수량을 넣으세요' }).int().min(1),
  cartons: z.number({ invalid_type_error: '박스 수를 넣으세요' }).int().min(1),
  kg: z.number({ invalid_type_error: '무게를 넣으세요' }).min(0.1),
  cbm: z.number({ invalid_type_error: '부피를 넣으세요' }).min(0.01),
  goods: z.number({ invalid_type_error: '물품가를 넣으세요' }).min(0),
  cur: z.enum(['RMB', 'USD', 'KRW']),
  traits: z.array(z.string()).max(8),
  hsCategory: z.string().max(30),
  targetPrice: z.number().int().min(0).nullable(),
});
export type SkuInputT = z.infer<typeof SkuInput>;

export async function saveSku(input: SkuInputT): Promise<ActionResult<{ id: string }>> {
  const v = await requireViewer('app');
  const p = SkuInput.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0].message, path: p.error.issues[0].path.join('.') };
  const d = p.data;
  const id = await asUser(v, async (q) => {
    if (d.id) {
      await q.query(
        `update fcd.skus set name=$2, units=$3, cartons=$4, kg=$5, cbm=$6, goods_value=$7, goods_currency=$8, traits=$9::text[], hs_category=$10, target_price=$11 where id=$1 and org_id=$12`,
        [d.id, d.name, d.units, d.cartons, d.kg, d.cbm, d.goods, d.cur, d.traits, d.hsCategory, d.targetPrice, v.org.id],
      );
      return d.id;
    }
    const r = await q.query<{ id: string }>(
      `insert into fcd.skus (org_id, name, units, cartons, kg, cbm, goods_value, goods_currency, traits, hs_category, target_price, created_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9::text[],$10,$11,$12) returning id`,
      [v.org.id, d.name, d.units, d.cartons, d.kg, d.cbm, d.goods, d.cur, d.traits, d.hsCategory, d.targetPrice, v.id],
    );
    return r[0].id;
  });
  revalidatePath('/app/skus');
  return { ok: true, data: { id } };
}

/** 보관(숨김) — 지우지 않는다. 되돌리기로 다시 꺼낼 수 있다. */
export async function setSkuArchived(ids: string[], archived: boolean): Promise<ActionResult> {
  const v = await requireViewer('app');
  await asUser(v, (q) => q.query(`update fcd.skus set archived = $2 where id = any($1::uuid[]) and org_id = $3`, [ids, archived, v.org.id]));
  revalidatePath('/app/skus');
  return { ok: true };
}

const ReviewInput = z.object({
  shipmentId: z.string().uuid(),
  rating: z.number().int().min(1).max(5),
  onTimeOk: z.boolean(),
  billingOk: z.boolean(),
  body: z.string().trim().min(10, '열 글자 이상 적어 주세요').max(600),
});

export async function submitReview(input: z.infer<typeof ReviewInput>): Promise<ActionResult> {
  const v = await requireViewer('app');
  const p = ReviewInput.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0].message };
  const d = p.data;
  const r = await asUser(v, async (q) => {
    const s = (await q.query<{ stage: number; partner_org_id: string; origin_hub: string; port: string; outcome: string | null }>(`select stage, partner_org_id, origin_hub, port, fcd.shipment_outcome(id) outcome from fcd.shipments where id = $1 and shipper_org_id = $2`, [d.shipmentId, v.org.id]))[0];
    if (!s) return { error: '선적을 찾을 수 없습니다' };
    // v2 trust — FC 입고(회송 포함)뿐 아니라 입고 반려·분실(미도착)로 끝난 선적도 평가한다. 끝은 선적 기록에서 읽는다.
    if (!s.outcome) return { error: 'FC 입고가 끝나거나, 입고 반려·분실(미도착)로 끝난 선적만 평가할 수 있습니다' };
    const hub = (await q.query<{ name_ko: string }>('select name_ko from fcd.hubs where code = $1', [s.origin_hub]))[0]?.name_ko ?? s.origin_hub;
    await q.query(
      `insert into fcd.reviews (shipment_id, shipper_org_id, partner_org_id, rating, on_time_ok, billing_ok, body, author_label, created_by, outcome) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [d.shipmentId, v.org.id, s.partner_org_id, d.rating, d.onTimeOk, d.billingOk, d.body, `화주 · ${hub}→${s.port === 'ICN' ? '인천' : '평택'}`, v.id, s.outcome],
    );
    return { partner: s.partner_org_id };
  }).catch(() => ({ error: '이미 평가한 선적입니다' }));
  if ('error' in r) return { ok: false, error: r.error };
  await notifyMany([{ orgId: r.partner, kind: 'status', title: '새 평가가 올라왔습니다', body: `${d.rating}/5`, link: `/partner/shipments/${d.shipmentId}` }]);
  revalidatePath(`/app/shipments/${d.shipmentId}`);
  return { ok: true };
}

export async function reportBilling(shipmentId: string, note: string): Promise<ActionResult> {
  const v = await requireViewer('app');
  if (note.trim().length < 5) return { ok: false, error: '무엇이 다른지 다섯 글자 이상 적어 주세요' };
  const s = await asUser(v, async (q) => {
    const x = (await q.query<{ partner_org_id: string; shipment_no: string }>(`select partner_org_id, shipment_no from fcd.shipments where id = $1 and shipper_org_id = $2`, [shipmentId, v.org.id]))[0];
    if (!x) return null;
    await q.query(`insert into fcd.exceptions (shipment_id, kind, note, created_by) values ($1,'billing_deviation',$2,$3)`, [shipmentId, note.trim(), v.id]);
    return x;
  });
  if (!s) return { ok: false, error: '선적을 찾을 수 없습니다' };
  await notifyMany([{ orgId: s.partner_org_id, kind: 'exception', title: `청구 확인 요청 — ${s.shipment_no}`, body: note.trim(), link: `/partner/shipments/${shipmentId}` }]);
  revalidatePath(`/app/shipments/${shipmentId}`);
  return { ok: true };
}

/** SKU 여러 줄 올리기(엑셀) */
export async function importSkus(rows: { name: string; units: number; cartons: number; kg: number; cbm: number; goods: number; cur: string; hs: string | null; price: number | null }[]): Promise<ActionResult<{ created: number }>> {
  const v = await requireViewer('app');
  if (rows.length === 0 || rows.length > 500) return { ok: false, error: '한 번에 1~500줄까지 올릴 수 있습니다' };
  const cur = (c: string) => (['RMB', 'USD', 'KRW'].includes(c?.toUpperCase?.()) ? c.toUpperCase() : 'RMB');
  await asUser(v, async (q) => {
    for (const r of rows) {
      await q.query(
        `insert into fcd.skus (org_id, name, units, cartons, kg, cbm, goods_value, goods_currency, hs_category, target_price, created_by) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [v.org.id, String(r.name).slice(0, 80), Math.round(r.units), Math.round(r.cartons), r.kg, r.cbm, r.goods, cur(r.cur), r.hs || 'general', r.price ? Math.round(r.price) : null, v.id],
      );
    }
  });
  revalidatePath('/app/skus');
  return { ok: true, data: { created: rows.length } };
}
