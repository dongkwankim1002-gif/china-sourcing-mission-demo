/**
 * 관세청 화물운송주선업자 목록·내역 어댑터(v2 6차 scorecard) — 업체와 관세청 「화물운송주선업자 부호」를 잇는 데 쓴다. 읽기(조회)만.
 *
 * · 검색 요약으로 확인한 것: UNI-PASS 오픈API 에 「화물운송주선업자 목록」(부호·상호)이 있다. **API 번호·주소·요청/응답 칸 이름은 원문 연계가이드를
 *   이 환경에서 열지 못해 가정했다(확인 필요 — docs/scorecard-plan.md 3절).** 켜기 전에 원문으로 바꾼다.
 * · 실제 HTTP 는 UNIPASS_ENABLED 꺼짐이면 fetch 를 부르기 전에 막힌다(5차 API001 과 같은 스위치·같은 키·같은 재시도 규칙).
 * · 흉내는 결정적(FNV) — 넘겨받은 업체 이름으로 「EX」로 시작하는 예시 부호를 만든다(실제 부호와 헷갈리지 않게). 비슷한 이름의 예시 업체도 하나 섞는다.
 * · 응답에서 부호·상호·주소 앞부분만 읽는다. 대표자 이름 같은 칸은 읽지 않는다.
 */
import { backoffMs, isRetryableStatus } from '../wing/http';
import { UNIPASS_API_BASE } from './http';
import { fnv } from './mock';
import { decodeXmlText, xmlBlocks, xmlScalar } from './parse';
import { UnipassDisabledError, UnipassError } from './types';

export interface ForwarderRecord {
  /** 화물운송주선업자 부호(형식 확인 필요) */
  code: string;
  name: string;
  address: string | null;
  source: 'unipass' | 'mock';
}

export interface ForwarderAdapter {
  readonly kind: 'http' | 'mock';
  /** 상호로 찾기 */
  search(name: string): Promise<ForwarderRecord[]>;
  /** 부호로 내역 */
  detail(code: string): Promise<ForwarderRecord | null>;
}

/** 가정한 주소·칸 이름(확인 필요) */
export const FORWARDER_LIST_PATH = '/frwrLstQry/retrieveFrwrLst';
export const FORWARDER_DETAIL_PATH = '/frwrBrkdQry/retrieveFrwrBrkd';

export function normalizeForwarderName(s: string): string {
  return s.normalize('NFKC').replace(/\s+/g, '').replace(/[(（]?(주|주식회사|유한회사)[)）]?/g, '').toUpperCase();
}

const clip = (s: string | null, n: number) => (s == null ? null : s.length > n ? s.slice(0, n) : s);

/** 가정한 응답 XML → 기록(순수). DOCTYPE 거부 · 200KB 상한 · 부호 형식이 틀린 줄은 버린다 */
export function parseForwarderXml(xml: string): ForwarderRecord[] {
  if (xml.length > 200_000) throw new UnipassError(200, '관세청 응답이 너무 큽니다');
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new UnipassError(200, '관세청 응답 모양이 예상과 다릅니다(확인 필요)');
  const rows = [...xmlBlocks(xml, 'frwrLstQryRsltVo'), ...xmlBlocks(xml, 'frwrBrkdQryRsltVo')];
  const out: ForwarderRecord[] = [];
  for (const b of rows) {
    const code = (xmlScalar(b, 'frwrSgn') ?? '').toUpperCase();
    const name = xmlScalar(b, 'frwrConm');
    if (!/^[A-Z0-9]{2,12}$/.test(code) || !name) continue;
    out.push({ code, name: clip(decodeXmlText(name), 120)!, address: clip(xmlScalar(b, 'addr'), 120), source: 'unipass' });
  }
  return out.slice(0, 50);
}

/** 흉내 — 예시 부호 */
export function mockForwarderCode(name: string): string {
  return `EX${fnv(normalizeForwarderName(name)).toString(36).toUpperCase().padStart(6, '0').slice(0, 6)}`;
}

