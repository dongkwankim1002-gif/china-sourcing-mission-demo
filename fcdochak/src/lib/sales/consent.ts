/**
 * 쿠팡 API 제공 동의 문구(v2 3차 sales) — 「읽는 것 / 하지 않는 것」. 법률 검토 전 초안(docs/sales-plan.md 사람이 정할 일 3).
 * 문구를 바꾸면 version 을 올린다 — 올리면 화주 관리자가 다시 동의해야 새 키를 넣을 수 있다.
 * 동의 기록(fcd.wing_consents)에는 그때 보인 목록을 그대로 남긴다.
 */
export const SALES_CONSENT = {
  version: 'sales-consent-2026-09(법률 검토 전)',
  reads: [
    { key: 'products', label: '상품·옵션', why: '옵션 이름·판매가를 우리 SKU 와 이어 개당 도착원가를 붙입니다' },
    { key: 'orders', label: '주문', why: '날짜·수량·금액만 — 주문자·받는 사람 정보는 가져오지 않습니다' },
    { key: 'inventory', label: '재고(로켓창고)', why: '재고 일수·품절 예상일·입고 반영 일수' },
    { key: 'returns', label: '반품', why: '반품률·사유(로켓그로스 반품 API 는 확인 필요)' },
    { key: 'settlements', label: '정산', why: '실제 수수료 확인(정산 API 모양 확인 필요 — 확인 전에는 기준값으로 추정)' },
  ],
  notDo: [
    '상품 등록·수정·삭제',
    '가격 변경',
    '주문 처리(발주 확인·송장 입력·취소)',
    '입고 요청 만들기·바코드 발급',
    '반품 승인·거절',
    '고객 문의 답변',
  ],
  notes: [
    '쓰기 호출은 코드에 없습니다 — 읽기(GET)만 합니다.',
    '키는 암호화해 보관하고 끝 4자리만 보입니다. 운영자도 키를 볼 수 없습니다.',
    '가져온 판매 기록은 이 조직 사람만 봅니다. 다른 셀러·물류사에게 넘기지 않습니다.',
    '연결을 끊어도 이미 가져온 기록은 남습니다. 지워 달라고 하면 운영 담당이 지웁니다(자동 삭제 없음).',
  ],
} as const;

/** 동의 기록에 남기는 범위 */
export function consentScopes() {
  return { reads: SALES_CONSENT.reads.map((r) => r.key), notDo: [...SALES_CONSENT.notDo] };
}
