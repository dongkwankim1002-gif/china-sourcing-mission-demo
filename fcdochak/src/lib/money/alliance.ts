/**
 * 제휴 주선사 정산 — 순수 함수(docs/alliance-plan.md 4·7·8장).
 *
 * 구조: 셀러는 제휴 주선사와 확정가로 계약한다. 주선사는 플랫폼에 제휴 수수료와 준비금 적립분을 내고,
 * 외부 요인으로 생긴 초과비용의 플랫폼 몫(상한 있음)은 준비금에서 먼저 받는다.
 *
 *   수수료 = (확정가 − 관세사 보수) × 수수료율 — 관세사 보수를 빼는 원칙은 commission.ts 와 같다(관세사법 제3조).
 *   부가세 = 수수료 × 부가세율, 원 미만 버림.
 *   준비금 적립 = 프리미엄 × 적립률.
 *   사건 부담 = 셀러 귀책 → 셀러 100% · 주선사 귀책 → 주선사 100% · 외부 요인 → 플랫폼 min(금액 × 비율, 확정가 × 상한), 나머지 주선사.
 *   주선사가 낼 돈 = 수수료 + 부가세 + 준비금 적립 − 플랫폼 부담분(음수면 플랫폼이 낸다).
 *
 * 금액은 원 단위 정수, 비율은 bp(1/10000) 정수. 곱셈은 BigInt 로 하고 사사오입(부가세만 버림).
 * 요율·비율은 계약 조건 판(fcd.alliance_terms)에서 읽어 넘긴다 — 여기에는 기본값을 두지 않는다.
 */
import { BP, divFloor, divRoundHalfUp, toNumber } from './decimal';
import { daysUntil } from './eligibility';

export const INCIDENT_KINDS = ['overrun', 'return', 'loss', 'delay'] as const;
export type IncidentKind = (typeof INCIDENT_KINDS)[number];
export const FAULTS = ['seller', 'partner', 'external'] as const;
export type Fault = (typeof FAULTS)[number];

/** 사건 하나의 외부 요인 분담 — 플랫폼 비율(bp)과 건당 상한(확정가의 bp) */
export interface LiabilityShare {
  platformBp: number;
  capBp: number;
}
export type Liability = Record<IncidentKind, LiabilityShare>;

export interface AllianceTermsInput {
  commissionBp: number;
  reserveBp: number;
  liability: Liability;
}

function won(n: number, what: string): number {
  if (!Number.isSafeInteger(n) || n < 0) throw new RangeError(`${what}: 0 이상 원 단위 정수가 아닙니다 (${n})`);
  return n;
}
function bp(n: number, what: string, max = 10000): number {
  if (!Number.isInteger(n) || n < 0 || n > max) throw new RangeError(`${what}: 0~${max}bp 정수가 아닙니다 (${n})`);
  return n;
}
const mulBp = (amount: number, rateBp: number) => toNumber(divRoundHalfUp(BigInt(amount) * BigInt(rateBp), BP));

export function validateTerms(t: AllianceTermsInput): AllianceTermsInput {
  bp(t.commissionBp, '수수료율', 3000);
  bp(t.reserveBp, '준비금 적립률');
  for (const k of INCIDENT_KINDS) {
    const s = t.liability?.[k];
    if (!s) throw new RangeError(`책임 비율이 없습니다: ${k}`);
    bp(s.platformBp, `${k} 플랫폼 비율`);
    bp(s.capBp, `${k} 상한`);
  }
  return t;
}

/** 수수료 나누기 — 확정가 중 관세사 보수를 뺀 기준에 요율. 주선사 몫 = 확정가 − 수수료 */
export function splitCommission(firmPrice: number, brokerFee: number, commissionBp: number) {
  won(firmPrice, '확정가');
  won(brokerFee, '관세사 보수');
  bp(commissionBp, '수수료율', 3000);
  if (brokerFee > firmPrice) throw new RangeError('관세사 보수가 확정가보다 큽니다');
  const base = firmPrice - brokerFee;
  const commission = mulBp(base, commissionBp);
  return { base, commission, partnerGross: firmPrice - commission };
}

/** 부가세 — 원 미만 버림 */
export function vatOf(amount: number, vatBp: number): number {
  won(amount, '공급가액');
  bp(vatBp, '부가세율', 3000);
  return toNumber(divFloor(BigInt(amount) * BigInt(vatBp), BP));
}

export interface IncidentShare {
  amount: number;
  seller: number;
  partner: number;
  platform: number;
  /** 플랫폼 몫이 상한에 걸렸는가 */
  capped: boolean;
}

