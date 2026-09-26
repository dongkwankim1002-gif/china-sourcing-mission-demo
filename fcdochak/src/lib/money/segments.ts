/**
 * 9구간 — 중국 공장 문 앞에서 쿠팡 FC 입고, 그리고 회송 대비까지.
 * 순서가 곧 화면의 색 띠 순서다. 바꾸면 모든 막대가 바뀐다.
 */
export const SEGMENTS = [
  'pickup',
  'cn_warehouse',
  'export_customs',
  'freight',
  'port',
  'broker',
  'kr_warehouse',
  'fc_delivery',
  'return_reserve',
] as const;

export type Segment = (typeof SEGMENTS)[number];

export const SEGMENT_LABEL_KO: Record<Segment, string> = {
  pickup: '집하',
  cn_warehouse: '창고 작업',
  export_customs: '수출통관',
  freight: '국제운송',
  port: '항만',
  broker: '관세사',
  kr_warehouse: '국내 창고',
  fc_delivery: 'FC 운송',
  return_reserve: '회송 대비',
};

export const SEGMENT_LABEL_ZH: Record<Segment, string> = {
  pickup: '提货',
  cn_warehouse: '仓库作业',
  export_customs: '出口报关',
  freight: '国际运输',
  port: '港口杂费',
  broker: '韩国报关行',
  kr_warehouse: '韩国仓库',
  fc_delivery: 'FC 配送',
  return_reserve: '退仓预留',
};

/** 한국 도착항까지(과세가격 CIF 산입 대상) 구간. */
export const SEGMENTS_TO_KR_PORT: readonly Segment[] = ['pickup', 'cn_warehouse', 'export_customs', 'freight'];

export function isSegment(v: unknown): v is Segment {
  return typeof v === 'string' && (SEGMENTS as readonly string[]).includes(v);
}
