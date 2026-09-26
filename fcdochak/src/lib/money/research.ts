/**
 * 셀러 인터뷰 · 먼저 검증할 실험 셋 — 순수 함수(docs/research-plan.md 5·6절).
 *
 *  ① 확정가 지불 의향: 가격 사다리(낮은 값부터, 처음 「아니오」에서 멈춤) → 한 사람의 수용 한도 →
 *     값마다 「그 값 이상 받겠다」 비율(말로 한 의향)과 반대 질문을 통과한 「확인된 의향」, 윌슨 95% 구간 → 판정.
 *  ② 청구서 점검 업로드 비율: 점검까지 간 기기 ÷ 방문한 기기.
 *  ③ 물량 단가 곡선: 업체 종류·포함 범위별로 물량 구간마다 CBM 당 단가 중간값 → 콘솔사(큰 물량) 대 포워더(작은 물량) 할인율.
 *
 * 기준치는 fcd.settings 의 research.rules 에서 읽어 넘긴다 — 여기에 박지 않는다.
 * 비율은 bp(만분율) 정수로 낸다(반올림). 금액은 원 단위 정수.
 */

export interface ResearchRules {
  /** 사다리 값(bp, 오름차순) — 첫 판 100·300·500·800 */
  ladderBp: number[];
  /** 방안 A 판정 기준 프리미엄(bp) — 첫 판 300 */
  thresholdBp: number;
  /** 「다수」 — 이 비율(bp)을 넘어야(같으면 미충족) 충족 */
  majorityBp: number;
  /** 이보다 적으면 「표본 부족」 */
  minSample: number;
  uploadTargetBp: number;
  uploadMinVisitors: number;
  volumeBucketsCbm: number[];
  consolidationVolumeCbm: number;
  consolidationBaseCbm: number;
  consolidationDiscountBp: number;
  consolidationMinQuotes: number;
  inviteDays: number;
  consentVersion: string;
  retentionDays: number;
  publicPerMinute: number;
}

export type Verdict = 'met' | 'not_met' | 'insufficient';

export const VERDICT_LABEL: Record<Verdict, string> = {
  met: '기준 충족',
  not_met: '기준 미충족',
  insufficient: '표본 부족',
};

const isInt = (v: unknown, min = 0) => typeof v === 'number' && Number.isInteger(v) && v >= min;
const isNum = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v > 0;

/** 설정 값 → 규칙. 모양이 틀리면 멈춘다(참조 시드를 올려야 한다). */
export function parseResearchRules(v: unknown): ResearchRules {
  const o = (v ?? {}) as Record<string, unknown>;
  const bad = (k: string) => new Error(`설정 research.rules.${k} 가 없거나 올바르지 않습니다. 참조 시드를 올려 주세요.`);
  const ladder = o.ladderBp;
  if (!Array.isArray(ladder) || ladder.length < 2 || ladder.length > 8 || !ladder.every((x) => isInt(x, 1) && x <= 10000)) throw bad('ladderBp');
  for (let i = 1; i < ladder.length; i++) if (ladder[i] <= ladder[i - 1]) throw bad('ladderBp');
  const buckets = o.volumeBucketsCbm;
  if (!Array.isArray(buckets) || buckets.length < 2 || !buckets.every(isNum)) throw bad('volumeBucketsCbm');
  for (let i = 1; i < buckets.length; i++) if (buckets[i] <= buckets[i - 1]) throw bad('volumeBucketsCbm');
  for (const k of ['thresholdBp', 'majorityBp', 'uploadTargetBp', 'consolidationDiscountBp'] as const) if (!isInt(o[k], 0) || (o[k] as number) > 10000) throw bad(k);
  for (const k of ['minSample', 'uploadMinVisitors', 'consolidationMinQuotes', 'inviteDays', 'retentionDays', 'publicPerMinute'] as const) if (!isInt(o[k], 1)) throw bad(k);
  if ((o.inviteDays as number) > 90) throw bad('inviteDays');
  for (const k of ['consolidationVolumeCbm', 'consolidationBaseCbm'] as const) if (!isNum(o[k])) throw bad(k);
  if (typeof o.consentVersion !== 'string' || !o.consentVersion.trim() || o.consentVersion.length > 40) throw bad('consentVersion');
  return {
    ladderBp: ladder as number[],
    thresholdBp: o.thresholdBp as number,
    majorityBp: o.majorityBp as number,
    minSample: o.minSample as number,
    uploadTargetBp: o.uploadTargetBp as number,
    uploadMinVisitors: o.uploadMinVisitors as number,
    volumeBucketsCbm: buckets as number[],
    consolidationVolumeCbm: o.consolidationVolumeCbm as number,
    consolidationBaseCbm: o.consolidationBaseCbm as number,
    consolidationDiscountBp: o.consolidationDiscountBp as number,
    consolidationMinQuotes: o.consolidationMinQuotes as number,
    inviteDays: o.inviteDays as number,
    consentVersion: o.consentVersion,
    retentionDays: o.retentionDays as number,
    publicPerMinute: o.publicPerMinute as number,
  };
}

