/**
 * 판매 흉내 어댑터(v2 3차 sales) — 데모·미리보기·시험용. 쿠팡을 부르지 않는다.
 * 같은 씨앗·같은 오늘이면 늘 같은 180일 주문·재고·반품을 만든다(sha-256 기반 결정적 난수, 2차 wing 흉내와 같은 방식).
 *
 *  · 날짜는 오늘 전날까지만(미래 날짜 없음). 재고는 음수가 되지 않는다 — 재고가 없으면 그날은 덜 팔린다(품절).
 *  · 입고(inbounds)가 주어지면 그날부터 1~4일 뒤 재고에 반영된다(입고 성과가 보이게). 첫 136일은 재고가 떨어지면 예시 입고로 채운다.
 *  · 번호는 EX-VI-(상품)·EX-OD-(주문 하루 묶음)·EX-RT-(반품) — 실제 번호와 헷갈리지 않는다.
 */
import { createHash } from 'node:crypto';
import { addDays } from '../money/sales';
import { RETURN_REASONS, type ReturnReason, type SalesDataset, type SalesOrder, type SalesProduct, type SalesReturn, type SalesSnapshot } from './types';

export const DEMO_SALES_SEED = 'fcd-demo-sales';
export const PREVIEW_SALES_SEED = 'fcd-sales-preview';

export interface MockProductInput {
  name: string;
  skuId: string | null;
  /** 목록 판매가(부가세 포함) */
  price: number;
  /** 하루 평균 수요(없으면 씨앗으로 2~24) */
  baseDaily?: number;
  /** 입고(FC 입고일·수량) — 재고에 1~4일 뒤 반영 */
  inbounds?: { on: string; units: number }[];
}

export interface MockSalesOptions {
  seed: string;
  today: string;
  days?: number;
  /** 첫날을 고정하면(다시 동기화할 때 앞서 만든 첫날) 같은 날까지의 기록이 늘 같다 — 없으면 오늘 전날부터 days 일 */
  start?: string;
  products: readonly MockProductInput[];
}

function rand(seed: string, i: number, salt: string): number {
  const h = createHash('sha256').update(`${seed}:${i}:${salt}`).digest();
  return h.readUInt32BE(0) / 0x1_0000_0000;
}
const int = (r: number, lo: number, hi: number) => lo + Math.floor(r * (hi - lo + 1));
const ymdCompact = (d: string) => d.replaceAll('-', '');

/** 입고가 쿠팡 재고에 반영되기까지 흉내 일수(1~4) — 시험이 같은 값을 다시 셈할 수 있게 드러낸다 */
export function mockReflectLag(seed: string, productIndex: number, on: string): number {
  return int(rand(seed, productIndex, `lag:${on}`), 1, 4);
}

