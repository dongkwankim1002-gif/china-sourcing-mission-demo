'use server';
/**
 * 원스톱 대행형 구역(v2 4차 onestop) — 맡기기 접수·취소(화주), 단계 남기기·새 판(운영).
 * 어느 것도 밖으로 연락하지 않고(메일·문자·외부 API 없음) 돈을 받지 않는다. 스위치 onestop.enabled 가 꺼져 있으면 접수는 「미리보기」로 기록만.
 */
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { asUser, todayKst, type Queryable } from '@/lib/db';
import { requireViewer } from '@/lib/server/viewer';
import { newNo } from '@/lib/server/rate-cards';
import { loadOnestopConfig, orderByRoot, serverQuote, type OnestopOrderInput } from '@/lib/server/onestop';
import { loadSettings } from '@/lib/server/settings';
import { ONESTOP_STAGES, nextStages } from '@/lib/onestop/settings';

interface R {
  ok: boolean;
  error?: string;
  id?: string;
  already?: boolean;
}

async function audit(q: Queryable, actor: string, orgId: string, action: string, target: string, detail: unknown) {
  await q.query(`insert into fcd.audit_log (actor_id, org_id, action, target, detail) values ($1,$2,$3,$4,$5::jsonb)`, [actor, orgId, action, target, JSON.stringify(detail)]);
}

const Cargo = {
  units: z.number().int().min(1, '수량은 1개 이상').max(1_000_000),
  cartons: z.number().int().min(1, '박스는 1개 이상').max(100_000),
  cbm: z.number().gt(0, 'CBM 을 적어 주세요').max(200),
  kg: z.number().gt(0, '무게를 적어 주세요').max(100_000),
};

const NewOrder = z.object({
  productName: z.string().trim().min(2, '상품명을 두 글자 이상 적어 주세요').max(120),
  category: z.string().trim().min(1).max(40),
  sourceUrl: z.union([z.string().trim().max(500).regex(/^https?:\/\/\S+$/, '사입처 링크는 http:// 또는 https:// 로 시작해야 합니다'), z.literal('')]).optional(),
  ...Cargo,
  unitPrice: z.number().gt(0).max(10_000_000).nullable(),
  currency: z.enum(['RMB', 'USD', 'KRW']),
  hub: z.string().regex(/^[A-Z]{3}$/),
  mode: z.enum(['LCL', 'FERRY']),
  fc: z.string().regex(/^FC-[A-Z0-9]{3}$/),
  purchase: z.boolean(),
  barcode: z.boolean(),
  inspection: z.enum(['none', 'basic', 'full']),
  note: z.string().trim().max(600).optional(),
});
export type NewOnestopOrder = z.infer<typeof NewOrder>;

/** 맡기기 — 결제 없음. 스위치가 꺼져 있으면 「접수 기록만 · 대행 계약 전」(preview = true) */
export async function createOnestopOrder(input: NewOnestopOrder): Promise<R> {
  const v = await requireViewer('app');
  const p = NewOrder.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? '주문서를 읽지 못했습니다' };
  const d = p.data;
  if (d.purchase && !d.unitPrice) return { ok: false, error: '사입 대행을 맡기려면 개당 매입가를 적어 주세요(수수료·관부가세 추정에 씁니다)' };
  const out = await asUser(v, async (q): Promise<R> => {
    const s = await loadSettings(q);
    const config = await loadOnestopConfig(q);
    if (!s.dutyRates.some((x) => x.category === d.category)) return { ok: false, error: '분류를 목록에서 골라 주세요' };
    const fc = await q.query(`select 1 from fcd.fc_centers where code = $1 and kind = 'coupang_fc'`, [d.fc]);
    if (!fc.length) return { ok: false, error: '도착 FC 를 목록에서 골라 주세요' };
    const i: OnestopOrderInput = { ...d, unitPrice: d.unitPrice };
    const quote = await serverQuote(q, i, todayKst(), { s, config });
    if (!quote.ok) return { ok: false, error: quote.error };
    const row = await q.query<{ id: string }>(
      `insert into fcd.onestop_orders (order_no, org_id, created_by, version, product_name, category, source_url, units, cartons, cbm, kg, unit_price, currency,
         hub, mode, port, fc_code, purchase, barcode, inspection, quote, total_krw, preview, note)
       values ($1,$2,$3,1,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20::jsonb,$21,$22,$23) returning id`,
      [
        newNo('OS'), v.org.id, v.id, d.productName, d.category, d.sourceUrl || null, d.units, d.cartons, d.cbm, d.kg, d.unitPrice, d.currency,
        d.hub, d.mode, quote.snap.lane.port, d.fc, d.purchase, d.barcode, d.inspection, JSON.stringify(quote.snap), quote.snap.total, !config.on, d.note || null,
      ],
    );
    await audit(q, v.id, v.org.id, 'onestop.order', `onestop_order:${row[0].id}`, { preview: !config.on, total: quote.snap.total });
    return { ok: true, id: row[0].id };
  });
  if (out.ok) {
    revalidatePath('/onestop/orders');
    revalidatePath('/admin/onestop');
    revalidatePath('/app');
  }
  return out;
}

