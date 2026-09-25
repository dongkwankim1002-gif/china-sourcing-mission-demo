/**
 * 운영 지표 — 이벤트 기록(fcd.events)과 그 대상(응찰·청구·선적)에서 센다. 순수 함수.
 * DB·시계·환경변수를 읽지 않는다. 기간·요율은 인자로 받는다. 돈은 src/lib/money 를 쓴다.
 *
 * 정의(화면 설명과 같다)
 *   · 월간 활성 셀러 — 그 달(KST)에 셀러(화주) 조직이 걸린 이벤트가 하나라도 있는 셀러 수
 *   · 관리 선적 수 — 그 달 플랫폼에서 예약(booked)으로 만들어진 선적 수
 *   · 초대로 들어온 업체 비율 — 기간 안 가입 중 초대 링크로 들어온 비율. 초대 기록이 아직 없으면 「준비 중」
 *   · 재선적률 — 기간 안에 예약한 셀러 중, 그 전에 이미 예약한 적이 있는 셀러의 비율
 *   · 견적 대비 청구 차이 — 선적마다 최신 판 청구서 합계와 고른 응찰 합계의 차이 ÷ 응찰 합계(평균·절대값 평균)
 *   · 회송률 — 기간 안 FC 입고 선적의 회송 수량 ÷ 선적 수량
 *   · 선적당 매출 — 기간 안 예약의 성사 수수료(commissionAmount — 물류비 − 관세사 보수, 요율은 설정) ÷ 예약 수
 */
import { commissionAmount, type SegmentAmounts } from './money/commission';

export const EVENT_KINDS = [
  'signed_up',
  'quote_requested',
  'request_cancelled',
  'bid_submitted',
  'bid_selected',
  'booked',
  'shipped',
  'fc_inbound',
  'invoiced',
  'returned',
  'reviewed',
] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

export const EVENT_KIND_LABEL: Record<EventKind, string> = {
  signed_up: '가입',
  quote_requested: '견적 요청',
  request_cancelled: '요청 취소',
  bid_submitted: '응찰',
  bid_selected: '응찰 선택',
  booked: '예약',
  shipped: '선적·출항',
  fc_inbound: 'FC 입고',
  invoiced: '청구',
  returned: '회송',
  reviewed: '평가',
};

export interface MetricEvent {
  kind: EventKind;
  sellerOrgId: string | null;
  at: string;
}

export interface Range {
  /** 포함 */
  from: string;
  /** 제외 */
  to: string;
}

const HOUR = 3_600_000;
const DAY = 86_400_000;

function ms(iso: string): number {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) throw new RangeError(`시각이 올바르지 않습니다: ${iso}`);
  return t;
}

export function inRange(at: string, r: Range): boolean {
  const t = ms(at);
  return t >= ms(r.from) && t < ms(r.to);
}

/** 'YYYY-MM' (KST) */
export function monthKey(at: string): string {
  return new Date(ms(at) + 9 * HOUR).toISOString().slice(0, 7);
}

/** 오늘(KST 'YYYY-MM-DD')이 든 달까지 거슬러 n 달 — 오래된 달이 앞 */
export function lastMonths(today: string, n: number): string[] {
  const y = +today.slice(0, 4);
  const m = +today.slice(5, 7) - 1;
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(y, m - i, 1));
    out.push(d.toISOString().slice(0, 7));
  }
  return out;
}

/** 오늘(KST)을 끝으로 하는 최근 days 일과 그 앞 같은 길이 — 끝은 내일 0시(KST) */
export function trailingRanges(today: string, days: number): { cur: Range; prev: Range } {
  const end = Date.UTC(+today.slice(0, 4), +today.slice(5, 7) - 1, +today.slice(8, 10)) + DAY - 9 * HOUR;
  const iso = (t: number) => new Date(t).toISOString();
  return {
    cur: { from: iso(end - days * DAY), to: iso(end) },
    prev: { from: iso(end - 2 * days * DAY), to: iso(end - days * DAY) },
  };
}

/** 기간 안 활성 셀러 수(서로 다른 셀러) */
export function activeSellers(events: MetricEvent[], r: Range): number {
  const s = new Set<string>();
  for (const e of events) if (e.sellerOrgId && inRange(e.at, r)) s.add(e.sellerOrgId);
  return s.size;
}

/** 달별 활성 셀러 수 */
export function monthlyActiveSellers(events: MetricEvent[], months: string[]): { month: string; n: number }[] {
  const by = new Map<string, Set<string>>(months.map((m) => [m, new Set()]));
  for (const e of events) {
    if (!e.sellerOrgId) continue;
    by.get(monthKey(e.at))?.add(e.sellerOrgId);
  }
  return months.map((m) => ({ month: m, n: by.get(m)!.size }));
}

/** 달별 이벤트 수(kind 하나) — 관리 선적 수는 kind = 'booked' */
export function monthlyCount(events: MetricEvent[], kind: EventKind, months: string[]): { month: string; n: number }[] {
  const by = new Map<string, number>(months.map((m) => [m, 0]));
  for (const e of events) {
    if (e.kind !== kind) continue;
    const k = monthKey(e.at);
    if (by.has(k)) by.set(k, by.get(k)! + 1);
  }
  return months.map((m) => ({ month: m, n: by.get(m)! }));
}

