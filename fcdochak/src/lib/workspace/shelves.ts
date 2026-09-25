/**
 * 서류함 칸 — 셀러가 찾는 다섯 칸. 저장은 documents.kind(원래 종류) + documents.shelf(칸).
 * shelf 가 비어 있는 옛 기록은 kind 로 가른다 — SQL 의 fcd.doc_shelf() 와 같은 규칙.
 */
export const SHELVES = ['invoice', 'packing_list', 'coupang_barcode', 'bl', 'other'] as const;
export type Shelf = (typeof SHELVES)[number];

export const SHELF_LABEL: Record<Shelf, string> = {
  invoice: '인보이스',
  packing_list: '패킹리스트',
  coupang_barcode: '쿠팡 바코드 PDF',
  bl: 'B/L',
  other: '기타',
};

export const SHELF_LABEL_ZH: Record<Shelf, string> = {
  invoice: '发票',
  packing_list: '装箱单',
  coupang_barcode: 'Coupang 条码 PDF',
  bl: '提单',
  other: '其他',
};

export const SHELF_HINT: Record<Shelf, string> = {
  invoice: '상업송장(CI) — 통관·관부가세 계산의 근거',
  packing_list: '박스별 수량·무게·부피',
  coupang_barcode: '쿠팡 윙에서 받은 상품·박스 바코드 라벨',
  bl: '선하증권 — 화물 인수의 근거',
  other: '원산지증명·수입신고필증·사진 등',
};

export function shelfOf(kind: string, shelf: string | null | undefined): Shelf {
  if (shelf && (SHELVES as readonly string[]).includes(shelf)) return shelf as Shelf;
  if (kind === 'commercial_invoice') return 'invoice';
  if (kind === 'packing_list') return 'packing_list';
  if (kind === 'bl') return 'bl';
  return 'other';
}

/** 올릴 때 고르는 것 — (칸, 원래 종류) 한 쌍. 값은 「칸:종류」 */
export const UPLOAD_OPTIONS: { value: string; shelf: Shelf; kind: string; label: string; labelZh: string }[] = [
  { value: 'invoice:commercial_invoice', shelf: 'invoice', kind: 'commercial_invoice', label: '인보이스(상업송장)', labelZh: '商业发票' },
  { value: 'packing_list:packing_list', shelf: 'packing_list', kind: 'packing_list', label: '패킹리스트', labelZh: '装箱单' },
  { value: 'coupang_barcode:other', shelf: 'coupang_barcode', kind: 'other', label: '쿠팡 바코드 PDF', labelZh: 'Coupang 条码 PDF' },
  { value: 'bl:bl', shelf: 'bl', kind: 'bl', label: 'B/L(선하증권)', labelZh: '提单' },
  { value: 'other:co', shelf: 'other', kind: 'co', label: '기타 — 원산지증명', labelZh: '其他 — 原产地证' },
  { value: 'other:import_declaration', shelf: 'other', kind: 'import_declaration', label: '기타 — 수입신고필증', labelZh: '其他 — 进口申报单' },
  { value: 'other:photo', shelf: 'other', kind: 'photo', label: '기타 — 사진', labelZh: '其他 — 照片' },
  { value: 'other:other', shelf: 'other', kind: 'other', label: '기타', labelZh: '其他' },
];

export function parseUploadOption(v: string): { shelf: Shelf; kind: string } | null {
  const o = UPLOAD_OPTIONS.find((x) => x.value === v);
  return o ? { shelf: o.shelf, kind: o.kind } : null;
}

/** 칸마다 묶기(칸 순서 그대로, 빈 칸도 둔다) */
export function groupByShelf<T extends { kind: string; shelf?: string | null }>(docs: T[]): { shelf: Shelf; docs: T[] }[] {
  const m = new Map<Shelf, T[]>(SHELVES.map((s) => [s, []]));
  for (const d of docs) m.get(shelfOf(d.kind, d.shelf))!.push(d);
  return SHELVES.map((s) => ({ shelf: s, docs: m.get(s)! }));
}

/** 쿠팡 입고에 늘 필요한 칸 중 비어 있는 것 */
export function missingShelves(docs: { kind: string; shelf?: string | null }[], need: readonly Shelf[] = ['invoice', 'packing_list', 'coupang_barcode']): Shelf[] {
  const have = new Set(docs.map((d) => shelfOf(d.kind, d.shelf)));
  return need.filter((s) => !have.has(s));
}
