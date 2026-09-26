/**
 * 셀러 인터뷰 답변 — 화면(셀러·인터뷰어)과 서버 행동이 같은 모양을 쓴다. 모두 선택 칸.
 * 저장은 fcd.research_responses.answers(jsonb) 에 이 모양 그대로(판 번호 v).
 */
import { z } from 'zod';
import type { Cargo } from '../money/quote';
import { STANDARD_CARGO, STANDARD_ROUTE } from '../standard-cargo';

export const STEPS = ['consent', 'lane', 'screens', 'ladder', 'habits', 'comment', 'done'] as const;
export type Step = (typeof STEPS)[number];

export const STEP_LABEL: Record<Step, string> = {
  consent: '동의',
  lane: '최근 선적',
  screens: '화면 셋',
  ladder: '확정가',
  habits: '지금 방식',
  comment: '자유 의견',
  done: '끝',
};

export const PAIN = ['extra_charges', 'fc_reject', 'hard_compare', 'customs_docs', 'delay_contact', 'other'] as const;
export const PAIN_LABEL: Record<(typeof PAIN)[number], string> = {
  extra_charges: '견적에 없던 추가비용·청구가 견적과 다름',
  fc_reject: 'FC 입고 반려·회송',
  hard_compare: '업체 비교가 어려움',
  customs_docs: '통관·서류',
  delay_contact: '일정 지연·연락 안 됨',
  other: '기타',
};

export const METHOD = ['fixed_forwarder', 'baedaeji', 'compare', 'other'] as const;
export const METHOD_LABEL: Record<(typeof METHOD)[number], string> = {
  fixed_forwarder: '한 포워더에 고정',
  baedaeji: '배대지(구매·배송 대행)',
  compare: '매번 견적 비교',
  other: '기타',
};

export const ONESTOP = ['used_good', 'used_bad', 'never'] as const;
export const ONESTOP_LABEL: Record<(typeof ONESTOP)[number], string> = {
  used_good: '써 봤다 — 만족',
  used_bad: '써 봤다 — 불만',
  never: '안 써 봤다',
};

export const COUNTER = ['agree', 'disagree', 'unsure'] as const;
export const COUNTER_LABEL: Record<(typeof COUNTER)[number], string> = {
  agree: '그렇다 — 지금처럼이 낫다',
  disagree: '아니다 — 확정가가 낫다',
  unsure: '모르겠다',
};

export const PAST_EXTRA = ['none', 'once', 'few', 'many', 'unknown'] as const;
export const PAST_EXTRA_LABEL: Record<(typeof PAST_EXTRA)[number], string> = {
  none: '없다',
  once: '1번',
  few: '2~3번',
  many: '4번 이상',
  unknown: '잘 모르겠다',
};

export const SCREENS = ['check', 'firm', 'pnl'] as const;
export type ScreenKey = (typeof SCREENS)[number];
export const SCREEN_LABEL: Record<ScreenKey, string> = {
  check: '청구서 점검',
  firm: '확정가 카드',
  pnl: '판매손익',
};

const txt = (max: number) => z.string().trim().max(max).optional();
const score = z.number().int().min(1).max(5).nullable().optional();

export const Lane = z.object({
  hub: z.string().regex(/^[A-Z]{3}$/).optional(),
  port: z.enum(['ICN', 'PTK']).optional(),
  mode: z.enum(['LCL', 'FERRY', 'FCL', 'AIR']).optional(),
  cbm: z.number().min(0.1).max(200).optional(),
  /** 부가세 포함 판매가(원) */
  price: z.number().int().min(100).max(100_000_000).optional(),
  /** 지난번 물류비 총액(원) — 청구서 점검 미리 계산 */
  lastTotal: z.number().int().min(1000).max(10_000_000_000).optional(),
});
export type LaneT = z.infer<typeof Lane>;

const ScreenReact = z.object({ score, why: txt(400) });

