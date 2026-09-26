/**
 * 예상일 엔진 — 순수 함수(브라우저·서버 공용). 기획 docs/tracker-plan.md 4절.
 *   · 분위수(선형 보간 = 엑셀 PERCENTILE.INC)
 *   · 소요 통계: (물류사·관세사·항구·방식)별 입항→수리, 수리→FC 입고 영업일의 p50·p90·표본·분포
 *   · 통계 고르기: 표본 기준을 넘는 가장 좁은 판 → 넓은 판 → 가정치
 *   · 예상일: 「보통 X일 · 늦으면 Y일」(p50 반올림 · p90 올림) + 늦어지는 중 표시
 *   · 같은 날 입항분 완료율
 */
import { addBusinessDays, addDays, businessDaysBetween, nextBusinessDay, type HolidaySet, type Ymd } from './calendar';

export type LeadMetric = 'arrival_to_clearance' | 'clearance_to_fc';
export type StatLevel = 'port_mode' | 'partner' | 'partner_broker';

/** 선형 보간 분위수(p 는 0~1). 빈 배열이면 오류 */
export function quantile(values: readonly number[], p: number): number {
  if (!values.length) throw new RangeError('값이 없습니다');
  if (!(p >= 0 && p <= 1)) throw new RangeError('분위는 0~1');
  for (const v of values) if (!Number.isFinite(v)) throw new RangeError('숫자가 아닌 값');
  const s = [...values].sort((a, b) => a - b);
  const h = (s.length - 1) * p;
  const lo = Math.floor(h);
  const hi = Math.ceil(h);
  const v = s[lo] + (s[hi] - s[lo]) * (h - lo);
  return Math.round(v * 100) / 100;
}

export interface Summary {
  p50: number;
  p90: number;
  n: number;
  /** 영업일별 건수 — [0일, 1일, …, histCap 일 이상] */
  hist: number[];
}

export function summarize(values: readonly number[], histCap = 10): Summary {
  if (!Number.isInteger(histCap) || histCap < 1) throw new RangeError('분포 칸 수는 1 이상의 정수');
  const hist = Array.from({ length: histCap + 1 }, () => 0);
  for (const v of values) {
    if (!Number.isInteger(v) || v < 0) throw new RangeError('영업일은 0 이상의 정수');
    hist[Math.min(v, histCap)]++;
  }
  return { p50: quantile(values, 0.5), p90: quantile(values, 0.9), n: values.length, hist };
}

/** 번호 하나의 실측 — 정규화 단계 날짜(한국 날짜) */
export interface LeadSample {
  partner: string | null;
  broker: string | null;
  port: string | null;
  mode: string | null;
  arrival: Ymd | null;
  cleared: Ymd | null;
  fc: Ymd | null;
}

export interface StatRow extends Summary {
  metric: LeadMetric;
  level: StatLevel;
  partner: string | null;
  broker: string | null;
  port: string;
  mode: string;
  fromOn: Ymd;
  toOn: Ymd;
}

/**
 * 최근 windowDays 일(끝 단계 날짜 기준, today 포함) 안의 표본으로 판마다 통계를 낸다.
 * 항구·방식을 모르는 표본은 뺀다. 끝이 시작보다 앞선 표본(자료 오류)도 뺀다.
 */
export function computeLeadTimeStats(samples: readonly LeadSample[], o: { holidays: HolidaySet; today: Ymd; windowDays: number; histCap?: number }): StatRow[] {
  if (!Number.isInteger(o.windowDays) || o.windowDays < 1) throw new RangeError('기간은 1일 이상');
  const fromOn = addDays(o.today, -(o.windowDays - 1));
  const groups = new Map<string, { metric: LeadMetric; level: StatLevel; partner: string | null; broker: string | null; port: string; mode: string; v: number[] }>();
  const push = (metric: LeadMetric, level: StatLevel, s: LeadSample, v: number) => {
    const partner = level === 'port_mode' ? null : s.partner;
    const broker = level === 'partner_broker' ? s.broker : null;
    const k = [metric, level, partner, broker, s.port, s.mode].join('|');
    const g = groups.get(k) ?? { metric, level, partner, broker, port: s.port!, mode: s.mode!, v: [] };
    g.v.push(v);
    groups.set(k, g);
  };
  const inWindow = (d: Ymd) => d >= fromOn && d <= o.today;
  for (const s of samples) {
    if (!s.port || !s.mode) continue;
    const legs: [LeadMetric, Ymd | null, Ymd | null][] = [
      ['arrival_to_clearance', s.arrival, s.cleared],
      ['clearance_to_fc', s.cleared, s.fc],
    ];
    for (const [metric, a, b] of legs) {
      if (!a || !b || b < a || !inWindow(b)) continue;
      const v = businessDaysBetween(a, b, o.holidays);
      push(metric, 'port_mode', s, v);
      if (s.partner) {
        push(metric, 'partner', s, v);
        if (s.broker) push(metric, 'partner_broker', s, v);
      }
    }
  }
  const order: Record<StatLevel, number> = { port_mode: 0, partner: 1, partner_broker: 2 };
  return [...groups.values()]
    .map((g) => ({ metric: g.metric, level: g.level, partner: g.partner, broker: g.broker, port: g.port, mode: g.mode, fromOn, toOn: o.today, ...summarize(g.v, o.histCap ?? 10) }))
    .sort((a, b) => a.metric.localeCompare(b.metric) || order[a.level] - order[b.level] || a.port.localeCompare(b.port) || a.mode.localeCompare(b.mode) || String(a.partner).localeCompare(String(b.partner)) || String(a.broker).localeCompare(String(b.broker)));
}

