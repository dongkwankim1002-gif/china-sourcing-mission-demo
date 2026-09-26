/**
 * 청구서 점검 — 셀러가 받은 견적서·청구서의 줄을 9구간으로 모아 구간 시세와 비교한다.
 * 순수 함수. DB·환경변수·시계를 읽지 않는다. 기준치(과함·빠짐 판정선, 최소 표본)는 인자(설정 표 `invoice_check_rule`)로 받는다.
 *
 *   줄(항목·금액·통화·구간) → 원 환산 → 구간별 합
 *   구간 시세(같은 화물로 계산한 요금표들의 구간 금액 분포) → 구간마다 판정
 *     high      과한 구간 — 중간값보다 기준 넘게 높고, 비싼 쪽 25% 경계도 넘는다
 *     typical   시세 안
 *     low       중간값보다 기준 넘게 낮다 — 뒤에 따로 붙을 항목이 없는지 확인
 *     missing   빠진 구간 — 시장 요금표 대부분이 이 구간을 맡는데 청구서에 없다(나중에 따로 청구될 위험)
 *     separate  보통 따로 맡기는 구간 — 청구서에 없고 시장도 대부분 따로(따로 들 비용 참고치만)
 *     unknown   비교할 기준이 없다
 */
import { divRoundHalfUp, toNumber, toScaled, BP } from './decimal';
import type { Currency } from './quote';
import { SEGMENTS, type Segment } from './segments';

export type LineSegment = Segment | 'tax' | null;

/** 청구서 한 줄 — 금액은 그 통화 단위(원·위안·달러) */
export interface InvoiceLine {
  label: string;
  amount: number;
  currency: Currency;
  /** 9구간 중 하나, 'tax' = 관세·부가세(비교에서 뺀다), null = 아직 못 정함 */
  segment: LineSegment;
}

export interface InvoiceCheckRule {
  /** 구간 표본(그 구간을 맡는 요금표 수)이 이보다 적으면 시장 분포 대신 참고치로 비교한다 */
  minSamples: number;
  /** 중간값보다 이만큼(bp) 넘게 높으면 「과함」 후보 */
  highOverMedianBp: number;
  /** 중간값보다 이만큼(bp) 넘게 낮으면 「낮음」 */
  lowUnderMedianBp: number;
  /** 시장 요금표 중 이 비율(bp) 이상이 맡는 구간이 청구서에 없으면 「빠짐」, 아니면 「따로」 */
  missingCoverageBp: number;
  /** 비로그인 점검 — IP 당 분당 횟수 */
  publicPerMinute: number;
  /**
   * 분포의 퍼짐(싼 쪽 25%·비싼 쪽 25%·최저)을 싣는 최소 표본. 이보다 적으면 중간값만 싣는다 —
   * 표본 3~4건에서 네 분위를 모두 내면 요금표 금액이 거의 그대로 드러난다. 없으면 퍼짐을 싣지 않는다.
   */
  minSpreadSamples?: number;
}

export interface Distribution {
  n: number;
  min: number;
  /** 싼 쪽 25% 경계 */
  q1: number;
  median: number;
  /** 비싼 쪽 25% 경계 */
  q3: number;
  max: number;
}

/** 구간 하나의 비교 기준 */
export interface Benchmark {
  /** market = 요금표 분포, reference = 플랫폼 참고치(표본 부족), none = 기준 없음 */
  source: 'market' | 'reference' | 'none';
  /** 이 구간을 맡은 요금표 수 */
  n: number;
  median: number | null;
  q1: number | null;
  q3: number | null;
  /** 표본이 적으면 싣지 않는다(한 업체 가격이 드러나지 않게) */
  min: number | null;
  /** 이 구간을 맡는 요금표 비율(bp). 요금표가 없으면 null */
  coverageBp: number | null;
}

export type Verdict = 'high' | 'typical' | 'low' | 'missing' | 'separate' | 'unknown';

export interface SegmentCheck {
  segment: Segment;
  /** 청구서의 이 구간 합(원). 없으면 null */
  amount: number | null;
  /** 이 구간으로 모인 줄 수 */
  lines: number;
  benchmark: Benchmark;
  verdict: Verdict;
  /** 청구 − 중간값 */
  diffFromMedian: number | null;
  /** (청구 − 중간값) / 중간값, bp */
  overMedianBp: number | null;
  /** 청구 − 최저 */
  diffFromMin: number | null;
  /** 빠진·따로 구간이면 들 것으로 보이는 금액(중간값 또는 참고치) */
  expected: number | null;
}

