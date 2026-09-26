/**
 * 관세청 UNI-PASS 오픈API 어댑터 한 겹 — 실제 HTTP(UNIPASS_ENABLED 꺼짐 기본) · 흉내(데모·시험, 결정적).
 * 읽기(조회)만 한다. 응답 칸 이름은 원문 연계가이드를 확인하지 못해 가정했다(docs/tracker-plan.md 3절, 확인 필요).
 */

export type TrackKind = 'cargo_no' | 'mbl' | 'hbl';

/** 정규화 아홉 단계(DB fcd.track_stage_rank 와 같은 순서) */
export const TRACK_STAGES = ['manifest', 'arrival', 'unloading', 'bonded_in', 'declared', 'cleared', 'released', 'domestic', 'fc'] as const;
export type TrackStage = (typeof TRACK_STAGES)[number];

export interface TrackQuery {
  kind: TrackKind;
  /** 대문자·숫자·하이픈으로 다듬은 번호 */
  number: string;
  /** B/L 이면 연도 */
  year: number | null;
}

/** 이력 한 줄(cargCsclPrgsInfoDtlQryVo) — 저장하는 것은 처리구분·일시·요약 앞부분뿐 */
export interface CargoEvent {
  /** 처리구분 원문(cargTrcnRelaBsopTpcd) */
  rawType: string;
  /** 처리일시(ISO, 한국 시각을 +09:00 으로) */
  at: string;
  /** 장치장명·반출입내용 앞부분 */
  summary: string | null;
}

/** 요약(cargCsclPrgsInfoQryVo) 중 쓰는 칸 */
export interface CargoSummary {
  cargoNo: string | null;
  mbl: string | null;
  hbl: string | null;
  /** 진행상태·통관진행상태 원문 */
  status: string | null;
  /** 양륙항 코드(dsprCd, 예: KRINC) */
  portCode: string | null;
  /** 입항일(etprDt) YYYY-MM-DD */
  arrivalOn: string | null;
  /** 포워더명(frwrEntsConm) — 표시만(업체 잇기는 사람이 고른다) */
  forwarder: string | null;
  packages: number | null;
}

export type LookupResult =
  | { status: 'found'; summary: CargoSummary; events: CargoEvent[]; source: 'unipass' | 'mock' }
  /** B/L 로 여러 건 — 화물관리번호로 다시 */
  | { status: 'multiple'; cargoNos: string[]; source: 'unipass' | 'mock' }
  | { status: 'not_found'; source: 'unipass' | 'mock' };

export interface UnipassAdapter {
  readonly kind: 'http' | 'mock';
  lookup(q: TrackQuery): Promise<LookupResult>;
}

export class UnipassDisabledError extends Error {
  readonly code = 'unipass_disabled';
  constructor() {
    super('관세청 조회가 꺼져 있습니다(UNIPASS_ENABLED). 연결 준비 중입니다.');
  }
}

export class UnipassError extends Error {
  readonly code = 'unipass_error';
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
