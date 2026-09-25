/**
 * 참조 시드 — 본게임에도 남는 자료. 데모가 아니다.
 * 기준값(환율·요율·기준)은 여기 「첫 판」만 넣고, 이후는 운영 어드민에서 새 판으로 쌓는다.
 */
import type { RateLine } from '@/lib/money/quote';

export const HUBS = [
  { code: 'YIW', name_ko: '이우', name_zh: '义乌', province_ko: '저장성', lat: 29.306, lng: 120.075, stage: 1, ord: 1 },
  { code: 'QDG', name_ko: '청도', name_zh: '青岛', province_ko: '산둥성', lat: 36.067, lng: 120.383, stage: 1, ord: 2 },
  { code: 'WEH', name_ko: '위해', name_zh: '威海', province_ko: '산둥성', lat: 37.513, lng: 122.12, stage: 1, ord: 3 },
  { code: 'YNT', name_ko: '연태', name_zh: '烟台', province_ko: '산둥성', lat: 37.464, lng: 121.448, stage: 2, ord: 4 },
  { code: 'RZH', name_ko: '일조', name_zh: '日照', province_ko: '산둥성', lat: 35.417, lng: 119.527, stage: 2, ord: 5 },
  { code: 'CAN', name_ko: '광저우', name_zh: '广州', province_ko: '광둥성', lat: 23.129, lng: 113.264, stage: 1, ord: 6 },
  { code: 'SZX', name_ko: '선전', name_zh: '深圳', province_ko: '광둥성', lat: 22.543, lng: 114.058, stage: 2, ord: 7 },
] as const;

export const PORTS = [
  { code: 'ICN', name_ko: '인천', name_zh: '仁川', lat: 37.456, lng: 126.598, ord: 1 },
  { code: 'PTK', name_ko: '평택', name_zh: '平泽', lat: 36.966, lng: 126.827, ord: 2 },
] as const;

export const MODES = [
  { code: 'LCL', name_ko: 'LCL 혼적', name_zh: '拼箱 LCL', days_min: 7, days_max: 12, ord: 1 },
  { code: 'FERRY', name_ko: '카페리', name_zh: '客滚船', days_min: 3, days_max: 6, ord: 2 },
  { code: 'FCL', name_ko: 'FCL 컨테이너', name_zh: '整箱 FCL', days_min: 7, days_max: 14, ord: 3 },
  { code: 'AIR', name_ko: '항공', name_zh: '空运', days_min: 2, days_max: 4, ord: 4 },
] as const;

/** 쿠팡 FC — 지역 이름으로만 부른다. 거리는 항구에서의 도로 거리(대략, km). */
export const FC_CENTERS = [
  { code: 'FC-ICN', name: '인천 FC', region: '인천', km_incheon: 18, km_pyeongtaek: 92 },
  { code: 'FC-GOY', name: '고양 FC', region: '경기 북부', km_incheon: 45, km_pyeongtaek: 105 },
  { code: 'FC-ICH', name: '이천 FC', region: '경기 동부', km_incheon: 88, km_pyeongtaek: 62 },
  { code: 'FC-DPG', name: '덕평 FC', region: '경기 동부', km_incheon: 92, km_pyeongtaek: 70 },
  { code: 'FC-DTN', name: '동탄 FC', region: '경기 남부', km_incheon: 62, km_pyeongtaek: 30 },
  { code: 'FC-PTK', name: '평택 FC', region: '경기 남부', km_incheon: 84, km_pyeongtaek: 12 },
  { code: 'FC-CAN', name: '천안 FC', region: '충청', km_incheon: 110, km_pyeongtaek: 38 },
  { code: 'FC-DGU', name: '대구 FC', region: '경상', km_incheon: 290, km_pyeongtaek: 230 },
  { code: 'FC-CWN', name: '창원 FC', region: '경상', km_incheon: 370, km_pyeongtaek: 310 },
  { code: 'FC-GWJ', name: '광주 FC', region: '전라', km_incheon: 300, km_pyeongtaek: 230 },
] as const;

