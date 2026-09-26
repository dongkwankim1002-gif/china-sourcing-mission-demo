/**
 * 원스톱 고정 요금 — 순수 함수(v2 4차 onestop, docs/onestop-plan.md 5절). DB·환경변수·시계를 읽지 않는다.
 *
 *   가격 하나 = 공동 혼적 운임(청구 CBM × 허브·방식별 CBM당) + 원거리 FC 할증
 *             + 개당 작업비·바코드·검품 + 사입 대행 수수료(물품가 대비)
 *             → 합계가 최소 요금보다 작으면 최소 요금.
 *   9구간 참고치와의 차이 = 가격 하나 − 같은 화물의 9구간 합계(서버가 구간 시세 또는 플랫폼 참고치로 셈해 넘긴다).
 *   개당 도착원가 = (물품가 + 가격 하나 + 관세·부가세 참고 추정) ÷ 수량 — 관부가세는 estimateDutyVat 그대로.
 *
 * 원 단위 계산은 정수(BigInt)로 하고 한 번만 반올림한다. 요율은 fcd.settings 'onestop.tariff' 에서 읽어 넘긴다.
 */
import { BP, divRoundHalfUp, toNumber } from './decimal';
import { estimateDutyVat, type DutyEstimate } from './duty';
import type { OnestopLane, OnestopTariff } from '../onestop/settings';

export type OnestopInspection = 'none' | 'basic' | 'full';

export interface OnestopQuoteInput {
  hub: string;
  mode: 'LCL' | 'FERRY';
  fc: string;
  units: number;
  /** 신고 CBM(전체) */
  cbm: number;
  /** 물품가(원) — 사입 대행 수수료·관부가세 추정에 쓴다. 모르면 0 */
  goodsKrw: number;
  purchase: boolean;
  barcode: boolean;
  inspection: OnestopInspection;
}

export type OnestopLineKey = 'freight' | 'remote_fc' | 'handling' | 'barcode' | 'inspection' | 'purchase_fee';

export interface OnestopLine {
  key: OnestopLineKey;
  /** 수량(청구 CBM · 개수 · 물품가) */
  qty: number;
  /** 단가(원) 또는 bp(수수료) */
  rate: number;
  amount: number;
}

export type OnestopQuote =
  | { ok: false; reason: 'no_lane' | 'bad_input' }
  | {
      ok: true;
      lane: OnestopLane;
      billableCbm: number;
      lines: OnestopLine[];
      subtotal: number;
      /** 최소 요금까지 채운 금액(없으면 0) */
      minTopUp: number;
      minApplied: boolean;
      total: number;
      /** 개당 원스톱 요금(원, 반올림) */
      perUnit: number;
      /** 혼적 운임 + 원거리 할증 — 9구간 물류와 견줄 부분 */
      logistics: number;
      /** 개당 작업·바코드·검품·사입 수수료 — 9구간에 없는 대행 작업 */
      services: number;
    };

/** 청구 CBM — step(0.01 CBM 단위 정수)으로 올림. 부동소수 꼬리(0.30000000004)는 먼저 지운다 */
export function billableCbm(cbm: number, stepCenti: number): number {
  if (!(cbm > 0) || !Number.isFinite(cbm)) throw new RangeError(`CBM 이 올바르지 않습니다: ${cbm}`);
  if (!Number.isInteger(stepCenti) || stepCenti < 1) throw new RangeError('올림 단위가 올바르지 않습니다');
  const centi = Math.round(cbm * 1e6) / 1e4; // 0.01 CBM 단위(소수 둘째 자리까지 살림)
  const steps = Math.ceil(centi / stepCenti - 1e-9);
  return (Math.max(1, steps) * stepCenti) / 100;
}

export function findLane(t: Pick<OnestopTariff, 'lanes'>, hub: string, mode: 'LCL' | 'FERRY'): OnestopLane | null {
  return t.lanes.find((l) => l.hub === hub && l.mode === mode) ?? null;
}

const mulRound = (a: bigint, b: bigint, den: bigint) => toNumber(divRoundHalfUp(a * b, den));

