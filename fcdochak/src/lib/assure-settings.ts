/**
 * v2 assure 설정 — 키 이름과 값 규칙. 값은 fcd.settings 에만 있고(참조 시드가 첫 판), 여기에는 규칙만 둔다.
 * 스위치 키가 없거나 읽을 수 없으면 꺼짐으로 본다(안전한 쪽).
 */
import { z } from 'zod';
import type { CoverageRates, DeferredRates, FirmPriceRates } from './money/assure';

export const ASSURE_KINDS = ['firm', 'coverage', 'deferred', 'consolidation'] as const;
export type AssureKind = (typeof ASSURE_KINDS)[number];

export const ASSURE_SWITCH_KEY: Record<AssureKind, string> = {
  firm: 'v2.firm_price_enabled',
  coverage: 'v2.coverage_enabled',
  deferred: 'v2.deferred_enabled',
  consolidation: 'v2.consolidation_enabled',
};

export const ASSURE_KIND_LABEL: Record<AssureKind, string> = {
  firm: '확정가',
  coverage: '회송 보장',
  deferred: '물류비 후불',
  consolidation: '공동 혼적',
};

/** 켜려면 사람이 먼저 정해야 하는 일 */
export const ASSURE_HUMAN_TODO: Record<AssureKind, string> = {
  firm: '국제물류주선업 등록(법인 자본금 3억 원 이상·보증보험) 또는 등록 업체와의 제휴, 초과비용 준비금',
  coverage: '보험사 제휴(회송 비용 보장 상품)',
  deferred: '금융사·결제대행(에스크로) 제휴',
  consolidation: '콘솔사 물량 단가·공동 혼적 운영 계약',
};

const int = (min = 0, max = Number.MAX_SAFE_INTEGER) => z.number().int().min(min).max(max);

export const FirmRatesSchema = z.object({
  confidenceBp: int(5000, 9999),
  loadingBp: int(0, 50000),
  minPremiumBp: int(0, 5000),
  smallSampleMin: int(1, 100),
  smallSamplePremiumBp: int(0, 5000),
  maxPremiumBp: int(0, 10000),
  roundTo: int(1, 100000),
  validDays: int(1, 60),
}) satisfies z.ZodType<FirmPriceRates>;

export const CoverageRatesSchema = z.object({
  priorReturnRateBp: int(0, 10000),
  credibilityK: int(0, 10000),
  loadingBp: int(0, 50000),
  minFee: int(0, 10_000_000),
  maxInsurableRateBp: int(0, 10000),
  roundTo: int(1, 100000),
}) satisfies z.ZodType<CoverageRates>;

export const DeferredRatesSchema = z.object({
  monthlyFeeBp: int(0, 2000),
  termDays: int(1, 180),
  maxAmount: int(0, 10_000_000_000),
}) satisfies z.ZodType<DeferredRates>;

/** 운영 설정 화면의 「새 판」 검사 규칙(admin addSetting 이 쓴다) */
export const ASSURE_SETTING_SCHEMAS: Record<string, z.ZodTypeAny> = {
  'v2.firm_price_enabled': z.boolean(),
  'v2.coverage_enabled': z.boolean(),
  'v2.deferred_enabled': z.boolean(),
  'v2.consolidation_enabled': z.boolean(),
  'v2.firm_price_rates': FirmRatesSchema,
  'v2.coverage_rates': CoverageRatesSchema,
  'v2.deferred_rates': DeferredRatesSchema,
};

export const ASSURE_SETTING_LABEL: Record<string, string> = {
  'v2.firm_price_enabled': '확정가 시범 스위치',
  'v2.coverage_enabled': '회송 보장 시범 스위치',
  'v2.deferred_enabled': '물류비 후불 시범 스위치',
  'v2.consolidation_enabled': '공동 혼적 시범 스위치',
  'v2.firm_price_rates': '확정가 요율(신뢰수준·프리미엄)',
  'v2.coverage_rates': '회송 보장 요율',
  'v2.deferred_rates': '물류비 후불 요율',
};

export interface AssureConfig {
  on: Record<AssureKind, boolean>;
  firmRates: FirmPriceRates | null;
  coverageRates: CoverageRates | null;
  deferredRates: DeferredRates | null;
}

/** 설정 행(키 → 값)에서 assure 설정을 읽는다. 스위치는 값이 정확히 true 일 때만 켜짐. */
export function readAssureConfig(m: Map<string, unknown>): AssureConfig {
  const parse = <T>(s: z.ZodType<T>, k: string): T | null => {
    const r = s.safeParse(m.get(k));
    return r.success ? r.data : null;
  };
  return {
    on: Object.fromEntries(ASSURE_KINDS.map((k) => [k, m.get(ASSURE_SWITCH_KEY[k]) === true])) as Record<AssureKind, boolean>,
    firmRates: parse(FirmRatesSchema, 'v2.firm_price_rates'),
    coverageRates: parse(CoverageRatesSchema, 'v2.coverage_rates'),
    deferredRates: parse(DeferredRatesSchema, 'v2.deferred_rates'),
  };
}
