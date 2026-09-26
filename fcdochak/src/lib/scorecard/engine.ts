/**
 * 물류사 성적표 지표 엔진 — 순수 함수(브라우저·서버·시드 공용). 기획 docs/scorecard-plan.md 3·4·5절.
 *
 *   · 표본 합치기(mergeSamples): 같은 화물(관세청 화물관리번호 또는 종류·번호·연도)을 한 번만 — 출처(플랫폼 선적·셀러 등록·물류사 제출)를 모으고
 *     둘 이상이면 교차 확인. 업체 귀속은 플랫폼 선적 > 셀러 등록 > 물류사 제출 순(물류사가 번호만 내서 남의 화물을 가져가지 못하게),
 *     서로 다르면 「귀속 충돌」로 센다.
 *   · 지표(computeScorecards): (전체 · 물류사 · 관세사) × (모든 항구·방식 · 항구 × 방식) 판마다
 *     입항→수리 p50·p90·늦는 폭·분포 · 검사 비율 · 반입→반출 · 반출→FC 입고 · 주별 추이 · 전체 평균 대비 · 출처별 수 · 제출률 · 실측 인증.
 *   · 단계 시각은 5차 stageTimes 가 접은 한국 날짜(관세청 기록)만 받는다 — 누가 손으로 넣은 숫자가 아니다.
 *   · 영업일은 5차 달력(businessDaysBetween) 그대로, 분위수는 5차 quantile(선형 보간) 그대로 — 두 화면의 숫자가 같은 식이다.
 */
import { addDays, businessDaysBetween, weekday, type HolidaySet, type Ymd } from '../tracker/calendar';
import { quantile, summarize } from '../tracker/leadtime';
import type { ScorecardRules } from './settings';

export type NumberSource = 'platform' | 'seller' | 'partner';
export const NUMBER_SOURCES: readonly NumberSource[] = ['platform', 'seller', 'partner'];
export const SOURCE_LABEL: Record<NumberSource, string> = { platform: '플랫폼 선적', seller: '셀러 등록', partner: '물류사 제출' };

/** 번호 하나(한 출처) — 서버가 cargo_tracks + 단계 기록에서 만든다 */
export interface RawSample {
  /** 같은 화물 열쇠(cargo_no 또는 kind:number:year) */
  key: string;
  source: NumberSource;
  /** 번호를 등록한 조직(셀러 조직 또는 제출한 물류사) */
  registrant: string;
  partner: string | null;
  broker: string | null;
  port: string | null;
  mode: string | null;
  arrival: Ymd | null;
  bondedIn: Ymd | null;
  cleared: Ymd | null;
  released: Ymd | null;
  fc: Ymd | null;
  /** 진행 단계에 검사 낱말이 있는가(hasInspection) */
  inspected: boolean;
  /** 이의 cargo_ref 와 맞출 번호들(B/L 번호 · 화물관리번호) — 연도 조각은 넣지 않는다 */
  refs?: readonly string[];
}

export interface MergedSample extends Omit<RawSample, 'source' | 'registrant' | 'refs'> {
  /** 이 화물을 가리키는 번호들(정규화 — 대문자·하이픈 뺌) */
  refs: string[];
  sources: NumberSource[];
  registrants: string[];
  /** 이 화물을 스스로 제출한 물류사들 */
  submittedBy: string[];
  /** 출처마다 다른 물류사를 말했는가 */
  conflict: boolean;
}

/** 진행 단계 처리구분 원문에 검사 낱말이 있는가 — 낱말 목록 원문 확인 전 가정(확인 필요). 「검사대상」「검사지정」「검사 완료」 등 */
export function hasInspection(rawTypes: readonly string[]): boolean {
  return rawTypes.some((t) => /검사/.test(t.replace(/\s+/g, '')) && !/보세운송/.test(t));
}

// 셀러가 고른 업체가 물류사가 스스로 낸 것보다 앞선다 — 제출만으로 남의 화물을 가져가지 못하게(검토 고침)
const PRIORITY: Record<NumberSource, number> = { platform: 0, seller: 1, partner: 2 };

/** 이의 번호·화물 번호 맞추기용 정규화 — NFKC · 대문자 · 공백·하이픈 뺌 */
export function normRef(x: string): string {
  return x.normalize('NFKC').toUpperCase().replace(/[\s-]+/g, '');
}

