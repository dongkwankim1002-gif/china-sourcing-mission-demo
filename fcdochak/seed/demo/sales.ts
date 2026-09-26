/**
 * 데모 시드 — 판매 분석(v2 3차 sales). 본 시드의 데모 화주(리빙모아) SKU·선적 위에 덧붙인다.
 *   · 흉내 어댑터로 만든 180일 주문(하루 묶음)·재고 스냅숏·반품 — 번호 EX-VI-·EX-OD-·EX-RT- = 예시
 *   · 입고 끝난 선적(9단계)의 FC 입고일·수량을 재고에 1~4일 뒤 반영(입고 성과가 보이게)
 *   · 마지막 SKU 는 판매가를 낮춰 「적자 SKU」 예시가 보이게
 *   · 동기화 기록 한 줄(source = mock) — 이 기록이 있으면 데모 조직의 판매 분석이 「예시 연결」로 열린다
 * 키 연결(wing_connections)은 넣지 않는다(2차와 같다 — 데모에도 가짜 키 암호문을 두지 않는다). 미래 날짜 없음.
 * 모두 is_demo 조직 아래라 걷어내기(조직 삭제) 한 번에 CASCADE 로 사라진다.
 */
import type { Queryable } from '@/lib/db/driver';
import { addDays } from '@/lib/money/sales';
import { DEMO_SALES_SEED, mockSales, type MockProductInput } from '@/lib/sales/mock';
import { storeSalesDataset } from '@/lib/sales/store';

const HOUR = 3_600_000;

/** 데모 SKU → 흉내 상품 입력(데모 시드와 「예시 다시 가져오기」가 같이 쓴다) */
export async function demoSalesProducts(q: Queryable, orgId: string): Promise<MockProductInput[]> {
  const skus = await q.query<{ id: string; name: string; target_price: number | null }>(
    `select id, name, target_price from fcd.skus where org_id = $1 and not archived order by created_at, id`,
    [orgId],
  );
  const ships = await q.query<{ sku_id: string; on: string; units: number }>(
    `select r.sku_id, (s.delivered_at at time zone 'Asia/Seoul')::date::text "on", s.units
       from fcd.shipments s join fcd.bookings b on b.id = s.booking_id join fcd.quote_requests r on r.id = b.request_id
      where s.shipper_org_id = $1 and s.stage = 9 and s.delivered_at is not null and r.sku_id is not null`,
    [orgId],
  );
  return skus.map((s, i) => {
    const tp = s.target_price ?? 15_900;
    const loss = skus.length > 1 && i === skus.length - 1;
    return {
      name: s.name,
      skuId: s.id,
      // 마지막 SKU 는 판매가를 낮춘 예시(적자 SKU 가 화면에 보이게)
      price: loss ? Math.max(1_000, Math.round((tp * 0.45) / 100) * 100 - 100) : tp,
      inbounds: ships.filter((x) => x.sku_id === s.id).map((x) => ({ on: x.on, units: Number(x.units) })),
    };
  });
}

export async function seedSalesDemo(q: Queryable, opts: { now: number; today: string; shipperEmail: string; onlyIfEmpty?: boolean }) {
  const me = (
    await q.query<{ user_id: string; org_id: string }>(
      `select p.id user_id, p.home_org_id org_id from fcd.profiles p join fcd.orgs o on o.id = p.home_org_id where lower(p.email) = $1 and o.is_demo`,
      [opts.shipperEmail.toLowerCase()],
    )
  )[0];
  if (!me) return 0;
  if (opts.onlyIfEmpty && (await q.query<{ n: number }>(`select count(*)::int n from fcd.sales_sync_runs where org_id = $1`, [me.org_id]))[0].n > 0) return 0;
  const products = await demoSalesProducts(q, me.org_id);
  if (!products.length) return 0;
  const ds = mockSales({ seed: DEMO_SALES_SEED, today: opts.today, days: 180, products });
  const end = addDays(opts.today, -1);
  const s = await storeSalesDataset(q, {
    orgId: me.org_id,
    userId: me.user_id,
    source: 'mock',
    ds,
    at: new Date(opts.now - 3 * HOUR).toISOString(),
    range: { from: addDays(end, -179), to: end },
  });
  return s.orders;
}