/** k / n 을 bp 로(사사오입). n = 0 이면 null */
export function shareBp(k: number, n: number): number | null {
  if (!Number.isInteger(k) || !Number.isInteger(n) || k < 0 || n < 0 || k > n) throw new RangeError(`비율 인자가 올바르지 않습니다: ${k}/${n}`);
  if (n === 0) return null;
  return Math.floor((k * 10000 * 2 + n) / (2 * n));
}

/** 윌슨 점수 구간(95%, z = 1.96) — [아래, 위] bp. n = 0 이면 null */
export function wilsonBp(k: number, n: number, z = 1.96): [number, number] | null {
  if (!Number.isInteger(k) || !Number.isInteger(n) || k < 0 || n < 0 || k > n) throw new RangeError(`비율 인자가 올바르지 않습니다: ${k}/${n}`);
  if (n === 0) return null;
  const p = k / n;
  const z2 = z * z;
  const den = 1 + z2 / n;
  const mid = (p + z2 / (2 * n)) / den;
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / den;
  const clamp = (x: number) => Math.min(10000, Math.max(0, Math.round(x * 10000)));
  return [clamp(mid - half), clamp(mid + half)];
}

/**
 * 인터뷰 미리 계산의 「청구서 점검」 — 지난번 물류비 총액 한 줄을 그 구간 총액 중간값과 견준다.
 * 판정선은 청구서 점검과 같은 invoice_check_rule(과함 = 중간값 +highOverMedianBp 이상, 낮음 = −lowUnderMedianBp 이하).
 */
export function totalVsMedian(
  total: number,
  median: number,
  rule: { highOverMedianBp: number; lowUnderMedianBp: number },
): { overMedianBp: number | null; tone: 'high' | 'typical' | 'low' | 'unknown' } {
  if (!Number.isSafeInteger(total) || total < 0 || !Number.isSafeInteger(median) || median < 0) throw new RangeError('금액은 0 이상의 원 단위 정수');
  if (median === 0) return { overMedianBp: null, tone: 'unknown' };
  const d = (total - median) * 10000;
  // 사사오입(음수도 절댓값 기준)
  const bp = d >= 0 ? Math.floor((2 * d + median) / (2 * median)) : -Math.floor((2 * -d + median) / (2 * median));
  return { overMedianBp: bp, tone: bp >= rule.highOverMedianBp ? 'high' : -bp >= rule.lowUnderMedianBp ? 'low' : 'typical' };
}

// ─── ① 지불 의향 사다리 ───────────────────────────────────────────
/** 사다리 답 — 키는 bp 문자열('100'), 값은 예/아니오, 묻지 않았으면 없음·null */
export type LadderAnswers = Record<string, boolean | null | undefined>;

export interface LadderRead {
  /** 한 번이라도 답했는가(첫 값에 답이 있는가) */
  answered: boolean;
  /** 끝까지 이어진 「예」 중 가장 높은 값(bp). 첫 값부터 「아니오」면 0 */
  maxBp: number;
  /** 「아니오」 뒤에 「예」가 있었다(인정은 이어진 「예」까지만) */
  inconsistent: boolean;
  /** 사다리 끝까지 「예」 */
  topped: boolean;
}

