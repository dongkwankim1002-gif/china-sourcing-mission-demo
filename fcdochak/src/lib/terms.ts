/**
 * 행동 이름 — 같은 행동은 끝까지 같은 이름. 버튼·메뉴·알림·명령 팔레트가 여기서 가져간다.
 */
export const ACTION = {
  newRequest: '견적 요청 올리기',
  compare: '같은 조건 비교',
  bidAsIs: '이대로 응찰',
  bidAdjusted: '조정해서 응찰',
  toBooking: '예약으로 전환',
  cancelRequest: '요청 취소',
  addRateCard: '요금표 추가',
  uploadRateCards: '엑셀로 요금표 올리기',
  extendRateCard: '유효기간 연장',
  expireRateCard: '지금 만료',
  updateStatus: '상태 갱신',
  addInvoice: '청구서 등록',
  review: '평가 남기기',
  saveSku: 'SKU 저장',
  demo: '데모로 둘러보기',
  login: '로그인',
  logout: '로그아웃',
  joinShipper: '화주로 시작하기',
  joinPartner: '물류사 입점 신청',
  verifyContact: '담당자 인증 요청',
  requestDeletion: '게시 삭제 요청',
  approve: '승인',
  reject: '반려',
  exportCsv: 'CSV 내보내기',
  markAllRead: '모두 읽음',
  undo: '되돌리기',
  approveInvoice: '청구 승인',
  disputeInvoice: '이의 남기기',
  changeDecision: '결정 바꾸기',
  uploadDoc: '서류 올리기',
  invitePartner: '초대 링크 만들기',
  copyLink: '링크 복사',
  revokeInvite: '초대 거두기',
  acceptInvite: '거래처로 연결',
  // v2 alliance
  applyAlliance: '제휴 신청하기',
  uploadAllianceDoc: '올리기',
  verifyRequirement: '확인함',
  newTermsVersion: '계약 조건 새 판 만들기',
  newSettlement: '정산 명세 만들기',
} as const;

export const REQUEST_STATUS: Record<string, { label: string; tone: 'neutral' | 'info' | 'caution' | 'ok' | 'stamp' | 'label' }> = {
  waiting: { label: '응찰 대기', tone: 'neutral' },
  bidding: { label: '응찰 중', tone: 'info' },
  closing_soon: { label: '마감 임박', tone: 'caution' },
  comparable: { label: '비교 가능', tone: 'label' },
  selected: { label: '선택 완료', tone: 'ok' },
  expired: { label: '만료', tone: 'neutral' },
  cancelled: { label: '취소', tone: 'neutral' },
};

/** 표준 9단계 */
export const STAGES = [
  '',
  '예약 확정',
  '집하 완료',
  '중국 창고 입고',
  '수출통관 완료',
  '선적·출항',
  '한국 도착',
  '수입통관 완료',
  '국내 창고 입고',
  'FC 입고 완료',
] as const;

export const STAGES_ZH = ['', '订舱确认', '已提货', '已入中国仓', '出口报关完成', '已装船出港', '已到韩国', '进口清关完成', '已入韩国仓', 'FC入库完成'] as const;

export const EXCEPTION_LABEL: Record<string, string> = {
  customs_hold: '통관 보류',
  inspection: '검사 지정',
  fc_rejected: 'FC 입고 반려',
  ferry_cancelled: '카페리 결항',
  billing_deviation: '청구 편차',
};

export const BIZ_TYPE_LABEL: Record<string, string> = {
  forwarder: '포워더',
  consolidator: '해상 혼적(콘솔)',
  ferry_agent: '카페리 대리점',
  air_forwarder: '항공 포워더',
  customs_broker: '관세사',
  fulfillment_3pl: '국내 창고·3PL',
};

export const PARTNER_STATUS_LABEL: Record<string, string> = {
  public_info: '공개정보 기준',
  pending_verification: '인증 대기',
  official: '공식 등록',
  deletion_requested: '삭제 요청',
  deleted: '삭제',
  active: '활성',
};

