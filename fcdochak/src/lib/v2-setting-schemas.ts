/**
 * v2 꾸러미(tools·check·workspace·metrics)가 더한 설정 키의 검사 규칙과 이름 — 어드민 설정 화면에서 새 판으로 바꿀 수 있게.
 * 각 규칙은 그 값을 읽는 쪽(parseFeeBasis·parseTraitNotes·parseInvoiceCheckRule·parseArrivalRule·workspaceSettings·LastLegRule)이 보는 칸과 같다.
 * assure 스위치·요율은 assure-settings.ts 에 따로 있다.
 */
import { z } from 'zod';

const nonNegInt = z.number().int().min(0);

export const V2_SETTING_SCHEMAS: Record<string, z.ZodTypeAny> = {
  'tools.coupang_fee_basis': z.object({
    saleFeeBp: nonNegInt.max(5000),
    rgInboundPerUnit: nonNegInt.max(1_000_000),
    rgShippingPerUnit: nonNegInt.max(1_000_000),
    adBp: nonNegInt.max(5000),
    checkedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '확인일은 YYYY-MM-DD').nullable(),
    example: z.boolean(),
    source: z.string().max(500).nullable().optional(),
  }),
  'tools.trait_extra_costs': z
    .array(z.object({ trait: z.string().regex(/^[a-z_]{2,20}$/), items: z.array(z.string().trim().min(1).max(200)).max(20) }))
    .max(50),
  'tools.arrival_rule': z.object({
    minSamples: z.number().int().min(1).max(100),
    minSpreadSamples: z.number().int().min(1).max(100),
    perMinute: z.number().int().min(1).max(600),
  }),
  invoice_check_rule: z.object({
    minSamples: z.number().int().min(1).max(100),
    highOverMedianBp: nonNegInt.max(100_000),
    lowUnderMedianBp: nonNegInt.max(10_000),
    missingCoverageBp: nonNegInt.max(10_000),
    publicPerMinute: z.number().int().min(1).max(600),
    minSpreadSamples: z.number().int().min(1).max(100).optional(),
  }),
  'workspace.invite_days': z.number().int().min(1).max(90),
  'workspace.billing_flag_bp': z.number().int().min(1).max(10_000),
  destination_leg: z.object({
    perPalletBase: nonNegInt.max(10_000_000),
    perPalletPerKm: nonNegInt.max(1_000_000),
    minCharge: nonNegInt.max(10_000_000),
  }),
};

export const V2_SETTING_LABEL: Record<string, string> = {
  'tools.coupang_fee_basis': '판매손익 계산기 쿠팡 기준값(예시·확인일)',
  'tools.trait_extra_costs': '화물 특성별 추가비용 항목(글)',
  'tools.arrival_rule': '공개 도착원가 — 최소 표본·분당 횟수',
  invoice_check_rule: '청구서 점검 판정선·최소 표본',
  'workspace.invite_days': '거래처 초대 링크 유효 일수',
  'workspace.billing_flag_bp': '청구 「차이 큼」 기준(bp)',
  destination_leg: '쿠팡 FC 밖 목적지 마지막 구간 참고치',
};

// v2 2차 wing — 쿠팡 WING 연동 기준치(읽는 쪽: src/lib/server/wing.ts parseWingSettings)
export const WING_SETTING_SCHEMAS = {
  'wing.call_rule': z.object({
    perSecond: z.number().int().min(1).max(5),
    perMinute: z.number().int().min(1).max(300),
    maxRetries: z.number().int().min(0).max(5),
    baseBackoffMs: z.number().int().min(100).max(60_000),
    maxBackoffMs: z.number().int().min(100).max(300_000),
    timeoutMs: z.number().int().min(1000).max(60_000),
  }),
  'wing.match_rule': z.object({
    dateWindowDays: z.number().int().min(1).max(90),
    unitsToleranceBp: z.number().int().min(1).max(10_000),
    minScore: z.number().int().min(0).max(100),
  }),
  'wing.key_valid_days': z.number().int().min(1).max(365),
};
Object.assign(V2_SETTING_SCHEMAS, WING_SETTING_SCHEMAS);
Object.assign(V2_SETTING_LABEL, {
  'wing.call_rule': '쿠팡 WING 호출 제한·재시도',
  'wing.match_rule': '쿠팡 입고 요청 ↔ 선적 짝 제안 기준',
  'wing.key_valid_days': '쿠팡 OPEN API 키 유효 일수',
});