/** 사건 하나의 부담 — 귀책으로 가르고, 외부 요인이면 플랫폼 비율·상한 */
export function allocateIncident(amount: number, fault: Fault, share: LiabilityShare, firmPrice: number): IncidentShare {
  won(amount, '사건 금액');
  won(firmPrice, '확정가');
  bp(share.platformBp, '플랫폼 비율');
  bp(share.capBp, '상한');
  if (fault === 'seller') return { amount, seller: amount, partner: 0, platform: 0, capped: false };
  if (fault === 'partner') return { amount, seller: 0, partner: amount, platform: 0, capped: false };
  const want = mulBp(amount, share.platformBp);
  const cap = mulBp(firmPrice, share.capBp);
  const platform = Math.min(want, cap);
  return { amount, seller: 0, partner: amount - platform, platform, capped: want > cap };
}

/** 초과비용 = max(0, 실제 원가 − 확정가) 를 귀책대로 나눈다 */
export function allocateOverrun(firmPrice: number, actualCost: number, fault: Fault, share: LiabilityShare): IncidentShare {
  won(actualCost, '실제 원가');
  const over = Math.max(0, actualCost - won(firmPrice, '확정가'));
  return allocateIncident(over, fault, share, firmPrice);
}

/** 준비금 적립 = 프리미엄 × 적립률 */
export function reserveAccrual(premium: number, reserveBp: number): number {
  return mulBp(won(premium, '프리미엄'), bp(reserveBp, '준비금 적립률'));
}

export type ReserveMove = { kind: 'accrue'; amount: number } | { kind: 'draw'; amount: number };

/**
 * 준비금 적립·소진 — 순서대로. 소진이 잔액보다 크면 잔액만큼 쓰고 나머지는 「부족」(플랫폼 자기 돈).
 * 잔액은 음수가 되지 않는다.
 */
export function reserveLedger(opening: number, moves: ReserveMove[]) {
  let balance = won(opening, '기초 준비금');
  let accrued = 0;
  let drawn = 0;
  let shortfall = 0;
  const lines = moves.map((m) => {
    won(m.amount, '준비금 이동');
    if (m.kind === 'accrue') {
      balance += m.amount;
      accrued += m.amount;
      return { ...m, used: m.amount, short: 0, balance };
    }
    const used = Math.min(balance, m.amount);
    balance -= used;
    drawn += used;
    shortfall += m.amount - used;
    return { ...m, used, short: m.amount - used, balance };
  });
  return { opening, accrued, drawn, shortfall, closing: balance, lines };
}

export interface SettlementIncident {
  kind: Exclude<IncidentKind, 'overrun'>;
  amount: number;
  fault: Fault;
}

export interface SettlementLineInput {
  /** 선적 번호 등 참조(사람이 읽는 값) */
  ref: string;
  firmPrice: number;
  premium: number;
  brokerFee: number;
  actualCost: number;
  /** 초과비용의 귀책(초과가 없으면 쓰이지 않는다) */
  overrunFault: Fault;
  incidents?: SettlementIncident[];
}

export interface SettlementLine {
  ref: string;
  firmPrice: number;
  premium: number;
  brokerFee: number;
  actualCost: number;
  commission: number;
  reserveIn: number;
  overrunFault: Fault;
  overrun: IncidentShare;
  incidents: (SettlementIncident & IncidentShare)[];
  /** 이 선적의 플랫폼 부담 합계 */
  platform: number;
  seller: number;
  partner: number;
}

export interface SettlementTotals {
  lines: SettlementLine[];
  count: number;
  grossFirm: number;
  commissionBase: number;
  commission: number;
  commissionVat: number;
  reserveIn: number;
  overrunTotal: number;
  platformShare: number;
  partnerShare: number;
  sellerShare: number;
  reserveOpening: number;
  reserveDrawn: number;
  /** 준비금이 모자라 플랫폼이 자기 돈으로 낼 몫 */
  reserveShortfall: number;
  reserveClosing: number;
  /** 주선사 → 플랫폼(음수면 플랫폼 → 주선사) */
  netPayable: number;
}

/**
 * 정산 합계 — 한 기간의 선적 줄을 모아 명세를 만든다.
 * 준비금은 기간 안 적립을 먼저 더하고(같은 달 적립으로 같은 달 사고를 받친다) 플랫폼 부담을 뺀다.
 */
/** 저장한 명세 줄에서 입력을 되살린다(새 판을 같은 줄로 다시 셈할 때) */
export function linesToInput(lines: Pick<SettlementLine, 'ref' | 'firmPrice' | 'premium' | 'brokerFee' | 'actualCost' | 'overrunFault' | 'incidents'>[]): SettlementLineInput[] {
  return lines.map((l) => ({
    ref: l.ref,
    firmPrice: l.firmPrice,
    premium: l.premium,
    brokerFee: l.brokerFee,
    actualCost: l.actualCost,
    overrunFault: l.overrunFault,
    incidents: (l.incidents ?? []).map((i) => ({ kind: i.kind, amount: i.amount, fault: i.fault })),
  }));
}

