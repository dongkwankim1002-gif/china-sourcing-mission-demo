/**
 * 쿠팡 WING 연동 어댑터 한 겹 — 실제 HTTP(스위치 꺼짐 기본) · 흉내(데모·시험).
 * 쓰기(입고 요청 만들기 등)는 없다. 읽기만.
 */

/** 가져온 입고 요청 한 건 — 파일·흉내·API 가 같은 모양으로 맞춘다 */
export interface WingInbound {
  /** 쿠팡 입고 요청 번호 */
  externalNo: string;
  /** WING 에 적힌 물류센터 이름 그대로 */
  centerName: string | null;
  /** 우리 참조표의 FC 코드(이름으로 맞춘 것, 못 맞추면 null) */
  fcCode: string | null;
  /** 입고 예정일 YYYY-MM-DD */
  plannedOn: string | null;
  skuCount: number | null;
  units: number | null;
  boxes: number | null;
  /** WING 상태값 그대로 */
  statusRaw: string | null;
  /** 입고 결과 — 입고된 수량 */
  receivedUnits: number | null;
  /** 회송 수량 */
  returnedUnits: number | null;
}

export interface WingCredentials {
  vendorId: string;
  accessKey: string;
  secretKey: string;
}

export interface WingAdapter {
  readonly kind: 'http' | 'mock';
  /** 입고 요청 목록(기간 YYYY-MM-DD). HTTP 어댑터는 공개 API 확인 전이라 WingUnsupportedError */
  listInboundRequests(range: { from: string; to: string }): Promise<WingInbound[]>;
}

export class WingDisabledError extends Error {
  readonly code = 'wing_disabled';
  constructor() {
    super('쿠팡 WING 연동이 꺼져 있습니다(WING_ENABLED). 연동 준비 중입니다.');
  }
}

export class WingUnsupportedError extends Error {
  readonly code = 'wing_unsupported';
  constructor(what: string) {
    super(`${what} — 공개 API 를 확인하지 못했습니다(확인 필요). WING 에서 내려받은 파일을 올려 주세요.`);
  }
}

export class WingHttpError extends Error {
  readonly code = 'wing_http';
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** 호출 제한·재시도 — 설정 wing.call_rule */
export interface WingCallRule {
  perSecond: number;
  perMinute: number;
  maxRetries: number;
  baseBackoffMs: number;
  maxBackoffMs: number;
  timeoutMs: number;
}

/** 짝 맞추기 기준 — 설정 wing.match_rule */
export interface WingMatchRule {
  dateWindowDays: number;
  unitsToleranceBp: number;
  minScore: number;
}