/** 화주가 접수 단계에서 취소 — 새 기록(주문 줄은 고치지 않는다) */
export async function cancelOnestopOrder(input: { orderId: string }): Promise<R> {
  const v = await requireViewer('app');
  const id = z.string().uuid().safeParse(input.orderId);
  if (!id.success) return { ok: false, error: '주문을 읽지 못했습니다' };
  const out = await asUser(v, async (q): Promise<R> => {
    const o = await orderByRoot(q, id.data);
    if (!o || o.org_id !== v.org.id) return { ok: false, error: '주문을 찾지 못했습니다' };
    if (o.stage === 'cancelled') return { ok: true, already: true };
    if (o.stage !== 'received') return { ok: false, error: '사입 대금 확인 뒤에는 운영에 취소를 요청해 주세요' };
    await q.query(`insert into fcd.onestop_order_events (order_id, org_id, stage, note, actor_id) values ($1,$2,'cancelled','화주가 취소',$3)`, [o.root, o.org_id, v.id]);
    await audit(q, v.id, v.org.id, 'onestop.cancel', `onestop_order:${o.root}`, {});
    return { ok: true };
  });
  revalidatePath(`/onestop/orders/${input.orderId}`);
  revalidatePath('/onestop/orders');
  revalidatePath('/admin/onestop');
  return out;
}

// ─── 운영 ─────────────────────────────────────────────────────────────

const Stage = z.object({
  orderId: z.string().uuid(),
  stage: z.enum([...ONESTOP_STAGES, 'cancelled', 'issue'] as [string, ...string[]]),
  note: z.string().trim().max(300).optional(),
  occurredOn: z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.literal('')]).optional(),
});

/** 단계 남기기 — 앞으로만(건너뛰기 가능), 문제는 설명과 함께 언제든, 취소는 출항 전. DB 도 같은 규칙으로 막는다 */
export async function addOnestopStage(input: z.infer<typeof Stage>): Promise<R> {
  const v = await requireViewer('admin');
  const p = Stage.safeParse(input);
  if (!p.success) return { ok: false, error: '요청을 읽지 못했습니다' };
  const d = p.data;
  if (d.stage === 'issue' && !d.note) return { ok: false, error: '문제 기록에는 설명을 적어 주세요' };
  const today = todayKst();
  if (d.occurredOn && d.occurredOn > today) return { ok: false, error: '앞으로의 날짜로는 남길 수 없습니다' };
  const out = await asUser(v, async (q): Promise<R> => {
    const o = await orderByRoot(q, d.orderId);
    if (!o) return { ok: false, error: '주문을 찾지 못했습니다' };
    if (o.stage === 'cancelled') return { ok: false, error: '취소한 주문입니다' };
    if (d.stage !== 'issue' && d.stage !== 'cancelled' && !nextStages(o.stage).includes(d.stage as (typeof ONESTOP_STAGES)[number])) {
      return { ok: false, error: '단계는 앞으로만 남길 수 있습니다' };
    }
    const at = d.occurredOn && d.occurredOn < today ? `${d.occurredOn}T12:00:00+09:00` : new Date().toISOString();
    await q.query('savepoint os_stage');
    try {
      await q.query(`insert into fcd.onestop_order_events (order_id, org_id, stage, note, occurred_at, actor_id) values ($1,$2,$3,$4,$5::timestamptz,$6)`, [
        o.root, o.org_id, d.stage, d.note || null, at, v.id,
      ]);
    } catch {
      await q.query('rollback to savepoint os_stage');
      return { ok: false, error: d.stage === 'cancelled' ? '출항한 뒤에는 취소로 남길 수 없습니다 — 문제로 남겨 주세요' : '이 단계는 남길 수 없습니다' };
    }
    await audit(q, v.id, o.org_id, 'onestop.stage', `onestop_order:${o.root}`, { stage: d.stage });
    return { ok: true };
  });
  revalidatePath(`/admin/onestop`);
  revalidatePath(`/admin/onestop/${d.orderId}`);
  revalidatePath(`/onestop/orders/${d.orderId}`);
  return out;
}