export function mockSales(o: MockSalesOptions): SalesDataset {
  const end = addDays(o.today, -1);
  const start = o.start && o.start <= end ? o.start : addDays(end, -((o.days ?? 180) - 1));
  const products: SalesProduct[] = [];
  const orders: SalesOrder[] = [];
  const inventory: SalesSnapshot[] = [];
  const returns: SalesReturn[] = [];
  const seenExt = new Set<string>();

  o.products.forEach((p, i) => {
    const r = (salt: string) => rand(o.seed, i, salt);
    let ext = `EX-VI-${int(r('vi'), 10_000_000, 99_999_999)}`;
    while (seenExt.has(ext)) ext = `${ext}X`;
    seenExt.add(ext);
    products.push({ ext, name: p.name, optionName: r('opt') < 0.5 ? '기본' : `${int(r('optn'), 1, 3)}개입`, listPrice: Math.max(0, Math.round(p.price)), skuId: p.skuId });

    const base = p.baseDaily ?? 2 + Math.floor(r('base') * 23);
    // 추세: 앞에서 뒤로 (1 − g) → (1 + g)
    const g = -0.4 + r('trend') * 0.9;
    const returnRate = 0.01 + r('rr') * 0.07;
    const reasonW = RETURN_REASONS.map((_, k) => 0.2 + rand(o.seed, i, `rw${k}`) * (k === 0 ? 3 : 1));
    // 입고 — 주어진 입고(FC도착 선적)는 1~4일 뒤 재고에. 그 밖에 첫 136일 동안은 재고가 열흘 치 밑으로 내려가면 8~15일 뒤 예시 입고
    // (첫날에 묶인 규칙이라 다시 동기화해도 앞날이 바뀌지 않는다. 마지막 44일쯤은 채우지 않아 재입고 권장이 보인다)
    const arrivals = new Map<string, number>();
    const given = (p.inbounds ?? []).map((x) => x.on);
    const addArrival = (on: string, units: number) => {
      const lag = mockReflectLag(o.seed, i, on);
      const d = addDays(on, lag);
      if (d > end) return;
      arrivals.set(d, (arrivals.get(d) ?? 0) + units);
    };
    for (const x of p.inbounds ?? []) addArrival(x.on, x.units);
    const nearGiven = (d: string) => given.some((g) => g >= addDays(d, -5) && g <= addDays(d, 30));
    let autoAt: string | null = null;
    const autoUnits = Math.max(50, Math.round((base * 60) / 50) * 50);
    // 첫 재고 — 입고가 주어지면 적게(10~25일 치), 아니면 25~60일 치
    let stock = Math.round(base * (given.length ? int(r('stock0'), 10, 25) : int(r('stock0'), 25, 60)));
    let retCarry = 0;
    let dayIdx = 0;
    for (let d = start; d <= end; d = addDays(d, 1), dayIdx++) {
      stock += arrivals.get(d) ?? 0;
      if (autoAt === d) {
        stock += autoUnits;
        autoAt = null;
      }
      if (autoAt == null && dayIdx <= 135 && stock < base * 10 && !nearGiven(d)) autoAt = addDays(d, int(rand(o.seed, i, `auto:${d}`), 8, 15));
      // 추세는 첫날부터 179일에 걸쳐(다시 동기화해 기간이 늘어도 앞날의 값이 바뀌지 않게)
      const progress = Math.min(1, dayIdx / 179);
      const dow = new Date(`${d}T00:00:00Z`).getUTCDay();
      const week = dow === 0 || dow === 6 ? 1.25 : 1;
      const noise = 0.6 + rand(o.seed, i, `n:${d}`) * 0.8;
      const demand = Math.max(0, Math.round(base * (1 - g + 2 * g * progress) * week * noise));
      const sold = Math.min(stock, demand);
      stock -= sold;
      if (sold > 0) {
        const promo = rand(o.seed, i, `p:${d}`) < 0.12 ? 0.9 : 1;
        const unitPrice = Math.round((p.price * promo) / 10) * 10;
        orders.push({
          ext: `EX-OD-${i}${ymdCompact(d)}`,
          productExt: ext,
          on: d,
          units: sold,
          amount: sold * unitPrice,
          orders: Math.max(1, Math.round(sold / (1 + rand(o.seed, i, `o:${d}`) * 0.5))),
          cancelled: false,
        });
        retCarry += sold * returnRate;
        if (retCarry >= 1) {
          const units = Math.floor(retCarry);
          retCarry -= units;
          const on = addDays(d, int(rand(o.seed, i, `rl:${d}`), 2, 10));
          if (on <= end) {
            const pick = rand(o.seed, i, `rs:${d}`) * reasonW.reduce((a, b) => a + b, 0);
            let acc = 0;
            let reason: ReturnReason = 'other';
            for (let k = 0; k < RETURN_REASONS.length; k++) {
              acc += reasonW[k];
              if (pick <= acc) {
                reason = RETURN_REASONS[k];
                break;
              }
            }
            returns.push({ ext: `EX-RT-${i}${ymdCompact(d)}`, productExt: ext, on, units, reason, reasonRaw: null });
          }
        }
      }
      inventory.push({ productExt: ext, on: d, onHand: stock, inbound: null });
    }
  });
  return { products, orders, inventory, returns };
}

/** 연결 전 미리보기 — 실제 자료가 아니라 「예시」. 개당 원가도 예시 값 */
export const PREVIEW_PRODUCTS: (MockProductInput & { example: { goodsPerUnit: number; logisticsPerUnit: number; dutyPerUnit: number } })[] = [
  { name: '예시 상품 · 실리콘 서랍 정리함', skuId: null, price: 12_900, baseDaily: 22, example: { goodsPerUnit: 2_600, logisticsPerUnit: 1_300, dutyPerUnit: 210 } },
  { name: '예시 상품 · 접이식 수납 바구니', skuId: null, price: 9_900, baseDaily: 14, example: { goodsPerUnit: 2_100, logisticsPerUnit: 1_900, dutyPerUnit: 170 } },
  { name: '예시 상품 · 차량용 컵홀더', skuId: null, price: 7_900, baseDaily: 9, example: { goodsPerUnit: 1_500, logisticsPerUnit: 900, dutyPerUnit: 110 } },
  { name: '예시 상품 · 욕실 선반', skuId: null, price: 15_900, baseDaily: 5, example: { goodsPerUnit: 4_800, logisticsPerUnit: 3_300, dutyPerUnit: 380 } },
  { name: '예시 상품 · 대용량 물병', skuId: null, price: 6_900, baseDaily: 3, example: { goodsPerUnit: 2_300, logisticsPerUnit: 2_600, dutyPerUnit: 190 } },
];
