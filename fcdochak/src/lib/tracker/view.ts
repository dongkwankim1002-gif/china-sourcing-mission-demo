/**
 * 번호 하나의 화면 자료 — 순수 함수(공개 /track · 화주 /app/tracking · 선적·원스톱 화면이 같은 것을 쓴다).
 * 단계 기록(관세청 원문 → 정규화) + 이은 선적의 국내 운송·FC 입고 + 소요 통계 → 아홉 단계·타임라인·예상일.
 */
import { stageTimes, TRACK_STAGE_LABEL } from '../unipass/stages';
import { TRACK_STAGES, type TrackStage } from '../unipass/types';
import { kstYmd, type HolidaySet } from './calendar';
import { completionRate, displayDays, estimateDates, pickStat, type DateEstimate, type PickedStat, type StatLike } from './leadtime';
import type { TrackerRules } from './settings';

export interface ViewEvent {
  stage: TrackStage | null;
  rawType: string;
  at: string;
  summary: string | null;
}

export interface TrackViewInput {
  events: readonly ViewEvent[];
  /** 이은 선적에서 온 국내 운송(8단계 국내 창고)·FC 입고(9단계) 시각 */
  shipment?: { domesticAt: string | null; fcAt: string | null } | null;
  key: { partner: string | null; broker: string | null; port: string | null; mode: string | null };
  stats: readonly StatLike[];
  rules: Pick<TrackerRules, 'minSamples' | 'assumed'>;
  calendar: HolidaySet;
  today: string;
  sameDay?: { total: number; cleared: number } | null;
}

export interface TrackStep {
  stage: TrackStage;
  label: string;
  at: string | null;
  state: 'done' | 'current' | 'todo';
  /** 관세청 기록인가, 선적 기록인가 */
  from: 'customs' | 'shipment' | null;
}

export interface TrackView {
  current: TrackStage | null;
  steps: TrackStep[];
  timeline: (ViewEvent & { label: string | null })[];
  clearance: DateEstimate & { basis: PickedStat['basis']; n: number | null; usualDays: number; lateDays: number };
  fc: DateEstimate & { basis: PickedStat['basis']; n: number | null; usualDays: number; lateDays: number };
  /** 같은 항구·방식의 입항→수리 분포(표본 기준 이상일 때만) */
  dist: { hist: number[]; n: number; p50: number; p90: number } | null;
  sameDay: { total: number; cleared: number; rate: number } | null;
  arrivalOn: string | null;
  /** FC 입고를 기록할 선적이 이어져 있는가(없으면 FC 입고는 스스로 끝나지 않는다) */
  fcTracked: boolean;
}

export function buildTrackView(i: TrackViewInput): TrackView {
  const evs = [...i.events];
  if (i.shipment?.domesticAt) evs.push({ stage: 'domestic', rawType: '국내 창고 입고(물류사 기록)', at: i.shipment.domesticAt, summary: null });
  if (i.shipment?.fcAt) evs.push({ stage: 'fc', rawType: 'FC 입고(물류사 기록)', at: i.shipment.fcAt, summary: null });
  const st = stageTimes(evs);
  const cur = st.current ? TRACK_STAGES.indexOf(st.current) : -1;
  const steps: TrackStep[] = TRACK_STAGES.map((s, idx) => ({
    stage: s,
    label: TRACK_STAGE_LABEL[s],
    at: st.first[s] ?? null,
    state: idx <= cur ? 'done' : idx === cur + 1 ? 'current' : 'todo',
    from: st.first[s] ? (s === 'domestic' || s === 'fc' ? 'shipment' : 'customs') : null,
  }));
  const arrivalAt = st.first.arrival ?? st.first.unloading ?? st.first.bonded_in ?? null;
  const clearedAt = st.first.cleared ?? st.first.released ?? null;
  const d = (x: string | null | undefined) => (x ? kstYmd(x) : null);
  const clearStat = pickStat(i.stats, { metric: 'arrival_to_clearance', ...i.key }, i.rules.minSamples, i.rules.assumed.toClear);
  const fcStat = pickStat(i.stats, { metric: 'clearance_to_fc', ...i.key }, i.rules.minSamples, i.rules.assumed.toFc);
  const est = estimateDates({ arrival: d(arrivalAt), cleared: d(clearedAt), fc: d(st.first.fc), toClear: clearStat, toFc: fcStat, holidays: i.calendar, today: i.today });
  const distRow = i.stats
    .filter((r) => r.metric === 'arrival_to_clearance' && r.level === 'port_mode' && r.port === i.key.port && (i.key.mode == null || r.mode === i.key.mode) && r.n >= i.rules.minSamples)
    .sort((a, b) => b.n - a.n)[0] as (StatLike & { hist?: number[] }) | undefined;
  const cd = displayDays(clearStat);
  const fd = displayDays(fcStat);
  return {
    current: st.current,
    steps,
    timeline: [...evs].sort((a, b) => b.at.localeCompare(a.at)).map((e) => ({ ...e, label: e.stage ? TRACK_STAGE_LABEL[e.stage] : null })),
    clearance: { ...est.clearance, basis: clearStat.basis, n: clearStat.n, usualDays: cd.usual, lateDays: cd.late },
    fc: { ...est.fc, basis: fcStat.basis, n: fcStat.n, usualDays: fd.usual, lateDays: fd.late },
    dist: distRow && Array.isArray(distRow.hist) ? { hist: distRow.hist, n: distRow.n, p50: distRow.p50, p90: distRow.p90 } : null,
    sameDay: completionRate(i.sameDay ?? null, i.rules.minSamples),
    arrivalOn: d(arrivalAt),
    fcTracked: !!i.shipment,
  };
}

export const BASIS_LABEL: Record<PickedStat['basis'], string> = {
  partner_broker: '이 물류사·관세사 실측',
  partner: '이 물류사 실측',
  port_mode: '같은 항구·방식 실측',
  assumed: '가정치(실측 표본 부족)',
};
