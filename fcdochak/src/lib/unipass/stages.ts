/**
 * 단계 정규화 — 관세청 처리구분 원문 → 아홉 단계. 순수 함수(브라우저·서버 공용).
 * 원문 처리구분 목록을 확인하지 못해 낱말 규칙은 **가정**이다(docs/tracker-plan.md 3-1, 확인 필요).
 * 모르는 원문은 null — 원문 그대로 타임라인에만 보인다. 순서가 뜻을 가진다(위 규칙이 먼저).
 */
import { TRACK_STAGES, type CargoEvent, type TrackStage } from './types';

export const TRACK_STAGE_LABEL: Record<TrackStage, string> = {
  manifest: '적하목록 제출',
  arrival: '입항',
  unloading: '하선',
  bonded_in: '보세구역 반입',
  declared: '수입신고',
  cleared: '수리',
  released: '반출',
  domestic: '국내 운송',
  fc: 'FC 입고',
};

/** 물류사·중국 쪽이 함께 보는 이름(중국어 병기 관례) */
export const TRACK_STAGE_ZH: Record<TrackStage, string> = {
  manifest: '舱单申报',
  arrival: '到港',
  unloading: '卸船',
  bonded_in: '进保税区',
  declared: '进口申报',
  cleared: '放行(受理)',
  released: '出库',
  domestic: '国内运输',
  fc: 'FC入库',
};

const RULES: [RegExp, TrackStage | null][] = [
  // 보세운송(신고·수리·반출·반입)은 통관이 아니라 보세구역 사이 옮기기 — 단계로 세지 않고 원문만 보인다(LCL 이 CFS → 내륙 창고로 옮길 때,
  // 「보세운송 신고수리」가 수리로, 첫 반출이 반출로 잡히지 않게). 처리구분 낱말 목록 원문은 확인 필요.
  [/보세운송/, null],
  [/하선|하기/, 'unloading'],
  [/반입/, 'bonded_in'],
  [/반출/, 'released'],
  [/적하목록|적재화물목록/, 'manifest'],
  [/입항/, 'arrival'],
  [/수리|통관완료/, 'cleared'],
  [/수입신고/, 'declared'],
];

export function normalizeStage(rawType: string): TrackStage | null {
  const s = rawType.replace(/\s+/g, '');
  for (const [re, st] of RULES) if (re.test(s)) return st;
  return null;
}

export function stageRank(s: TrackStage | null | undefined): number {
  return s ? TRACK_STAGES.indexOf(s) + 1 : 0;
}

export interface StageTimes {
  /** 단계별 처음 일어난 때(ISO) */
  first: Partial<Record<TrackStage, string>>;
  /** 가장 앞선 단계 */
  current: TrackStage | null;
}

/**
 * 기록 → 단계별 첫 시각과 지금 단계. 뒤 단계가 있으면 앞 단계가 빠져 있어도 지난 것으로 본다(관세청 기록이 모든 단계를 남기지 않을 수 있다).
 * 선적에서 온 국내 운송·FC 입고(extra)도 함께 접는다.
 * 단, 「반출」은 수입신고나 수리 **뒤에** 온 것만 반출로 센다 — 신고 전 반출은 보세구역 사이 옮기기(보세운송 등)일 수 있다(확인 필요).
 * 그래야 LCL 의 하선 → 반입(CFS) → 반출(보세운송) → 반입(내륙 창고) → 수입신고 → 수리 → 반출 에서 첫 반출로 폴링이 멈추지 않는다.
 */
export function stageTimes(events: readonly { stage: TrackStage | null; at: string }[]): StageTimes {
  const first: Partial<Record<TrackStage, string>> = {};
  let top = 0;
  for (const e of [...events].sort((a, b) => a.at.localeCompare(b.at))) {
    if (!e.stage) continue;
    if (e.stage === 'released' && !first.declared && !first.cleared) continue;
    if (!first[e.stage]) first[e.stage] = e.at;
    top = Math.max(top, stageRank(e.stage));
  }
  return { first, current: top ? TRACK_STAGES[top - 1] : null };
}

/** 같은 기록을 두 번 넣지 않는 지문 — 처리구분 + 처리일시 */
export function eventFingerprint(e: Pick<CargoEvent, 'rawType' | 'at'>): string {
  return `${e.rawType.replace(/\s+/g, '').slice(0, 60)}@${e.at}`.slice(0, 200);
}