export function readLadder(ans: LadderAnswers | null | undefined, steps: number[]): LadderRead {
  const a = ans ?? {};
  const first = a[String(steps[0])];
  if (first !== true && first !== false) return { answered: false, maxBp: 0, inconsistent: false, topped: false };
  let maxBp = 0;
  let broke = false;
  let inconsistent = false;
  for (const s of steps) {
    const v = a[String(s)];
    if (!broke && v === true) maxBp = s;
    else if (v === true && broke) inconsistent = true;
    else broke = true; // 아니오 또는 묻지 않음 — 그 위는 아니오로 본다
  }
  return { answered: true, maxBp, inconsistent, topped: maxBp === steps[steps.length - 1] };
}

/** 반대 질문 — 「확정가 없이 지금처럼, 추가비용이 나오면 그때 따지는 편이 낫다」 */
export type CounterAnswer = 'agree' | 'disagree' | 'unsure';

export interface WtpInput {
  ladder: LadderAnswers | null | undefined;
  counter: CounterAnswer | null | undefined;
}

export interface WtpStep {
  bp: number;
  /** 그 값 이상 받겠다고 한 사람 */
  stated: number;
  statedBp: number | null;
  statedCi: [number, number] | null;
  /** 그중 반대 질문에서 흔들리지 않은 사람(「그렇다」가 아님) */
  confirmed: number;
  confirmedBp: number | null;
  confirmedCi: [number, number] | null;
}

export interface WtpCurve {
  /** 사다리에 답한 사람 */
  n: number;
  steps: WtpStep[];
  inconsistent: number;
  /** 사다리에서는 기준 이상 「예」였지만 반대 질문에 「그렇다」 — 흔들림 */
  wavered: number;
  threshold: { bp: number; stated: WtpStep | null; confirmed: WtpStep | null };
  verdict: Verdict;
  /** 충족일 때 윌슨 아래 끝까지 기준을 넘는가(강한 충족) */
  strong: boolean;
  /** 말로 한 의향과 확인된 의향의 차이(bp, 기준 값에서) */
  gapBp: number | null;
}

export function wtpCurve(rows: WtpInput[], rules: Pick<ResearchRules, 'ladderBp' | 'thresholdBp' | 'majorityBp' | 'minSample'>): WtpCurve {
  const reads = rows.map((r) => ({ l: readLadder(r.ladder, rules.ladderBp), c: r.counter ?? null })).filter((x) => x.l.answered);
  const n = reads.length;
  const steps: WtpStep[] = rules.ladderBp.map((bp) => {
    const st = reads.filter((x) => x.l.maxBp >= bp);
    const cf = st.filter((x) => x.c !== 'agree');
    return {
      bp,
      stated: st.length,
      statedBp: shareBp(st.length, n),
      statedCi: wilsonBp(st.length, n),
      confirmed: cf.length,
      confirmedBp: shareBp(cf.length, n),
      confirmedCi: wilsonBp(cf.length, n),
    };
  });
  // 기준 값이 사다리에 없으면 그 값 이상인 첫 사다리 값으로 본다(없으면 판정 불가 = 표본 부족 쪽이 아니라 미충족)
  const at = steps.find((s) => s.bp >= rules.thresholdBp) ?? null;
  const tStated = at ? { ...at } : null;
  const wavered = reads.filter((x) => x.l.maxBp >= rules.thresholdBp && x.c === 'agree').length;
  let verdict: Verdict;
  if (n < rules.minSample) verdict = 'insufficient';
  else verdict = at && (at.confirmedBp ?? 0) > rules.majorityBp ? 'met' : 'not_met';
  const strong = verdict === 'met' && !!at?.confirmedCi && at.confirmedCi[0] > rules.majorityBp;
  return {
    n,
    steps,
    inconsistent: reads.filter((x) => x.l.inconsistent).length,
    wavered,
    threshold: { bp: rules.thresholdBp, stated: tStated, confirmed: at },
    verdict,
    strong,
    gapBp: at && at.statedBp != null && at.confirmedBp != null ? at.statedBp - at.confirmedBp : null,
  };
}

