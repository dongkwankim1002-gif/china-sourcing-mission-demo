/**
 * 데모 조직 — 전부 가상. 실존 회사명을 쓰지 않는다.
 * quality: 선적·청구 실측을 만들어 내는 성향(점수는 이 값이 아니라 만들어진 기록에서 계산된다).
 */
export type BizType = 'forwarder' | 'consolidator' | 'ferry_agent' | 'air_forwarder' | 'customs_broker' | 'fulfillment_3pl';
export type PartnerStatus = 'public_info' | 'pending_verification' | 'official' | 'deletion_requested';

export interface PartnerDef {
  key: string;
  name: string;
  nameZh: string;
  type: BizType;
  status: PartnerStatus;
  city: string;
  address: string;
  phone: string;
  hubs: string[];
  ports: string[];
  modes: string[];
  caps: string[];
  locale: 'ko' | 'zh';
  /** 가격 수준(1 = 시장 평균) */
  price: number;
  onTime: number;
  deviation: number; // 청구 편차 평균(부호 포함)
  returnRate: number;
  /** 과거 선적 가중치 — 클수록 거래가 많다 */
  weight: number;
  certain: number; // 확정 요금 비중 성향 0~1
  related?: string;
  intro?: string;
  website?: string;
  license?: string;
  insurance?: string;
  uploadedLogo?: boolean;
}

