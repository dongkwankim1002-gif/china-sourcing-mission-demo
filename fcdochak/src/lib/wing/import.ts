/**
 * WING 에서 내려받은 입고 목록 파일(엑셀·CSV) — 칸 정의와 줄 정리. 순수 함수.
 *
 * 머리글 이름은 WING 화면 실물을 보지 못해 **짐작한 별칭**이다(확인 필요 — docs/wing-plan.md §3).
 * 화면(엑셀 올리기)이 별칭으로 먼저 맞추고, 못 맞춘 칸은 사람이 파일 머리글을 골라 잇는다.
 * 필수 칸은 입고 요청 번호 하나 — 나머지는 비어도 받는다(짝 맞추기 점수가 낮아질 뿐).
 */
import type { WingInbound } from './types';

export interface WingImportColumn {
  key: keyof WingInbound;
  label: string;
  aliases: string[];
  type: 'number' | 'string';
  required?: boolean;
  /** 열 이름을 실물로 확인했는가 — 아직 모두 false(확인 필요) */
  confirmed: boolean;
}

export const WING_IMPORT_COLUMNS: WingImportColumn[] = [
  { key: 'externalNo', label: '입고 요청 번호', aliases: ['입고요청번호', '입고번호', '입고 ID', '입고요청ID', 'inbound id', 'inboundId', '입고신청번호', 'receiving id'], type: 'string', required: true, confirmed: false },
  { key: 'centerName', label: '물류센터', aliases: ['센터', '입고센터', '입고 센터', '물류센터명', 'FC', 'center', 'fulfillment center'], type: 'string', confirmed: false },
  { key: 'plannedOn', label: '입고 예정일', aliases: ['입고예정일', '입고 예정 일자', '입고일', '입고 희망일', '도착예정일', 'eta', 'planned date'], type: 'string', confirmed: false },
  { key: 'skuCount', label: 'SKU 수', aliases: ['SKU수', '옵션 수', '옵션수', '상품 수', 'sku count'], type: 'number', confirmed: false },
  { key: 'units', label: '수량', aliases: ['입고 요청 수량', '입고요청수량', '요청 수량', '총 수량', 'qty', 'quantity'], type: 'number', confirmed: false },
  { key: 'boxes', label: '박스 수', aliases: ['박스수', '박스', '박스 개수', '카톤', 'cartons', 'boxes'], type: 'number', confirmed: false },
  { key: 'statusRaw', label: '상태', aliases: ['입고 상태', '입고상태', '진행 상태', 'status'], type: 'string', confirmed: false },
  { key: 'receivedUnits', label: '입고 수량', aliases: ['입고수량', '입고 완료 수량', '입고완료수량', '정상 입고 수량', 'received'], type: 'number', confirmed: false },
  { key: 'returnedUnits', label: '회송 수량', aliases: ['회송수량', '반려 수량', '회송', '입고 반려 수량', 'returned'], type: 'number', confirmed: false },
];

export interface FcRef {
  code: string;
  name: string;
}

function squash(s: string) {
  return s.normalize('NFKC').toLowerCase().replace(/[\s_()（）·\-./]/g, '');
}

/**
 * WING 의 센터 이름 → 우리 FC 코드. 우리 이름에서 「FC」를 뗀 지명(예: 「이천」)이 들어 있으면 그 FC.
 * 둘 이상 걸리면(예: 「이천·덕평」) 맞추지 않는다 — 사람이 고른다.
 */
export function matchFcCode(centerName: string | null | undefined, fcs: readonly FcRef[]): string | null {
  if (!centerName) return null;
  const c = squash(centerName);
  if (!c) return null;
  const hits = fcs.filter((f) => {
    const stem = squash(f.name.replace(/\s*FC$/i, ''));
    return stem.length >= 2 && c.includes(stem);
  });
  return hits.length === 1 ? hits[0].code : null;
}

