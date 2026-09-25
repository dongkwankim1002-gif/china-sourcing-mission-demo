import { STANDARD_CARGO as C, STANDARD_ROUTE as R } from './standard-cargo';

/** 공개 계산기 첫 값 — 서버(첫 칠)와 브라우저(입력)가 같이 쓴다. 'use client' 모듈에 두면 서버에서 값이 안 보인다. */
export interface CalcInput {
  hub: string;
  port: string;
  mode: string;
  units: number | null;
  cartons: number | null;
  kg: number | null;
  cbm: number | null;
  goods: number | null;
  cur: 'RMB' | 'USD';
  fc: string;
  traits: string[];
}

/** 첫 값 = 공표 기준 화물(STANDARD_CARGO) — 구간 시세와 같은 조건에서 시작한다 */
export const DEFAULT_INPUT: CalcInput = {
  hub: R.hub,
  port: R.port,
  mode: 'ANY',
  units: C.units,
  cartons: C.cartons,
  kg: C.kg,
  cbm: C.cbm,
  goods: C.goodsValue,
  cur: C.goodsCurrency === 'USD' ? 'USD' : 'RMB',
  fc: R.fc,
  traits: [],
};
