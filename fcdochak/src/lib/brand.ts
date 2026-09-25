/**
 * 브랜드 — 서비스 정식 이름·도메인·운영 법인이 아직 미정이다. 여기 한 곳만 바꾸면 된다.
 * 색은 src/app/globals.css 의 :root 토큰, 로고는 components/brand-mark.tsx.
 */
export const BRAND = {
  name: 'FC도착',
  nameEn: 'FC Dochak',
  tagline: '중국 공장에서 쿠팡 FC까지, 같은 조건으로 비교합니다',
  description:
    '중국 → 쿠팡 FC 물류비를 9구간(집하·창고·수출통관·국제운송·항만·관세사·국내 창고·FC 운송·회송 대비)으로 나눠 업체별로 같은 조건에서 비교하는 물류 조달 오픈마켓.',
  /** 운영 법인 — 미정. 정해지면 채운다. 비어 있으면 푸터에 「준비 중」 */
  company: {
    legalName: null as string | null,
    ceo: null as string | null,
    bizRegNo: null as string | null,
    mailOrderNo: null as string | null,
    address: null as string | null,
    email: 'hello@fcdochak.example',
    phone: null as string | null,
  },
  /** 브랜드 글자 마크의 두 글자 */
  markText: 'FC',
};
