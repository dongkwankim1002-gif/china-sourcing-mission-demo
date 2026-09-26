/**
 * 청구서 읽기 — 업체마다 다른 항목 이름을 9구간으로 가르고, 붙여넣은 표에서 항목·금액을 뽑는다.
 * 순수 함수(브라우저·서버 모두). 금액 계산은 하지 않는다(원 환산·비교는 src/lib/money/invoice-check.ts).
 */
import type { Currency } from './money/quote';
import type { InvoiceLine, LineSegment } from './money/invoice-check';

/**
 * 항목 이름 → 구간. 위에서부터 처음 맞는 규칙. 순서가 뜻이다:
 * 세금 → 회송 → 한국 쪽 통관(报关行·清关) → 수출통관 → 관세사 → FC 운송 → 국내 창고 → 항만 → 국제운송 → 중국 창고 → 집하.
 * (「국내 창고」가 「창고」보다, 「수출통관」이 「통관」보다 먼저 와야 한다)
 */
const RULES: [LineSegment, RegExp][] = [
  ['tax', /관\s*세(?!\s*사)|부가\s*(가치)?\s*세|(^|[^a-z])vat([^a-z]|$)|关税|增值税|进口税|import\s*duty|customs\s*duty|(^|[^a-z])duty([^a-z]|$)/],
  ['return_reserve', /회송|반송|반품|반려|재입고|退仓|退货|退回|(^|[^a-z])returns?([^a-z]|$)/],
  ['broker', /报关行|韩国清关|进口清关|清关/],
  ['export_customs', /수출\s*(통관|신고|면장)|出口报关|报关|出口申报|export\s*(customs|clearance|declaration)|export\s*licen[cs]e/],
  ['broker', /관세사|통관|수입\s*신고|customs\s*broker|brokerage|import\s*(customs|clearance|declaration)|customs\s*clearance/],
  ['fc_delivery', /(^|[^a-z])fc([^a-z]|$)|쿠팡|로켓|밀크\s*런|milk\s*run|센터\s*(입고\s*)?(운송|배송)|입고\s*운송|국내\s*(운송|배송|택배|트럭)|배송|택배|delivery|last\s*mile|派送|配送|入仓费用?\(韩/],
  ['kr_warehouse', /국내\s*창고|한국\s*창고|3\s*pl|보관|입고\s*(작업|검수|비)|바코드|재\s*작업|韩国仓|韩仓|storage|fulfil?ment/],
  ['port', /(^|[^a-z])(thc|cfs|d\s*\/\s*o|do\s*fee|wharfage)([^a-z]|$)|터미널|항만|부두|하역|핸들링|서류|b\s*\/\s*l|documentation|doc(ument)?\s*fee|handling|港杂|码头|港口|文件费|换单/],
  ['freight', /해상|운임|(^|[^a-z])o\s*\/\s*f([^a-z]|$)|ocean|sea\s*freight|air\s*freight|항공|카페리|페리|ferry|(^|[^a-z])(baf|caf|lss|ebs|ens|afs)([^a-z]|$)|유류|할증|freight|海运|运费|空运|燃油|船/],
  ['cn_warehouse', /중국\s*창고|창고|검수|검품|포장|라벨|실사|분류|仓库|仓储|入仓|打包|贴标|质检|验货|warehouse|packing|label|inspection/],
  ['pickup', /집하|픽업|수거|내륙\s*운송|트럭|提货|拖车|国内运输|pick\s*-?\s*up|trucking|collection|drayage/],
];

export function classifyItem(label: string): LineSegment {
  const s = label.normalize('NFKC').toLowerCase();
  for (const [seg, re] of RULES) if (re.test(s)) return seg;
  return null;
}

/** 글에서 통화를 알아본다. 없으면 null */
export function detectCurrency(s: string | null | undefined): Currency | null {
  if (!s) return null;
  const t = s.normalize('NFKC').toLowerCase();
  if (/usd|\$|달러|美元|us\s*dollar/.test(t)) return 'USD';
  if (/rmb|cny|元|¥|위안|인민폐|人民币/.test(t)) return 'RMB';
  if (/krw|₩|원|韩元/.test(t)) return 'KRW';
  return null;
}

/** 「합계·총액·소계」 줄 — 붙여넣을 때 두 번 세지 않게 뺀다 */
const TOTAL_ROW = /^(총\s*(합계|액|계|청구)|합\s*계|소\s*계|청구\s*(금액|합계|총액)|total|sub\s*-?\s*total|grand\s*total|合计|总计|小计|总额|계)(?=\s|$|[:：(（])/;

/** 숫자 조각 — 「1,200,000」「¥3,600.50」「-12,000원」「60000 元」 */
const AMOUNT = /(-|−)?\s*([₩¥$])?\s*(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)\s*(원|元|rmb|cny|usd|krw|위안|달러)?/gi;

/** 금액 바로 앞에 적은 통화 — 「해상운임 USD 1,200」「O/F\tUSD\t850」「수출통관 RMB 300」 */
const PREFIX_CUR = /(?:^|[\s|:：(（])(usd|us\$|rmb|cny|krw|달러|위안|元|人民币|美元)\s*[:：)）]?\s*$/i;

export interface PastedLine extends InvoiceLine {
  /** 원래 줄(미리보기) */
  raw: string;
}

/**
 * 붙여넣은 표(엑셀·메일·메신저에서 복사) → 청구서 줄.
 * 한 줄에서 마지막 숫자를 금액으로, 그 앞 글을 항목으로 본다. 합계 줄·숫자 없는 줄(머리글)은 뺀다.
 */
export function parseInvoiceText(text: string, defaultCurrency: Currency = 'KRW'): PastedLine[] {
  const out: PastedLine[] = [];
  const headCur = detectCurrency(text.split(/\r?\n/).find((l) => !/\d/.test(l)) ?? null);
  for (const rawLine of text.replace(/^﻿/, '').split(/\r?\n/)) {
    const raw = rawLine.trim();
    if (!raw) continue;
    const matches = [...raw.matchAll(AMOUNT)];
    if (matches.length === 0) continue;
    const m = matches[matches.length - 1];
    const neg = !!m[1];
    const value = Number(m[3].replace(/,/g, ''));
    if (!Number.isFinite(value)) continue;
    const before = raw.slice(0, m.index);
    const pre = PREFIX_CUR.exec(before);
    let label = (pre ? before.slice(0, pre.index) : before)
      .replace(/\t+/g, ' ')
      .replace(/^\s*(\d+[.)]|[①-⑳]|[-*•·])\s*/, '')
      .replace(/[\s=:：|×x*@\-–]+$/i, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
    // 표 칸이 「항목 | 수량 | 단가 | 금액」이면 앞쪽 글만 항목으로
    const firstCell = raw.split(/\t|\s{2,}|\|/)[0]?.trim();
    if (firstCell && /[^\d\s.,]/.test(firstCell) && firstCell.length < label.length) label = firstCell;
    if (!label || !/[^\d\s.,]/.test(label)) continue;
    const norm = label.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ');
    if (TOTAL_ROW.test(norm)) continue;
    const currency =
      detectCurrency(`${m[2] ?? ''}${m[4] ?? ''}`) ?? detectCurrency(raw.slice(m.index)) ?? (pre ? detectCurrency(pre[1]) : null) ?? headCur ?? defaultCurrency;
    out.push({ label: label.slice(0, 80), amount: neg ? -value : value, currency, segment: classifyItem(label), raw });
  }
  return out;
}

/** 엑셀 올리기 한 줄(항목·금액·통화 칸) → 청구서 줄 */
export function lineFromRow(row: { item?: unknown; amount?: unknown; currency?: unknown }, defaultCurrency: Currency = 'KRW'): InvoiceLine | null {
  const label = row.item == null ? '' : String(row.item).trim();
  const amount = typeof row.amount === 'number' ? row.amount : Number(String(row.amount ?? '').replace(/[^\d.\-]/g, ''));
  if (!label || !Number.isFinite(amount)) return null;
  if (TOTAL_ROW.test(label.normalize('NFKC').toLowerCase())) return null;
  const currency = detectCurrency(row.currency == null ? null : String(row.currency)) ?? detectCurrency(label) ?? defaultCurrency;
  return { label: label.slice(0, 80), amount, currency, segment: classifyItem(label) };
}

/**
 * 줄 이름에서 운송 방식을 짐작한다 — 「상관없음」이면 항공·해상 요금표가 한 분포에 섞여 판정이 흐려지므로,
 * 청구서에 방식이 적혀 있으면 미리 골라 둔다. 두 가지 이상이 보이거나 없으면 null(셀러가 고른다).
 */
export function inferMode(labels: string[]): 'LCL' | 'FCL' | 'AIR' | 'FERRY' | null {
  const found = new Set<'LCL' | 'FCL' | 'AIR' | 'FERRY'>();
  for (const raw of labels) {
    const t = raw.normalize('NFKC').toLowerCase();
    if (/(^|[^a-z])lcl([^a-z]|$)|拼箱|혼재/.test(t)) found.add('LCL');
    if (/(^|[^a-z])fcl([^a-z]|$)|整箱|(^|[^a-z])(20|40)\s*(ft|gp|hq)|컨테이너\s*(단독|통)/.test(t)) found.add('FCL');
    if (/항공|air\s*(freight|cargo)?|空运|(^|[^a-z])awb([^a-z]|$)/.test(t)) found.add('AIR');
    if (/카페리|페리|ferry|轮渡/.test(t)) found.add('FERRY');
  }
  return found.size === 1 ? [...found][0] : null;
}