// ─── 순위·점수 ──────────────────────────────────────────────────
/** 고른 값 세기 — 많은 순, 같으면 주어진 순서 */
export function tally<K extends string>(values: (K | null | undefined)[], order: readonly K[]): { key: K; n: number; bp: number | null }[] {
  const answered = values.filter((v): v is K => v != null && order.includes(v));
  const out = order.map((key) => ({ key, n: answered.filter((v) => v === key).length }));
  return out
    .map((x, i) => ({ ...x, i, bp: shareBp(x.n, answered.length) }))
    .sort((a, b) => b.n - a.n || a.i - b.i)
    .map(({ i: _i, ...x }) => x);
}

export interface ScoreSummary {
  n: number;
  /** 평균(소수 한 자리, 사사오입) — 답이 없으면 null */
  mean: number | null;
  /** 1~5 점별 사람 수 */
  dist: [number, number, number, number, number];
  /** 4·5 점 비율(bp) */
  topBoxBp: number | null;
}

export function scoreSummary(scores: (number | null | undefined)[]): ScoreSummary {
  const s = scores.filter((x): x is number => Number.isInteger(x) && (x as number) >= 1 && (x as number) <= 5);
  const dist: ScoreSummary['dist'] = [0, 0, 0, 0, 0];
  for (const x of s) dist[x - 1]++;
  const sum = s.reduce((a, b) => a + b, 0);
  return {
    n: s.length,
    mean: s.length ? Math.round((sum * 10) / s.length) / 10 : null,
    dist,
    topBoxBp: shareBp(dist[3] + dist[4], s.length),
  };
}

// ─── ② 청구서 점검 업로드 비율 ───────────────────────────────────
export interface FunnelCounts {
  /** 방문한 기기 */
  visitors: number;
  /** 청구서 항목을 넣은 기기 */
  inputters: number;
  /** 점검까지 간 기기 */
  runners: number;
  /** 보관한 기기 */
  savers: number;
}

export interface UploadRead {
  counts: FunnelCounts;
  inputBp: number | null;
  runBp: number | null;
  saveBp: number | null;
  runCi: [number, number] | null;
  verdict: Verdict;
}

export function uploadRate(c: FunnelCounts, rules: Pick<ResearchRules, 'uploadTargetBp' | 'uploadMinVisitors'>): UploadRead {
  for (const [k, v] of Object.entries(c)) if (!Number.isInteger(v) || v < 0) throw new RangeError(`${k} 가 올바르지 않습니다`);
  // 방문 없이 점검만 기록된 기기(쪽을 새로 열지 않은 채 다시 점검)는 방문 수를 넘지 않게 자른다
  const v = c.visitors;
  const cap = (x: number) => Math.min(x, v);
  const runBp = shareBp(cap(c.runners), v);
  return {
    counts: c,
    inputBp: shareBp(cap(c.inputters), v),
    runBp,
    saveBp: shareBp(cap(c.savers), v),
    runCi: wilsonBp(cap(c.runners), v),
    verdict: v < rules.uploadMinVisitors ? 'insufficient' : (runBp ?? 0) >= rules.uploadTargetBp ? 'met' : 'not_met',
  };
}

// ─── ③ 물량 단가 곡선 ────────────────────────────────────────────
export type VendorKind = 'consolidator' | 'forwarder';
export type QuoteIncludes = 'sea_cfs' | 'to_port' | 'to_fc';

export interface VendorQuote {
  kind: VendorKind;
  includes: QuoteIncludes;
  volumeCbm: number;
  unitPriceKrw: number;
}

/** 정수 배열 중간값(짝수면 가운데 둘 평균, 사사오입) */
export function medianInt(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : Math.floor((s[m - 1] + s[m] + 1) / 2);
}