export const PARTNERS: PartnerDef[] = [
  { key: 'hanbada', name: '한바다포워딩', nameZh: '韩海货运代理', type: 'forwarder', status: 'official', city: '인천', address: '인천 중구 서해대로 가상로 118, 7층', phone: '032-555-0181', hubs: ['YIW', 'QDG', 'WEH', 'CAN'], ports: ['ICN', 'PTK'], modes: ['LCL', 'FERRY', 'FCL'], caps: ['battery', 'liquid'], locale: 'ko', price: 1.0, onTime: 0.95, deviation: 0.006, returnRate: 0.012, weight: 13, certain: 0.9, intro: '이우·청도 집하부터 FC 입고 예약까지 한 번에 맡습니다. FC 입고 규격 재포장 전담 조가 있습니다.', website: 'https://hanbada.example', license: '국제물류주선업 제2019-인천-0412호', insurance: '적하보험 가입(건당 최대 3억 원)', uploadedLogo: true },
  { key: 'seohae', name: '서해브릿지로지스', nameZh: '西海桥物流', type: 'forwarder', status: 'official', city: '평택', address: '경기 평택시 포승읍 가상항만길 22', phone: '031-555-0122', hubs: ['QDG', 'WEH', 'YNT', 'RZH'], ports: ['PTK', 'ICN'], modes: ['LCL', 'FERRY'], caps: ['battery', 'dg', 'liquid'], locale: 'ko', price: 1.04, onTime: 0.93, deviation: 0.012, returnRate: 0.018, weight: 11, certain: 0.85, intro: '산둥 네 항구 정기 혼적. 위험물 해상 취급 등록 업체입니다.', website: 'https://seohaebridge.example', license: '국제물류주선업 제2017-평택-0077호', insurance: '적하보험 가입', uploadedLogo: true },
  { key: 'daon', name: '다온글로벌물류', nameZh: '达温环球物流', type: 'forwarder', status: 'official', city: '서울', address: '서울 강서구 가상공항로 301', phone: '02-555-0133', hubs: ['YIW', 'CAN', 'SZX'], ports: ['ICN'], modes: ['LCL', 'FCL', 'AIR'], caps: ['battery'], locale: 'ko', price: 0.9, onTime: 0.84, deviation: 0.095, returnRate: 0.041, weight: 5, certain: 0.55, intro: '남중국 전 구간 최저가 도전.', license: '국제물류주선업 제2021-서울-1180호' },
  { key: 'nuri', name: '누리로지텍', nameZh: '努里物流科技', type: 'forwarder', status: 'official', city: '인천', address: '인천 연수구 가상신항대로 57', phone: '032-555-0144', hubs: ['YIW', 'QDG'], ports: ['ICN'], modes: ['LCL', 'FERRY'], caps: ['liquid'], locale: 'ko', price: 0.98, onTime: 0.9, deviation: 0.02, returnRate: 0.022, weight: 5, certain: 0.8, related: '플랫폼 운영사 임원의 가족이 지분 20%를 보유하고 있습니다.', intro: '화장품·액체류 전문 혼적.', license: '국제물류주선업 제2020-인천-0931호', insurance: '적하보험 가입' },
  { key: 'ongil', name: '온길로지스틱스', nameZh: '温吉物流', type: 'forwarder', status: 'pending_verification', city: '부천', address: '경기 부천시 가상로 88', phone: '032-555-0155', hubs: ['YIW', 'CAN'], ports: ['ICN'], modes: ['LCL'], caps: [], locale: 'ko', price: 0.95, onTime: 0.88, deviation: 0.03, returnRate: 0.03, weight: 1, certain: 0.7 },
  { key: 'saebyeok', name: '새벽항로물류', nameZh: '晨航物流', type: 'forwarder', status: 'public_info', city: '인천', address: '인천 중구 가상부두로 12', phone: '032-555-0166', hubs: ['QDG'], ports: ['ICN'], modes: ['LCL'], caps: [], locale: 'ko', price: 1, onTime: 0.9, deviation: 0.02, returnRate: 0.02, weight: 0, certain: 0.8 },
  { key: 'garam', name: '가람해운항공', nameZh: '嘉兰海空运', type: 'forwarder', status: 'official', city: '인천', address: '인천 중구 가상공항동로 205', phone: '032-555-0177', hubs: ['QDG', 'WEH', 'YNT'], ports: ['ICN', 'PTK'], modes: ['FERRY', 'LCL', 'AIR'], caps: ['battery', 'dg'], locale: 'ko', price: 1.06, onTime: 0.96, deviation: 0.004, returnRate: 0.01, weight: 13, certain: 0.95, intro: '카페리 주 6항차 정기 선적, 입고 반려 0.8% 목표.', website: 'https://garam.example', license: '국제물류주선업 제2016-인천-0218호', insurance: '적하보험 가입(건당 최대 5억 원)', uploadedLogo: true },
  { key: 'mirinae', name: '미리내포워딩', nameZh: '银河货代', type: 'forwarder', status: 'deletion_requested', city: '안산', address: '경기 안산시 가상공단로 9', phone: '031-555-0188', hubs: ['YIW'], ports: ['PTK'], modes: ['LCL'], caps: [], locale: 'ko', price: 1, onTime: 0.9, deviation: 0.02, returnRate: 0.02, weight: 0, certain: 0.8 },
  { key: 'qinghe', name: '이우청화국제화운', nameZh: '义乌青禾国际货运', type: 'forwarder', status: 'official', city: '이우', address: '浙江省义乌市虚拟国际商贸城三区 8号', phone: '+86-579-5550-1901', hubs: ['YIW'], ports: ['ICN', 'PTK'], modes: ['LCL', 'FCL', 'FERRY'], caps: ['battery', 'liquid'], locale: 'zh', price: 0.88, onTime: 0.92, deviation: 0.015, returnRate: 0.02, weight: 8, certain: 0.8, intro: '이우 국제상무성 3구 직영 창고. 한국어 상담 가능.', license: '中国国际货运代理备案 义乌-2018-2211', insurance: '适用货运险', uploadedLogo: true },
  { key: 'lanlan', name: '청도남란공급망', nameZh: '青岛蓝澜供应链', type: 'forwarder', status: 'official', city: '청도', address: '山东省青岛市黄岛区虚拟港湾路 66号', phone: '+86-532-5550-1902', hubs: ['QDG', 'RZH'], ports: ['PTK', 'ICN'], modes: ['LCL', 'FERRY', 'FCL'], caps: ['dg', 'liquid'], locale: 'zh', price: 0.86, onTime: 0.82, deviation: 0.12, returnRate: 0.038, weight: 5, certain: 0.5, license: '中国国际货运代理备案 青岛-2020-0877' },
  { key: 'yunzhou', name: '위해운주화운', nameZh: '威海云舟货运', type: 'forwarder', status: 'official', city: '위해', address: '山东省威海市环翠区虚拟海滨路 19号', phone: '+86-631-5550-1903', hubs: ['WEH', 'YNT'], ports: ['ICN', 'PTK'], modes: ['FERRY'], caps: ['battery'], locale: 'zh', price: 0.93, onTime: 0.91, deviation: 0.018, returnRate: 0.025, weight: 4, certain: 0.8, license: '中国国际货运代理备案 威海-2019-0133' },
  { key: 'yuelan', name: '광저우월란크로스보더', nameZh: '广州粤澜跨境物流', type: 'forwarder', status: 'official', city: '광저우', address: '广东省广州市白云区虚拟物流园 A座', phone: '+86-20-5550-1904', hubs: ['CAN', 'SZX'], ports: ['ICN'], modes: ['LCL', 'AIR', 'FCL'], caps: ['battery'], locale: 'zh', price: 0.95, onTime: 0.89, deviation: 0.025, returnRate: 0.028, weight: 5, certain: 0.75, license: '中国国际货运代理备案 广州-2017-3120' },
  { key: 'huichuan', name: '선전회천속운', nameZh: '深圳汇川速运', type: 'forwarder', status: 'pending_verification', city: '선전', address: '广东省深圳市宝安区虚拟航空路 7号', phone: '+86-755-5550-1905', hubs: ['SZX', 'CAN'], ports: ['ICN'], modes: ['AIR', 'LCL'], caps: ['battery'], locale: 'zh', price: 0.97, onTime: 0.88, deviation: 0.03, returnRate: 0.03, weight: 1, certain: 0.7 },
  { key: 'jinqiao', name: '이우금교화대', nameZh: '义乌金桥货代', type: 'forwarder', status: 'public_info', city: '이우', address: '浙江省义乌市虚拟稠州北路 1200号', phone: '+86-579-5550-1906', hubs: ['YIW'], ports: ['ICN'], modes: ['LCL'], caps: [], locale: 'zh', price: 1, onTime: 0.9, deviation: 0.02, returnRate: 0.02, weight: 0, certain: 0.8 },
  { key: 'rizhao', name: '일조항만국제', nameZh: '日照港湾国际物流', type: 'forwarder', status: 'public_info', city: '일조', address: '山东省日照市东港区虚拟海港路 3号', phone: '+86-633-5550-1907', hubs: ['RZH'], ports: ['PTK'], modes: ['LCL'], caps: [], locale: 'zh', price: 1, onTime: 0.9, deviation: 0.02, returnRate: 0.02, weight: 0, certain: 0.8 },
  { key: 'koreasea', name: '코리아씨콘솔', nameZh: '韩国海拼箱', type: 'consolidator', status: 'official', city: '부산', address: '부산 중구 가상중앙대로 77', phone: '051-555-0199', hubs: ['YIW', 'QDG', 'CAN'], ports: ['ICN', 'PTK'], modes: ['LCL'], caps: [], locale: 'ko', price: 0.85, onTime: 0.87, deviation: 0.045, returnRate: 0.03, weight: 5, certain: 0.65, intro: '주 3회 고정 혼적 — 1 CBM 부터.', license: '국제물류주선업 제2015-부산-0551호' },
  { key: 'bluewave', name: '블루웨이브혼재', nameZh: '蓝波拼箱', type: 'consolidator', status: 'official', city: '인천', address: '인천 중구 가상CFS로 40', phone: '032-555-0110', hubs: ['QDG', 'WEH'], ports: ['ICN'], modes: ['LCL'], caps: ['liquid'], locale: 'ko', price: 0.97, onTime: 0.94, deviation: 0.008, returnRate: 0.015, weight: 4, certain: 0.9, license: '국제물류주선업 제2018-인천-0602호', insurance: '적하보험 가입' },
  { key: 'hailian', name: '산둥해련병상', nameZh: '山东海联拼箱', type: 'consolidator', status: 'pending_verification', city: '청도', address: '山东省青岛市市北区虚拟港口路 21号', phone: '+86-532-5550-1908', hubs: ['QDG', 'YNT', 'WEH'], ports: ['ICN', 'PTK'], modes: ['LCL'], caps: [], locale: 'zh', price: 0.9, onTime: 0.86, deviation: 0.035, returnRate: 0.03, weight: 1, certain: 0.6 },
  { key: 'haeden', name: '해든카페리서비스', nameZh: '海登客滚服务', type: 'ferry_agent', status: 'official', city: '평택', address: '경기 평택시 포승읍 가상국제여객로 5', phone: '031-555-0121', hubs: ['WEH', 'YNT', 'QDG'], ports: ['PTK', 'ICN'], modes: ['FERRY'], caps: ['battery', 'liquid'], locale: 'ko', price: 1.0, onTime: 0.93, deviation: 0.01, returnRate: 0.02, weight: 4, certain: 0.9, intro: '카페리 선복 대리. 3 CBM 이상 구간 할인.', license: '해상화물운송 대리점 등록 제2014-0031호' },
  { key: 'hwanghae', name: '황해훼리에이전시', nameZh: '黄海轮渡代理', type: 'ferry_agent', status: 'official', city: '인천', address: '인천 중구 가상제1국제여객로 2', phone: '032-555-0132', hubs: ['WEH', 'RZH'], ports: ['ICN'], modes: ['FERRY'], caps: [], locale: 'ko', price: 1.03, onTime: 0.9, deviation: 0.022, returnRate: 0.024, weight: 3, certain: 0.85, license: '해상화물운송 대리점 등록 제2012-0019호' },
  { key: 'bohai', name: '연태발해객곤대리', nameZh: '烟台渤海客滚代理', type: 'ferry_agent', status: 'public_info', city: '연태', address: '山东省烟台市芝罘区虚拟港湾大道 8号', phone: '+86-535-5550-1909', hubs: ['YNT'], ports: ['PTK'], modes: ['FERRY'], caps: [], locale: 'zh', price: 1, onTime: 0.9, deviation: 0.02, returnRate: 0.02, weight: 0, certain: 0.8 },
  { key: 'skybridge', name: '스카이브릿지에어', nameZh: '天桥空运', type: 'air_forwarder', status: 'official', city: '인천', address: '인천 중구 가상화물청사로 10', phone: '032-555-0143', hubs: ['CAN', 'SZX', 'QDG'], ports: ['ICN'], modes: ['AIR'], caps: [], locale: 'ko', price: 1.02, onTime: 0.97, deviation: 0.01, returnRate: 0.015, weight: 3, certain: 0.9, intro: '항공 D+2 입고. 소량 긴급 전용.', license: '국제물류주선업 제2019-인천-0870호' },
  { key: 'jetline', name: '제트라인항공물류', nameZh: '捷线航空物流', type: 'air_forwarder', status: 'public_info', city: '인천', address: '인천 중구 가상공항화물로 88', phone: '032-555-0154', hubs: ['SZX'], ports: ['ICN'], modes: ['AIR'], caps: [], locale: 'ko', price: 1, onTime: 0.9, deviation: 0.02, returnRate: 0.02, weight: 0, certain: 0.8 },
  { key: 'hangyeol', name: '한결관세법인', nameZh: '韩洁关税法人', type: 'customs_broker', status: 'official', city: '인천', address: '인천 중구 가상세관로 31', phone: '032-555-0165', hubs: ['YIW', 'QDG', 'WEH', 'CAN'], ports: ['ICN', 'PTK'], modes: ['LCL', 'FERRY'], caps: ['food_contact', 'cosmetics', 'kids'], locale: 'ko', price: 1, onTime: 0.95, deviation: 0.0, returnRate: 0.01, weight: 0, certain: 1, related: '플랫폼 운영사가 사무실을 임차해 쓰는 건물의 소유 법인과 대표가 같습니다.', license: '관세사 등록 제0000-가상호', insurance: '관세사 배상책임보험 가입' },
  { key: 'gaon', name: '가온관세사무소', nameZh: '嘉温报关事务所', type: 'customs_broker', status: 'official', city: '평택', address: '경기 평택시 가상세관길 14', phone: '031-555-0176', hubs: ['QDG', 'WEH', 'YNT'], ports: ['PTK'], modes: ['FERRY', 'LCL'], caps: ['food_contact', 'kids'], locale: 'ko', price: 0.95, onTime: 0.95, deviation: 0.0, returnRate: 0.01, weight: 0, certain: 1, license: '관세사 등록 제0001-가상호' },
  { key: 'bareun', name: '바른통관관세사', nameZh: '正通报关', type: 'customs_broker', status: 'public_info', city: '인천', address: '인천 남동구 가상로 250', phone: '032-555-0187', hubs: ['YIW'], ports: ['ICN'], modes: ['LCL'], caps: [], locale: 'ko', price: 1, onTime: 0.9, deviation: 0.02, returnRate: 0.02, weight: 0, certain: 1 },
  { key: 'mir', name: '미르풀필먼트', nameZh: '米尔履约中心', type: 'fulfillment_3pl', status: 'official', city: '이천', address: '경기 이천시 마장면 가상물류로 300', phone: '031-555-0198', hubs: ['YIW', 'QDG', 'WEH', 'CAN'], ports: ['ICN', 'PTK'], modes: ['LCL', 'FERRY'], caps: ['liquid', 'cosmetics'], locale: 'ko', price: 1.0, onTime: 0.96, deviation: 0.005, returnRate: 0.008, weight: 0, certain: 0.9, intro: 'FC 입고 규격 검수·재작업·회송 대행. 이천·덕평 FC 당일 입고.', license: '창고업 등록 제2020-이천-0044호' },
  { key: 'ieum', name: '이음물류센터', nameZh: '连接物流中心', type: 'fulfillment_3pl', status: 'pending_verification', city: '평택', address: '경기 평택시 청북읍 가상창고길 71', phone: '031-555-0109', hubs: ['QDG', 'WEH'], ports: ['PTK'], modes: ['FERRY', 'LCL'], caps: [], locale: 'ko', price: 0.97, onTime: 0.9, deviation: 0.02, returnRate: 0.02, weight: 0, certain: 0.8 },
  { key: 'pumasi', name: '품앗이물류센터', nameZh: '互助物流中心', type: 'fulfillment_3pl', status: 'deletion_requested', city: '김포', address: '경기 김포시 가상산단로 5', phone: '031-555-0120', hubs: ['YIW'], ports: ['ICN'], modes: ['LCL'], caps: [], locale: 'ko', price: 1, onTime: 0.9, deviation: 0.02, returnRate: 0.02, weight: 0, certain: 0.8 },
  { key: 'dodam', name: '도담3PL', nameZh: '都潭第三方物流', type: 'fulfillment_3pl', status: 'public_info', city: '인천', address: '인천 서구 가상북항로 44', phone: '032-555-0131', hubs: ['YIW'], ports: ['ICN'], modes: ['LCL'], caps: [], locale: 'ko', price: 1, onTime: 0.9, deviation: 0.02, returnRate: 0.02, weight: 0, certain: 0.8 },
];