export interface MarketTotals {
  /** 같은 조건으로 계산한 요금표 수 */
  cards: number;
  /** 빈 구간을 참고치로 채운 총액의 분포 */
  totals: Distribution | null;
}

export interface InvoiceCheckResult {
  segments: SegmentCheck[];
  /** 구간을 정한 줄의 합(원) */
  classifiedTotal: number;
  /** 구간을 못 정한 줄 */
  unclassified: { label: string; amount: number }[];
  unclassifiedTotal: number;
  /** 관세·부가세 — 물류비 비교에서 뺀다 */
  taxTotal: number;
  /** 물류비 청구 합계 = 구간 합 + 못 정한 줄 */
  invoiceTotal: number;
  /** 빠진 구간이 뒤에 붙으면 — 물류비 합계 + 빠진 구간 예상 */
  projectedTotal: number;
  market: {
    cards: number;
    median: number | null;
    q1: number | null;
    min: number | null;
    /** (예상 합계 − 중간값) / 중간값, bp */
    overMedianBp: number | null;
  };
  counts: Record<Verdict, number>;
  /** 참고치로 비교한 구간 수 */
  referenceCount: number;
  /** 과한 구간의 중간값 초과분 합 */
  highExcess: number;
  /** 빠진 구간 예상 합 — 나중에 따로 청구될 수 있는 돈 */
  missingRisk: number;
  /** 따로 맡기는 구간 예상 합 */
  separateExpected: number;
}

/** 분위수 — 가까운 순위(구간 시세 화면과 같은 방식) */
function quantile(sorted: number[], p: number) {
  return sorted[Math.min(sorted.length - 1, Math.floor(p * (sorted.length - 1) + 0.5))];
}

export function distribution(values: number[]): Distribution | null {
  const s = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (s.length === 0) return null;
  const m = Math.floor(s.length / 2);
  const median = s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
  return { n: s.length, min: s[0], q1: quantile(s, 0.25), median, q3: quantile(s, 0.75), max: s[s.length - 1] };
}

/** 외화 → 원(반올림). fx = 1 외화당 원 */
export function toKrw(amount: number, currency: Currency, fx: Record<Currency, number>): number {
  if (!Number.isFinite(amount)) throw new RangeError(`금액이 숫자가 아닙니다: ${amount}`);
  const rate = fx[currency];
  if (rate == null) throw new RangeError(`환율이 없습니다: ${currency}`);
  return toNumber(divRoundHalfUp(toScaled(amount, 2) * toScaled(rate, 4), 1_000_000n));
}

/**
 * 구간 하나의 기준 — 이 구간을 맡은 요금표들의 금액(amounts)과 전체 요금표 수(cards), 참고치(reference).
 * 표본이 minSamples 이상이면 시장 분포, 아니면 참고치.
 */
export function benchmarkFrom(
  amounts: number[],
  cards: number,
  reference: number | null | undefined,
  rule: Pick<InvoiceCheckRule, 'minSamples' | 'minSpreadSamples'>,
): Benchmark {
  const d = distribution(amounts);
  const coverageBp = cards > 0 ? toNumber(divRoundHalfUp(BigInt(amounts.length) * BP, BigInt(cards))) : null;
  if (d && d.n >= Math.max(1, rule.minSamples)) {
    // 표본이 적으면 중간값만 — 분위·최저까지 내면 요금표 하나하나의 금액이 드러난다
    if (!showSpread(d.n, rule)) return { source: 'market', n: d.n, median: d.median, q1: null, q3: null, min: null, coverageBp };
    return { source: 'market', n: d.n, median: d.median, q1: d.q1, q3: d.q3, min: d.min, coverageBp };
  }
  if (reference != null) {
    return { source: 'reference', n: d?.n ?? 0, median: reference, q1: reference, q3: reference, min: null, coverageBp };
  }
  return { source: 'none', n: d?.n ?? 0, median: null, q1: null, q3: null, min: null, coverageBp };
}

/** 퍼짐(분위·최저)을 실어도 되는 표본인가 — minSpreadSamples 가 없으면 싣지 않는다 */
export function showSpread(n: number, rule: Pick<InvoiceCheckRule, 'minSamples' | 'minSpreadSamples'>): boolean {
  const m = rule.minSpreadSamples;
  return typeof m === 'number' && Number.isFinite(m) && n >= Math.max(m, rule.minSamples, 1);
}

function bpOver(amount: number, base: number): number {
  return toNumber(divRoundHalfUp(BigInt(amount - base) * BP, BigInt(base)));
}

