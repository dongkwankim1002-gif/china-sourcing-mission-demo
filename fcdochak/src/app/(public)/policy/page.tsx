import type { Metadata } from 'next';
import { BRAND } from '@/lib/brand';

export const metadata: Metadata = {
  title: '규정 — 이용약관·개인정보·게시 기준·수수료 기준',
  description: `${BRAND.name}의 거래 구조(통신판매중개), 게시 기준과 삭제 요청, 성사 수수료 기준.`,
  alternates: { canonical: '/policy' },
};

const S = ({ id, title, children }: { id: string; title: string; children: React.ReactNode }) => (
  <section id={id} aria-labelledby={`${id}-h`} className="scroll-mt-20 border-t border-line pt-8">
    <h2 id={`${id}-h`} className="text-lg font-bold">{title}</h2>
    <div className="mt-3 space-y-3 text-sm leading-7 text-text [&_li]:ml-5 [&_li]:list-disc">{children}</div>
  </section>
);

export default function PolicyPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="display text-[clamp(28px,4vw,44px)]">규정</h1>
      <p className="mt-2 text-sm text-muted">정식 법인·약관 전문은 서비스 시작 전에 확정해 이 자리에 싣습니다. 아래는 지금 서비스가 지키는 원칙입니다.</p>
      <nav aria-label="목차" className="mt-6 flex flex-wrap gap-2 text-sm">
        {[['terms', '이용약관'], ['privacy', '개인정보'], ['listing', '게시 기준·삭제 요청'], ['fees', '수수료 기준'], ['ranking', '추천 순서']].map(([id, t]) => (
          <a key={id} href={`#${id}`} className="rounded-xs border border-line bg-surface px-3 py-1.5 font-semibold hover:border-muted/60">{t}</a>
        ))}
      </nav>
      <div className="mt-8 grid gap-8">
        <S id="terms" title="이용약관 — 거래 구조">
          <p>{BRAND.name}은 전자상거래법상 <b>통신판매중개자</b>이며 운송·통관 거래의 당사자가 아닙니다.</p>
          <ul>
            <li>운송계약은 화주와 물류사가 직접 맺습니다. 통관(수입신고) 위임은 화주와 관세사가 직접 맺습니다.</li>
            <li>1차 서비스에서 플랫폼은 물류 대금·관세·부가세를 받거나 대신 내지 않습니다.</li>
            <li>관세·부가세 금액은 <b>참고 추정</b>입니다. 판매용 수입은 목록통관 대상이 아니며 일반 수입신고 기준으로 계산합니다.</li>
          </ul>
        </S>
        <S id="privacy" title="개인정보">
          <ul>
            <li>가입할 때 받는 것: 이름, 이메일, 회사명, 사업자등록번호(선택), 연락처(선택).</li>
            <li>알림은 화면 안 알림 센터가 기본입니다. 메일·문자·카카오 알림은 본인이 켠 종류만, 서비스 발송 스위치가 켜진 뒤에 보냅니다.</li>
            <li>공개정보 기준 업체 페이지에는 담당자 개인 연락처를 싣지 않습니다.</li>
          </ul>
        </S>
        <S id="listing" title="게시 기준과 삭제 요청">
          <ul>
            <li><b>공식 등록</b>: 업체가 직접 인증하고 요금표를 올린 경우. 요금표·실측 점수를 싣습니다.</li>
            <li><b>공개정보 기준</b>: 공개된 회사명·주소·대표 연락처·노선만, 출처와 확인일을 함께 싣습니다. 가격·소개문 원문·사진·담당자 개인 연락처는 싣지 않습니다.</li>
            <li>가격을 반복해서 모으는 수집 도구를 만들지 않습니다. 업체 가격은 업체가 제공한 것만 씁니다.</li>
            <li>업체 페이지의 「게시 삭제 요청」을 받으면 즉시 공개 목록에서 가리고, 확인 뒤 지웁니다.</li>
            <li>모든 가격에 제공 업체·제공일·유효기간·포함/제외 구간·확정/예상/추가비용 가능 여부를 함께 적습니다. 만료된 요금표는 비교에서 자동으로 빠집니다.</li>
          </ul>
        </S>
        <S id="fees" title="수수료 기준">
          <p>성사 수수료 기준 = <b>물류비 합계 − 관세사 보수</b>. 관세·부가세는 물류비가 아니므로 들어가지 않습니다.</p>
          <p>관세사 보수를 빼는 이유: 관세사법 제3조 제2·3항에 따라 관세사가 아닌 자가 통관 대리의 대가를 나눠 받는 구조를 만들지 않습니다. 플랫폼은 관세사에게서 어떤 대가도 받지 않습니다.</p>
          <p>요율은 운영 설정 값이며, 바뀌면 새 판으로 쌓아 기록을 남깁니다.</p>
        </S>
        <S id="ranking" title="추천 순서">
          <p>추천 점수 = 정시 입고 30 · 청구 편차 25 · FC 회송률 25 · 가격확정도 20. 모두 선적·청구 기록에서 계산합니다.</p>
          <ul>
            <li>광고와 특수관계는 점수에 들어가지 않습니다.</li>
            <li>광고는 「광고」 표시와 함께 목록 맨 위 한 자리에만 나옵니다.</li>
            <li>특수관계가 있는 업체는 카드·상세에 「특수관계 공개」를 붙입니다.</li>
            <li>「FC 입고 준비 인증」은 쿠팡의 공식 인증이 아니며, 기준(FC 입고 60건 이상·30일 회송률 3.5% 이하)은 운영 설정 값입니다.</li>
          </ul>
        </S>
      </div>
    </div>
  );
}
