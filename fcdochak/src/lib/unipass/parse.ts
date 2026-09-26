/**
 * API001 화물통관진행정보 XML 파서 — 순수 함수. 외부 XML 라이브러리 없이, 이 응답에 필요한 평평한 구조만 읽는다.
 *
 * 가정한 구조(docs/tracker-plan.md 3절 — 공개 예시 응답을 원문에서 보지 못했다, **확인 필요**):
 *   <cargCsclPrgsInfoQryRtnVo>
 *     <tCnt>1</tCnt>                     건수(오류면 -1)
 *     <ntceInfo/>                        안내('[N00]…' = B/L 로 여러 건)
 *     <cargCsclPrgsInfoQryVo>…</…>       요약(여러 건이면 여러 개)
 *     <cargCsclPrgsInfoDtlQryVo>…</…>    이력(단건일 때 0..n)
 *   </cargCsclPrgsInfoQryRtnVo>
 *
 * · DOCTYPE·ENTITY 가 있으면 읽지 않는다(외부 개체 공격 막기). 500KB 넘으면 읽지 않는다.
 * · 모르는 칸은 버린다. 수입자·납세자 같은 칸은 아예 읽지 않는다(개인정보·상호가 섞이지 않게).
 * · 오류 문구에 번호·키를 싣지 않는다.
 */
import { UnipassError, type CargoEvent, type CargoSummary, type LookupResult } from './types';

const MAX_BYTES = 500_000;

export function decodeXmlText(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/** <tag>…</tag> 안쪽들(겹치지 않는 평평한 요소) */
export function xmlBlocks(xml: string, tag: string): string[] {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'g');
  return [...xml.matchAll(re)].map((m) => m[1]);
}

/** 칸 하나의 글자(없거나 비었으면 null) */
export function xmlScalar(block: string, tag: string): string | null {
  if (new RegExp(`<${tag}\\s*/>`).test(block)) return null;
  const m = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`).exec(block);
  if (!m) return null;
  const v = decodeXmlText(m[1]).trim();
  return v === '' ? null : v;
}

/** YYYYMMDDHHMMSS(한국 시각) → ISO(+09:00). 틀리면 null */
export function unipassDateTime(v: string | null): string | null {
  if (!v || !/^\d{14}$/.test(v)) return null;
  const iso = `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}T${v.slice(8, 10)}:${v.slice(10, 12)}:${v.slice(12, 14)}+09:00`;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  // 13월·32일 같은 값은 Date 가 넘겨 버리므로 되돌려 대조한다
  const back = new Date(t + 9 * 3600_000).toISOString().slice(0, 19).replace(/[-T:]/g, '');
  return back === v ? iso : null;
}

/** YYYYMMDD → YYYY-MM-DD. 틀리면 null */
export function unipassDate(v: string | null): string | null {
  if (!v || !/^\d{8}$/.test(v)) return null;
  const d = `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}`;
  const t = Date.parse(`${d}T00:00:00Z`);
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === d ? d : null;
}

const clip = (s: string | null, n: number) => (s == null ? null : s.length > n ? `${s.slice(0, n - 1)}…` : s);
const int = (s: string | null) => (s != null && /^\d{1,9}$/.test(s) ? Number(s) : null);

export function parseSummary(b: string): CargoSummary {
  const port = xmlScalar(b, 'dsprCd');
  return {
    cargoNo: clip(xmlScalar(b, 'cargMtNo'), 40),
    mbl: clip(xmlScalar(b, 'mblNo'), 40),
    hbl: clip(xmlScalar(b, 'hblNo'), 40),
    status: clip(xmlScalar(b, 'csclPrgsStts') ?? xmlScalar(b, 'prgsStts'), 60),
    portCode: port && /^[A-Z0-9]{2,10}$/.test(port) ? port : null,
    arrivalOn: unipassDate(xmlScalar(b, 'etprDt')),
    forwarder: clip(xmlScalar(b, 'frwrEntsConm'), 60),
    packages: int(xmlScalar(b, 'pckGcnt')),
  };
}

export function parseEvent(b: string): CargoEvent | null {
  const rawType = clip(xmlScalar(b, 'cargTrcnRelaBsopTpcd'), 60);
  const at = unipassDateTime(xmlScalar(b, 'prcsDttm'));
  if (!rawType || !at) return null;
  const parts = [clip(xmlScalar(b, 'shedNm'), 60), clip(xmlScalar(b, 'rlbrCn'), 56)].filter(Boolean) as string[];
  return { rawType, at, summary: parts.length ? clip(parts.join(' · '), 120) : null };
}

/** 응답 전체 → 조회 결과. tCnt = -1 이면 UnipassError(안내 문구만, 번호 없음) */
export function parseCargoProgressXml(xml: string): LookupResult {
  if (xml.length > MAX_BYTES) throw new UnipassError(200, '관세청 응답이 너무 큽니다');
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new UnipassError(200, '관세청 응답 모양이 예상과 다릅니다(확인 필요)');
  const root = xmlBlocks(xml, 'cargCsclPrgsInfoQryRtnVo')[0];
  if (root == null) throw new UnipassError(200, '관세청 응답 모양이 예상과 다릅니다(확인 필요)');
  const tCnt = Number(xmlScalar(root, 'tCnt') ?? 'NaN');
  const notice = xmlScalar(root, 'ntceInfo');
  if (tCnt === -1) throw new UnipassError(200, `관세청이 조회를 거절했습니다${notice ? ` — ${clip(notice.replace(/[A-Z0-9]{8,}/g, '…'), 80)}` : ''}`);
  if (!Number.isFinite(tCnt)) throw new UnipassError(200, '관세청 응답 모양이 예상과 다릅니다(확인 필요)');
  const summaries = xmlBlocks(root, 'cargCsclPrgsInfoQryVo').map(parseSummary);
  if (tCnt === 0 || summaries.length === 0) return { status: 'not_found', source: 'unipass' };
  if (summaries.length > 1 || (notice ?? '').startsWith('[N00]')) {
    return { status: 'multiple', cargoNos: summaries.map((s) => s.cargoNo).filter((x): x is string => !!x).slice(0, 20), source: 'unipass' };
  }
  const events = xmlBlocks(root, 'cargCsclPrgsInfoDtlQryVo')
    .map(parseEvent)
    .filter((e): e is CargoEvent => !!e)
    .sort((a, b) => a.at.localeCompare(b.at));
  return { status: 'found', summary: summaries[0], events, source: 'unipass' };
}

/** 양륙항 코드 → 우리 항구 코드(참조표에 있는 것만). 모르면 null */
export const PORT_FROM_UNLOCODE: Record<string, string> = { KRINC: 'ICN', KRPTK: 'PTK' };
export function portFromCode(code: string | null): string | null {
  return code ? (PORT_FROM_UNLOCODE[code] ?? null) : null;
}