export class MockForwarderAdapter implements ForwarderAdapter {
  readonly kind = 'mock' as const;
  /** catalog = 찾을 수 있는 이름들(데모 업체 이름) */
  constructor(private readonly catalog: readonly string[]) {}
  async search(name: string): Promise<ForwarderRecord[]> {
    const q = normalizeForwarderName(name);
    if (q.length < 2) return [];
    const hits = this.catalog.filter((c) => normalizeForwarderName(c).includes(q) || q.includes(normalizeForwarderName(c)));
    const out = hits.map((c) => ({ code: mockForwarderCode(c), name: `${c}(예시)`, address: '예시 주소', source: 'mock' as const }));
    // 비슷한 이름 하나 — 운영자가 부호를 골라야 한다는 것을 보이게
    if (out.length) out.push({ code: mockForwarderCode(`${hits[0]}-유사`), name: `${hits[0]} 유사상호(예시)`, address: '예시 주소', source: 'mock' });
    return out;
  }
  async detail(code: string): Promise<ForwarderRecord | null> {
    const hit = this.catalog.find((c) => mockForwarderCode(c) === code);
    return hit ? { code, name: `${hit}(예시)`, address: '예시 주소', source: 'mock' } : null;
  }
}

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; signal?: AbortSignal }) => Promise<{ status: number; text(): Promise<string> }>;

export class HttpForwarderAdapter implements ForwarderAdapter {
  readonly kind = 'http' as const;
  private readonly fetchImpl: FetchLike;
  constructor(private readonly o: { enabled: boolean; apiKey: string | null; fetch?: FetchLike; sleep?: (ms: number) => Promise<void>; maxRetries?: number; timeoutMs?: number }) {
    this.fetchImpl = o.fetch ?? ((url, init) => fetch(url, init));
  }
  private async call(path: string, params: Record<string, string>): Promise<string> {
    if (!this.o.enabled) throw new UnipassDisabledError();
    if (!this.o.apiKey) throw new UnipassError(0, '관세청 인증키가 서버에 없습니다(UNIPASS_API_KEY).');
    const url = `${UNIPASS_API_BASE}${path}?${new URLSearchParams({ crkyCn: this.o.apiKey, ...params })}`;
    const sleep = this.o.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
    const max = this.o.maxRetries ?? 2;
    for (let attempt = 0; ; attempt++) {
      let status = 0;
      let body = '';
      const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const timer = ctl ? setTimeout(() => ctl.abort(), this.o.timeoutMs ?? 10_000) : null;
      try {
        const r = await this.fetchImpl(url, { method: 'GET', headers: { Accept: 'application/xml' }, signal: ctl?.signal });
        status = r.status;
        body = await r.text();
      } catch {
        status = 0;
      } finally {
        if (timer) clearTimeout(timer);
      }
      if (status >= 200 && status < 300) return body;
      if (!(status === 0 || isRetryableStatus(status)) || attempt >= max) {
        throw new UnipassError(status, status === 0 ? '관세청에 닿지 못했습니다(네트워크·시간 초과).' : `관세청이 오류로 답했습니다(${status}).`);
      }
      await sleep(backoffMs(attempt + 1, { baseBackoffMs: 800, maxBackoffMs: 8000 }));
    }
  }
  async search(name: string): Promise<ForwarderRecord[]> {
    const q = name.trim().slice(0, 50);
    if (q.length < 2) return [];
    return parseForwarderXml(await this.call(FORWARDER_LIST_PATH, { frwrConm: q }));
  }
  async detail(code: string): Promise<ForwarderRecord | null> {
    if (!/^[A-Z0-9]{2,12}$/.test(code)) return null;
    return parseForwarderXml(await this.call(FORWARDER_DETAIL_PATH, { frwrSgn: code }))[0] ?? null;
  }
}
