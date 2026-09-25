/**
 * 청구 대 견적 — 물류사가 낸 청구서를 화주가 승인하거나 이의를 남길 때 곁에 보이는 차이.
 * 순수 함수. 원 단위 정수만 받는다. 비율은 bp(1/10000) 정수로, 사사오입.
 * 「차이가 크다」의 기준(flagBp)은 설정 fcd.settings 의 workspace.billing_flag_bp 에서 읽어 넘긴다.
 */
import { divRoundHalfUp, toNumber } from './decimal';
import { SEGMENTS, type Segment } from './segments';

export interface BillingDiffRow {
  segment: Segment;
  quote: number | null;
  invoice: number | null;
  /** 청구 − 견적(없는 칸은 0 으로 보고 뺀다) */
  delta: number;
  /** 견적에 없던 칸이 청구에 새로 생김 */
  added: boolean;
}

export interface BillingDiff {
  rows: BillingDiffRow[];
  quoteTotal: number;
  invoiceTotal: number;
  /** 청구 합계 − 견적 합계 */
  delta: number;
  /** 차이 비율(bp). 견적 합계가 0 이면 null */
  deviationBp: number | null;
  /** |차이| ≥ flagBp */
  flagged: boolean;
  /** 늘어난 칸(금액이 큰 순) */
  increased: Segment[];
}

function int(n: number | null | undefined, what: string): number | null {
  if (n == null) return null;
  if (!Number.isSafeInteger(n)) throw new RangeError(`${what}: 원 단위 정수가 아닙니다 (${n})`);
  if (n < 0) throw new RangeError(`${what}: 음수입니다 (${n})`);
  return n;
}

export function billingDiff(
  quote: Partial<Record<string, number | null>>,
  invoice: Partial<Record<string, number | null>>,
  flagBp: number,
): BillingDiff {
  if (!Number.isInteger(flagBp) || flagBp < 0) throw new RangeError(`기준 bp 가 올바르지 않습니다: ${flagBp}`);
  let qt = 0;
  let it = 0;
  const rows: BillingDiffRow[] = SEGMENTS.map((s) => {
    const q = int(quote[s], `견적 ${s}`);
    const i = int(invoice[s], `청구 ${s}`);
    qt += q ?? 0;
    it += i ?? 0;
    return { segment: s, quote: q, invoice: i, delta: (i ?? 0) - (q ?? 0), added: q == null && i != null && i > 0 };
  });
  const delta = it - qt;
  const deviationBp = qt === 0 ? null : toNumber(divRoundHalfUp(BigInt(delta) * 10_000n, BigInt(qt)));
  const flagged = deviationBp == null ? it > 0 : Math.abs(deviationBp) >= flagBp;
  const increased = rows
    .filter((r) => r.delta > 0)
    .sort((a, b) => b.delta - a.delta || SEGMENTS.indexOf(a.segment) - SEGMENTS.indexOf(b.segment))
    .map((r) => r.segment);
  return { rows, quoteTotal: qt, invoiceTotal: it, delta, deviationBp, flagged, increased };
}