export interface ShipperDef {
  key: string;
  name: string;
  category: string;
  presets: string[];
  hubs: string[];
  weight: number;
}

export const SHIPPERS: ShipperDef[] = [
  { key: 'livingmoa', name: '리빙모아', category: '생활용품', presets: ['general', 'food', 'oversize'], hubs: ['YIW', 'QDG'], weight: 6 },
  { key: 'haru', name: '하루살림', category: '주방용품', presets: ['food', 'general'], hubs: ['YIW', 'CAN'], weight: 4 },
  { key: 'sorigongbang', name: '소리공방', category: '음향기기', presets: ['audio', 'battery'], hubs: ['SZX', 'CAN'], weight: 3 },
  { key: 'kidson', name: '키즈온', category: '완구', presets: ['kids', 'general'], hubs: ['YIW', 'QDG'], weight: 3 },
  { key: 'beautylab', name: '뷰티랩', category: '화장품', presets: ['liquid', 'general'], hubs: ['QDG', 'WEH'], weight: 3 },
  { key: 'campieum', name: '캠핑이음', category: '캠핑용품', presets: ['gas', 'oversize', 'general'], hubs: ['QDG', 'RZH'], weight: 3 },
  { key: 'modernhome', name: '모던홈가구', category: '가구', presets: ['oversize'], hubs: ['CAN', 'YIW'], weight: 2 },
  { key: 'petmaru', name: '펫마루', category: '반려용품', presets: ['general', 'food'], hubs: ['YIW', 'WEH'], weight: 3 },
  { key: 'dailyfit', name: '데일리핏', category: '운동용품', presets: ['general', 'battery'], hubs: ['YIW', 'YNT'], weight: 2 },
  { key: 'mono', name: '문구상점 모노', category: '문구', presets: ['general', 'kids'], hubs: ['YIW'], weight: 2 },
  { key: 'lightway', name: '라이트웨이', category: '조명', presets: ['battery', 'general'], hubs: ['SZX', 'CAN'], weight: 2 },
  { key: 'onsoom', name: '온숨', category: '가전 소품', presets: ['battery', 'audio'], hubs: ['CAN', 'QDG'], weight: 2 },
];

