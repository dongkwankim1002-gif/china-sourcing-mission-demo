/**
 * v2 alliance 설정 — 키 이름과 값 규칙. 값은 fcd.settings 에만 있고(참조 시드가 첫 판), 여기에는 규칙만 둔다.
 * 스위치 키가 없거나 값이 정확히 true 가 아니면 꺼짐(안전한 쪽).
 */
import { z } from 'zod';
import { INCIDENT_KINDS, type Liability } from './money/alliance';

export const ALLIANCE_SWITCH_KEY = 'v2.alliance_enabled';

export const REQUIREMENT_KINDS = ['registration_cert', 'guarantee_bond', 'biz_reg', 'incident_history', 'cargo_insurance'] as const;
export type RequirementKind = (typeof REQUIREMENT_KINDS)[number];

export const REQUIREMENT_LABEL: Record<RequirementKind, { ko: string; zh: string; hint: string; hintZh: string }> = {
  registration_cert: { ko: '국제물류주선업 등록증', zh: '国际物流代理业登记证(韩国)', hint: '등록번호와 등록기준 신고 기한(3년 주기)을 적어 주세요', hintZh: '请填写登记号码及登记基准申报期限(每3年)' },
  guarantee_bond: { ko: '보증보험 증권', zh: '保证保险保单', hint: '증권번호·보험 금액·보험 기간 끝', hintZh: '保单号·保险金额·保险期限截止日' },
  biz_reg: { ko: '사업자등록증', zh: '营业登记证(韩国)', hint: '사업자등록번호', hintZh: '营业登记号码' },
  incident_history: { ko: '사고 이력(최근 12개월)', zh: '事故记录(最近12个月)', hint: '분실·파손·회송·분쟁 건수와 설명', hintZh: '丢失·破损·退回·纠纷件数及说明' },
  cargo_insurance: { ko: '적하보험 증권(선택)', zh: '货运险保单(可选)', hint: '증권번호·보험 기간 끝', hintZh: '保单号·保险期限截止日' },
};

export const INCIDENT_LABEL: Record<(typeof INCIDENT_KINDS)[number], string> = { overrun: '초과비용', return: 'FC 회송', loss: '분실·파손', delay: '지연' };
export const FAULT_LABEL = { seller: '셀러 귀책', partner: '주선사 귀책', external: '외부 요인' } as const;

export const ALLIANCE_STATUS = ['candidate', 'applied', 'reviewing', 'active', 'suspended', 'ended'] as const;
export type AllianceStatus = (typeof ALLIANCE_STATUS)[number];
export const ALLIANCE_STATUS_LABEL: Record<AllianceStatus, { ko: string; zh: string; tone: 'neutral' | 'info' | 'caution' | 'ok' | 'stamp' | 'label' }> = {
  candidate: { ko: '후보', zh: '候选', tone: 'neutral' },
  applied: { ko: '신청함', zh: '已申请', tone: 'info' },
  reviewing: { ko: '요건 확인 중', zh: '资格审核中', tone: 'caution' },
  active: { ko: '제휴 중', zh: '合作中', tone: 'ok' },
  suspended: { ko: '멈춤', zh: '暂停', tone: 'stamp' },
  ended: { ko: '끝남', zh: '已结束', tone: 'neutral' },
};

export const REQ_STATUS_LABEL = {
  submitted: { ko: '올림 — 확인 전', zh: '已提交 — 待审核', tone: 'info' },
  verified: { ko: '확인함', zh: '已确认', tone: 'ok' },
  rejected: { ko: '반려', zh: '已驳回', tone: 'stamp' },
} as const;

export const TERMS_MODELS = ['partner_contract', 'sales_agency'] as const;
export type TermsModel = (typeof TERMS_MODELS)[number];
export const TERMS_MODEL_LABEL: Record<TermsModel, string> = { partner_contract: '① 제휴 주선사 명의 계약', sales_agency: '② 영업 대리' };
export const TERMS_STATUS_LABEL = { draft: '초안', agreed: '서명함', ended: '끝남' } as const;

const int = (min = 0, max = Number.MAX_SAFE_INTEGER) => z.number().int().min(min).max(max);
const Share = z.object({ platformBp: int(0, 10000), capBp: int(0, 10000) });
export const LiabilitySchema = z.object({ overrun: Share, return: Share, loss: Share, delay: Share }) satisfies z.ZodType<Liability>;

export const AllianceRulesSchema = z.object({
  expiryWarnDays: int(1, 180),
  minBondAmount: int(0, 10_000_000_000),
  requiredKinds: z.array(z.enum(REQUIREMENT_KINDS)).min(1),
});
export type AllianceRules = z.infer<typeof AllianceRulesSchema>;

export const DefaultTermsSchema = z.object({
  model: z.enum(TERMS_MODELS),
  commissionBp: int(0, 3000),
  reserveBp: int(0, 10000),
  liability: LiabilitySchema,
  validDays: int(1, 1095),
});
export type DefaultTerms = z.infer<typeof DefaultTermsSchema>;

export const ALLIANCE_SETTING_SCHEMAS: Record<string, z.ZodTypeAny> = {
  [ALLIANCE_SWITCH_KEY]: z.boolean(),
  'alliance.rules': AllianceRulesSchema,
  'alliance.default_terms': DefaultTermsSchema,
};

export const ALLIANCE_SETTING_LABEL: Record<string, string> = {
  [ALLIANCE_SWITCH_KEY]: '제휴 주선사 스위치',
  'alliance.rules': '제휴 요건 — 만료 경고 일수·보증보험 최소 금액·필수 서류',
  'alliance.default_terms': '제휴 계약 첫 판 기본값(수수료·준비금·책임 비율)',
};

export interface AllianceConfig {
  on: boolean;
  rules: AllianceRules | null;
  defaults: DefaultTerms | null;
}

export function readAllianceConfig(m: Map<string, unknown>): AllianceConfig {
  const r = AllianceRulesSchema.safeParse(m.get('alliance.rules'));
  const d = DefaultTermsSchema.safeParse(m.get('alliance.default_terms'));
  return { on: m.get(ALLIANCE_SWITCH_KEY) === true, rules: r.success ? r.data : null, defaults: d.success ? d.data : null };
}

/** 영업 대리(②)는 위험을 나누지 않는다 — 준비금·플랫폼 부담이 0 이어야 한다 */
export function termsModelOk(model: TermsModel, reserveBp: number, liability: Liability): boolean {
  if (model === 'partner_contract') return true;
  return reserveBp === 0 && INCIDENT_KINDS.every((k) => liability[k].platformBp === 0);
}
