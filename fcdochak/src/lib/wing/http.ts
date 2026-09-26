/**
 * 실제 HTTP 어댑터 — 쿠팡 오픈 API(api-gateway.coupang.com). GET 만 만든다(쓰기 없음).
 *
 * · `enabled`(= 환경변수 WING_ENABLED)가 false 면 **fetch 를 부르기 전에** WingDisabledError.
 * · 속도: 한 어댑터(= 한 업체 코드) 안에서 호출 사이를 max(1초/perSecond, 1분/perMinute) 만큼 띄운다(인스턴스 메모리 기준).
 * · 재시도: 429·5xx·네트워크 오류·시간 초과만, 지수 대기(Retry-After 우선), 최대 maxRetries 회.
 * · 키 값은 오류 문구·로그에 싣지 않는다.
 *
 * 경로 출처(docs/wing-plan.md §3): 로켓창고 재고 요약
 *   GET /v2/providers/rg_open_api/apis/api/v1/vendors/{vendorId}/rg/inventory/summaries — 개발자 센터 「로켓창고 재고 API」(검색 요약, 원문 확인 필요)
 * 입고 요청 조회 API 는 공개 여부를 확인하지 못했다 → listInboundRequests 는 WingUnsupportedError.
 */
import { wingAuthorization, wingSignedDate } from './sign';
import {
  WingDisabledError,
  WingHttpError,
  WingUnsupportedError,
  type WingAdapter,
  type WingCallRule,
  type WingCredentials,
  type WingInbound,
} from './types';

export const WING_API_BASE = 'https://api-gateway.coupang.com';
export const RG_INVENTORY_PATH = (vendorId: string) => `/v2/providers/rg_open_api/apis/api/v1/vendors/${encodeURIComponent(vendorId)}/rg/inventory/summaries`;

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; signal?: AbortSignal }) => Promise<{
  status: number;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
}>;

export interface HttpAdapterOptions {
  enabled: boolean;
  credentials: WingCredentials;
  rule: WingCallRule;
  fetch?: FetchLike;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
}

export function isRetryableStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status <= 599);
}

/** n 번째 재시도(1부터) 전에 기다릴 시간. Retry-After(초)가 있으면 그 값(최대치 안에서) */
export function backoffMs(attempt: number, rule: Pick<WingCallRule, 'baseBackoffMs' | 'maxBackoffMs'>, retryAfter?: string | null): number {
  if (!Number.isInteger(attempt) || attempt < 1) throw new RangeError('재시도 번호는 1 이상의 정수');
  const ra = retryAfter != null && /^\d+$/.test(retryAfter.trim()) ? Number(retryAfter.trim()) * 1000 : null;
  const exp = rule.baseBackoffMs * 2 ** (attempt - 1);
  return Math.min(rule.maxBackoffMs, ra ?? exp);
}

/** 호출 사이 최소 간격(ms) */
export function minIntervalMs(rule: Pick<WingCallRule, 'perSecond' | 'perMinute'>): number {
  if (rule.perSecond <= 0 || rule.perMinute <= 0) throw new RangeError('호출 제한은 0보다 커야 합니다');
  return Math.ceil(Math.max(1000 / rule.perSecond, 60_000 / rule.perMinute));
}

export class WingHttpAdapter implements WingAdapter {
  readonly kind = 'http' as const;
  private last = 0;
  private readonly fetchImpl: FetchLike;
  private readonly now: () => Date;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly o: HttpAdapterOptions) {
    this.fetchImpl = o.fetch ?? ((url, init) => fetch(url, init));
    this.now = o.now ?? (() => new Date());
    this.sleep = o.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  /** 서명한 GET 한 번(재시도 포함). 스위치가 꺼져 있으면 부르지 않는다 */
  async get(path: string, query = ''): Promise<unknown> {
    if (!this.o.enabled) throw new WingDisabledError();
    const { rule, credentials } = this.o;
    for (let attempt = 0; ; attempt++) {
      const gap = minIntervalMs(rule) - (this.now().getTime() - this.last);
      if (this.last && gap > 0) await this.sleep(gap);
      this.last = this.now().getTime();
      const signedDate = wingSignedDate(this.now());
      const auth = wingAuthorization({ method: 'GET', path, query, signedDate, accessKey: credentials.accessKey, secretKey: credentials.secretKey });
      const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const timer = ctl ? setTimeout(() => ctl.abort(), rule.timeoutMs) : null;
      let status = 0;
      let retryAfter: string | null = null;
      let body = '';
      try {
        const r = await this.fetchImpl(`${WING_API_BASE}${path}${query ? `?${query}` : ''}`, {
          method: 'GET',
          // 머리글은 문서 예시에서 확인한 둘만(다른 머리글 요구 여부는 확인 필요)
          headers: { Authorization: auth, 'Content-Type': 'application/json;charset=UTF-8' },
          signal: ctl?.signal,
        });
        status = r.status;
        retryAfter = r.headers.get('retry-after');
        body = await r.text();
      } catch {
        status = 0; // 네트워크 오류·시간 초과
      } finally {
        if (timer) clearTimeout(timer);
      }
      if (status >= 200 && status < 300) {
        try {
          return JSON.parse(body);
        } catch {
          throw new WingHttpError(status, '쿠팡 응답을 읽지 못했습니다');
        }
      }
      const retryable = status === 0 || isRetryableStatus(status);
      if (!retryable || attempt >= rule.maxRetries) {
        throw new WingHttpError(
          status,
          status === 401 || status === 403
            ? '쿠팡이 키를 받지 않았습니다 — 만료됐거나 권한 대기(최대 24시간) 중일 수 있습니다. 키를 다시 넣어 주세요.'
            : status === 429
              ? '쿠팡 호출 제한에 걸렸습니다. 잠시 뒤 다시 해 주세요.'
              : status === 0
                ? '쿠팡에 닿지 못했습니다(네트워크·시간 초과).'
                : `쿠팡이 오류로 답했습니다(${status}).`,
        );
      }
      await this.sleep(backoffMs(attempt + 1, rule, retryAfter));
    }
  }

  /** 로켓창고 재고 요약 — 입고 완료 교차 확인용(다음 단계) */
  async inventorySummaries(nextToken?: string): Promise<unknown> {
    const q = nextToken ? `nextToken=${encodeURIComponent(nextToken)}` : '';
    return this.get(RG_INVENTORY_PATH(this.o.credentials.vendorId), q);
  }

  async listInboundRequests(range: { from: string; to: string }): Promise<WingInbound[]> {
    void range;
    if (!this.o.enabled) throw new WingDisabledError();
    throw new WingUnsupportedError('로켓그로스 입고 요청 조회');
  }
}