export interface PresetDef {
  key: string;
  label: string;
  items: string[];
  units: [number, number];
  unitKg: number;
  unitCbm: number;
  perCarton: number;
  unitRmb: [number, number];
  traits: string[];
  hs: string;
  price: [number, number];
}

/** 상품 프리셋 8종 */
export const PRESETS: PresetDef[] = [
  { key: 'general', label: '일반', items: ['실리콘 서랍 정리함', '접이식 빨래 바구니', '욕실 흡착 선반', '다용도 수납 박스', '미니 휴지통'], units: [800, 3000], unitKg: 0.32, unitCbm: 0.0018, perCarton: 40, unitRmb: [4, 14], traits: [], hs: 'general', price: [8900, 19900] },
  { key: 'battery', label: '배터리+전파+KC', items: ['충전식 미니 선풍기', '무선 LED 무드등', '충전식 손난로', '무선 전동 칫솔'], units: [500, 2000], unitKg: 0.42, unitCbm: 0.0022, perCarton: 30, unitRmb: [18, 42], traits: ['battery', 'radio', 'kc'], hs: 'electronics', price: [19900, 39900] },
  { key: 'food', label: '식품접촉', items: ['실리콘 조리도구 세트', '스테인리스 밀폐용기', '유리 보관병 3종', '대나무 도마'], units: [600, 2400], unitKg: 0.55, unitCbm: 0.0025, perCarton: 24, unitRmb: [9, 28], traits: ['food_contact'], hs: 'kitchen', price: [12900, 29900] },
  { key: 'audio', label: '음향기기', items: ['블루투스 스피커', '유선 이어폰', '무선 헤드셋', '사운드바 미니'], units: [300, 1200], unitKg: 0.6, unitCbm: 0.003, perCarton: 20, unitRmb: [35, 90], traits: ['radio', 'kc'], hs: 'audio', price: [29900, 69900] },
  { key: 'liquid', label: '액체 화장품', items: ['약산성 토너 150ml', '수분 앰플 30ml', '바디 미스트 200ml', '클렌징 오일 150ml'], units: [1000, 4000], unitKg: 0.24, unitCbm: 0.0006, perCarton: 60, unitRmb: [6, 18], traits: ['liquid', 'cosmetics'], hs: 'cosmetics', price: [9900, 24900] },
  { key: 'gas', label: '가스 위험물', items: ['휴대용 가스 토치', '캠핑 가스 랜턴', '미니 부탄 버너'], units: [200, 800], unitKg: 0.9, unitCbm: 0.004, perCarton: 12, unitRmb: [22, 55], traits: ['dg'], hs: 'chemical', price: [19900, 44900] },
  { key: 'kids', label: '어린이제품', items: ['원목 블록 50p', '말랑 촉감 공', '유아 목욕 장난감', '자석 그림판'], units: [500, 2000], unitKg: 0.38, unitCbm: 0.0028, perCarton: 24, unitRmb: [8, 26], traits: ['kids'], hs: 'toys', price: [12900, 32900] },
  { key: 'oversize', label: '대부피', items: ['접이식 수납 선반 4단', '캠핑 폴딩 테이블', '원목 신발장', '대형 빨래 건조대'], units: [100, 400], unitKg: 6.5, unitCbm: 0.045, perCarton: 1, unitRmb: [45, 140], traits: [], hs: 'furniture', price: [39900, 99900] },
];

export const PEOPLE_KO = ['김서윤', '이도현', '박지아', '최민준', '정하은', '강태윤', '조수아', '윤지호', '장예린', '임건우', '한소율', '오시우', '서유나', '신재원', '권다인', '황민서', '안주원', '송하람', '홍채원', '문지후', '배은호', '유나연', '전서진', '고은채'];
export const PEOPLE_ZH = ['王晓晨', '李明哲', '陈雨桐', '张浩然', '刘思远', '赵嘉怡', '孙一凡', '周梦琪'];
