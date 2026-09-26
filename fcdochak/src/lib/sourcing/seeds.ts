/**
 * 소싱 요청의 시작점 — 「잘 팔리는 내 상품」 목록.
 *   · 저장한 SKU(1차, fcd.skus)
 *   · 판매 분석 상품(3차 sales) — **연결 지점**: salesProductsForSourcing() 하나. sales 꾸러미가 동시에 만들어지고 있어
 *     그 표에 직접 기대지 않는다. 합칠 때 이 함수 안에서 sales 의 상품 표(판매량 순)를 읽어 같은 모양으로 돌려주면 된다.
 *   · 2차 wing 자료는 입고 요청 번호·수량뿐이라(상품 이름 없음) 시작점으로 쓰지 않는다.
 */
import type { Queryable } from '../db';

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
 * 판매 분석(3차 sales)의 잘 팔리는 상품 — 합치기 전에는 빈 목록.
 * 합칠 때: sales 의 상품 표에서 이 조직의 상품을 판매량 순으로 읽어 SourcingSeed 로(origin 'sales', ref = 상품 열쇠).
 */
export async function salesProductsForSourcing(_q: Queryable, _orgId: string): Promise<SourcingSeed[]> {
  return [];
}

export async function sourcingSeeds(q: Queryable, orgId: string): Promise<SourcingSeed[]> {
  const sales = await salesProductsForSourcing(q, orgId);
  const skus = await skusForSourcing(q, orgId);
  return [...sales, ...skus];
}