export interface StatLike {
  metric: LeadMetric;
  level: StatLevel;
  partner: string | null;
  broker: string | null;
  port: string;
  mode: string;
  p50: number;
  p90: number;
  n: number;
}

export type StatBasis = StatLevel | 'assumed';
export interface PickedStat {
  p50: number;
  p90: number;
  n: number | null;
  basis: StatBasis;
}

/**
 * 표본 기준(minSamples) 이상인 가장 좁은 판을 고른다 — 물류사+관세사 → 물류사 → 항구·방식 → 가정치.
 * 방식을 모르면(mode = null) 항구의 방식 중 표본이 가장 많은 판.
 */
export function pickStat(
  rows: readonly StatLike[],
  key: { metric: LeadMetric; partner: string | null; broker: string | null; port: string | null; mode: string | null },
  minSamples: number,
  assumed: { p50: number; p90: number },
): PickedStat {
  const ok = rows.filter((r) => r.metric === key.metric && r.n >= minSamples && r.port === key.port && (key.mode == null || r.mode === key.mode));
  const best = (xs: StatLike[]) => [...xs].sort((a, b) => b.n - a.n)[0];
  const tries: [StatLevel, (r: StatLike) => boolean][] = [
    ['partner_broker', (r) => r.level === 'partner_broker' && !!key.partner && !!key.broker && r.partner === key.partner && r.broker === key.broker],
    ['partner', (r) => r.level === 'partner' && !!key.partner && r.partner === key.partner],
    ['port_mode', (r) => r.level === 'port_mode'],
  ];
  for (const [level, f] of tries) {
    const r = best(ok.filter(f));
    if (r) return { p50: r.p50, p90: r.p90, n: r.n, basis: level };
  }
  return { p50: assumed.p50, p90: assumed.p90, n: null, basis: 'assumed' };
}

/** 「보통 X일 · 늦으면 Y일」 — p50 반올림, p90 올림(보통보다 작지 않게) */
export function displayDays(s: { p50: number; p90: number }): { usual: number; late: number } {
  const usual = Math.max(0, Math.round(s.p50));
  return { usual, late: Math.max(usual, Math.ceil(s.p90 - 1e-9)) };
}

export interface DateEstimate {
  /** 이미 끝났으면 그 날 */
  done: Ymd | null;
  usual: Ymd | null;
  late: Ymd | null;
  /** 보통 날짜가 오늘보다 앞인데 아직 안 끝남 — 늦어지는 중 */
  overdue: boolean;
}

export interface EstimateInput {
  arrival: Ymd | null;
  cleared: Ymd | null;
  fc: Ymd | null;
  toClear: { p50: number; p90: number };
  toFc: { p50: number; p90: number };
  holidays: HolidaySet;
  today: Ymd;
}

/** 예상 통관(수리)일 · 예상 FC 입고일. 입항 전이면 날짜 없음(「입항하면 셈합니다」) */
export function estimateDates(i: EstimateInput): { clearance: DateEstimate; fc: DateEstimate } {
  const none: DateEstimate = { done: null, usual: null, late: null, overdue: false };
  const roll = (base: Ymd, s: { p50: number; p90: number }, done: Ymd | null): DateEstimate => {
    if (done) return { done, usual: null, late: null, overdue: false };
    const d = displayDays(s);
    let usual = addBusinessDays(base, d.usual, i.holidays);
    let late = addBusinessDays(base, d.late, i.holidays);
    const overdue = usual < i.today;
    if (overdue) {
      // 늦어지는 중 — 오늘(영업일이 아니면 다음 영업일)보다 앞 날짜를 예상일로 보이지 않는다
      const t = nextBusinessDay(i.today, i.holidays);
      usual = t;
      if (late < t) late = t;
    }
    return { done: null, usual, late, overdue };
  };
  if (!i.arrival && !i.cleared) return { clearance: i.fc ? { ...none } : none, fc: i.fc ? { ...none, done: i.fc } : none };
  const clearance = i.cleared ? { ...none, done: i.cleared } : roll(i.arrival!, i.toClear, null);
  if (i.fc) return { clearance, fc: { ...none, done: i.fc } };
  const d = displayDays(i.toFc);
  const baseUsual = clearance.done ?? clearance.usual!;
  const baseLate = clearance.done ?? clearance.late!;
  let usual = addBusinessDays(baseUsual, d.usual, i.holidays);
  let late = addBusinessDays(baseLate, d.late, i.holidays);
  const overdue = usual < i.today;
  if (overdue) {
    const t = nextBusinessDay(i.today, i.holidays);
    usual = t;
    if (late < t) late = t;
  }
  if (late < usual) late = usual;
  return { clearance, fc: { done: null, usual, late, overdue } };
}

/** 같은 날 입항분 완료율 — 표본이 minSamples 미만이면 null(숨김) */
export function completionRate(x: { total: number; cleared: number } | null, minSamples: number): { total: number; cleared: number; rate: number } | null {
  if (!x || x.total < minSamples || x.total <= 0) return null;
  if (x.cleared < 0 || x.cleared > x.total) throw new RangeError('완료 수가 전체보다 많습니다');
  return { ...x, rate: Math.round((x.cleared / x.total) * 1000) / 1000 };
}
