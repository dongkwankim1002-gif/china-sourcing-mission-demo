/**
 * 공개 도구(/tools/pnl)의 기준값 — 설정 표(fcd.settings)에서 읽은 값을 모양 맞춰 푼다. 순수 함수(브라우저·서버 공용).
 * 값이 없거나 모양이 틀리면 기존 판매손익 기준값(sale_fee_bp·fulfillment_per_unit)으로 떨어지고 「확인일 없음」으로 보인다.
 */
import type { TraitCostNote } from './money/seller';

export interface CoupangFeeBasis {
  saleFeeBp: number;
  rgInboundPerUnit: number;
  rgShippingPerUnit: number;
  adBp: number;
  /** 기준값을 확인한 날(YYYY-MM-DD). 모르면 null */
  checkedOn: string | null;
  /** 실제 요율을 확인한 값이 아니라 예시인가 */
  example: boolean;
  source: string | null;
  /** 설정 표의 tools.coupang_fee_basis 에서 왔는가(아니면 옛 기본값으로 채움) */
  fromSettings: boolean;
}

const nonNeg = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null);

export function parseFeeBasis(v: unknown, fallback: { saleFeeBp: number; fulfillmentPerUnit: number }): CoupangFeeBasis {
  const o = v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  const sale = nonNeg(o?.saleFeeBp);
  const inbound = nonNeg(o?.rgInboundPerUnit);
  const ship = nonNeg(o?.rgShippingPerUnit);
  if (!o || sale == null || inbound == null || ship == null) {
    return {
      saleFeeBp: fallback.saleFeeBp,
      rgInboundPerUnit: 0,
      rgShippingPerUnit: fallback.fulfillmentPerUnit,
      adBp: 0,
      checkedOn: null,
      example: true,
      source: null,
      fromSettings: false,
    };
  }
  const checked = typeof o.checkedOn === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(o.checkedOn) ? o.checkedOn : null;
  return {
    saleFeeBp: sale,
    rgInboundPerUnit: inbound,
    rgShippingPerUnit: ship,
    adBp: nonNeg(o.adBp) ?? 0,
    checkedOn: checked,
    // 예시가 아니라고 적혀 있고 확인일이 있을 때만 「확인한 값」
    example: !(o.example === false && checked),
    source: typeof o.source === 'string' ? o.source : null,
    fromSettings: true,
  };
}

export function parseTraitNotes(v: unknown): TraitCostNote[] {
  if (!Array.isArray(v)) return [];
  const out: TraitCostNote[] = [];
  for (const x of v) {
    if (!x || typeof x !== 'object') continue;
    const t = (x as Record<string, unknown>).trait;
    const items = (x as Record<string, unknown>).items;
    if (typeof t !== 'string' || !Array.isArray(items)) continue;
    out.push({ trait: t, items: items.filter((i): i is string => typeof i === 'string' && i.trim().length > 0) });
  }
  return out;
}

/** 「예시 기준값 · 확인일 2026-09-25」 */
export function basisLabel(b: Pick<CoupangFeeBasis, 'example' | 'checkedOn'>): string {
  return `${b.example ? '예시 기준값' : '확인한 기준값'} · 확인일 ${b.checkedOn ?? '없음'}`;
}