export function mergeSamples(raw: readonly RawSample[]): MergedSample[] {
  const groups = new Map<string, RawSample[]>();
  for (const r of raw) {
    const g = groups.get(r.key) ?? [];
    g.push(r);
    groups.set(r.key, g);
  }
  const out: MergedSample[] = [];
  for (const [key, g] of groups) {
    const s = [...g].sort((a, b) => PRIORITY[a.source] - PRIORITY[b.source] || a.registrant.localeCompare(b.registrant));
    const pick = <K extends keyof RawSample>(k: K): RawSample[K] => (s.find((x) => x[k] != null)?.[k] ?? null) as RawSample[K];
    const partners = new Set(s.map((x) => x.partner).filter((x): x is string => !!x));
    out.push({
      key,
      refs: [...new Set(s.flatMap((x) => x.refs ?? []).map(normRef).filter(Boolean))].sort(),
      sources: NUMBER_SOURCES.filter((src) => s.some((x) => x.source === src)),
      registrants: [...new Set(s.map((x) => x.registrant))].sort(),
      submittedBy: [...new Set(s.filter((x) => x.source === 'partner').map((x) => x.registrant))].sort(),
      conflict: partners.size > 1,
      partner: pick('partner'),
      broker: pick('broker'),
      port: pick('port'),
      mode: pick('mode'),
      arrival: pick('arrival'),
      bondedIn: pick('bondedIn'),
      cleared: pick('cleared'),
      released: pick('released'),
      fc: pick('fc'),
      inspected: s.some((x) => x.inspected),
    });
  }
  return out.sort((a, b) => a.key.localeCompare(b.key));
}

export type EntityKind = 'overall' | 'partner' | 'broker';

export interface Dist {
  p50: number;
  p90: number;
  n: number;
}
export interface ScoreMetrics {
  /** 입항 → 수리(영업일) — 이상치를 뺀 값 */
  clear: (Dist & { spread: number; hist: number[] }) | null;
  /** 검사 비율(0~1) — 기간 안 표본 전체(이상치 포함) 기준 */
  inspectRate: number | null;
  inspected: number;
  bondedRelease: Dist | null;
  releaseFc: Dist | null;
  /** 주별(월요일 시작) 수리일 기준 p50 — 표본 2건 미만 주는 null */
  trend: { week: Ymd; p50: number | null; n: number }[];
  /** 같은 항구·방식 전체 판 대비 p50 차이(+ 는 느림) — 전체 판이 표본 기준 미만이면 null */
  vsOverall: { overallP50: number | null; deltaP50: number | null };
}
export interface SourceCounts {
  platform: number;
  seller: number;
  partner: number;
  /** 출처 둘 이상이 같은 화물을 말함 */
  crossChecked: number;
  /** 입항 → 수리가 이상치 기준을 넘어 분위수에서 뺀 수 */
  outliers: number;
  /** 출처마다 다른 물류사를 말한 화물 */
  conflicts: number;
  /** 가장 많이 등록한 한 조직의 몫(bp) — 쏠림 경고 */
  topRegistrantBp: number;
}
export interface Submission {
  /** 셀러 등록·플랫폼 선적으로 이 업체에 귀속된 화물 */
  registered: number;
  /** 그중 이 업체도 스스로 낸 화물 */
  submitted: number;
  /** 0~1, 등록이 0 이면 null */
  rate: number | null;
  /** 업체만 낸 화물(셀러·선적에 없는 것) */
  partnerOnly: number;
}
export interface ScoreRow {
  entityKind: EntityKind;
  entity: string | null;
  port: string | null;
  mode: string | null;
  fromOn: Ymd;
  toOn: Ymd;
  /** 기간 안 · 이상치 뺀 입항 → 수리 표본 */
  n: number;
  metrics: ScoreMetrics;
  sources: SourceCounts;
  submission: Submission | null;
  certified: boolean;
}

export interface ComputeOptions {
  holidays: HolidaySet;
  today: Ymd;
  rules: Pick<ScorecardRules, 'windowDays' | 'outlierDays' | 'trendWeeks' | 'sources' | 'minSamples' | 'certifiedMinSamples' | 'certifiedSubmissionBp'>;
  /** 이의가 받아들여져 뺄 화물 — 열쇠 그대로이거나 그 화물의 번호(B/L 번호·화물관리번호)와 똑같은 값. 연도 조각과는 맞추지 않는다 */
  excluded?: readonly string[];
  histCap?: number;
}