export const SEGMENT_ROWS = [
  { code: 'pickup', ord: 1, name_ko: '집하', name_zh: '提货', description_ko: '공장·도매시장에서 화물을 거둬 창고로' },
  { code: 'cn_warehouse', ord: 2, name_ko: '창고 작업', name_zh: '仓库作业', description_ko: '검수·라벨·재포장·팔레트' },
  { code: 'export_customs', ord: 3, name_ko: '수출통관', name_zh: '出口报关', description_ko: '중국 수출신고·서류' },
  { code: 'freight', ord: 4, name_ko: '국제운송', name_zh: '国际运输', description_ko: '해상·카페리·항공 운임' },
  { code: 'port', ord: 5, name_ko: '항만', name_zh: '港口杂费', description_ko: '터미널 작업료·CFS·서류 발급' },
  { code: 'broker', ord: 6, name_ko: '관세사', name_zh: '韩国报关行', description_ko: '수입신고 대리 보수 — 수수료 기준에서 뺀다' },
  { code: 'kr_warehouse', ord: 7, name_ko: '국내 창고', name_zh: '韩国仓库', description_ko: '입고·보관·FC 규격 작업' },
  { code: 'fc_delivery', ord: 8, name_ko: 'FC 운송', name_zh: 'FC 配送', description_ko: '쿠팡 FC 입고 운송·예약' },
  { code: 'return_reserve', ord: 9, name_ko: '회송 대비', name_zh: '退仓预留', description_ko: 'FC 입고 반려 시 회송·재작업 예비비' },
] as const;

export const CARGO_TRAITS = [
  {
    code: 'battery', ord: 1, name_ko: '배터리', name_zh: '电池',
    verdict_ko: '리튬 배터리 포함 — 항공은 못 보내고, 해상·카페리는 MSDS 와 UN38.3 시험성적서가 필요합니다.',
    requirement_ko: '배터리 취급을 등록한 업체만 받을 수 있습니다.',
    needs_capability: true, blocked_modes: ['AIR'],
  },
  {
    code: 'radio', ord: 2, name_ko: '전파인증', name_zh: '无线电认证',
    verdict_ko: '무선 기능 — 수입신고 때 전파법 적합성평가(KC 전파) 번호가 필요합니다.',
    requirement_ko: '인증 번호를 요청서에 적어 주세요. 없으면 통관이 보류됩니다.',
    needs_capability: false, blocked_modes: [],
  },
  {
    code: 'kc', ord: 3, name_ko: 'KC 안전', name_zh: 'KC 安全认证',
    verdict_ko: '전기·생활용품 — KC 안전인증·안전확인·공급자적합성확인 대상인지 먼저 확인합니다.',
    requirement_ko: '대상이면 인증서 또는 시험성적서를 서류 탭에 올려 주세요.',
    needs_capability: false, blocked_modes: [],
  },
  {
    code: 'food_contact', ord: 4, name_ko: '식품접촉', name_zh: '食品接触',
    verdict_ko: '식품에 닿는 제품 — 기구·용기·포장 수입신고가 필요하고, 정밀검사가 걸리면 5~10일 늘어납니다.',
    requirement_ko: '재질 성적서를 준비해 주세요. 관세사가 식약처 신고를 대행합니다.',
    needs_capability: false, blocked_modes: [],
  },
  {
    code: 'liquid', ord: 5, name_ko: '액체', name_zh: '液体',
    verdict_ko: '액체 — 누수 방지 이중 포장이 필요하고, 일부 카페리 선사는 받지 않습니다.',
    requirement_ko: '액체 취급을 등록한 업체만 받을 수 있습니다.',
    needs_capability: true, blocked_modes: [],
  },
  {
    code: 'cosmetics', ord: 6, name_ko: '화장품', name_zh: '化妆品',
    verdict_ko: '화장품 — 화장품책임판매업 등록 화주만 수입할 수 있고, 한글 표시사항이 필요합니다.',
    requirement_ko: '책임판매업 등록증을 설정의 회사 서류에 올려 주세요.',
    needs_capability: false, blocked_modes: [],
  },
  {
    code: 'dg', ord: 7, name_ko: '위험물', name_zh: '危险品',
    verdict_ko: '위험물(가스·압축·인화) — 항공과 카페리는 불가, 위험물 취급 업체의 해상 운송만 됩니다.',
    requirement_ko: '위험물 취급을 등록한 업체만 받을 수 있습니다. MSDS 필수.',
    needs_capability: true, blocked_modes: ['AIR', 'FERRY'],
  },
  {
    code: 'kids', ord: 8, name_ko: '어린이제품', name_zh: '儿童产品',
    verdict_ko: '어린이제품 — KC 어린이제품 안전인증(또는 안전확인) 없이는 통관되지 않습니다.',
    requirement_ko: '인증 번호와 표시사항 사진을 서류 탭에 올려 주세요.',
    needs_capability: false, blocked_modes: [],
  },
] as const;