export const Answers = z.object({
  v: z.literal(1),
  lane: Lane.optional(),
  screens: z.object({ check: ScreenReact.optional(), firm: ScreenReact.optional(), pnl: ScreenReact.optional() }).optional(),
  /** 미리 계산 때 보인 참고 확정가 프리미엄(bp) — 사다리 답과 견줄 때 */
  shownPremiumBp: z.number().int().min(0).max(10000).nullable().optional(),
  ladder: z.record(z.string().regex(/^[0-9]{1,5}$/), z.boolean().nullable()).optional(),
  counter: z.enum(COUNTER).optional(),
  pastExtra: z.enum(PAST_EXTRA).optional(),
  pilotWaitlist: z.boolean().optional(),
  pain: z.enum(PAIN).optional(),
  painOther: txt(200),
  method: z.enum(METHOD).optional(),
  oneStop: z.enum(ONESTOP).optional(),
  oneStopWhy: txt(400),
  monthlyShipments: z.number().int().min(0).max(1000).optional(),
  comment: txt(1500),
  quoteOk: z.boolean().optional(),
});
export type AnswersT = z.infer<typeof Answers>;

export const EMPTY_ANSWERS: AnswersT = { v: 1 };

/** 진행 저장 입력 */
export const SaveInput = z.object({
  step: z.enum(STEPS),
  answers: Answers,
  complete: z.boolean(),
});
export type SaveInputT = z.infer<typeof SaveInput>;

/**
 * 셀러가 넣은 CBM 으로 기준 화물을 비례해 늘리고 줄인다(수량·박스·무게·물품가). 넣지 않았으면 기준 화물 그대로.
 * 인터뷰의 미리 계산은 「대략 이런 크기의 짐」이면 충분하다 — 예시 화물이라고 화면에 적는다.
 */
export function cargoFromCbm(cbm: number | null | undefined): Cargo {
  const base = STANDARD_CARGO;
  if (cbm == null || !(cbm > 0)) return { ...base };
  const r = cbm / base.cbm;
  return {
    units: Math.max(1, Math.round(base.units * r)),
    cartons: Math.max(1, Math.round(base.cartons * r)),
    kg: Math.max(1, Math.round(base.kg * r * 10) / 10),
    cbm: Math.round(cbm * 100) / 100,
    goodsValue: Math.max(1, Math.round(base.goodsValue * r)),
    goodsCurrency: base.goodsCurrency,
  };
}

export function laneOrDefault(l: LaneT | undefined) {
  return {
    hub: l?.hub ?? STANDARD_ROUTE.hub,
    port: l?.port ?? STANDARD_ROUTE.port,
    mode: l?.mode ?? 'LCL',
    fc: STANDARD_ROUTE.fc,
    cargo: cargoFromCbm(l?.cbm),
    usedDefault: !l?.hub && !l?.port && !l?.cbm,
  };
}

/** 참여자 진행 상태(보드 표) */
export type ProgressState = 'not_invited' | 'invited' | 'opened' | 'in_progress' | 'done' | 'declined';
export const PROGRESS_LABEL: Record<ProgressState, string> = {
  not_invited: '링크 없음',
  invited: '링크 보냄(안 열림)',
  opened: '동의함(답 전)',
  in_progress: '진행 중',
  done: '끝',
  declined: '동의 안 함',
};

export function progressOf(p: { consent_state: string; invites: number; opened: boolean; head_step: string | null; completed: boolean }): ProgressState {
  if (p.consent_state === 'declined' || p.consent_state === 'withdrawn') return 'declined';
  if (p.completed) return 'done';
  if (p.head_step) return 'in_progress';
  if (p.opened) return 'opened';
  if (p.invites > 0) return 'invited';
  return 'not_invited';
}

/** 한 응답이 몇 단계까지 왔는가(진행률 막대) — 0~1 */
export function stepRatio(step: string | null | undefined): number {
  const i = STEPS.indexOf((step ?? 'consent') as Step);
  return i < 0 ? 0 : i / (STEPS.length - 1);
}