const r2 = (v: number) => Math.round(v * 100) / 100;
const dist = (vs: number[]): Dist | null => (vs.length ? { p50: quantile(vs, 0.5), p90: quantile(vs, 0.9), n: vs.length } : null);
export function weekStart(d: Ymd): Ymd {
  return addDays(d, -((weekday(d) + 6) % 7));
}

/**
 * 이의로 뺄 화물인가 — 열쇠 전체가 같거나, 그 화물의 번호(refs: B/L 번호·화물관리번호) 하나와 똑같다.
 * 열쇠를 「:」로 쪼개 맞추지 않는다 — 「2026」 같은 연도 조각이 맞아 그해 표본이 모두 빠지는 일을 막는다(검토 고침).
 * refs 가 없으면(옛 호출) 열쇠의 번호 조각(kind:번호:연도 의 가운데)만 본다.
 */
export function isExcluded(s: string | Pick<MergedSample, 'key' | 'refs'>, excluded: readonly string[]): boolean {
  if (!excluded.length) return false;
  const key = typeof s === 'string' ? s : s.key;
  const parts = key.split(':');
  const refs = new Set<string>(typeof s === 'string' || !s.refs.length ? (parts.length === 3 ? [normRef(parts[1])] : [normRef(key)]) : s.refs);
  return excluded.some((x) => x === key || refs.has(normRef(x)));
}

/** 이의 번호로 받을 만한가 — 네 자 이상이고, 숫자만이면 여섯 자 이상(연도 「2026」 같은 짧은 숫자는 화물 하나를 가리키지 못한다) */
export function disputeRefOk(ref: string): boolean {
  const bare = normRef(ref);
  return /^[A-Z0-9]{4,40}$/.test(bare) && !(/^\d+$/.test(bare) && bare.length < 6);
}

interface Prepared {
  s: MergedSample;
  clearDays: number | null;
  outlier: boolean;
  bondedRelease: number | null;
  releaseFc: number | null;
  srcs: NumberSource[];
}

