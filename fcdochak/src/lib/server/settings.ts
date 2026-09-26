import 'server-only';
/** 설정 표에서 읽는다 — 요율·기준값·환율·관세율을 코드에 박지 않는다. */
import type { Queryable } from '../db';
import type { LastLegRule, QuoteParams, RateLine } from '../money';

export interface AppSettings {
  fx: QuoteParams['fx'];
  quoteParams: QuoteParams;
  commissionRateBp: number;
  fcReadyRule: { minFcInbound: number; maxReturnRate30d: number };
  scoreCaps: { deviationCap: number; fcReturnCap: number };
  vatRateBp: number;
  insuranceBp: number;
  saleFeeBp: number;
  fulfillmentPerUnit: number;
  referenceLines: RateLine[];
  expiringDays: number;
  dutyRates: { category: string; name_ko: string; rate_bp: number }[];
  /** v2 metrics — 쿠팡 FC 밖 목적지의 마지막 구간 기준(없으면 null: 목적지 반영 없이 예전처럼) */
  destinationLeg: LastLegRule | null;
}

export async function loadSettings(q: Queryable): Promise<AppSettings> {
  const rows = await q.query<{ key: string; value: unknown }>('select key, value from fcd.v_current_settings');
  const m = new Map(rows.map((r) => [r.key, r.value]));
  const get = <T>(k: string): T => {
    if (!m.has(k)) throw new Error(`설정 ${k} 가 없습니다. 참조 시드를 올려 주세요.`);
    return m.get(k) as T;
  };
  const fx = get<QuoteParams['fx']>('fx');
  const qp = get<Omit<QuoteParams, 'fx'>>('quote_params');
  const duty = await q.query<{ category: string; name_ko: string; rate_bp: number }>(
    'select category, name_ko, rate_bp from fcd.v_current_duty_rates order by category',
  );
  return {
    fx,
    quoteParams: { fx, ...qp },
    commissionRateBp: get<number>('commission_rate_bp'),
    fcReadyRule: get('fc_ready_rule'),
    scoreCaps: get('score_caps'),
    vatRateBp: get<number>('vat_rate_bp'),
    insuranceBp: get<number>('insurance_bp'),
    saleFeeBp: get<number>('sale_fee_bp'),
    fulfillmentPerUnit: get<number>('fulfillment_per_unit'),
    referenceLines: get<RateLine[]>('reference_lines'),
    expiringDays: get<number>('expiring_days'),
    dutyRates: duty,
    destinationLeg: (m.get('destination_leg') as LastLegRule | undefined) ?? null,
  };
}
