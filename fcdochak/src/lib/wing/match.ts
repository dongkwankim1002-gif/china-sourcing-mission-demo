/**
 * 입고 요청 ↔ 선적 짝 제안 · 실측 회송률 — 순수 함수. 기준치는 설정 wing.match_rule 에서 받는다.
 *
 * 점수(100): FC 같음 40 · 날짜 30(입고 예정일 − FC 도착 예정일 차이가 0일이면 30, dateWindowDays 에서 0) ·
 *            수량 30(수량 차이 비율이 0이면 30, unitsToleranceBp 에서 0. 수량이 없으면 박스로).
 * 한 선적에 한 입고 요청 — 점수 높은 짝부터 나눠 준다. 동점이면 날짜 차이 작은 쪽 → 선적 번호 → 입고 요청 번호.
 * **자동 확정하지 않는다** — 화면은 「제안」으로만 보이고 사람이 확정한다.
 */
import type { WingMatchRule } from './types';

export interface MatchInbound {
  id: string;
  externalNo: string;
  fcCode: string | null;
  plannedOn: string | null;
  units: number | null;
  boxes: number | null;
}

export interface MatchShipment {
  id: string;
  shipmentNo: string;
  fcCode: string;
  etaFc: string | null;
  units: number;
  cartons: number;
}

export interface MatchReason {
  fc: boolean;
  dayDiff: number | null;
  qtyDiffBp: number | null;
  qtyBasis: 'units' | 'boxes' | null;
}

export interface MatchCandidate {
  shipmentId: string;
  shipmentNo: string;
  score: number;
  reason: MatchReason;
}

export const FC_POINTS = 40;
export const DATE_POINTS = 30;
export const QTY_POINTS = 30;

const DAY = 86_400_000;

export function checkMatchRule(r: WingMatchRule): WingMatchRule {
  if (!Number.isInteger(r.dateWindowDays) || r.dateWindowDays < 1 || r.dateWindowDays > 90) throw new RangeError('dateWindowDays 는 1~90');
  if (!Number.isInteger(r.unitsToleranceBp) || r.unitsToleranceBp < 1 || r.unitsToleranceBp > 10_000) throw new RangeError('unitsToleranceBp 는 1~10000');
  if (!Number.isInteger(r.minScore) || r.minScore < 0 || r.minScore > 100) throw new RangeError('minScore 는 0~100');
  return r;
}

