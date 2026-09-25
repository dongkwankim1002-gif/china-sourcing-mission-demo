/**
 * 기준 화물 — 공개 계산기 첫 값·구간 시세·업체 공개 요금·물류사 시장 데이터가 모두 이 하나를 쓴다.
 * 서버 전용 모듈이 아니다(브라우저 계산기도 첫 값으로 읽는다). 값을 바꾸면 화면에 적힌 조건도 같이 바뀐다.
 */
import type { Cargo } from './money/quote';

export const STANDARD_CARGO: Cargo = { units: 1200, cartons: 40, kg: 650, cbm: 3, goodsValue: 24000, goodsCurrency: 'RMB' };

/** 기준 구간(계산기 첫 값) */
export const STANDARD_ROUTE = { hub: 'YIW', port: 'ICN', fc: 'FC-ICH' } as const;

const n = (v: number, d = 0) => v.toLocaleString('ko-KR', { maximumFractionDigits: d });

/** 「1,200개 · 40박스 · 650 kg · 3 CBM · 물품가 24,000 RMB」 — 화면에 조건을 그대로 적을 때 */
export function cargoSummaryText(c: Cargo): string {
  return `${n(c.units)}개 · ${n(c.cartons)}박스 · ${n(c.kg, 1)} kg · ${n(c.cbm, 2)} CBM · 물품가 ${n(c.goodsValue)} ${c.goodsCurrency}`;
}
