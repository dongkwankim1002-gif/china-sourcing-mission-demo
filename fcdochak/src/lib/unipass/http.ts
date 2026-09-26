/**
 * 실제 HTTP 어댑터 — 관세청 UNI-PASS API001 화물통관진행정보. GET 만(조회).
 *
 * · `enabled`(= 환경변수 UNIPASS_ENABLED)가 false 면 **fetch 를 부르기 전에** UnipassDisabledError.
 * · 키(UNIPASS_API_KEY)는 서버 환경변수에서만 받는다. 오류 문구·로그·기록에 키와 주소(키가 든 쿼리)를 싣지 않는다.
 * · 재시도: 429·5xx·네트워크 오류·시간 초과만, 지수 대기, 최대 maxRetries 번(쿠팡 어댑터와 같은 규칙 — wing/http 재사용).
 * · 주소·칸 이름 출처: docs/tracker-plan.md 3절(검색 요약 + 공개 라이브러리 — 원문 확인 필요).
 *   관세청은 IP 가 아닌 도메인 이름·TLS 1.2 이상으로만 받는다고 한다(확인 필요) — 아래 주소는 도메인이다.
 */
import { backoffMs, isRetryableStatus } from '../wing/http';
import { parseCargoProgressXml } from './parse';
import { UnipassDisabledError, UnipassError, type LookupResult, type TrackQuery, type UnipassAdapter } from './types';

export const UNIPASS_API_BASE = 'https://unipass.customs.go.kr:38010/ext/rest';
export const CARGO_PROGRESS_PATH = '/cargCsclPrgsInfoQry/retrieveCargCsclPrgsInfo';

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; signal?: AbortSignal }) => Promise<{ status: number; text(): Promise<string> }>;

export interface UnipassHttpOptions {
  enabled: boolean;
  apiKey: string | null;
  timeoutMs?: number;
  maxRetries?: number;
  baseBackoffMs?: number;
  maxBackoffMs?: number;
  fetch?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
  /** 호출할 때마다(재시도 포함) 하나씩 — 회차 기록의 호출 수 */
  onCall?: () => void;
}

/** 조회 쿼리(키 제외) — 시험에서 모양을 본다 */
export function cargoQueryParams(q: TrackQuery): Record<string, string> {
  if (q.kind === 'cargo_no') return { cargMtNo: q.number };
  if (q.year == null) throw new RangeError('B/L 조회에는 연도가 필요합니다');
  return q.kind === 'mbl' ? { mblNo: q.number, blYy: String(q.year) } : { hblNo: q.number, blYy: String(q.year) };
}

export class UnipassHttpAdapter implements UnipassAdapter {
  readonly kind = 'http' as const;
  private readonly fetchImpl: FetchLike;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly o: UnipassHttpOptions) {
    this.fetchImpl = o.fetch ?? ((url, init) => fetch(url, init));
    this.sleep = o.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  async lookup(q: TrackQuery): Promise<LookupResult> {
    if (!this.o.enabled) throw new UnipassDisabledError();
    if (!this.o.apiKey) throw new UnipassError(0, '관세청 인증키가 서버에 없습니다(UNIPASS_API_KEY).');
    const params = new URLSearchParams({ crkyCn: this.o.apiKey, ...cargoQueryParams(q) });
    const url = `${UNIPASS_API_BASE}${CARGO_PROGRESS_PATH}?${params.toString()}`;
    const rule = { baseBackoffMs: this.o.baseBackoffMs ?? 800, maxBackoffMs: this.o.maxBackoffMs ?? 8000 };
    const maxRetries = this.o.maxRetries ?? 2;
    for (let attempt = 0; ; attempt++) {
      const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const timer = ctl ? setTimeout(() => ctl.abort(), this.o.timeoutMs ?? 10_000) : null;
      let status = 0;
      let body = '';
      this.o.onCall?.();
      try {
        const r = await this.fetchImpl(url, { method: 'GET', headers: { Accept: 'application/xml' }, signal: ctl?.signal });
        status = r.status;
        body = await r.text();
      } catch {
        status = 0;
      } finally {
        if (timer) clearTimeout(timer);
      }
      if (status >= 200 && status < 300) {
        const out = parseCargoProgressXml(body);
        return out;
      }
      const retryable = status === 0 || isRetryableStatus(status);
      if (!retryable || attempt >= maxRetries) {
        throw new UnipassError(
          status,
          status === 429 ? '관세청 호출 한도에 걸렸습니다. 잠시 뒤 다시 해 주세요.' : status === 0 ? '관세청에 닿지 못했습니다(네트워크·시간 초과).' : `관세청이 오류로 답했습니다(${status}).`,
        );
      }
      await this.sleep(backoffMs(attempt + 1, rule));
    }
  }
}
