/**
 * v2 3차 sourcing 설정 — 키 이름과 값 규칙. 값은 fcd.settings 에만 있고(참조 시드가 첫 판), 여기엔 규칙만 둔다.
 * 스위치가 없거나 읽을 수 없으면 꺼짐(안전한 쪽). 규칙·수수료가 없으면 오류로 멈춘다(참조 시드를 올려야 한다).
 */
import { z } from 'zod';

export const SOURCING_SWITCH_KEY = 'sourcing.enabled';

const int = (min: number, max: number) => z.number().int().min(min).max(max);

export const SimilarityWeightsSchema = z.object({
  wordBp: int(0, 10000),
  categoryBp: int(0, 10000),
  priceBp: int(0, 10000),
  imageBp: int(0, 10000),
  minShow: int(0, 100),
});
export type SimilarityWeights = z.infer<typeof SimilarityWeightsSchema>;

export const SourcingRulesSchema = z.object({
  slaDays: int(1, 60),
  maxOpenPerOrg: int(1, 100),
  maxCandidates: int(1, 30),
  defaultHub: z.string().regex(/^[A-Z]{3}$/),
  defaultPort: z.enum(['ICN', 'PTK']),
  defaultMode: z.enum(['LCL', 'FERRY', 'FCL', 'AIR']),
  defaultFc: z.string().regex(/^(FC|TP|MK)-[A-Z0-9]{3}$/),
  targetCostShareBp: int(1, 10000),
  priceBandBp: int(1, 10000),
  similarity: SimilarityWeightsSchema,
});
export type SourcingRules = z.infer<typeof SourcingRulesSchema>;

export const SourcingFeesSchema = z.object({
  example: z.boolean(),
  agentFeeBp: int(0, 5000),
  sampleHandlingKrw: int(0, 10_000_000),
  inspectionPerDayKrw: int(0, 100_000_000),
  checkedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
});
export type SourcingFees = z.infer<typeof SourcingFeesSchema>;

export const SOURCING_SETTING_SCHEMAS: Record<string, z.ZodTypeAny> = {
  'sourcing.enabled': z.boolean(),
  'sourcing.rules': SourcingRulesSchema,
  'sourcing.fees': SourcingFeesSchema,
};

export const SOURCING_SETTING_LABEL: Record<string, string> = {
  'sourcing.enabled': '소싱처 찾기 스위치(패밀리 · 미리보기)',
  'sourcing.rules': '소싱 요청 처리 기한·유사도 가중치·시뮬 기본 구간',
  'sourcing.fees': '소싱 수익 가정치(대행·샘플·검품)',
};

export interface SourcingConfig {
  on: boolean;
  rules: SourcingRules;
  fees: SourcingFees;
}

export function readSourcingConfig(m: Map<string, unknown>): SourcingConfig {
  const rules = SourcingRulesSchema.safeParse(m.get('sourcing.rules'));
  if (!rules.success) throw new Error('설정 sourcing.rules 가 없거나 모양이 틀립니다. 참조 시드를 올려 주세요.');
  const fees = SourcingFeesSchema.safeParse(m.get('sourcing.fees'));
  if (!fees.success) throw new Error('설정 sourcing.fees 가 없거나 모양이 틀립니다. 참조 시드를 올려 주세요.');
  return { on: m.get(SOURCING_SWITCH_KEY) === true, rules: rules.data, fees: fees.data };
}

/** 처리 기한(YYYY-MM-DD) = 접수일 + slaDays */
export function dueOn(today: string, slaDays: number): string {
  return new Date(Date.parse(`${today}T00:00:00Z`) + slaDays * 86_400_000).toISOString().slice(0, 10);
}

export const SOURCING_STATUSES = ['requested', 'researching', 'candidates_ready', 'sample_requested', 'closed', 'cancelled'] as const;
export type SourcingStatus = (typeof SOURCING_STATUSES)[number];
export const OPEN_STATUSES: readonly SourcingStatus[] = ['requested', 'researching', 'candidates_ready', 'sample_requested'];

/** 처리 기한 상태 — 끝난 요청은 기한을 보지 않는다 */
export function dueState(due: string, today: string, status: SourcingStatus): 'done' | 'overdue' | 'today' | 'ok' {
  if (!OPEN_STATUSES.includes(status) || status === 'candidates_ready' || status === 'sample_requested') return 'done';
  if (due < today) return 'overdue';
  if (due === today) return 'today';
  return 'ok';
}
