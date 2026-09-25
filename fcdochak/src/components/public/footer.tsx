import Link from 'next/link';
import { BrandMark } from '@/components/brand-mark';
import { BRAND } from '@/lib/brand';

export function PublicFooter() {
  const c = BRAND.company;
  const pending = '준비 중';
  return (
    <footer className="mt-16 border-t border-line bg-ink text-on-ink-muted">
      <div className="mx-auto grid max-w-[1280px] gap-8 px-4 py-10 md:grid-cols-[1.3fr_1fr_1fr_1fr]">
        <div>
          <BrandMark />
          <p className="mt-3 max-w-sm text-sm leading-6">{BRAND.tagline}.</p>
          <p className="mt-4 max-w-sm text-xs leading-5">
            {BRAND.name}은 통신판매중개자이며 운송·통관 거래의 당사자가 아닙니다. 운송계약은 화주와 물류사가, 통관 위임은 화주와 관세사가
            직접 맺습니다. 플랫폼은 대금을 받지 않습니다.
          </p>
        </div>
        <nav aria-label="서비스">
          <h2 className="text-xs font-bold text-on-ink">서비스</h2>
          <ul className="mt-3 space-y-2 text-sm">
            <li><Link className="hover:text-on-ink" href="/lanes">구간 시세</Link></li>
            <li><Link className="hover:text-on-ink" href="/partners">업체 찾기</Link></li>
            <li><Link className="hover:text-on-ink" href="/join/shipper">화주로 시작하기</Link></li>
            <li><Link className="hover:text-on-ink" href="/join/partner">물류사 입점 신청</Link></li>
          </ul>
        </nav>
        <nav aria-label="규정">
          <h2 className="text-xs font-bold text-on-ink">규정</h2>
          <ul className="mt-3 space-y-2 text-sm">
            <li><Link className="hover:text-on-ink" href="/policy#terms">이용약관</Link></li>
            <li><Link className="hover:text-on-ink" href="/policy#privacy">개인정보 처리방침</Link></li>
            <li><Link className="hover:text-on-ink" href="/policy#listing">게시 기준·삭제 요청</Link></li>
            <li><Link className="hover:text-on-ink" href="/policy#fees">수수료 기준</Link></li>
            <li><Link className="hover:text-on-ink" href="/faq">자주 묻는 질문</Link></li>
          </ul>
        </nav>
        <div>
          <h2 className="text-xs font-bold text-on-ink">문의</h2>
          <p className="mt-3 text-sm">
            <a className="hover:text-on-ink" href={`mailto:${c.email}`}>{c.email}</a>
          </p>
          <p className="mt-1 text-xs">평일 10:00–18:00 (한국 시간)</p>
        </div>
      </div>
      <div className="border-t border-white/10">
        <div className="mx-auto max-w-[1280px] px-4 py-5 text-2xs leading-5">
          <p>
            상호 {c.legalName ?? pending} · 대표 {c.ceo ?? pending} · 사업자등록번호 {c.bizRegNo ?? pending} · 통신판매업 신고 {c.mailOrderNo ?? pending} ·
            주소 {c.address ?? pending}
          </p>
          <p className="mt-1">
            관세·부가세 금액은 참고 추정이며 실제 세액은 수입신고 때 세관이 정합니다. 요금은 각 업체가 제공한 값이며 제공일·유효기간을 함께 적습니다.
          </p>
          <p className="mt-1">© {new Date().getFullYear()} {BRAND.name}</p>
        </div>
      </div>
    </footer>
  );
}