export const DUTY_RATES = [
  { category: 'general', name_ko: '일반 잡화', rate_bp: 800 },
  { category: 'electronics', name_ko: '소형 전자기기', rate_bp: 800 },
  { category: 'audio', name_ko: '음향기기', rate_bp: 800 },
  { category: 'apparel', name_ko: '의류·섬유', rate_bp: 1300 },
  { category: 'kitchen', name_ko: '주방용품(식품접촉)', rate_bp: 800 },
  { category: 'cosmetics', name_ko: '화장품', rate_bp: 650 },
  { category: 'toys', name_ko: '완구·어린이제품', rate_bp: 800 },
  { category: 'furniture', name_ko: '가구·대형 생활용품', rate_bp: 800 },
  { category: 'chemical', name_ko: '가스·화학 생활용품', rate_bp: 650 },
] as const;

/** 비교 때 업체가 맡지 않은 구간을 채우는 플랫폼 참고 요금(원). 운영 어드민에서 새 판으로 바꾼다. */
export const REFERENCE_LINES: RateLine[] = [
  { segment: 'pickup', included: true, basis: 'per_cbm', unitPrice: 9000, currency: 'KRW', minCharge: 45000, certainty: 'estimated' },
  { segment: 'cn_warehouse', included: true, basis: 'per_carton', unitPrice: 1100, currency: 'KRW', minCharge: 20000, certainty: 'estimated' },
  { segment: 'export_customs', included: true, basis: 'per_shipment', unitPrice: 48000, currency: 'KRW', certainty: 'estimated' },
  { segment: 'freight', included: true, basis: 'per_rt', unitPrice: 88000, currency: 'KRW', minCharge: 88000, certainty: 'estimated' },
  { segment: 'port', included: true, basis: 'per_rt', unitPrice: 36000, currency: 'KRW', minCharge: 60000, certainty: 'estimated' },
  { segment: 'broker', included: true, basis: 'per_shipment', unitPrice: 33000, currency: 'KRW', certainty: 'estimated' },
  { segment: 'kr_warehouse', included: true, basis: 'per_carton', unitPrice: 1400, currency: 'KRW', minCharge: 30000, certainty: 'estimated' },
  { segment: 'fc_delivery', included: true, basis: 'per_pallet', unitPrice: 42000, currency: 'KRW', minCharge: 60000, certainty: 'estimated' },
  { segment: 'return_reserve', included: true, basis: 'per_carton', unitPrice: 600, currency: 'KRW', minCharge: 10000, certainty: 'estimated' },
];

