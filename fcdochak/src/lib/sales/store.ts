/**
 * 판매 자료 쌓기(v2 3차 sales) — 데모 시드와 「동기화」 행동이 같이 쓴다. 고치지 않고 쌓는다:
 *  · 상품·주문·반품: 번호가 처음이면 1판, 바뀌었으면 다음 판(supersedes_id), 같으면 건너뜀
 *  · 재고 스냅숏: (상품·날짜)의 마지막 값과 다를 때만 한 줄
 *  · 끝에 동기화 기록 한 줄
 * RLS 안(asUser)에서 부르면 그 조직 정책을 그대로 탄다. 데모 시드는 소유자 권한으로 부른다.
 */
import type { Queryable } from '../db/driver';
import type { SalesDataset } from './types';

export interface StoreSummary {
  products: number;
  orders: number;
  inventory: number;
  returns: number;
  skipped: number;
}

async function insertMany(q: Queryable, table: string, cols: string[], rows: unknown[][]) {
  if (!rows.length) return;
  const names = cols.map((c) => c.split('::')[0]);
  const casts = cols.map((c) => (c.includes('::') ? `::${c.split('::')[1]}` : ''));
  const per = Math.max(1, Math.floor(8000 / cols.length));
  for (let i = 0; i < rows.length; i += per) {
    const params: unknown[] = [];
    const values = rows
      .slice(i, i + per)
      .map((r) => `(${r.map((v, j) => (params.push(v), `$${params.length}${casts[j]}`)).join(',')})`)
      .join(',');
    await q.query(`insert into fcd.${table} (${names.join(',')}) values ${values}`, params);
  }
}

export async function storeSalesDataset(
  q: Queryable,
  o: { orgId: string; userId: string; source: 'mock' | 'file' | 'api'; ds: SalesDataset; at?: string; range?: { from: string; to: string } | null },
): Promise<StoreSummary> {
  const batch = (await q.query<{ id: string }>(`select gen_random_uuid() id`))[0].id;
  const at = o.at ?? new Date().toISOString();
  const s: StoreSummary = { products: 0, orders: 0, inventory: 0, returns: 0, skipped: 0 };

  // 상품
  const curP = new Map(
    (
      await q.query<{ id: string; version: number; external_id: string; name: string; option_name: string | null; list_price: number | null; sku_id: string | null }>(
        `select id, version, external_id, name, option_name, list_price, sku_id from fcd.v_sales_products_current where org_id = $1`,
        [o.orgId],
      )
    ).map((r) => [r.external_id, r]),
  );
  const pRows: unknown[][] = [];
  for (const p of o.ds.products) {
    const c = curP.get(p.ext);
    // 가져온 자료에 SKU 연결이 없으면 앞 판의 연결을 잇는다(사람이 이은 것을 지우지 않는다)
    const sku = p.skuId ?? c?.sku_id ?? null;
    if (c && c.name === p.name && c.option_name === p.optionName && Number(c.list_price ?? -1) === (p.listPrice ?? -1) && (c.sku_id ?? null) === sku) {
      s.skipped++;
      continue;
    }
    pRows.push([o.orgId, o.source, batch, p.ext, p.name, p.optionName, p.listPrice, sku, (c?.version ?? 0) + 1, c?.id ?? null, o.userId, at]);
    s.products++;
  }
  await insertMany(q, 'sales_products', ['org_id', 'source', 'batch_id', 'external_id', 'name', 'option_name', 'list_price', 'sku_id', 'version', 'supersedes_id', 'created_by', 'created_at::timestamptz'], pRows);

  // 주문
  const curO = new Map(
    (
      await q.query<{ id: string; version: number; external_id: string; units: number; amount: string | number; order_count: number; cancelled: boolean; ordered_on: string }>(
        `select id, version, external_id, units, amount, order_count, cancelled, ordered_on::text ordered_on from fcd.v_sales_orders_current where org_id = $1`,
        [o.orgId],
      )
    ).map((r) => [r.external_id, r]),
  );
  const oRows: unknown[][] = [];
  for (const x of o.ds.orders) {
    const c = curO.get(x.ext);
    if (c && Number(c.units) === x.units && Number(c.amount) === x.amount && Number(c.order_count) === x.orders && c.cancelled === x.cancelled && c.ordered_on === x.on) {
      s.skipped++;
      continue;
    }
    oRows.push([o.orgId, o.source, batch, x.ext, x.productExt, x.on, x.units, x.amount, x.orders, x.cancelled, (c?.version ?? 0) + 1, c?.id ?? null, o.userId, at]);
    s.orders++;
  }
  await insertMany(q, 'sales_orders', ['org_id', 'source', 'batch_id', 'external_id', 'product_ext', 'ordered_on::date', 'units', 'amount', 'order_count', 'cancelled', 'version', 'supersedes_id', 'created_by', 'created_at::timestamptz'], oRows);

  // 재고 스냅숏 — 같은 (상품·날짜)의 마지막 값과 같으면 건너뜀
  const curI = new Map(
    (await q.query<{ product_ext: string; snap_on: string; on_hand: number }>(`select product_ext, snap_on::text snap_on, on_hand from fcd.v_sales_inventory_daily where org_id = $1`, [o.orgId])).map((r) => [
      `${r.product_ext}|${r.snap_on}`,
      Number(r.on_hand),
    ]),
  );
  const iRows: unknown[][] = [];
  for (const x of o.ds.inventory) {
    if (curI.get(`${x.productExt}|${x.on}`) === x.onHand) {
      s.skipped++;
      continue;
    }
    iRows.push([o.orgId, o.source, batch, x.productExt, x.on, x.onHand, x.inbound, o.userId, at]);
    s.inventory++;
  }
  await insertMany(q, 'sales_inventory_snapshots', ['org_id', 'source', 'batch_id', 'product_ext', 'snap_on::date', 'on_hand', 'inbound_units', 'created_by', 'created_at::timestamptz'], iRows);

  // 반품
  const curR = new Map(
    (
      await q.query<{ id: string; version: number; external_id: string; units: number; reason: string; returned_on: string }>(
        `select id, version, external_id, units, reason, returned_on::text returned_on from fcd.v_sales_returns_current where org_id = $1`,
        [o.orgId],
      )
    ).map((r) => [r.external_id, r]),
  );
  const rRows: unknown[][] = [];
  for (const x of o.ds.returns) {
    const c = curR.get(x.ext);
    if (c && Number(c.units) === x.units && c.reason === x.reason && c.returned_on === x.on) {
      s.skipped++;
      continue;
    }
    rRows.push([o.orgId, o.source, batch, x.ext, x.productExt, x.on, x.units, x.reason, x.reasonRaw, (c?.version ?? 0) + 1, c?.id ?? null, o.userId, at]);
    s.returns++;
  }
  await insertMany(q, 'sales_returns', ['org_id', 'source', 'batch_id', 'external_id', 'product_ext', 'returned_on::date', 'units', 'reason', 'reason_raw', 'version', 'supersedes_id', 'created_by', 'created_at::timestamptz'], rRows);

  await q.query(
    `insert into fcd.sales_sync_runs (org_id, source, status, range_from, range_to, counts, detail, created_by, created_at) values ($1,$2,'ok',$3::date,$4::date,$5::jsonb,$6::jsonb,$7,$8::timestamptz)`,
    [o.orgId, o.source, o.range?.from ?? null, o.range?.to ?? null, JSON.stringify(s), JSON.stringify({ batch }), o.userId, at],
  );
  return s;
}
