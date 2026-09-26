/** 폼 검증 — 브라우저(즉시 검증)와 서버(최종 검증)가 같은 규칙을 쓴다. */
import { z } from 'zod';
import { SEGMENTS } from './money/segments';

export const BASES = ['per_cbm', 'per_rt', 'per_kg', 'per_chargeable_kg', 'per_carton', 'per_unit', 'per_pallet', 'per_container', 'per_shipment', 'percent_goods'] as const;

export const RateLineInput = z.object({
  segment: z.enum(SEGMENTS),
  included: z.boolean({ required_error: '포함/제외를 고르세요' }).nullable(),
  basis: z.enum(BASES),
  unitPrice: z.number({ invalid_type_error: '단가를 넣으세요' }).min(0).max(100_000_000).nullable(),
  currency: z.enum(['KRW', 'RMB', 'USD']),
  minCharge: z.number().min(0).max(100_000_000).nullable(),
  certainty: z.enum(['confirmed', 'estimated', 'extra_possible']),
});
export type RateLineInputT = z.infer<typeof RateLineInput>;

export const RateCardInput = z
  .object({
    hub: z.string().regex(/^[A-Z]{3}$/),
    port: z.enum(['ICN', 'PTK']),
    mode: z.enum(['LCL', 'FERRY', 'FCL', 'AIR']),
    validFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '시작일을 고르세요'),
    validTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '끝나는 날을 고르세요'),
    transitMin: z.number().int().min(1).max(60),
    transitMax: z.number().int().min(1).max(90),
    certainty: z.enum(['confirmed', 'estimated', 'extra_possible']),
    fuelSeparate: z.boolean(),
    isPublicPrice: z.boolean(),
    lines: z.array(RateLineInput).length(9),
    tiers: z.array(z.object({ minQty: z.number().min(0), discountBp: z.number().int().min(0).max(9000) })).max(6).default([]),
    note: z.string().max(200).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.validFrom > v.validTo) ctx.addIssue({ code: 'custom', path: ['validTo'], message: '끝나는 날이 시작일보다 앞입니다' });
    if (v.transitMin > v.transitMax) ctx.addIssue({ code: 'custom', path: ['transitMax'], message: '기간의 최대가 최소보다 작습니다' });
    if (v.mode === 'FERRY' && !['QDG', 'WEH', 'YNT', 'RZH'].includes(v.hub))
      ctx.addIssue({ code: 'custom', path: ['mode'], message: '카페리는 산둥 거점(청도·위해·연태·일조)에서만 탑니다' });
    v.lines.forEach((l, i) => {
      if (l.included == null) ctx.addIssue({ code: 'custom', path: ['lines', i, 'included'], message: '포함인지 제외인지 고르세요' });
      if (l.included && (l.unitPrice == null || l.unitPrice <= 0)) ctx.addIssue({ code: 'custom', path: ['lines', i, 'unitPrice'], message: '단가를 넣으세요' });
    });
    if (!v.lines.some((l) => l.included)) ctx.addIssue({ code: 'custom', path: ['lines'], message: '포함 구간이 하나는 있어야 합니다' });
  });
export type RateCardInputT = z.infer<typeof RateCardInput>;

export const DEFAULT_BASIS: Record<(typeof SEGMENTS)[number], (typeof BASES)[number]> = {
  pickup: 'per_cbm',
  cn_warehouse: 'per_carton',
  export_customs: 'per_shipment',
  freight: 'per_rt',
  port: 'per_rt',
  broker: 'per_shipment',
  kr_warehouse: 'per_carton',
  fc_delivery: 'per_pallet',
  return_reserve: 'per_carton',
};

export function emptyLines(): RateLineInputT[] {
  return SEGMENTS.map((s) => ({
    segment: s,
    included: null,
    basis: DEFAULT_BASIS[s],
    unitPrice: null,
    currency: 'KRW' as const,
    minCharge: null,
    certainty: 'confirmed' as const,
  }));
}

export const Password = z.string().min(10, '비밀번호는 10자 이상').max(72).regex(/[A-Za-z]/, '영문을 하나 이상').regex(/\d/, '숫자를 하나 이상');

export const ShipperSignup = z.object({
  company: z.string().trim().min(2, '회사(상호) 이름을 넣으세요').max(60),
  bizRegNo: z.string().trim().regex(/^(\d{3}-?\d{2}-?\d{5})?$/, '사업자등록번호는 숫자 10자리').optional().or(z.literal('')),
  category: z.string().trim().max(30).optional(),
  hubs: z.array(z.string()).max(7).default([]),
  name: z.string().trim().min(2, '이름을 넣으세요').max(40),
  email: z.string().trim().email('이메일 형식이 아닙니다'),
  phone: z.string().trim().max(30).optional(),
  password: Password,
  agree: z.literal(true, { errorMap: () => ({ message: '약관에 동의해 주세요' }) }),
});
export type ShipperSignupT = z.infer<typeof ShipperSignup>;

export const PartnerSignup = z.object({
  company: z.string().trim().min(2, '회사 이름을 넣으세요').max(60),
  companyZh: z.string().trim().max(60).optional(),
  businessType: z.enum(['forwarder', 'consolidator', 'ferry_agent', 'air_forwarder', 'customs_broker', 'fulfillment_3pl']),
  bizRegNo: z.string().trim().min(5, '사업자(영업집조) 번호를 넣으세요').max(30),
  licenseNo: z.string().trim().max(60).optional(),
  city: z.string().trim().min(1, '도시를 넣으세요').max(30),
  address: z.string().trim().max(120).optional(),
  phone: z.string().trim().max(30).optional(),
  locale: z.enum(['ko', 'zh']),
  hubs: z.array(z.string()).min(1, '거점을 하나 이상 고르세요'),
  ports: z.array(z.string()).min(1, '도착항을 하나 이상 고르세요'),
  modes: z.array(z.string()).min(1, '운송 방식을 하나 이상 고르세요'),
  caps: z.array(z.string()).default([]),
  insurance: z.string().trim().max(80).optional(),
  card: RateCardInput,
  name: z.string().trim().min(2, '이름을 넣으세요').max(40),
  email: z.string().trim().email('이메일 형식이 아닙니다'),
  password: Password,
  agree: z.literal(true, { errorMap: () => ({ message: '약관에 동의해 주세요' }) }),
});
export type PartnerSignupT = z.infer<typeof PartnerSignup>;

export function slugify(name: string, suffix: string) {
  const base = name
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 30);
  return `${base || 'p'}-${suffix}`;
}