export const SETTINGS: { key: string; value: unknown; note: string }[] = [
  { key: 'fx', value: { KRW: 1, RMB: 190.5, USD: 1380 }, note: '1 외화 = N 원. 매주 월요일 고시환율로 갱신.' },
  { key: 'commission_rate_bp', value: 300, note: '성사 수수료 요율(bp). 기준 = 물류비 합계 − 관세사 보수.' },
  { key: 'fc_ready_rule', value: { minFcInbound: 60, maxReturnRate30d: 0.035 }, note: 'FC 입고 준비 인증 기준' },
  { key: 'score_caps', value: { deviationCap: 0.1, fcReturnCap: 0.1 }, note: '이 편차·회송률 이상이면 그 칸 0점' },
  { key: 'quote_params', value: { volumetricKgPerCbm: 167, palletCbm: 1.5, containerCbm: 28 }, note: '청구 수량 환산 기준' },
  { key: 'vat_rate_bp', value: 1000, note: '부가세율' },
  { key: 'insurance_bp', value: 20, note: '보험료를 모를 때 과세가격 산입 비율' },
  { key: 'sale_fee_bp', value: 1080, note: '판매손익 기본 판매 수수료율 — 화주가 바꿀 수 있다' },
  { key: 'fulfillment_per_unit', value: 2800, note: '판매손익 기본 개당 풀필먼트 비용(원)' },
  { key: 'reference_lines', value: REFERENCE_LINES, note: '비교 때 빈 구간을 채우는 참고 요금' },
  { key: 'expiring_days', value: 10, note: '「곧 만료」로 표시할 남은 날' },
  // v2 tools — 공개 판매손익 계산기(/tools/pnl) 기준값. 실제 쿠팡 요율을 확인한 값이 아니다(예시). 확인하면 어드민에서 새 판으로.
  {
    key: 'tools.coupang_fee_basis',
    value: {
      saleFeeBp: 1080,
      rgInboundPerUnit: 700,
      rgShippingPerUnit: 2100,
      adBp: 0,
      checkedOn: '2026-09-25',
      example: true,
      source: '예시 기준값 — 쿠팡 판매 수수료·로켓그로스 요금은 카테고리·크기·기간마다 다릅니다. 쿠팡 WING 과 로켓그로스 요금표에서 확인해 주세요.',
    },
    note: '공개 판매손익 계산기의 쿠팡 기준값(예시). 확인한 값으로 바꾸면 checkedOn·example 도 함께 고친다',
  },
  {
    key: 'tools.trait_extra_costs',
    value: [
      { trait: 'battery', items: ['MSDS·UN38.3 시험성적서 발급비', '배터리 취급 할증(업체마다 다름)', '항공 불가 — 해상·카페리 기간만큼 재고가 늦게 들어감'] },
      { trait: 'radio', items: ['전파 적합성평가(KC 전파) 비용 — 번호가 없을 때', '통관 보류 기간의 보관료'] },
      { trait: 'kc', items: ['KC 안전인증·시험성적서 비용 — 대상일 때', '통관 보류 기간의 보관료'] },
      { trait: 'food_contact', items: ['기구·용기·포장 수입신고 대행료', '정밀검사가 걸리면 검사비와 5~10일 보관료'] },
      { trait: 'liquid', items: ['누수 방지 이중 포장비', '받지 않는 카페리 선사가 있어 선택지가 줄어듦'] },
      { trait: 'cosmetics', items: ['한글 표시사항 라벨 작업비', '화장품책임판매업 등록(없으면 수입 불가)'] },
      { trait: 'dg', items: ['위험물 할증·전용 적재 비용', 'MSDS 필수 · 항공·카페리 불가'] },
      { trait: 'kids', items: ['KC 어린이제품 인증 비용', '표시사항 라벨 작업비'] },
    ],
    note: '화물 특성마다 생길 수 있는 추가비용 항목(금액 없이 글로). 계산기·비교에서 경고로 보인다',
  },
  {
    key: 'invoice_check_rule',
    value: { minSamples: 3, highOverMedianBp: 2000, lowUnderMedianBp: 3000, missingCoverageBp: 5000, publicPerMinute: 20 },
    note: '청구서 점검 — 구간 표본 최소 요금표 수 · 과함(중간값 +bp, 비싼 쪽 25% 초과) · 낮음(중간값 −bp) · 빠짐(그 구간을 맡는 요금표 비율 bp 이상) · 비로그인 분당 횟수',
  },
];