export function settleAlliance(input: SettlementLineInput[], terms: AllianceTermsInput, vatBp: number, reserveOpening = 0): SettlementTotals {
  validateTerms(terms);
  const lines: SettlementLine[] = input.map((l) => {
    if (typeof l.ref !== 'string' || !l.ref.trim()) throw new RangeError('참조가 비었습니다');
    if (won(l.premium, '프리미엄') > won(l.firmPrice, '확정가')) throw new RangeError(`${l.ref}: 프리미엄이 확정가보다 큽니다`);
    const c = splitCommission(l.firmPrice, l.brokerFee, terms.commissionBp);
    const overrun = allocateOverrun(l.firmPrice, l.actualCost, l.overrunFault, terms.liability.overrun);
    const incidents = (l.incidents ?? []).map((i) => ({ ...i, ...allocateIncident(i.amount, i.fault, terms.liability[i.kind], l.firmPrice) }));
    const sum = (k: 'platform' | 'seller' | 'partner') => overrun[k] + incidents.reduce((t, i) => t + i[k], 0);
    return {
      ref: l.ref.trim(),
      firmPrice: l.firmPrice,
      premium: l.premium,
      brokerFee: l.brokerFee,
      actualCost: l.actualCost,
      commission: c.commission,
      reserveIn: reserveAccrual(l.premium, terms.reserveBp),
      overrunFault: l.overrunFault,
      overrun,
      incidents,
      platform: sum('platform'),
      seller: sum('seller'),
      partner: sum('partner'),
    };
  });
  const tot = (f: (l: SettlementLine) => number) => lines.reduce((t, l) => t + f(l), 0);
  const commission = tot((l) => l.commission);
  const commissionVat = vatOf(commission, vatBp);
  const reserveIn = tot((l) => l.reserveIn);
  const platformShare = tot((l) => l.platform);
  const ledger = reserveLedger(reserveOpening, [{ kind: 'accrue', amount: reserveIn }, { kind: 'draw', amount: platformShare }]);
  return {
    lines,
    count: lines.length,
    grossFirm: tot((l) => l.firmPrice),
    commissionBase: tot((l) => l.firmPrice - l.brokerFee),
    commission,
    commissionVat,
    reserveIn,
    overrunTotal: tot((l) => l.overrun.amount),
    platformShare,
    partnerShare: tot((l) => l.partner),
    sellerShare: tot((l) => l.seller),
    reserveOpening,
    reserveDrawn: ledger.drawn,
    reserveShortfall: ledger.shortfall,
    reserveClosing: ledger.closing,
    netPayable: commission + commissionVat + reserveIn - platformShare,
  };
}

export interface AllianceSimInput {
  shipments: number;
  firmPrice: number;
  premium: number;
  brokerFee: number;
  /** 외부 요인 초과가 생기는 선적 비율(bp) */
  overrunRateBp: number;
  /** 초과 한 건 평균(원) */
  overrunAmount: number;
}

/** 수익 시뮬레이션(가정치) — 같은 선적 N건으로 settleAlliance 를 돌린다(문서 8장 숫자) */
export function simulateAlliance(s: AllianceSimInput, terms: AllianceTermsInput, vatBp: number) {
  if (!Number.isSafeInteger(s.shipments) || s.shipments < 0 || s.shipments > 100_000) throw new RangeError('선적 수가 범위를 벗어났습니다');
  bp(s.overrunRateBp, '초과 발생률');
  const over = toNumber(divRoundHalfUp(BigInt(s.shipments) * BigInt(s.overrunRateBp), BP));
  const lines: SettlementLineInput[] = Array.from({ length: s.shipments }, (_, i) => ({
    ref: `가정-${i + 1}`,
    firmPrice: s.firmPrice,
    premium: s.premium,
    brokerFee: s.brokerFee,
    actualCost: i < over ? s.firmPrice + s.overrunAmount : s.firmPrice - s.premium,
    overrunFault: 'external',
  }));
  const r = settleAlliance(lines, terms, vatBp, 0);
  return {
    overrunShipments: over,
    commission: r.commission,
    commissionVat: r.commissionVat,
    reserveIn: r.reserveIn,
    overrunTotal: r.overrunTotal,
    platformShare: r.platformShare,
    partnerShare: r.partnerShare,
    reserveNet: r.reserveIn - r.platformShare,
    netPayable: r.netPayable,
    commissionBase: r.commissionBase,
  };
}

/** 등록번호 끝 4자리(숫자·글자만 세어) — 화주에게는 이것만 보인다. SQL fcd.alliance_tail 과 같은 규칙 */
export function registrationTail(no: string | null | undefined): string | null {
  if (!no) return null;
  const s = no.replace(/[^0-9A-Za-z]/g, '');
  return s.length ? s.slice(-4) : null;
}

export type ExpiryState = 'none' | 'ok' | 'soon' | 'expired';
export function expiryState(validUntil: string | null, today: string, warnDays: number): ExpiryState {
  if (!validUntil) return 'none';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(validUntil) || !/^\d{4}-\d{2}-\d{2}$/.test(today)) throw new RangeError('날짜 형식이 아닙니다');
  const n = daysUntil(validUntil, today);
  return n < 0 ? 'expired' : n <= warnDays ? 'soon' : 'ok';
}