/** 물량을 구간에 넣는다 — 그 물량 이하인 가장 큰 구간 값(첫 구간보다 작으면 첫 구간) */
export function bucketOf(volume: number, buckets: number[]): number {
  let b = buckets[0];
  for (const x of buckets) if (volume >= x) b = x;
  return b;
}

export interface CurvePoint {
  bucket: number;
  n: number;
  median: number | null;
  /** 첫 값이 있는 구간 대비 할인율(bp, 양수 = 싸짐) */
  discountBp: number | null;
}

export interface VolumeCurve {
  kind: VendorKind;
  includes: QuoteIncludes;
  n: number;
  points: CurvePoint[];
}

export function volumeCurves(quotes: VendorQuote[], buckets: number[]): VolumeCurve[] {
  for (const q of quotes) if (!Number.isSafeInteger(q.unitPriceKrw) || q.unitPriceKrw < 0 || !(q.volumeCbm > 0)) throw new RangeError('단가·물량이 올바르지 않습니다');
  const keys = [...new Set(quotes.map((q) => `${q.kind}|${q.includes}`))].sort();
  return keys.map((k) => {
    const [kind, includes] = k.split('|') as [VendorKind, QuoteIncludes];
    const qs = quotes.filter((q) => q.kind === kind && q.includes === includes);
    const pts = buckets.map((b) => {
      const inB = qs.filter((q) => bucketOf(q.volumeCbm, buckets) === b).map((q) => q.unitPriceKrw);
      return { bucket: b, n: inB.length, median: medianInt(inB), discountBp: null as number | null };
    });
    const base = pts.find((p) => p.median != null)?.median ?? null;
    for (const p of pts) if (p.median != null && base) p.discountBp = Math.round(((base - p.median) * 10000) / base);
    return { kind, includes, n: qs.length, points: pts };
  });
}

export interface ConsolidationRead {
  includes: QuoteIncludes;
  /** 콘솔사 · 물량 ≥ consolidationVolumeCbm */
  big: { n: number; median: number | null };
  /** 포워더 · 물량 ≤ consolidationBaseCbm */
  small: { n: number; median: number | null };
  discountBp: number | null;
  verdict: Verdict;
}

/** 포함 범위마다 콘솔사 큰 물량 대 포워더 작은 물량 — 판정은 같은 범위끼리만 */
export function consolidationReads(
  quotes: VendorQuote[],
  rules: Pick<ResearchRules, 'consolidationVolumeCbm' | 'consolidationBaseCbm' | 'consolidationDiscountBp' | 'consolidationMinQuotes'>,
): ConsolidationRead[] {
  const inc = [...new Set(quotes.map((q) => q.includes))].sort() as QuoteIncludes[];
  return inc.map((i) => {
    const big = quotes.filter((q) => q.includes === i && q.kind === 'consolidator' && q.volumeCbm >= rules.consolidationVolumeCbm).map((q) => q.unitPriceKrw);
    const small = quotes.filter((q) => q.includes === i && q.kind === 'forwarder' && q.volumeCbm <= rules.consolidationBaseCbm).map((q) => q.unitPriceKrw);
    const bm = medianInt(big);
    const sm = medianInt(small);
    const discountBp = bm != null && sm ? Math.round(((sm - bm) * 10000) / sm) : null;
    const enough = big.length >= rules.consolidationMinQuotes && small.length >= rules.consolidationMinQuotes;
    return {
      includes: i,
      big: { n: big.length, median: bm },
      small: { n: small.length, median: sm },
      discountBp,
      verdict: !enough ? 'insufficient' : (discountBp ?? 0) >= rules.consolidationDiscountBp ? 'met' : 'not_met',
    };
  });
}

/** 여러 범위의 판정을 하나로: 충족이 하나라도 있으면 충족, 판정 가능한 게 있으면 미충족, 아니면 표본 부족 */
export function overallVerdict(vs: Verdict[]): Verdict {
  if (vs.includes('met')) return 'met';
  if (vs.includes('not_met')) return 'not_met';
  return 'insufficient';
}
