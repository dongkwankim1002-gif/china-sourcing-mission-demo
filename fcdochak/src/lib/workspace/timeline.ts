/**
 * 선적 한눈 타임라인 — 견적 → 예약 → 출항 → 입항 → 통관 → FC 입고 → 청구.
 * 표준 9단계 상태 이력(shipment_events)을 셀러가 챙기는 일곱 마디로 접는다. 순수 함수.
 *   예약 = 1단계(예약 확정) · 출항 = 5단계(선적·출항) · 입항 = 6단계(한국 도착)
 *   통관 = 7단계(수입통관 완료) · FC 입고 = 9단계 · 청구 = 현재 판 청구서(+ 화주 결정)
 * 2~4단계(집하·중국 창고·수출통관)와 8단계(국내 창고)는 다음 마디의 「지금」 설명으로 보인다.
 */
import { STAGES } from '../terms';

export type MilestoneKey = 'quote' | 'booking' | 'departure' | 'arrival' | 'customs' | 'fc' | 'billing';
export type MilestoneState = 'done' | 'current' | 'todo' | 'attention';

export interface Milestone {
  key: MilestoneKey;
  label: string;
  /** 일어난 때(ISO). 단계가 지났는데 기록이 없으면 null */
  at: string | null;
  state: MilestoneState;
  /** 짧은 설명 — 업체 원래 상태값, 지금 단계, 청구 결정 등 */
  note: string | null;
}

export const MILESTONE_LABEL: Record<MilestoneKey, string> = {
  quote: '견적',
  booking: '예약',
  departure: '출항',
  arrival: '입항',
  customs: '통관',
  fc: 'FC 입고',
  billing: '청구',
};

/** 마디 ↔ 표준 단계(이 단계에 닿으면 그 마디가 끝난 것) */
const STAGE_OF: Partial<Record<MilestoneKey, number>> = { booking: 1, departure: 5, arrival: 6, customs: 7, fc: 9 };

export interface TimelineInput {
  requestAt: string;
  bidCount?: number;
  bookedAt: string | null;
  stage: number;
  events: { stage: number; occurred_at: string; raw_status: string | null }[];
  invoice: { created_at: string; total: number; version: number } | null;
  decision: { decision: 'approved' | 'disputed'; created_at: string } | null;
  /** 열린 예외가 있는 단계(있으면 그 마디를 「확인 필요」로) */
  exceptionOpen?: boolean;
}

export function buildTimeline(i: TimelineInput): Milestone[] {
  // 단계별 첫 기록
  const first = new Map<number, { occurred_at: string; raw_status: string | null }>();
  for (const e of [...i.events].sort((a, b) => a.occurred_at.localeCompare(b.occurred_at))) {
    if (!first.has(e.stage)) first.set(e.stage, e);
  }
  const keys: MilestoneKey[] = ['quote', 'booking', 'departure', 'arrival', 'customs', 'fc', 'billing'];
  const out: Milestone[] = keys.map((key) => {
    if (key === 'quote') {
      return { key, label: MILESTONE_LABEL[key], at: i.requestAt, state: 'done', note: i.bidCount != null ? `응찰 ${i.bidCount}건` : null };
    }
    if (key === 'billing') {
      if (!i.invoice) return { key, label: MILESTONE_LABEL[key], at: null, state: 'todo', note: null };
      const d = i.decision;
      const note = d ? (d.decision === 'approved' ? '승인함' : '이의 제기함') : '승인·이의 기다림';
      const state: MilestoneState = d?.decision === 'disputed' ? 'attention' : d ? 'done' : 'current';
      return { key, label: MILESTONE_LABEL[key], at: d?.created_at ?? i.invoice.created_at, state, note: i.invoice.version > 1 ? `${note} · 정정 v${i.invoice.version}` : note };
    }
    const st = STAGE_OF[key]!;
    const ev = first.get(st);
    const reached = i.stage >= st;
    const at = ev?.occurred_at ?? (key === 'booking' ? i.bookedAt : null);
    return { key, label: MILESTONE_LABEL[key], at: reached ? at : null, state: reached ? 'done' : 'todo', note: reached && ev?.raw_status ? `「${ev.raw_status}」` : null };
  });
  // 지금 마디: 끝나지 않은 첫 운송 마디. 사이 단계(2~4, 8)에 있으면 그 이름을 적는다.
  const cur = out.find((m) => m.state === 'todo' && m.key !== 'billing');
  if (cur) {
    cur.state = i.exceptionOpen ? 'attention' : 'current';
    const between = i.stage >= 1 && i.stage < 9 && !Object.values(STAGE_OF).includes(i.stage) ? i.stage : null;
    cur.note = between ? `지금: ${between}. ${STAGES[between]}` : i.exceptionOpen ? '예외 확인 중' : '진행 중';
    if (between && i.exceptionOpen) cur.note += ' · 예외 확인 중';
  }
  return out;
}

/** 화면 읽기용 한 문장 */
export function timelineSummary(ms: Milestone[]): string {
  const done = ms.filter((m) => m.state === 'done').length;
  const now = ms.find((m) => m.state === 'current' || m.state === 'attention');
  return `일곱 마디 중 ${done}곳 끝남${now ? ` · 지금 ${now.label}${now.state === 'attention' ? '(확인 필요)' : ''}` : ''}`;
}