export function onestopQuote(t: OnestopTariff, i: OnestopQuoteInput): OnestopQuote {
  if (!Number.isInteger(i.units) || i.units < 1 || !(i.cbm > 0) || !Number.isFinite(i.cbm) || !Number.isInteger(i.goodsKrw) || i.goodsKrw < 0) {
    return { ok: false, reason: 'bad_input' };
  }
  const lane = findLane(t, i.hub, i.mode);
  if (!lane) return { ok: false, reason: 'no_lane' };
  const cbm = billableCbm(i.cbm, t.cbmStepCenti);
  const cbmCenti = BigInt(Math.round(cbm * 100));
  const units = BigInt(i.units);
  const lines: OnestopLine[] = [{ key: 'freight', qty: cbm, rate: lane.perCbmKrw, amount: mulRound(cbmCenti, BigInt(lane.perCbmKrw), 100n) }];
  if (t.remoteFc.codes.includes(i.fc) && t.remoteFc.perCbmKrw > 0) {
    lines.push({ key: 'remote_fc', qty: cbm, rate: t.remoteFc.perCbmKrw, amount: mulRound(cbmCenti, BigInt(t.remoteFc.perCbmKrw), 100n) });
  }
  if (t.handlingPerUnitKrw > 0) lines.push({ key: 'handling', qty: i.units, rate: t.handlingPerUnitKrw, amount: toNumber(units * BigInt(t.handlingPerUnitKrw)) });
  if (i.barcode) lines.push({ key: 'barcode', qty: i.units, rate: t.barcodePerUnitKrw, amount: toNumber(units * BigInt(t.barcodePerUnitKrw)) });
  if (i.inspection !== 'none') {
    const r = t.inspectionPerUnitKrw[i.inspection];
    lines.push({ key: 'inspection', qty: i.units, rate: r, amount: toNumber(units * BigInt(r)) });
  }
  if (i.purchase) lines.push({ key: 'purchase_fee', qty: i.goodsKrw, rate: t.purchaseFeeBp, amount: mulRound(BigInt(i.goodsKrw), BigInt(t.purchaseFeeBp), BP) });
  const subtotal = lines.reduce((a, l) => a + l.amount, 0);
  const minTopUp = Math.max(0, t.minChargeKrw - subtotal);
  const total = subtotal + minTopUp;
  const logistics = lines.filter((l) => l.key === 'freight' || l.key === 'remote_fc').reduce((a, l) => a + l.amount, 0);
  return {
    ok: true,
    lane,
    billableCbm: cbm,
    lines,
    subtotal,
    minTopUp,
    minApplied: minTopUp > 0,
    total,
    perUnit: toNumber(divRoundHalfUp(BigInt(total), units)),
    logistics,
    services: subtotal - logistics,
  };
}

export interface NineComparison {
  /** 9구간 합계(원) */
  nineTotal: number;
  /** 원스톱 합계 − 9구간 합계(+ 면 원스톱이 비쌈) */
  diff: number;
  /** 차이 ÷ 9구간 합계(bp, 반올림). 9구간 합계가 0 이면 null */
  diffBp: number | null;
  /** 혼적 운임(+할증)만의 차이 */
  logisticsDiff: number;
  logisticsDiffBp: number | null;
}

/** 9구간 참고치와의 차이 — 9구간에는 개당 작업·바코드·검품·사입 수수료가 없으므로 운임만의 차이도 함께 */
export function compareWithNine(q: { total: number; logistics: number }, nineTotal: number): NineComparison {
  if (!Number.isSafeInteger(nineTotal) || nineTotal < 0) throw new RangeError('9구간 합계가 올바르지 않습니다');
  const bp = (d: number) => (nineTotal > 0 ? toNumber(divRoundHalfUp(BigInt(d) * BP, BigInt(nineTotal))) : null);
  const diff = q.total - nineTotal;
  const logisticsDiff = q.logistics - nineTotal;
  return { nineTotal, diff, diffBp: bp(diff), logisticsDiff, logisticsDiffBp: bp(logisticsDiff) };
}

export interface OnestopArrivalInput {
  units: number;
  goodsKrw: number;
  onestopTotal: number;
  /** 한국 도착항까지 운임 참고(과세가격 산입) — 9구간 참고치의 집하~국제운송 */
  freightToPortKrw: number;
  dutyRateBp: number;
  vatRateBp: number;
  insuranceBp: number;
}

export interface OnestopArrival {
  duty: DutyEstimate;
  /** 물품가 + 원스톱 + 관세(부가세 제외 — 매입세액 공제 대상, 판매손익 sellerPnl 의 도착원가와 같은 기준) */
  total: number;
  /** 개당 도착원가(부가세 제외) */
  perUnit: number;
  /** 통관 때 먼저 내는 돈까지(부가세 포함) — 자금 계획용 */
  perUnitWithVat: number;
}

/** 개당 도착원가 — 관세·부가세는 참고 추정(estimateDutyVat) */
export function onestopArrival(i: OnestopArrivalInput): OnestopArrival {
  if (!Number.isInteger(i.units) || i.units < 1) throw new RangeError('수량은 1 이상 정수');
  const duty = estimateDutyVat({ goodsKrw: i.goodsKrw, freightToPortKrw: i.freightToPortKrw, insuranceBp: i.insuranceBp, dutyRateBp: i.dutyRateBp, vatRateBp: i.vatRateBp });
  const total = i.goodsKrw + i.onestopTotal + duty.duty;
  const u = BigInt(i.units);
  return {
    duty,
    total,
    perUnit: toNumber(divRoundHalfUp(BigInt(total), u)),
    perUnitWithVat: toNumber(divRoundHalfUp(BigInt(total + duty.vat), u)),
  };
}
