import Link from 'next/link';
import { BrandMark } from '@/components/brand-mark';
import { env } from '@/lib/env';
import { AccountSlot, MobileNav } from './header-client';

export const PUBLIC_NAV: { href: string; label: string; lgOnly?: boolean }[] = [
  { href: '/check', label: '청구서 점검' },
  { href: '/lanes', label: '구간 시세' },
  { href: '/partners', label: '업체 찾기' },
  // 768 폭에서는 머리 줄이 넘쳐 lg 부터 보인다(바닥글·홈 도구 띠에는 늘 있다)
  { href: '/tools/pnl', label: '판매손익 계산', lgOnly: true },
  { href: '/faq', label: '자주 묻는 질문' },
  { href: '/join/partner', label: '입점 안내' },
  // v2 3차 sourcing — 패밀리 사이트(소싱처 찾기, 미리보기). 머리 줄은 lg 부터(바닥글·모바일 메뉴에는 늘 있다)
  { href: '/family/sourcing', label: '패밀리 사이트', lgOnly: true },
  // v2 4차 onestop — 원스톱 대행형 구역(미리보기). 머리 줄은 lg 부터(바닥글·모바일 메뉴에는 늘 있다)
  { href: '/onestop', label: '원스톱', lgOnly: true },
];

export function DemoBand() {
  if (!env.demoMode) return null;
  return (
    <div className="flex min-h-7 items-center justify-center gap-2 bg-label px-3 py-1 text-center text-xs font-bold text-on-label">
      <span className="rounded-[2px] bg-ink px-1.5 text-2xs text-label">예시 데이터</span>
      <span>업체·요금·후기는 모두 가상의 예시입니다.<span className="hidden sm:inline"> 실제 서비스 시작 전에 걷어냅니다.</span></span>
    </div>
  );
}

export function PublicHeader() {
  return (
    <>
      <DemoBand />
      <header className="sticky top-[var(--banner-h)] z-40 bg-ink text-on-ink">
        <div className="mx-auto flex h-14 max-w-[1280px] items-center gap-4 px-4">
          <Link href="/" className="shrink-0 rounded-sm">
            <BrandMark />
          </Link>
          <nav aria-label="공개 메뉴" className="hidden md:block">
            <ul className="flex items-center gap-1">
              {PUBLIC_NAV.map((n) => (
                <li key={n.href} className={n.lgOnly ? 'hidden lg:block' : undefined}>
                  <Link href={n.href} className="rounded-sm px-3 py-2 text-sm font-semibold text-on-ink-muted hover:bg-white/10 hover:text-on-ink">
                    {n.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
          <div className="flex-1" />
          <AccountSlot demo={env.demoMode} />
          <MobileNav items={PUBLIC_NAV} demo={env.demoMode} />
        </div>
      </header>
    </>
  );
}