/** 여러 모양의 날짜 → YYYY-MM-DD. 엑셀 일련번호(1900 체계)도 받는다 */
export function normalizeDate(v: unknown): string | null {
  if (v == null || v === '') return null;
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v.toISOString().slice(0, 10);
  if (typeof v === 'number' && Number.isFinite(v) && v > 20000 && v < 80000) {
    return new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86_400_000).toISOString().slice(0, 10);
  }
  const s = String(v).trim();
  const m = s.match(/^(\d{4})[-./년\s]+(\d{1,2})[-./월\s]+(\d{1,2})/);
  if (m) {
    const [y, mo, d] = [+m[1], +m[2], +m[3]];
    const dt = new Date(Date.UTC(y, mo - 1, d));
    if (dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d) return dt.toISOString().slice(0, 10);
    return null;
  }
  const c = s.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (c) return normalizeDate(`${c[1]}-${c[2]}-${c[3]}`);
  // 엑셀 날짜 칸이 브라우저에서 글자로 바뀐 것(「Thu Sep 25 2026 09:00:00 GMT+0900」) — 엑셀은 날짜를 UTC 자정으로 준다
  if (/GMT|UTC|Z$/.test(s)) {
    const t = Date.parse(s);
    if (!Number.isNaN(t)) return new Date(t).toISOString().slice(0, 10);
  }
  return null;
}

function toInt(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[,\s]/g, '').replace(/(개|박스|ea|boxes|box)$/i, ''));
  if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n) || n > 10_000_000) return NaN;
  return n;
}

export const EXTERNAL_NO_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{2,39}$/;

/** 한 줄 정리 — 틀리면 까닭(사람 말) */
export function normalizeInboundRow(row: Record<string, unknown>, fcs: readonly FcRef[]): { ok: true; value: WingInbound } | { ok: false; error: string } {
  const ext = String(row.externalNo ?? '').trim();
  if (!ext) return { ok: false, error: '입고 요청 번호가 비었습니다' };
  if (!EXTERNAL_NO_RE.test(ext)) return { ok: false, error: '입고 요청 번호는 영문·숫자 3~40자입니다' };
  const nums: Record<string, number | null> = {};
  for (const k of ['skuCount', 'units', 'boxes', 'receivedUnits', 'returnedUnits'] as const) {
    const n = toInt(row[k]);
    if (Number.isNaN(n)) return { ok: false, error: `${WING_IMPORT_COLUMNS.find((c) => c.key === k)!.label}은(는) 0 이상 정수여야 합니다` };
    nums[k] = n;
  }
  const rawDate = row.plannedOn;
  const plannedOn = normalizeDate(rawDate);
  if (rawDate != null && rawDate !== '' && !plannedOn) return { ok: false, error: '입고 예정일을 읽지 못했습니다(YYYY-MM-DD)' };
  const centerName = row.centerName == null || row.centerName === '' ? null : String(row.centerName).trim().slice(0, 60);
  const statusRaw = row.statusRaw == null || row.statusRaw === '' ? null : String(row.statusRaw).trim().slice(0, 40);
  return {
    ok: true,
    value: {
      externalNo: ext,
      centerName,
      fcCode: matchFcCode(centerName, fcs),
      plannedOn,
      skuCount: nums.skuCount,
      units: nums.units,
      boxes: nums.boxes,
      statusRaw,
      receivedUnits: nums.receivedUnits,
      returnedUnits: nums.returnedUnits,
    },
  };
}

/** 같은 입고 요청인데 바뀐 것이 있는가(다시 가져올 때 새 판을 쌓을지) */
export function inboundChanged(a: WingInbound, b: WingInbound): boolean {
  const keys: (keyof WingInbound)[] = ['centerName', 'fcCode', 'plannedOn', 'skuCount', 'units', 'boxes', 'statusRaw', 'receivedUnits', 'returnedUnits'];
  return keys.some((k) => (a[k] ?? null) !== (b[k] ?? null));
}
