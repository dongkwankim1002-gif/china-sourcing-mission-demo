/** 데모 문장 — 조합해서 문장이 서로 겹치지 않게 만든다. */
import type { Rng } from './rng';

const OPEN_GOOD = [
  '처음 맡겨 봤는데', '세 번째 거래인데 이번에도', '급하게 부탁드렸는데', '성수기라 걱정했는데', '소량이라 망설였는데',
  '담당자가 바뀌었는데도', '카페리 결항 소식에 조마조마했는데', '처음 FC 입고라 긴장했는데',
];
const MID_GOOD = [
  '견적 금액 그대로 청구서가 왔습니다', 'FC 예약까지 알아서 잡아 주셨습니다', '입고 반려 없이 한 번에 들어갔습니다',
  '출항 전날 사진까지 보내 주셨어요', '라벨 재작업을 추가 비용 없이 해 주셨습니다', '통관 서류를 미리 챙겨 주셔서 보류가 없었습니다',
  '도착 예정일보다 하루 빨랐습니다', '박스 파손 하나 없이 도착했습니다',
];
const CLOSE_GOOD = [
  '다음 달 물량도 여기로 갑니다.', '주변 셀러에게도 추천했습니다.', '고정 거래처로 삼으려 합니다.', '답장이 빨라서 좋았어요.',
  '가격보다 마음이 편한 게 컸습니다.', '다음엔 FCL 로 늘려 볼 생각입니다.',
];
const OPEN_MIXED = ['전반적으로 괜찮았지만', '가격은 좋았는데', '운송은 빨랐는데', '처음이라 그런지'];
const MID_MIXED = [
  '항만 비용이 견적보다 조금 더 나왔습니다', 'FC 예약이 하루 밀렸습니다', '중간 연락이 한 번 끊겼습니다',
  '회송 한 박스가 생겼습니다', '서류 요청이 늦게 왔습니다',
];
const CLOSE_MIXED = ['다음엔 미리 확인하겠습니다.', '그래도 다시 맡길 생각은 있습니다.', '개선되면 좋겠습니다.', '가격 생각하면 이해합니다.'];
const OPEN_BAD = ['솔직히 아쉬웠습니다.', '기대와 달랐습니다.', '다시 맡기기는 어렵겠습니다.'];
const MID_BAD = [
  '청구서에 견적에 없던 유류할증이 붙었고', 'FC 입고 반려가 두 번 났고', '통관 보류 연락을 사흘 뒤에 받았고',
  '도착 예정일을 네 번 바꿨고',
];
const CLOSE_BAD = ['해명도 충분하지 않았습니다.', '추가 비용 근거를 끝내 못 받았습니다.', '연락이 계속 늦었습니다.'];

export function reviewText(rng: Rng, rating: number, product: string, used: Set<string>): string {
  for (let tries = 0; tries < 40; tries++) {
    let s: string;
    if (rating >= 4) s = `${rng.pick(OPEN_GOOD)} ${product} ${rng.pick(MID_GOOD)}. ${rng.pick(CLOSE_GOOD)}`;
    else if (rating === 3) s = `${rng.pick(OPEN_MIXED)} ${product} 건에서 ${rng.pick(MID_MIXED)}. ${rng.pick(CLOSE_MIXED)}`;
    else s = `${rng.pick(OPEN_BAD)} ${product} 건은 ${rng.pick(MID_BAD)} ${rng.pick(CLOSE_BAD)}`;
    if (!used.has(s)) {
      used.add(s);
      return s;
    }
  }
  const s = `${product} 건 — 평가 ${rating}점. (${used.size + 1})`;
  used.add(s);
  return s;
}

export const RAW_STATUS_KO = [
  '', '예약 접수', '픽업 완료', '입고 완료(검수 대기)', '수출신고 수리', '본선 적재', '입항·하선', '수입신고 수리', '센터 입고', 'FC 입고 확인',
];
export const RAW_STATUS_ZH = [
  '', '已接单', '已提货', '已入库待验', '报关放行', '已装船', '已到港', '清关完成', '已入韩国仓', 'FC已签收',
];

export const EXCEPTION_NOTES: Record<string, string[]> = {
  customs_hold: ['수입신고 서류 보완 요청 — 원산지 표시 사진 추가 필요', '전파인증 번호 불일치로 통관 보류'],
  inspection: ['세관 검사 지정(X-ray) — 검사장 이동, 1~2일 지연 예상', '식약처 정밀검사 대상 지정'],
  fc_rejected: ['FC 입고 반려 — 바코드 라벨 위치 규격 위반 3박스', 'FC 입고 반려 — 박스 중량 초과(20kg) 2박스'],
  ferry_cancelled: ['기상 악화로 카페리 결항 — 다음 항차(이틀 뒤)로 이월', '태풍 영향으로 운항 취소, 대체 항차 배정 중'],
  billing_deviation: ['청구 금액이 응찰 대비 9% 높음 — 항만 추가 작업비 근거 요청', '견적에 없던 유류할증 청구 — 확인 요청'],
};
