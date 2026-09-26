/**
 * 판매 분석 한 번 — 화면 다섯(개요·상품별·손익·반품·입고 성과)이 같은 결과를 쓴다. 순수 함수(계산은 money/sales.ts).
 * DB·설정은 부르는 쪽(src/lib/server/sales.ts)이 읽어 넘긴다.
 */
import {
  abcClassify,
  addDays,
  avgPrice,
  bucketSeries,
  changeBp,
  dailySeries,
  daysOfStock,
  inboundReflectFifo,
  median,
  periodWindows,
  reorderOn,
  reorderState,
  returnRateBp,
  skuUnitPnl,
  stockoutOn,
  suggestUnits,
  sumRange,
  velocityWithStockout,
  type AbcClass,
  type ArrivalPerUnit,
  type FeeLike,
  type ReorderState,
} from '../money/sales';
import type { PnlResult } from '../money/pnl';
import { RETURN_REASONS, type ReturnReason, type SalesDataset, type SalesRules } from './types';

export interface TransitInfo {
  days: number;
  /** market = 유효 요금표 운송일 중간값 · mode = 방식표 최대 일수 */
  basis: 'market' | 'mode';
  lane: string;
}

export interface DeliveredShipment {
  productExt: string;
  shipmentId: string;
  shipmentNo: string;
  deliveredOn: string;
  units: number;
  partner: string;
}

export interface AnalyzeContext {
  today: string;
  periodDays: number;
  rules: SalesRules;
  fee: FeeLike;
  vatRateBp: number;
  arrival: Record<string, ArrivalPerUnit>;
  transit: Record<string, TransitInfo>;
  delivered: DeliveredShipment[];
}

export interface ProductRow {
  ext: string;
  name: string;
  optionName: string | null;
  skuId: string | null;
  units: number;
  amount: number;
  prevAmount: number;
  changeBp: number | null;
  rank: number;
  abc: AbcClass;
  shareBp: number;
  perDay: number;
  /** recent = 최근 창 · before_stockout = 최근 창 내내 품절이라 그 앞 창의 속도 */
  perDayBasis: 'recent' | 'before_stockout';
  onHand: number | null;
  asOf: string | null;
  daysOfStock: number | null;
  stockout: string | null;
  transit: TransitInfo | null;
  reorder: string | null;
  reorderState: ReorderState;
  suggestUnits: number;
  avgPrice: number | null;
  arrival: ArrivalPerUnit;
  pnl: PnlResult | null;
  periodProfit: number | null;
  returned: number;
  returnRateBp: number | null;
}

export interface SalesAnalysis {
  end: string;
  period: { days: number; cur: { from: string; to: string }; prev: { from: string; to: string } };
  totals: { amount: number; units: number; orders: number; prevAmount: number; prevUnits: number; amountChangeBp: number | null; unitsChangeBp: number | null };
  profit: { cur: number; prev: number; changeBp: number | null; excluded: number };
  returnRate: { curBp: number | null; prevBp: number | null };
  daily: { d: string; units: number; amount: number }[];
  weekly: { d: string; units: number; amount: number; days: number }[];
  monthly: { d: string; units: number; amount: number; days: number }[];
  products: ProductRow[];
  lossCount: number;
  reasons: { reason: ReturnReason; units: number; shareBp: number }[];
  returnsWeekly: { d: string; units: number }[];
  inbound: (DeliveredShipment & { productName: string; reflectDays: number | null })[];
  inboundMedianDays: number | null;
  /** 평균(소수 첫째 자리) */
  inboundAvgDays: number | null;
  firstDay: string | null;
}

