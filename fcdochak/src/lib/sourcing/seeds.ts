/**
 * 소싱 요청의 시작점 — 「잘 팔리는 내 상품」 목록.
 *   · 저장한 SKU(1차, fcd.skus)
 *   · 판매 분석 상품(3차 sales) — salesProductsForSourcing(): 현재 판 상품(fcd.v_sales_products_current)을
 *     최근 30일 판매량 순으로. 판매 분석이 열리지 않은 조직(access none)은 빈 목록.
 *   · 2차 wing 자료는 입고 요청 번호·수량뿐이라(상품 이름 없음) 시작점으로 쓰지 않는다.
 */
import { todayKst, type Queryable } from '../db';
import { addDays } from '../money/sales';
import { salesAccess } from '../server/sales';

export interface SourcingSeed {
  origin: 'sku' | 'sales';
  ref: string;
  name: string;
  category: string;
  /** 목표 판매가(원) */
  targetPrice: number | null;
  /** 월 판매량(판매 분석에서) */
  monthlyUnits: number | null;
  /** 첫 발주 수량 제안(지금 발주 단위) */
  firstOrderUnits: number | null;
  unitKg: number | null;
  unitCbm: number | null;
  /** 지금 개당 매입가(RMB) — 비교 기준 */
  unitGoodsRmb: number | null;
}

/** 저장한 SKU — 보관(archived) 안 한 것, 최근 순 */
export async function skusForSourcing(q: Queryable, orgId: string): Promise<SourcingSeed[]> {
  const rows = await q.query<{ id: string; name: string; hs_category: string; target_price: number | null; units: number; kg: string; cbm: string; goods_value: string; goods_currency: string }>(
    `select id, name, hs_category, target_price, units, kg::text, cbm::text, goods_value::text, goods_currency
       from fcd.skus where org_id = $1 and not archived order by created_at desc limit 30`,
    [orgId],
  );
  return rows.map((r) => ({
    origin: 'sku' as const,
    ref: r.id,
    name: r.name,
    category: r.hs_category,
    targetPrice: r.target_price,
    monthlyUnits: null,
    firstOrderUnits: r.units,
    unitKg: Math.round((Number(r.kg) / r.units) * 1000) / 1000,
    unitCbm: Math.round((Number(r.cbm) / r.units) * 100000) / 100000,
    unitGoodsRmb: r.goods_currency === 'RMB' ? Math.round((Number(r.goods_value) / r.units) * 100) / 100 : null,
  }));
}

/**
 * 판매 분석(3차 sales)의 잘 팔리는 상품 — 최근 30일(어제까지, 취소 뺌) 판매량 순.
 * 판매 분석과 같은 열림 판정(salesAccess)을 쓴다 — 열리지 않은 조직(access none)은 빈 목록.
 * ref = 쿠팡 옵션 번호(external_id). 이어진 SKU 가 있으면 분류·개당 무게·부피·매입가를 SKU 에서.
 */
export async function salesProductsForSourcing(q: Queryable, orgId: string, today = todayKst()): Promise<SourcingSeed[]> {
  const org = (await q.query<{ is_demo: boolean }>(`select is_demo from fcd.orgs where id = $1`, [orgId]))[0];
  if (!org) return [];
  const { access } = await salesAccess(q, { id: orgId, is_demo: org.is_demo });
  if (access === 'none') return [];
  const end = addDays(today, -1);
  const from = addDays(end, -29);
  const rows = await q.query<{
    external_id: string;
    name: string;
    option_name: string | null;
    list_price: number | null;
    monthly: number;
    hs_category: string | null;
    units: number | null;
    kg: string | null;
    cbm: string | null;
    goods_value: string | null;
    goods_currency: string | null;
  }>(
    `select p.external_id, p.name, p.option_name, p.list_price, coalesce(o.units, 0)::int monthly,
            s.hs_category, s.units, s.kg::text, s.cbm::text, s.goods_value::text, s.goods_currency
       from fcd.v_sales_products_current p
       left join fcd.skus s on s.id = p.sku_id and s.org_id = p.org_id
       left join (
         select product_ext, sum(units) units from fcd.v_sales_orders_current
          where org_id = $1 and not cancelled and ordered_on between $2::date and $3::date
          group by product_ext
       ) o on o.product_ext = p.external_id
      where p.org_id = $1
      order by monthly desc, p.external_id
      limit 30`,
    [orgId, from, end],
  );
  return rows.map((r) => {
    const u = r.units && r.units > 0 ? Number(r.units) : null;
    return {
      origin: 'sales' as const,
      ref: r.external_id,
      name: r.option_name ? `${r.name} · ${r.option_name}` : r.name,
      category: r.hs_category ?? 'general',
      targetPrice: r.list_price == null ? null : Number(r.list_price),
      monthlyUnits: Number(r.monthly),
      firstOrderUnits: u,
      unitKg: u && r.kg != null ? Math.round((Number(r.kg) / u) * 1000) / 1000 : null,
      unitCbm: u && r.cbm != null ? Math.round((Number(r.cbm) / u) * 100000) / 100000 : null,
      unitGoodsRmb: u && r.goods_currency === 'RMB' && r.goods_value != null ? Math.round((Number(r.goods_value) / u) * 100) / 100 : null,
    };
  });
}

export async function sourcingSeeds(q: Queryable, orgId: string): Promise<SourcingSeed[]> {
  const sales = await salesProductsForSourcing(q, orgId);
  const skus = await skusForSourcing(q, orgId);
  return [...sales, ...skus];
}
