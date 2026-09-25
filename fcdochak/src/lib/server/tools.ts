import 'server-only';
/**
 * 공개 도구 — 판매손익 계산기(/tools/pnl)의 기준값과 「구간 시세로 도착원가」.
 * 도착원가는 구간 시세(laneStats)와 같은 규칙: 공식·인증 대기 업체의 지금 유효한 요금표, 집계 숫자만 내보낸다.
 */
import { asPublic, asSystem, todayKst, type Queryable } from '../db';
import { env } from '../env';
import type { TraitCostNote } from '../money/seller';
import { buildArrivalResponse, type ArrivalResponse } from '../tools-arrival';
import { parseFeeBasis, parseTraitNotes, type CoupangFeeBasis } from '../tools-settings';
import { compare, type CompareInput } from './compare';
import { loadSettings } from './settings';

export interface ToolBasis {
  fee: CoupangFeeBasis;
  traitNotes: TraitCostNote[];
  fx: Record<'KRW' | 'RMB' | 'USD', number>;
  vatRateBp: number;
  insuranceBp: number;
  dutyRates: { category: string; name_ko: string; rate_bp: number }[];
}

/** 설정 표에서 도구 기준값 — tools.* 키가 없어도(참조 시드 전) 계산기는 옛 기본값으로 돈다 */
export async function loadToolBasis(q: Queryable): Promise<ToolBasis> {
  const s = await loadSettings(q);
  const rows = await q.query<{ key: string; value: unknown }>(
    `select key, value from fcd.v_current_settings where key = any($1::text[])`,
    [['tools.coupang_fee_basis', 'tools.trait_extra_costs']],
  );
  const get = (k: string) => rows.find((r) => r.key === k)?.value;
  return {
    fee: parseFeeBasis(get('tools.coupang_fee_basis'), { saleFeeBp: s.saleFeeBp, fulfillmentPerUnit: s.fulfillmentPerUnit }),
    traitNotes: parseTraitNotes(get('tools.trait_extra_costs')),
    fx: s.fx,
    vatRateBp: s.vatRateBp,
    insuranceBp: s.insuranceBp,
    dutyRates: s.dutyRates,
  };
}

export function publicToolBasis(): Promise<ToolBasis> {
  return asPublic(loadToolBasis);
}

/** 화물 특성 추가비용 표만(홈 계산기·비교 화면 경고용) */
export async function loadTraitNotes(q: Queryable): Promise<TraitCostNote[]> {
  const rows = await q.query<{ value: unknown }>(`select value from fcd.v_current_settings where key = 'tools.trait_extra_costs'`);
  return parseTraitNotes(rows[0]?.value);
}

/** 구간 + 화물 + 특성 → 9구간 합계 중간값과 뺀 업체(이름·사유). 업체별 금액은 싣지 않는다. */
export async function arrivalEstimate(input: CompareInput): Promise<ArrivalResponse> {
  const today = todayKst();
  return asSystem(async (q) => {
    const s = await loadSettings(q);
    const r = await compare(q, input, s, today);
    return buildArrivalResponse(r, {
      okOrg: (p) => (p.status === 'official' || p.status === 'pending_verification') && (env.demoMode || !p.is_demo),
      units: input.cargo.units,
    });
  });
}