export const CERTAINTY_LABEL: Record<string, string> = {
  confirmed: '확정',
  estimated: '예상',
  extra_possible: '추가비용 가능',
};

export const BASIS_LABEL: Record<string, string> = {
  per_cbm: 'CBM당',
  per_rt: 'R/T당',
  per_kg: 'kg당',
  per_chargeable_kg: '청구중량 kg당',
  per_carton: '박스당',
  per_unit: '개당',
  per_pallet: '팔레트당',
  per_container: '컨테이너당',
  per_shipment: '건당',
  percent_goods: '물품가 %',
};

export const DOC_LABEL: Record<string, string> = {
  commercial_invoice: '상업송장(CI)',
  packing_list: '포장명세서(PL)',
  bl: '선하증권(B/L)',
  co: '원산지증명(CO)',
  import_declaration: '수입신고필증',
  photo: '사진',
  other: '기타',
};

export const NOTIF_KIND_LABEL: Record<string, string> = {
  bid_arrived: '응찰 도착',
  deadline_soon: '마감 임박',
  exception: '예외 발생',
  invoice_arrived: '청구서 도착',
  booking: '예약',
  status: '상태 갱신',
  system: '안내',
};

/** v2 check — 청구서 점검 행동 이름(홈 첫 행동·점검 화면·화주 목록이 같은 말을 쓴다) */
export const CHECK_ACTION = {
  start: '내 견적서·청구서 점검받기',
  run: '점검하기',
  save: '이 결과 보관',
  again: '고쳐서 다시 점검',
  list: '청구서 점검',
} as const;

/** 청구서 점검 판정 — 색만으로 뜻을 싣지 않도록 늘 글자와 함께 */
export const CHECK_VERDICT: Record<string, { label: string; tone: 'neutral' | 'info' | 'caution' | 'ok' | 'stamp' | 'label' }> = {
  high: { label: '과함', tone: 'stamp' },
  typical: { label: '시세 안', tone: 'ok' },
  low: { label: '낮음', tone: 'caution' },
  missing: { label: '빠짐', tone: 'caution' },
  separate: { label: '보통 따로', tone: 'neutral' },
  unknown: { label: '기준 없음', tone: 'neutral' },
};
/** 후기가 어떤 끝으로 끝난 선적에 대한 것인가(v2 trust) — 선적 기록에서 읽는다, 화주가 고르지 않는다 */
export const REVIEW_OUTCOME_LABEL: Record<string, string> = {
  delivered: 'FC 입고 완료',
  fc_returned: 'FC 회송 있음',
  fc_rejected: 'FC 입고 반려',
  lost: '분실·미도착',
};

export const REVIEW_OUTCOME_LABEL_ZH: Record<string, string> = {
  delivered: 'FC入库完成',
  fc_returned: '有FC退回',
  fc_rejected: 'FC拒收',
  lost: '丢失·未到',
};

/** 후기 답변 행동 이름(v2 trust) */
export const TRUST_ACTION = {
  reply: '공개 답변 남기기',
  editReply: '답변 고치기',
} as const;

/** 추천 점수 네 항목의 이름 — 계산기·비교·업체 화면·어드민·정책·자주 묻는 질문이 같은 말을 쓴다(v2 검토) */
export const SCORE_TERMS = ['정시 입고', '청구 편차', 'FC 회송', '가격 확실성'] as const;

/** 쿠팡 WING 연동 행동 이름(v2 2차 wing) — 화면·e2e 가 같은 말을 쓴다 */
export const WING_ACTION = {
  saveKey: '키 저장',
  revokeKey: '키 폐기',
  importMock: '예시 입고 요청 가져오기',
  importFile: 'WING 파일 올리기',
  syncApi: 'WING 에서 바로 가져오기',
  confirmMatch: '짝 확정',
  pickMatch: '이 선적과 짝',
  unlink: '짝 풀기',
  fileBarcode: '바코드 PDF 올리기',
} as const;

export const WING_METHOD_LABEL: Record<'self_key' | 'partner_solution', string> = {
  self_key: '판매자 본인 키(자체개발)',
  partner_solution: '연동 업체 선택(FC도착)',
};

