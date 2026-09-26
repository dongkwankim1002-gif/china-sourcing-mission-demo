import Link from 'next/link';
import { BrandMark } from '@/components/brand-mark';
import { DemoBand } from '@/components/public/header';
import { Chip } from '@/components/ui/core';
import { BRAND } from '@/lib/brand';
import { getViewer } from '@/lib/server/viewer';
import { ONESTOP_ACTION } from '@/lib/terms';

export const dynamic = 'force-dynamic';

/**
 * 원스톱 구역 틀 — v2 의 공개 머리·메뉴·바닥과 따로(두 가설을 섞지 않는다, docs/onestop-plan.md 3절).
 * 남색 머리 대신 종이색 머리 + 라벨 노랑 띠 · 머리에 늘 「원스톱 · 미리보기」. 메뉴는 셋만: 맡기기 · 요금표 · 내 주문.
 */
export default async function OnestopLayout({ children }: { children: React.ReactNode }) {
  const v = await getViewer();
  const shipper = v?.orgs.some((o) => o.kind === 'shipper') ?? false;
  const link = 'inline-flex min-h-10 items-center rounded-sm px-3 text-sm font-semibold hover:bg-surface-2';
  return (
    <>
      <DemoBand />
      <header className="sticky top-[var(--banner-h)] z-40 border-b border-line bg-surface">
        <div className="h-1 bg-label" aria-hidden />
        <div className="mx-auto flex max-w-[1080px] flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2">
          <Link href="/onestop" className="flex min-w-0 items-center gap-2 rounded-sm">
            <BrandMark compact />
            <span className="display text-[18px] leading-none text-text">원스톱</span>
          </Link>
          <Chip tone="caution" className="shrink-0">
            원스톱 · 미리보기
          </Chip>
          <div className="flex-1" />
          <nav aria-label="원스톱 메뉴" className="w-full sm:w-auto">
            <ul className="-mx-3 flex flex-wrap items-center sm:mx-0">
              <li>
                <Link href="/onestop" className={link}>
                  {ONESTOP_ACTION.entrust}
                </Link>
              </li>
              <li>
                <Link href="/onestop/price" className={link}>
                  요금표
                </Link>
              </li>
              <li>
                {shipper ? (
                  <Link href="/onestop/orders" className={link}>
                    내 주문
                  </Link>
                ) : (
                  <Link href="/login?next=/onestop/orders" className={link}>
                    로그인
                  </Link>
                )}
              </li>
            </ul>
          </nav>
        </div>
      </header>
      <main id="main" className="min-h-[60vh] bg-paper">
        <div className="mx-auto max-w-[1080px] px-4 py-6 sm:py-8">{children}</div>
      </main>
      <footer className="border-t border-line bg-surface">
        <div className="mx-auto max-w-[1080px] px-4 py-6 text-xs leading-5 text-muted">
          <p>
            원스톱은 {BRAND.name} v2 안에서 시험하는 대행형 판입니다(미리보기). 지금은 접수 기록만 남기고 대행 계약·결제·사입·발송을 하지 않습니다. 요금은 가정치이고, 관세·부가세는 실비입니다.
            수입자는 셀러 본인입니다.
          </p>
          <p className="mt-1">
            <Link href="/" className="underline underline-offset-4">
              {BRAND.name}으로 돌아가기
            </Link>{' '}
            · <Link href="/policy" className="underline underline-offset-4">규정</Link>
          </p>
        </div>
      </footer>
    </>
  );
}
