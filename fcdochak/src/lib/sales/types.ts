/**
 * 판매 자료 모양(v2 3차 sales) — 흉내·파일·API 가 같은 모양으로 맞춘다. 개인정보 칸(주문자·수령인)은 없다.
 */

export const RETURN_REASONS = ['change_of_mind', 'defect', 'damaged', 'wrong_item', 'not_as_described', 'other'] as const;
export type ReturnReason = (typeof RETURN_REASONS)[number];

export interface SalesProduct {
  /** 쿠팡 옵션 번호(흉내는 EX-VI-) */
  ext: string;
  name: string;
  optionName: string | null;
  /** 목록 판매가(부가세 포함) */
  listPrice: number | null;
  /** 우리 SKU */
  skuId: string | null;
}

export interface SalesOrder {
  ext: string;
  productExt: string;
  on: string;
  units: number;
  /** 결제 금액(부가세 포함) */
  amount: number;
  /** 하루 묶음이면 그날 주문 건수 */
  orders: number;
  cancelled: boolean;
}

export interface SalesSnapshot {
  productExt: string;
  on: string;
  onHand: number;
  inbound: number | null;
}

export interface SalesReturn {
  ext: string;
  productExt: string;
  on: string;
  units: number;
  reason: ReturnReason;
  reasonRaw: string | null;
}

export interface SalesDataset {
  products: SalesProduct[];
  orders: SalesOrder[];
  inventory: SalesSnapshot[];
  returns: SalesReturn[];
}

/** 설정 sales.rules */
export interface SalesRules {
  velocityDays: number;
  prepDays: number;
  coverDays: number;
  abcABp: number;
  abcBBp: number;
  lowStockDays: number;
  actualShipments: number;
  inboundReflectBp: number;
  roundUnits: number;
}

/** 판매 분석을 여는가 — live = 키를 맡긴 조직 · example = 데모 조직의 흉내 연결 · none = 연결 없음(권유 + 미리보기) */
export type SalesAccess = 'live' | 'example' | 'none';