export function analyzeSales(ds: SalesDataset, c: AnalyzeContext): SalesAnalysis {
  const end = addDays(c.today, -1);
  const { cur, prev } = periodWindows(end, c.periodDays);
  const ordersBy = new Map<string, typeof ds.orders>();
  for (const o of ds.orders) (ordersBy.get(o.productExt) ?? ordersBy.set(o.productExt, []).get(o.productExt)!).push(o);
  const invBy = new Map<string, typeof ds.inventory>();
  for (const s of ds.inventory) (invBy.get(s.productExt) ?? invBy.set(s.productExt, []).get(s.productExt)!).push(s);
  const retBy = new Map<string, number>();
  const retPrevBy = new Map<string, number>();
  for (const r of ds.returns) {
    if (r.on >= cur.from && r.on <= cur.to) retBy.set(r.productExt, (retBy.get(r.productExt) ?? 0) + r.units);
    if (r.on >= prev.from && r.on <= prev.to) retPrevBy.set(r.productExt, (retPrevBy.get(r.productExt) ?? 0) + r.units);
  }
  const rows = ds.orders.map((o) => ({ on: o.on, units: o.units, amount: o.amount, orders: o.orders, cancelled: o.cancelled }));
  const tc = sumRange(rows, cur);
  const tp = sumRange(rows, prev);

  const byProduct = ds.products.map((p) => {
    const os = (ordersBy.get(p.ext) ?? []).map((o) => ({ on: o.on, units: o.units, amount: o.amount, orders: o.orders, cancelled: o.cancelled }));
    return { p, os, c: sumRange(os, cur), pr: sumRange(os, prev) };
  });
  const abc = abcClassify(
    byProduct.map((x) => ({ id: x.p.ext, revenue: x.c.amount })),
    c.rules.abcABp,
    c.rules.abcBBp,
  );
  const none: ArrivalPerUnit = { basis: 'none', samples: 0, goodsPerUnit: 0, logisticsPerUnit: 0, dutyPerUnit: 0, perUnit: 0 };
  let profitCur = 0;
  let profitPrev = 0;
  let excluded = 0;
  const products: ProductRow[] = byProduct.map(({ p, os, c: pc, pr }) => {
    const a = abc.get(p.ext)!;
    const inv = [...(invBy.get(p.ext) ?? [])].sort((x, y) => (x.on < y.on ? -1 : 1));
    const last = inv[inv.length - 1] ?? null;
    const onHand = last ? last.onHand : null;
    // 최근 창 내내 품절이라 판매 0 이면 품절 전 속도로(「판매 없음」으로 숨지 않게)
    const vel = velocityWithStockout(os, end, c.rules.velocityDays, onHand);
    const perDay = vel.perDay;
    const dos = onHand == null ? null : daysOfStock(onHand, perDay);
    const asOf = last?.on ?? null;
    const so = asOf ? stockoutOn(asOf, dos) : null;
    const tr = c.transit[p.ext] ?? null;
    const lead = (tr?.days ?? 0) + c.rules.prepDays;
    const ro = tr ? reorderOn(so, tr.days, c.rules.prepDays) : null;
    const arrival = c.arrival[p.ext] ?? none;
    const price = avgPrice(pc.amount, pc.units) ?? p.listPrice;
    const pnl = price != null && arrival.basis !== 'none' ? skuUnitPnl(price, arrival, c.fee, c.vatRateBp) : null;
    const prevPrice = avgPrice(pr.amount, pr.units) ?? price;
    const prevPnl = prevPrice != null && arrival.basis !== 'none' ? skuUnitPnl(prevPrice, arrival, c.fee, c.vatRateBp) : null;
    if (pnl) profitCur += pnl.profit * pc.units;
    else if (pc.units > 0) excluded++;
    if (prevPnl) profitPrev += prevPnl.profit * pr.units;
    const returned = retBy.get(p.ext) ?? 0;
    return {
      ext: p.ext,
      name: p.name,
      optionName: p.optionName,
      skuId: p.skuId,
      units: pc.units,
      amount: pc.amount,
      prevAmount: pr.amount,
      changeBp: changeBp(pc.amount, pr.amount),
      rank: a.rank,
      abc: a.cls,
      shareBp: a.shareBp,
      perDay,
      perDayBasis: vel.basis,
      onHand,
      asOf,
      daysOfStock: dos,
      stockout: so,
      transit: tr,
      reorder: ro,
      reorderState: tr ? reorderState(ro, c.today, c.rules.lowStockDays) : perDay > 0 ? 'ok' : 'none',
      suggestUnits: suggestUnits(perDay, lead, c.rules.coverDays, onHand ?? 0, c.rules.roundUnits),
      avgPrice: price,
      arrival,
      pnl,
      periodProfit: pnl ? pnl.profit * pc.units : null,
      returned,
      returnRateBp: returnRateBp(returned, pc.units),
    };
  });
  products.sort((x, y) => x.rank - y.rank);

  const retCur = [...retBy.values()].reduce((a, b) => a + b, 0);
  const retPrev = [...retPrevBy.values()].reduce((a, b) => a + b, 0);
  const reasonUnits = new Map<ReturnReason, number>();
  for (const r of ds.returns) if (r.on >= cur.from && r.on <= cur.to) reasonUnits.set(r.reason, (reasonUnits.get(r.reason) ?? 0) + r.units);
  const reasons = RETURN_REASONS.map((reason) => ({ reason, units: reasonUnits.get(reason) ?? 0, shareBp: retCur > 0 ? Math.round(((reasonUnits.get(reason) ?? 0) * 10_000) / retCur) : 0 }))
    .filter((x) => x.units > 0)
    .sort((a, b) => b.units - a.units);

  const firstDay = ds.orders.length ? ds.orders.reduce((m, o) => (o.on < m ? o.on : m), ds.orders[0].on) : null;
  const allRange = { from: firstDay ?? cur.from, to: end };
  const allDaily = dailySeries(rows, allRange);
  const retDaily = dailySeries(
    ds.returns.map((r) => ({ on: r.on, units: r.units, amount: 0 })),
    allRange,
  );

  const nameBy = new Map(ds.products.map((p) => [p.ext, p.name]));
  // 재고 스냅숏이 있는 기간(첫날 다음 날부터)의 입고만 — 그 전 입고는 반영을 잴 수 없다
  const firstSnap = ds.inventory.reduce<string | null>((m, x) => (m == null || x.on < m ? x.on : m), null);
  // 한 상품의 입고는 선입선출로 함께 잰다 — 같은 선적은 한 번만(한 SKU 에 옵션이 여럿이어도)
  const seen = new Set<string>();
  const deliveredBy = new Map<string, DeliveredShipment[]>();
  for (const s of c.delivered) {
    if (seen.has(s.shipmentId)) continue;
    seen.add(s.shipmentId);
    (deliveredBy.get(s.productExt) ?? deliveredBy.set(s.productExt, []).get(s.productExt)!).push(s);
  }
  const inbound: SalesAnalysis['inbound'] = [];
  for (const [ext, list] of deliveredBy) {
    const days = inboundReflectFifo(list, invBy.get(ext)?.map((x) => ({ on: x.on, onHand: x.onHand })) ?? [], c.rules.inboundReflectBp);
    list.forEach((s, i) => {
      // 재고 스냅숏이 있는 기간(첫날 다음 날부터)의 입고만 보인다 — 그 전 입고는 반영을 잴 수 없다(나눠 주기에는 넣는다)
      if (firstSnap != null && s.deliveredOn > firstSnap) inbound.push({ ...s, productName: nameBy.get(s.productExt) ?? s.productExt, reflectDays: days[i] });
    });
  }
  inbound.sort((a, b) => (a.deliveredOn < b.deliveredOn ? 1 : a.deliveredOn > b.deliveredOn ? -1 : a.shipmentNo < b.shipmentNo ? 1 : -1));
  const reflected = inbound.map((x) => x.reflectDays).filter((x): x is number => x != null);

  return {
    end,
    period: { days: c.periodDays, cur, prev },
    totals: {
      amount: tc.amount,
      units: tc.units,
      orders: tc.orders,
      prevAmount: tp.amount,
      prevUnits: tp.units,
      amountChangeBp: changeBp(tc.amount, tp.amount),
      unitsChangeBp: changeBp(tc.units, tp.units),
    },
    profit: { cur: profitCur, prev: profitPrev, changeBp: changeBp(profitCur, profitPrev), excluded },
    returnRate: { curBp: returnRateBp(retCur, tc.units), prevBp: returnRateBp(retPrev, tp.units) },
    daily: allDaily.slice(-Math.max(c.periodDays, 30)),
    // 주 묶음은 온전한 주(7일)만 — 앞뒤 자투리 주가 뚝 떨어져 보이지 않게
    weekly: bucketSeries(allDaily, 'week').filter((x) => x.days === 7),
    monthly: bucketSeries(allDaily, 'month'),
    products,
    lossCount: products.filter((p) => p.pnl && p.pnl.profit < 0 && p.units > 0).length,
    reasons,
    returnsWeekly: bucketSeries(retDaily, 'week').filter((x) => x.days === 7).map((x) => ({ d: x.d, units: x.units })),
    inbound,
    inboundMedianDays: median(reflected),
    inboundAvgDays: reflected.length ? Math.round((reflected.reduce((a, b) => a + b, 0) * 10) / reflected.length) / 10 : null,
    firstDay,
  };
}