export const WING_STATUS_LABEL: Record<'saved' | 'verified' | 'failed' | 'revoked', string> = {
  saved: '저장됨 · 연동 준비 중',
  verified: '연결 확인됨',
  failed: '쿠팡이 받지 않음',
  revoked: '폐기함',
};

export const WING_SOURCE_LABEL: Record<'mock' | 'file' | 'api', string> = {
  mock: '예시',
  file: 'WING 파일',
  api: 'WING 연동',
};
/** 셀러 인터뷰 행동 이름(v2 interview) — 셀러 화면·인터뷰어 모드·운영 보드가 같은 말을 쓴다 */
export const RESEARCH_ACTION = {
  agree: '동의하고 시작',
  decline: '동의하지 않음',
  next: '저장하고 다음',
  back: '이전',
  finish: '끝내기',
  addParticipant: '대상 넣기',
  makeLink: '인터뷰 링크 만들기',
  newLink: '새 링크 만들기',
  revokeLink: '링크 거두기',
  conduct: '통화하며 대신 적기',
  revealContact: '연락처 보기',
  clearContact: '연락처 지우기',
  verbalAgree: '구두 동의 받음',
  verbalDecline: '거부함',
  addQuote: '단가 넣기',
} as const;

// v2 2차 고침 — 인터뷰 철회·삭제 요청(쌓기만, 실제 삭제는 사람이 docs/research-plan.md 7절대로)
export const RESEARCH_ACTION_MORE = {
  recordWithdrawal: '철회·삭제 요청 받음',
} as const;

// v2 3차 sourcing — 소싱처 찾기(패밀리 확장 모듈, 미리보기). 화주 화면·운영 화면·e2e 가 같은 말을 쓴다
export const SOURCING_ACTION = {
  request: '소싱 요청 남기기',
  cancel: '요청 취소',
  sample: '샘플 요청(관심 등록)',
  sampleDone: '샘플 요청함',
  toCompare: '이 조건으로 물류 비교',
  recalc: '다시 셈',
  setStatus: '상태 남기기',
  addCandidate: '후보 넣기',
  fillMock: '예시 후보 채우기',
  reviseQuote: '조건 새 판',
  withdraw: '후보 내리기',
} as const;

export const SOURCING_STATUS_LABEL: Record<'requested' | 'researching' | 'candidates_ready' | 'sample_requested' | 'closed' | 'cancelled', string> = {
  requested: '접수',
  researching: '조사 중',
  candidates_ready: '후보 있음',
  sample_requested: '샘플 요청',
  closed: '끝',
  cancelled: '취소',
};

export const SUPPLIER_KIND_LABEL: Record<'factory' | 'trader' | 'unknown', string> = {
  factory: '공장',
  trader: '무역상',
  unknown: '확인 전',
};

export const CANDIDATE_SOURCE_LABEL: Record<'manual' | 'seller_link' | 'mock' | 'api', string> = {
  manual: '담당 조사',
  seller_link: '셀러 링크 확인',
  mock: '예시',
  api: '공식 API',
};

/** 쿠팡 API 제공 · 판매 분석 행동 이름(v2 3차 sales) — 화면·e2e 가 같은 말을 쓴다 */
export const SALES_ACTION = {
  agree: '동의하고 키 넣기',
  test: '연결 시험',
  sync: '판매 기록 가져오기',
  quote: '지금 견적 요청',
  connect: '쿠팡 연결하러 가기',
  disconnect: '연결 끊기(키 폐기)',
} as const;

export const SALES_RETURN_REASON_LABEL: Record<'change_of_mind' | 'defect' | 'damaged' | 'wrong_item' | 'not_as_described' | 'other', string> = {
  change_of_mind: '단순 변심',
  defect: '상품 불량',
  damaged: '배송 중 파손',
  wrong_item: '오배송',
  not_as_described: '설명과 다름',
  other: '기타',
};