function dayDiff(a: string | null, b: string | null): number | null {
  if (!a || !b) return null;
  const x = Date.parse(`${a.slice(0, 10)}T00:00:00Z`);
  const y = Date.parse(`${b.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(x) || Number.isNaN(y)) return null;
  return Math.round(Math.abs(x - y) / DAY);
}

/** 두 수의 차이 ÷ 선적 쪽 값(bp, 사사오입) */
export function qtyDiffBp(inbound: number, shipment: number): number {
  if (!Number.isInteger(inbound) || !Number.isInteger(shipment) || inbound < 0 || shipment < 0) throw new RangeError('수량은 0 이상 정수');
  if (shipment === 0) return inbound === 0 ? 0 : 10_000;
  return Math.round((Math.abs(inbound - shipment) * 10_000) / shipment);
}

/** 곧게 줄어드는 점수 — 0 이면 만점, limit 이상이면 0 */
function linear(points: number, value: number, limit: number): number {
  if (value >= limit) return 0;
  return Math.round((points * (limit - value)) / limit);
}

export function scorePair(i: MatchInbound, s: MatchShipment, rule: WingMatchRule): MatchCandidate {
  const fc = !!i.fcCode && i.fcCode === s.fcCode;
  const dd = dayDiff(i.plannedOn, s.etaFc);
  let basis: MatchReason['qtyBasis'] = null;
  let q: number | null = null;
  if (i.units != null) {
    basis = 'units';
    q = qtyDiffBp(i.units, s.units);
  } else if (i.boxes != null) {
    basis = 'boxes';
    q = qtyDiffBp(i.boxes, s.cartons);
  }
  const score = (fc ? FC_POINTS : 0) + (dd == null ? 0 : linear(DATE_POINTS, dd, rule.dateWindowDays)) + (q == null ? 0 : linear(QTY_POINTS, q, rule.unitsToleranceBp));
  return { shipmentId: s.id, shipmentNo: s.shipmentNo, score, reason: { fc, dayDiff: dd, qtyDiffBp: q, qtyBasis: basis } };
}

export interface Suggestion {
  inboundId: string;
  /** 나눠 준 제안(기준 점수 이상) — 없으면 null */
  best: MatchCandidate | null;
  /** 사람이 고를 때 보여 줄 후보(점수순 최대 limit, 기준 미만 포함) */
  candidates: MatchCandidate[];
}

/**
 * @param taken 이미 확정된 짝(입고 요청 id → 선적 id) — 제안에서 빼고, 그 선적은 다른 입고 요청에 주지 않는다
 */
export function suggestMatches(
  inbounds: readonly MatchInbound[],
  shipments: readonly MatchShipment[],
  rule: WingMatchRule,
  taken: ReadonlyMap<string, string> = new Map(),
  limit = 3,
): Suggestion[] {
  checkMatchRule(rule);
  const usedShip = new Set(taken.values());
  const open = inbounds.filter((i) => !taken.has(i.id));
  const pairs: { i: MatchInbound; c: MatchCandidate }[] = [];
  const byInbound = new Map<string, MatchCandidate[]>();
  for (const i of open) {
    const cs = shipments.filter((s) => !usedShip.has(s.id)).map((s) => scorePair(i, s, rule));
    cs.sort(order);
    byInbound.set(i.id, cs.slice(0, limit));
    for (const c of cs) if (c.score >= rule.minScore) pairs.push({ i, c });
  }
  pairs.sort((a, b) => order(a.c, b.c) || a.i.externalNo.localeCompare(b.i.externalNo));
  const best = new Map<string, MatchCandidate>();
  const shipTaken = new Set<string>();
  for (const p of pairs) {
    if (best.has(p.i.id) || shipTaken.has(p.c.shipmentId)) continue;
    best.set(p.i.id, p.c);
    shipTaken.add(p.c.shipmentId);
  }
  return open.map((i) => ({ inboundId: i.id, best: best.get(i.id) ?? null, candidates: byInbound.get(i.id) ?? [] }));
}

function order(a: MatchCandidate, b: MatchCandidate): number {
  return b.score - a.score || (a.reason.dayDiff ?? 9999) - (b.reason.dayDiff ?? 9999) || a.shipmentNo.localeCompare(b.shipmentNo);
}

/** 제안 까닭을 사람 말로 */
export function reasonText(r: MatchReason): string {
  const parts: string[] = [r.fc ? 'FC 같음' : 'FC 다름'];
  if (r.dayDiff != null) parts.push(r.dayDiff === 0 ? '날짜 같음' : `날짜 ${r.dayDiff}일 차`);
  if (r.qtyDiffBp != null) {
    const w = r.qtyBasis === 'boxes' ? '박스' : '수량';
    parts.push(r.qtyDiffBp === 0 ? `${w} 같음` : `${w} ${(r.qtyDiffBp / 100).toFixed(1)}% 차`);
  }
  return parts.join(' · ');
}

/**
 * 실측 회송률 = 회송 ÷ (입고 + 회송), bp 사사오입. 결과 칸이 둘 다 있는 줄만 센다.
 */
export function measuredReturnRate(rows: readonly { receivedUnits: number | null; returnedUnits: number | null }[]): { rateBp: number | null; received: number; returned: number; rows: number } {
  let received = 0;
  let returned = 0;
  let n = 0;
  for (const r of rows) {
    if (r.receivedUnits == null || r.returnedUnits == null) continue;
    if (!Number.isInteger(r.receivedUnits) || !Number.isInteger(r.returnedUnits) || r.receivedUnits < 0 || r.returnedUnits < 0) throw new RangeError('입고·회송 수량은 0 이상 정수');
    received += r.receivedUnits;
    returned += r.returnedUnits;
    n++;
  }
  const d = received + returned;
  return { rateBp: d === 0 ? null : Math.round((returned * 10_000) / d), received, returned, rows: n };
}