export function computeScorecards(samples: readonly MergedSample[], o: ComputeOptions): ScoreRow[] {
  const { rules, holidays } = o;
  if (!Number.isInteger(rules.windowDays) || rules.windowDays < 1) throw new RangeError('기간은 1일 이상');
  const fromOn = addDays(o.today, -(rules.windowDays - 1));
  const excluded = o.excluded ?? [];
  const bd = (a: Ymd | null, b: Ymd | null) => (a && b && b >= a ? businessDaysBetween(a, b, holidays) : null);
  const prepared: Prepared[] = [];
  for (const s of samples) {
    const srcs = s.sources.filter((x) => rules.sources[x]);
    if (!srcs.length) continue;
    if (isExcluded(s, excluded)) continue;
    if (!s.cleared || s.cleared < fromOn || s.cleared > o.today) continue;
    const clearDays = bd(s.arrival, s.cleared);
    prepared.push({
      s,
      srcs,
      clearDays,
      outlier: clearDays != null && clearDays > rules.outlierDays,
      bondedRelease: bd(s.bondedIn, s.released),
      releaseFc: bd(s.released, s.fc),
    });
  }

  const weeks: Ymd[] = [];
  const lastWeek = weekStart(o.today);
  for (let i = rules.trendWeeks - 1; i >= 0; i--) weeks.push(addDays(lastWeek, -7 * i));

  const build = (entityKind: EntityKind, entity: string | null, port: string | null, mode: string | null, xs: Prepared[]): ScoreRow => {
    const used = xs.filter((x) => x.clearDays != null && !x.outlier);
    const cv = used.map((x) => x.clearDays!);
    const sum = cv.length ? summarize(cv, o.histCap ?? 10) : null;
    const byWeek = new Map<Ymd, number[]>();
    for (const x of used) {
      const w = weekStart(x.s.cleared!);
      byWeek.set(w, [...(byWeek.get(w) ?? []), x.clearDays!]);
    }
    const reg = new Map<string, number>();
    for (const x of xs) for (const r of x.s.registrants) reg.set(r, (reg.get(r) ?? 0) + 1);
    const top = Math.max(0, ...reg.values());
    let submission: Submission | null = null;
    if (entityKind === 'partner' && entity) {
      const registered = xs.filter((x) => x.srcs.includes('platform') || x.srcs.includes('seller'));
      const submitted = registered.filter((x) => x.s.submittedBy.includes(entity)).length;
      submission = {
        registered: registered.length,
        submitted,
        rate: registered.length ? Math.round((submitted / registered.length) * 1000) / 1000 : null,
        partnerOnly: xs.filter((x) => x.srcs.length === 1 && x.srcs[0] === 'partner').length,
      };
    }
    const inspected = xs.filter((x) => x.s.inspected).length;
    const n = cv.length;
    const certified =
      entityKind === 'partner' && port == null && mode == null && !!submission && submission.rate != null &&
      n >= rules.certifiedMinSamples && submission.registered >= rules.certifiedMinSamples && submission.rate * 10_000 >= rules.certifiedSubmissionBp;
    return {
      entityKind,
      entity,
      port,
      mode,
      fromOn,
      toOn: o.today,
      n,
      metrics: {
        clear: sum ? { p50: sum.p50, p90: sum.p90, n: sum.n, spread: r2(sum.p90 - sum.p50), hist: sum.hist } : null,
        inspectRate: xs.length ? Math.round((inspected / xs.length) * 1000) / 1000 : null,
        inspected,
        bondedRelease: dist(xs.map((x) => x.bondedRelease).filter((v): v is number => v != null)),
        releaseFc: dist(xs.map((x) => x.releaseFc).filter((v): v is number => v != null)),
        trend: weeks.map((w) => {
          const v = byWeek.get(w) ?? [];
          return { week: w, p50: v.length >= 2 ? quantile(v, 0.5) : null, n: v.length };
        }),
        vsOverall: { overallP50: null, deltaP50: null },
      },
      sources: {
        platform: xs.filter((x) => x.srcs.includes('platform')).length,
        seller: xs.filter((x) => x.srcs.includes('seller')).length,
        partner: xs.filter((x) => x.srcs.includes('partner')).length,
        crossChecked: xs.filter((x) => x.srcs.length > 1).length,
        outliers: xs.filter((x) => x.outlier).length,
        conflicts: xs.filter((x) => x.s.conflict).length,
        topRegistrantBp: xs.length ? Math.round((top / xs.length) * 10_000) : 0,
      },
      submission,
      certified,
    };
  };

  const groups = new Map<string, { kind: EntityKind; entity: string | null; port: string | null; mode: string | null; xs: Prepared[] }>();
  const add = (kind: EntityKind, entity: string | null, port: string | null, mode: string | null, x: Prepared) => {
    const k = [kind, entity, port, mode].join('|');
    const g = groups.get(k) ?? { kind, entity, port, mode, xs: [] };
    g.xs.push(x);
    groups.set(k, g);
  };
  for (const x of prepared) {
    const pm = x.s.port && x.s.mode;
    add('overall', null, null, null, x);
    if (pm) add('overall', null, x.s.port, x.s.mode, x);
    if (x.s.partner) {
      add('partner', x.s.partner, null, null, x);
      if (pm) add('partner', x.s.partner, x.s.port, x.s.mode, x);
    }
    if (x.s.broker) {
      add('broker', x.s.broker, null, null, x);
      if (pm) add('broker', x.s.broker, x.s.port, x.s.mode, x);
    }
  }
  // 표본이 하나도 없어도 전체 판(모든 항구·방식) 한 줄은 늘 남긴다 — 새 판이 0줄이면 옛 판이 「최근 판」으로 남는 일을 막는다(검토 고침)
  if (!groups.has(['overall', null, null, null].join('|'))) groups.set(['overall', null, null, null].join('|'), { kind: 'overall', entity: null, port: null, mode: null, xs: [] });
  // 물류사가 낸 화물이 기간 안에 없어도, 제출률 판은 그 업체가 귀속된 화물이 있으면 생긴다(위 add 가 이미 만든다)
  const rows = [...groups.values()].map((g) => build(g.kind, g.entity, g.port, g.mode, g.xs));
  const overall = new Map(rows.filter((r) => r.entityKind === 'overall').map((r) => [`${r.port}|${r.mode}`, r]));
  for (const r of rows) {
    if (r.entityKind === 'overall') continue;
    const ov = overall.get(`${r.port}|${r.mode}`);
    const ok = ov?.metrics.clear && ov.n >= rules.minSamples;
    r.metrics.vsOverall = {
      overallP50: ok ? ov!.metrics.clear!.p50 : null,
      deltaP50: ok && r.metrics.clear ? r2(r.metrics.clear.p50 - ov!.metrics.clear!.p50) : null,
    };
  }
  const order: Record<EntityKind, number> = { overall: 0, partner: 1, broker: 2 };
  return rows.sort(
    (a, b) =>
      order[a.entityKind] - order[b.entityKind] ||
      String(a.entity).localeCompare(String(b.entity)) ||
      String(a.port).localeCompare(String(b.port)) ||
      String(a.mode).localeCompare(String(b.mode)),
  );
}