const Revise = z.object({
  orderId: z.string().uuid(),
  ...Cargo,
  measured: z.boolean(),
  shipmentNo: z.string().trim().max(40).optional(),
  changeNote: z.string().trim().min(2, '새 판을 만드는 까닭을 적어 주세요').max(300),
});

/** 주문 새 판 — 중국 창고 실측(박스·CBM·무게)·선적 잇기. 요금은 지금 요금표로 서버가 다시 셈한다. 앞 판은 그대로 남는다 */
export async function reviseOnestopOrder(input: z.infer<typeof Revise>): Promise<R> {
  const v = await requireViewer('admin');
  const p = Revise.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? '요청을 읽지 못했습니다' };
  const d = p.data;
  const out = await asUser(v, async (q): Promise<R> => {
    const o = await orderByRoot(q, d.orderId);
    if (!o) return { ok: false, error: '주문을 찾지 못했습니다' };
    if (o.stage === 'cancelled') return { ok: false, error: '취소한 주문입니다' };
    let shipmentId: string | null = o.shipment_id;
    if (d.shipmentNo) {
      const s = await q.query<{ id: string }>(`select id from fcd.shipments where shipment_no = $1 and shipper_org_id = $2`, [d.shipmentNo, o.org_id]);
      if (!s[0]) return { ok: false, error: '그 화주의 선적 번호가 아닙니다' };
      shipmentId = s[0].id;
    } else if (d.shipmentNo === '') shipmentId = null;
    const quote = await serverQuote(
      q,
      { hub: o.hub, mode: o.mode, fc: o.fc_code, units: d.units, cartons: d.cartons, cbm: d.cbm, kg: d.kg, unitPrice: o.unit_price, currency: o.currency, category: o.category, purchase: o.purchase, barcode: o.barcode, inspection: o.inspection },
      todayKst(),
    );
    if (!quote.ok) return { ok: false, error: quote.error };
    await q.query('savepoint os_revise');
    try {
      await q.query(
        `insert into fcd.onestop_orders (order_no, org_id, created_by, version, root_id, supersedes_id, product_name, category, source_url, units, cartons, cbm, kg, unit_price, currency,
           hub, mode, port, fc_code, purchase, barcode, inspection, quote, total_krw, shipment_id, measured, preview, note, change_note)
         select order_no, org_id, $2, version + 1, coalesce(root_id, id), id, product_name, category, source_url, $3, $4, $5, $6, unit_price, currency,
                hub, mode, port, fc_code, purchase, barcode, inspection, $7::jsonb, $8, $9, $10, preview, note, $11
           from fcd.onestop_orders where id = $1`,
        [o.id, v.id, d.units, d.cartons, d.cbm, d.kg, JSON.stringify(quote.snap), quote.snap.total, shipmentId, d.measured, d.changeNote],
      );
    } catch {
      await q.query('rollback to savepoint os_revise');
      return { ok: false, error: '새 판을 쌓지 못했습니다 — 누가 먼저 바꿨는지 새로고침해 보세요' };
    }
    await audit(q, v.id, o.org_id, 'onestop.revise', `onestop_order:${o.root}`, { version: o.version + 1, measured: d.measured, shipment: shipmentId });
    return { ok: true };
  });
  revalidatePath(`/admin/onestop/${d.orderId}`);
  revalidatePath('/admin/onestop');
  revalidatePath(`/onestop/orders/${d.orderId}`);
  return out;
}
