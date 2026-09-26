/**
 * 주문에 남길 견적 기록(snapshot) 만들기 — 순수(서버·시드·시험이 같이 쓴다). DB·시계를 읽지 않는다.
 * 9구간 합계(nine)는 부르는 쪽이 넘긴다: 서버는 구간 시세 중간값(없으면 참고치), 시드는 플랫폼 참고치.
 */
import {
  compareWithNine,
  computeQuote,
  goodsValueKrw,
  onestopArrival,
  onestopQuote,
  SEGMENTS_TO_KR_PORT,
  type Cargo,
  type Currency,
  type NineComparison,
  type OnestopInspection,
  type OnestopLine,
  type QuoteParams,
  type RateLine,
} from '../money';
import type { OnestopTariff } from './settings';

export interface OnestopOrderInput {
  hub: string;
  mode: 'LCL' | 'FERRY';
  fc: string;
  units: number;
  cartons: number;
  cbm: number;
  kg: number;
  unitPrice: number | null;
  currency: Currency;
  category: string;
  purchase: boolean;
  barcode: boolean;
  inspection: OnestopInspection;
}

export interface OnestopQuoteSnapshot {
  by: 'server' | 'seed';
  tariff: { example: boolean; checkedOn: string | null };
  lane: { hub: string; mode: string; port: string; perCbmKrw: number; daysMin: number; daysMax: number };
  billableCbm: number;
  lines: OnestopLine[];
  subtotal: number;
  minApplied: boolean;
  minTopUp: number;
  total: number;
  perUnit: number;
  logistics: number;
  services: number;
  goodsKrw: number;
  nine: NineComparison & { basis: 'market' | 'reference'; offers: number };
  arrival: { perUnit: number; perUnitWithVat: number; duty: number; vat: number; dutyRateBp: number } | null;
}

export function orderCargo(i: Pick<OnestopOrderInput, 'units' | 'cartons' | 'cbm' | 'kg' | 'unitPrice' | 'currency'>): Cargo {
  return {
    units: i.units,
    cartons: i.cartons,
    kg: i.kg,
    cbm: i.cbm,
    goodsValue: i.unitPrice ? Math.round(i.unitPrice * i.units * 100) / 100 : 0,
    goodsCurrency: i.currency,
  };
}

/** 플랫폼 참고치(REFERENCE_LINES)로 셈한 같은 화물의 9구간 합계·도착항까지 운임 */
export function referenceNine(lines: RateLine[], cargo: Cargo, params: QuoteParams) {
  const ref = computeQuote(lines, cargo, params);
  return {
    total: ref.segments.reduce((a, x) => a + (x.amount ?? 0), 0),
    toPort: ref.segments.filter((x) => SEGMENTS_TO_KR_PORT.includes(x.segment)).reduce((a, x) => a + (x.amount ?? 0), 0),
    segments: ref.segments.map((x) => ({ segment: x.segment, amount: x.amount })),
  };
}

export type SnapshotResult = { ok: true; snap: OnestopQuoteSnapshot } | { ok: false; error: string };

export function buildOnestopSnapshot(a: {
  by: 'server' | 'seed';
  tariff: OnestopTariff;
  fx: Record<Currency, number>;
  input: OnestopOrderInput;
  nine: { basis: 'market' | 'reference'; offers: number; total: number; toPort: number };
  dutyRateBp: number;
  vatRateBp: number;
  insuranceBp: number;
}): SnapshotResult {
  const i = a.input;
  const cargo = orderCargo(i);
  const goodsKrw = cargo.goodsValue > 0 ? goodsValueKrw(cargo, a.fx) : 0;
  const q = onestopQuote(a.tariff, { hub: i.hub, mode: i.mode, fc: i.fc, units: i.units, cbm: i.cbm, goodsKrw, purchase: i.purchase, barcode: i.barcode, inspection: i.inspection });
  if (!q.ok) return { ok: false, error: q.reason === 'no_lane' ? '이 허브·방식은 원스톱 요금표에 없습니다 — 요금표에서 고를 수 있는 길을 골라 주세요' : '수량·CBM 을 다시 확인해 주세요' };
  const arrival =
    goodsKrw > 0
      ? onestopArrival({ units: i.units, goodsKrw, onestopTotal: q.total, freightToPortKrw: a.nine.toPort, dutyRateBp: a.dutyRateBp, vatRateBp: a.vatRateBp, insuranceBp: a.insuranceBp })
      : null;
  return {
    ok: true,
    snap: {
      by: a.by,
      tariff: { example: a.tariff.example, checkedOn: a.tariff.checkedOn },
      lane: q.lane,
      billableCbm: q.billableCbm,
      lines: q.lines,
      subtotal: q.subtotal,
      minApplied: q.minApplied,
      minTopUp: q.minTopUp,
      total: q.total,
      perUnit: q.perUnit,
      logistics: q.logistics,
      services: q.services,
      goodsKrw,
      nine: { ...compareWithNine(q, a.nine.total), basis: a.nine.basis, offers: a.nine.offers },
      arrival: arrival ? { perUnit: arrival.perUnit, perUnitWithVat: arrival.perUnitWithVat, duty: arrival.duty.duty, vat: arrival.duty.vat, dutyRateBp: a.dutyRateBp } : null,
    },
  };
}