// ─── 정렬 · 칩 ────────────────────────────────────────────────────────────

export type ScoreSort = 'fast' | 'stable' | 'inspect';
export const SCORE_SORT_LABEL: Record<ScoreSort, string> = { fast: '빠른 통관순', stable: '안정적인 순', inspect: '검사 적은 순' };

type SortRow = Pick<ScoreRow, 'n' | 'metrics'> & { sources?: Pick<SourceCounts, 'seller' | 'platform'> };

/**
 * 업체와 무관한 출처(셀러 등록·플랫폼 선적)가 말한 화물 수 — 정렬 자격. 물류사가 혼자 낸 번호만으로는 순위에 오르지 못한다
 * (빠른 화물만 골라 내는 업체를 가려내려고 · 검토 고침). sources 가 없으면(옛 행) n 을 쓴다.
 */
export function independentSamples(r: SortRow): number {
  return r.sources ? r.sources.seller + r.sources.platform : r.n;
}

/**
 * 성적 행에서 정렬 값(작을수록 앞) — 표본 기준 미만·독립 출처 표본 기준 미만·값 없음은 null(뒤로).
 * 빠른 통관순은 화면에 보이는 값(보통 = p50 반올림)으로 먼저 가르고, 같으면 늦으면(p90 올림)으로 — 보이는 숫자와 순서가 어긋나지 않게.
 */
export function sortValue(r: SortRow | null | undefined, by: ScoreSort, minSamples: number): number | null {
  if (!r || r.n < minSamples || !r.metrics.clear || independentSamples(r) < minSamples) return null;
  if (by === 'fast') {
    const d = daysLine(r.metrics.clear);
    return d.usual * 1000 + d.late;
  }
  if (by === 'stable') return r.metrics.clear.spread;
  return r.metrics.inspectRate;
}

/** 업체 id 들을 성적으로 줄 세운다 — 값이 같으면 p50 · p90 · 표본 많은 순, 값 없는 업체는 원래 순서대로 뒤에 */
export function sortByScore<T>(items: readonly T[], rowOf: (t: T) => SortRow | null | undefined, by: ScoreSort, minSamples: number): T[] {
  const idx = new Map(items.map((t, i) => [t, i]));
  return [...items].sort((a, b) => {
    const ra = rowOf(a);
    const rb = rowOf(b);
    const va = sortValue(ra, by, minSamples);
    const vb = sortValue(rb, by, minSamples);
    if (va == null && vb == null) return idx.get(a)! - idx.get(b)!;
    if (va == null) return 1;
    if (vb == null) return -1;
    return (
      va - vb ||
      ra!.metrics.clear!.p50 - rb!.metrics.clear!.p50 ||
      ra!.metrics.clear!.p90 - rb!.metrics.clear!.p90 ||
      rb!.n - ra!.n ||
      idx.get(a)! - idx.get(b)!
    );
  });
}

/** 출처 줄 — 「셀러 12 · 물류사 9 · 선적 4 · 교차 확인 3」(0 인 출처는 뺀다) */
export function sourceLine(s: SourceCounts): string {
  const parts = [
    s.seller ? `셀러 ${s.seller}` : null,
    s.partner ? `물류사 ${s.partner}` : null,
    s.platform ? `선적 ${s.platform}` : null,
    s.crossChecked ? `교차 확인 ${s.crossChecked}` : null,
  ].filter(Boolean);
  return parts.join(' · ') || '출처 없음';
}

/** 「보통 1일 · 늦으면 3일」 — 5차 displayDays 와 같은 반올림(p50 반올림 · p90 올림) */
export function daysLine(d: { p50: number; p90: number }): { usual: number; late: number } {
  const usual = Math.max(0, Math.round(d.p50));
  return { usual, late: Math.max(usual, Math.ceil(d.p90 - 1e-9)) };
}
