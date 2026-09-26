/**
 * v2 6차 scorecard 설정 — 키 이름·값 규칙. 값은 fcd.settings 에만 있고(참조 시드가 첫 판), 여기엔 규칙만 둔다.
 * 스위치가 없거나 읽을 수 없으면 꺼짐(안전한 쪽). 규칙이 없으면 오류로 멈춘다(참조 시드를 올려야 한다).
 * 브라우저에서도 읽는다 — 서버 전용 모듈이 아니다. 기획 docs/scorecard-plan.md 4·8-4절.
 */
import { z } from 'zod';

export const SCORECARD_RULES_KEY = 'scorecard.rules';
/** 이름 붙은 성적을 비로그인에게도 보이는가 — 꺼짐(법무 검토 전) */
export const SCORECARD_PUBLIC_NAMED_KEY = 'scorecard.public_named';

export const ScorecardRulesSchema = z.object({
  /** 화면에 싣는 최소 표본(건) */
  minSamples: z.number().int().min(1).max(1000),
  /** 기간(일) — 수리일 기준 */
  windowDays: z.number().int().min(7).max(730),
  /** 「실측 인증」 최소 표본·최소 등록 건수 */
  certifiedMinSamples: z.number().int().min(1).max(10_000),
  /** 「실측 인증」 제출률(bp, 8000 = 80%) */
  certifiedSubmissionBp: z.number().int().min(0).max(10_000),
  /** 입항 → 수리가 이 영업일을 넘으면 이상치(분위수에서 빼고 따로 센다) */
  outlierDays: z.number().int().min(1).max(365),
  /** 추이 주 수 */
  trendWeeks: z.number().int().min(1).max(52),
  /** 넣는 번호 출처 */
  sources: z.object({ platform: z.boolean(), seller: z.boolean(), partner: z.boolean() }),
  /** 첫 판 가정치면 true — 화면에 「기준 가정치」 */
  example: z.boolean(),
});
export type ScorecardRules = z.infer<typeof ScorecardRulesSchema>;

export const SCORECARD_SETTING_SCHEMAS: Record<string, z.ZodTypeAny> = {
  [SCORECARD_RULES_KEY]: ScorecardRulesSchema,
  [SCORECARD_PUBLIC_NAMED_KEY]: z.boolean(),
};

export const SCORECARD_SETTING_LABEL: Record<string, string> = {
  [SCORECARD_RULES_KEY]: '물류사 성적표 — 표본 기준·기간·실측 인증(표본·제출률)·이상치·추이 주 수·번호 출처',
  [SCORECARD_PUBLIC_NAMED_KEY]: '이름 붙은 성적 공개 스위치(꺼짐 = 로그인 화주·그 업체·운영자만 — 법무 검토 뒤 켬)',
};

export interface ScorecardConfig {
  rules: ScorecardRules;
  publicNamed: boolean;
}

export function readScorecardConfig(m: Map<string, unknown>): ScorecardConfig {
  const r = ScorecardRulesSchema.safeParse(m.get(SCORECARD_RULES_KEY));
  if (!r.success) throw new Error('설정 scorecard.rules 가 없거나 모양이 틀립니다. 참조 시드를 올려 주세요.');
  return { rules: r.data, publicNamed: m.get(SCORECARD_PUBLIC_NAMED_KEY) === true };
}