/** v2 3차 고침 — 판매 분석 상품 행에서 하는 일 */
export const SALES_PRODUCT_ACTION = {
  linkSku: 'SKU 잇기',
  sourcing: '비슷한 상품 소싱',
} as const;

// v2 4차 onestop — 원스톱 대행형 구역(미리보기). 셀러 화면·운영 화면·e2e 가 같은 말을 쓴다
export const ONESTOP_ACTION = {
  entrust: '맡기기',
  submit: '이대로 맡기기',
  cancel: '주문 취소',
  price: '요금표 보기',
  orders: '내 원스톱 주문',
  setStage: '단계 남기기',
  revise: '주문 새 판',
} as const;

export const ONESTOP_STAGE_LABEL: Record<'received' | 'payment_confirmed' | 'factory_received' | 'inspected' | 'barcoded' | 'departed' | 'customs_cleared' | 'fc_received' | 'cancelled' | 'issue', string> = {
  received: '접수',
  payment_confirmed: '사입 대금 확인',
  factory_received: '중국 창고 입고',
  inspected: '검품',
  barcoded: '바코드',
  departed: '혼적 출항',
  customs_cleared: '통관',
  fc_received: 'FC 입고',
  cancelled: '취소',
  issue: '문제 기록',
};

/** 중국 창고 쪽이 함께 보는 단계 이름(물류사 화면 관례처럼 중국어 병기) */
export const ONESTOP_STAGE_ZH: Record<keyof typeof ONESTOP_STAGE_LABEL, string> = {
  received: '已接单',
  payment_confirmed: '货款已确认',
  factory_received: '工厂货已入仓',
  inspected: '已验货',
  barcoded: '已贴条码',
  departed: '拼箱已出港',
  customs_cleared: '已清关',
  fc_received: 'FC已入库',
  cancelled: '已取消',
  issue: '异常记录',
};

export const ONESTOP_INSPECTION_LABEL: Record<'none' | 'basic' | 'full', string> = {
  none: '검품 안 함',
  basic: '기본 검품(수량·외관)',
  full: '정밀 검품(작동·치수)',
};

export const ONESTOP_LINE_LABEL: Record<'freight' | 'remote_fc' | 'handling' | 'barcode' | 'inspection' | 'purchase_fee', string> = {
  freight: '공동 혼적 운임',
  remote_fc: '원거리 FC 할증',
  handling: '개당 작업비',
  barcode: '바코드 부착',
  inspection: '검품',
  purchase_fee: '사입 대행 수수료',
};

// v2 5차 tracker — 통관·입고 알리미. 공개 조회·화주 목록·운영 화면·e2e 가 같은 말을 쓴다
export const TRACK_ACTION = {
  lookup: '통관 조회',
  search: '조회하기',
  save: '내 목록에 저장',
  watchOn: '알림 켜기',
  watchOff: '알림 끄기',
  link: '이대로 잇기',
  refresh: '지금 다시 조회',
  archive: '보관 끝내기',
  stats: '항구별 통관 소요 보기',
  poll: '폴링 한 번 돌리기',
  recompute: '통계 다시 셈',
  // 검토 고침 — 「보관」은 창고 보관으로 읽히므로 목록 말로(archive 는 옛 이름으로 남겨 둔다)
  unlist: '목록에서 빼기',
  restore: '다시 지켜보기',
  showUnlisted: '목록에서 뺀 번호',
} as const;

// v2 6차 scorecard — 물류사 성적표. 공개·물류사·운영 화면·e2e 가 같은 말을 쓴다(물류사 화면은 중국어 병기)
export const SCORECARD_ACTION = {
  title: '물류사 성적표',
  register: '내 화물 등록',
  submit: '화물번호 제출 · 提交单号',
  dispute: '이의 제기 · 提出异议',
  withdraw: '이의 거두기 · 撤回',
  accept: '받아들이기',
  reject: '돌려보내기',
  recompute: '성적표 다시 셈',
  refreshSubmitted: '제출 번호 조회',
  findCode: '관세청 목록에서 찾기',
  linkCode: '이 부호로 연결',
  market: '통관 시장 지표',
} as const;
