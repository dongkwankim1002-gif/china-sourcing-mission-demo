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

export const DEFAULT_INPUT: CalcInput = { hub: 'YIW', port: 'ICN', mode: 'ANY', units: 1200, cartons: 40, kg: 820, cbm: 3.6, goods: 36000, cur: 'RMB', fc: 'FC-ICH', traits: [] };
