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