export function countIn(events: MetricEvent[], kind: EventKind, r: Range): number {
  return events.filter((e) => e.kind === kind && inRange(e.at, r)).length;
}

export interface SignupRow {
  at: string;
  orgKind: 'shipper' | 'partner';
  /** 'invite' 면 초대 링크로 들어옴 */
  via: string | null;
}

/**
 * 초대로 들어온 업체 비율 — 기간 안 가입 업체(물류사·화주 모두) 중 초대로 들어온 비율.
 * ready: 초대로 들어온 기록이 한 번이라도 있는가(없으면 초대 기능이 아직 기록을 남기지 않는 것 — 「준비 중」).
 */
export function inviteRatio(rows: SignupRow[], r: Range): { invited: number; total: number; ratio: number; ready: boolean } {
  const inR = rows.filter((x) => inRange(x.at, r));
  const invited = inR.filter((x) => x.via === 'invite').length;
  return { invited, total: inR.length, ratio: inR.length ? invited / inR.length : 0, ready: rows.some((x) => x.via === 'invite') };
}

/** 재선적률 — 기간 안 예약한 셀러 중, 그 기간 첫 예약 전에 이미 예약한 적이 있는 셀러 비율 */
export function repeatRate(booked: MetricEvent[], r: Range): { sellers: number; repeat: number; rate: number | null } {
  const firstEver = new Map<string, number>();
  const firstIn = new Map<string, number>();
  for (const e of booked) {
    if (e.kind !== 'booked' || !e.sellerOrgId) continue;
    const t = ms(e.at);
    if (t >= ms(r.to)) continue;
    const f = firstEver.get(e.sellerOrgId);
    if (f == null || t < f) firstEver.set(e.sellerOrgId, t);
    if (inRange(e.at, r)) {
      const g = firstIn.get(e.sellerOrgId);
      if (g == null || t < g) firstIn.set(e.sellerOrgId, t);
    }
  }
  let repeat = 0;
  for (const [s, t] of firstIn) if ((firstEver.get(s) ?? t) < t) repeat++;
  return { sellers: firstIn.size, repeat, rate: firstIn.size ? repeat / firstIn.size : null };
}

export interface InvoiceRow {
  shipmentId: string;
  at: string;
  version: number;
  total: number;
  bidTotal: number;
}

/** 견적(고른 응찰) 대비 청구 차이 — 선적마다 최신 판. 기간은 최신 판의 발행 시각으로 가른다. */
export function quoteVsInvoice(rows: InvoiceRow[], r: Range): { n: number; avgSigned: number | null; avgAbs: number | null; over5: number } {
  const latest = new Map<string, InvoiceRow>();
  for (const x of rows) {
    const p = latest.get(x.shipmentId);
    if (!p || x.version > p.version || (x.version === p.version && ms(x.at) > ms(p.at))) latest.set(x.shipmentId, x);
  }
  const devs: number[] = [];
  for (const x of latest.values()) {
    if (!inRange(x.at, r) || !(x.bidTotal > 0)) continue;
    devs.push((x.total - x.bidTotal) / x.bidTotal);
  }
  if (!devs.length) return { n: 0, avgSigned: null, avgAbs: null, over5: 0 };
  const sum = (a: number[]) => a.reduce((t, v) => t + v, 0);
  return { n: devs.length, avgSigned: sum(devs) / devs.length, avgAbs: sum(devs.map(Math.abs)) / devs.length, over5: devs.filter((d) => Math.abs(d) >= 0.05).length };
}

export interface InboundRow {
  at: string;
  units: number;
  returned: number;
}

/** 회송률 — 회송 수량 ÷ 선적 수량(기간 안 FC 입고) */
export function returnRate(rows: InboundRow[], r: Range): { units: number; returned: number; rate: number | null; shipments: number; withReturn: number } {
  let units = 0;
  let returned = 0;
  let shipments = 0;
  let withReturn = 0;
  for (const x of rows) {
    if (!inRange(x.at, r)) continue;
    shipments++;
    units += x.units;
    returned += Math.min(x.returned, x.units);
    if (x.returned > 0) withReturn++;
  }
  return { units, returned, rate: units ? returned / units : null, shipments, withReturn };
}

export interface BookedRow {
  at: string;
  amounts: SegmentAmounts;
}

/** 선적당 매출(수수료 기준) — 기간 안 예약의 성사 수수료 합 ÷ 예약 수 */
export function revenuePerShipment(rows: BookedRow[], r: Range, rateBp: number): { n: number; commission: number; perShipment: number | null } {
  let n = 0;
  let commission = 0;
  for (const x of rows) {
    if (!inRange(x.at, r)) continue;
    n++;
    commission += commissionAmount(x.amounts, rateBp);
  }
  return { n, commission, perShipment: n ? Math.round(commission / n) : null };
}

/** 달별 선적당 매출 */
export function monthlyRevenuePerShipment(rows: BookedRow[], months: string[], rateBp: number): { month: string; v: number | null }[] {
  return months.map((m) => {
    const inM = rows.filter((x) => monthKey(x.at) === m);
    if (!inM.length) return { month: m, v: null };
    const c = inM.reduce((t, x) => t + commissionAmount(x.amounts, rateBp), 0);
    return { month: m, v: Math.round(c / inM.length) };
  });
}

/** 'YYYY-MM' → '9월' */
export function monthLabel(m: string): string {
  return `${+m.slice(5, 7)}월`;
}
