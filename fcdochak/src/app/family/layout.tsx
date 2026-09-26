import Link from 'next/link';
import { BrandMark } from '@/components/brand-mark';
import { Chip } from '@/components/ui/core';
import { BRAND } from '@/lib/brand';

/**
 * 패밀리 사이트 틀 — FC도착의 남색 머리 대신 종이색 머리 + 청록 띠(역할 토큰 --surface·--ok 안에서 「다른 방」).
 * 이름·도메인은 가칭(사람이 정한다, docs/sourcing-plan.md 2절). 계정은 FC도착과 같다.
 */
export default function FamilyLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <header className="sticky top-[var(--banner-h)] z-40 border-b border-line bg-surface">
        <div className="h-1 bg-ok" aria-hidden />
        <div className="mx-auto flex min-h-14 max-w-[1280px] flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2">
          <Link href="/family/sourcing" className="flex min-w-0 items-center gap-2 rounded-sm">
            <BrandMark compact />
            <span className="display text-[18px] leading-none text-text">{BRAND.name} 패밀리 · 소싱</span>
            <Chip tone="neutral">가칭</Chip>
          </Link>
          <div className="flex-1" />
          <nav aria-label="패밀리 메뉴">
            <ul className="flex flex-wrap items-center gap-1 text-sm font-semibold">
              <li>
                <Link href="/app/sourcing" className="rounded-sm px-3 py-2 hover:bg-surface-2">화주 코너</Link>
              </li>
              <li>
                <Link href="/" className="rounded-sm px-3 py-2 text-muted hover:bg-surface-2 hover:text-text">{BRAND.name}으로 돌아가기</Link>
              </li>
            </ul>
          </nav>
        </div>
      </header>
      <main id="main" className="min-h-[60vh] bg-paper">{children}</main>
      <footer className="border-t border-line bg-surface">
        <div className="mx-auto max-w-[1280px] px-4 py-6 text-xs leading-5 text-muted">
          <p>
            {BRAND.name} 패밀리 · 소싱(가칭)은 {BRAND.name}과 같은 계정·같은 9구간 원가 엔진을 씁니다. 지금은 미리보기이며, 후보 소개·조건 정리·도착원가 계산까지만
            돕습니다. 발주·대금·품질·인증 취득은 셀러와 공급처가 직접 합니다.
          </p>
          <p className="mt-1">
            <Link href="/policy" className="underline underline-offset-4">규정</Link> · <Link href="/" className="underline underline-offset-4">{BRAND.name}</Link>
          </p>
        </div>
      </footer>
    </>
  );
}