/** 청구서 줄을 원으로 바꿔 구간별로 모은다 */
export function groupLines(lines: InvoiceLine[], fx: Record<Currency, number>) {
  const bySeg = new Map<Segment, { amount: number; lines: number }>();
  const unclassified: { label: string; amount: number }[] = [];
  let taxTotal = 0;
  for (const l of lines) {
    const krw = toKrw(l.amount, l.currency, fx);
    if (l.segment === 'tax') taxTotal += krw;
    else if (l.segment == null) unclassified.push({ label: l.label, amount: krw });
    else {
      const e = bySeg.get(l.segment) ?? { amount: 0, lines: 0 };
      e.amount += krw;
      e.lines++;
      bySeg.set(l.segment, e);
    }
  }
  return { bySeg, unclassified, taxTotal };
}

export function checkInvoice(input: {
  lines: InvoiceLine[];
  fx: Record<Currency, number>;
  benchmarks: Record<Segment, Benchmark>;
  market: MarketTotals;
  rule: InvoiceCheckRule;
}): InvoiceCheckResult {
  const { rule } = input;
  const { bySeg, unclassified, taxTotal } = groupLines(input.lines, input.fx);
  const counts: Record<Verdict, number> = { high: 0, typical: 0, low: 0, missing: 0, separate: 0, unknown: 0 };
  let classifiedTotal = 0;
  let highExcess = 0;
  let missingRisk = 0;
  let separateExpected = 0;
  let referenceCount = 0;

  const segments: SegmentCheck[] = SEGMENTS.map((segment) => {
    const b = input.benchmarks[segment] ?? { source: 'none', n: 0, median: null, q1: null, q3: null, min: null, coverageBp: null };
    const got = bySeg.get(segment);
    // 0원 줄만 있으면 「청구서에 없음」으로 본다(「포함·0원」은 드물고, 대개 칸만 적어 둔 것)
    const amount = got && got.amount !== 0 ? got.amount : null;
    if (b.source === 'reference') referenceCount++;
    let verdict: Verdict = 'unknown';
    let diffFromMedian: number | null = null;
    let overMedianBp: number | null = null;
    let diffFromMin: number | null = null;
    let expected: number | null = null;
    if (amount != null) {
      classifiedTotal += amount;
      if (b.median != null && b.median > 0) {
        diffFromMedian = amount - b.median;
        overMedianBp = bpOver(amount, b.median);
        diffFromMin = b.min != null ? amount - b.min : null;
        // 비싼 쪽 25% 경계는 퍼짐을 실을 만큼 표본이 있을 때만 조건에 넣는다(참고치·적은 표본은 중간값 기준만)
        const aboveQ3 = b.source !== 'market' || b.q3 == null || amount > b.q3;
        if (overMedianBp >= rule.highOverMedianBp && aboveQ3) verdict = 'high';
        else if (-overMedianBp >= rule.lowUnderMedianBp) verdict = 'low';
        else verdict = 'typical';
        if (verdict === 'high') highExcess += diffFromMedian;
      }
    } else if (b.median != null && b.median > 0) {
      expected = b.median;
      // 시장 요금표가 대부분 맡는 구간이면 빠진 것, 아니면 보통 따로 맡기는 구간.
      // 요금표가 모자라 비율을 모르면(참고치) 조심스럽게 「빠짐」으로 본다.
      const common = b.coverageBp == null || b.source !== 'market' ? true : b.coverageBp >= rule.missingCoverageBp;
      verdict = common ? 'missing' : 'separate';
      if (verdict === 'missing') missingRisk += expected;
      else separateExpected += expected;
    }
    counts[verdict]++;
    return { segment, amount, lines: got?.lines ?? 0, benchmark: b, verdict, diffFromMedian, overMedianBp, diffFromMin, expected };
  });

  const unclassifiedTotal = unclassified.reduce((t, u) => t + u.amount, 0);
  const invoiceTotal = classifiedTotal + unclassifiedTotal;
  const projectedTotal = invoiceTotal + missingRisk;
  const t = input.market.totals && input.market.totals.n >= Math.max(1, rule.minSamples) ? input.market.totals : null;
  return {
    segments,
    classifiedTotal,
    unclassified,
    unclassifiedTotal,
    taxTotal,
    invoiceTotal,
    projectedTotal,
    market: {
      cards: input.market.cards,
      median: t?.median ?? null,
      q1: t && showSpread(t.n, rule) ? t.q1 : null,
      min: t && showSpread(t.n, rule) ? t.min : null,
      overMedianBp: t && t.median > 0 && projectedTotal > 0 ? bpOver(projectedTotal, t.median) : null,
    },
    counts,
    referenceCount,
    highExcess,
    missingRisk,
    separateExpected,
  };
}
