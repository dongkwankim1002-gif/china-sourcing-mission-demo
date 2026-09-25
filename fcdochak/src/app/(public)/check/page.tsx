import type { Metadata } from 'next';
import { ClipboardCheck, SearchX, TriangleAlert } from 'lucide-react';
import { InvoiceChecker } from '@/components/check/checker';
import { getReference } from '@/lib/server/reference';
import { CHECK_ACTION } from '@/lib/terms';

export const revalidate = 3600;

export const metadata: Metadata = {
  title: '청구서 점검',
  description: '받은 중국→쿠팡 FC 물류 견적서·청구서를 9구간으로 나눠 구간 시세(중간값·싼 쪽 25%·최저)와 견줍니다. 빠진 구간과 과한 구간을 짚습니다. 로그인 없이 됩니다.',
  alternates: { canonical: '/check' },
};

export default async function CheckPage() {
  const ref = await getReference();
  return (
    <>
      <section className="bg-ink text-on-ink">
        <div className="mx-auto max-w-[1100px] px-4 pb-10 pt-8 md:pt-12">
          <p className="text-xs font-bold text-on-ink-muted">{CHECK_ACTION.list} · 로그인 없이</p>
          <h1 className="display mt-2 max-w-3xl text-[clamp(28px,4.4vw,46px)] leading-[1.1]">
            받은 견적서·청구서, <span className="text-label">시세와 견줘</span> 봅니다
          </h1>
          <p className="mt-3 max-w-2xl text-md text-on-ink-muted">
            업체마다 다른 항목 이름을 9구간으로 가르고, 같은 화물로 계산한 이 구간 요금표들의 중간값과 비교합니다.
          </p>
          <ul className="mt-6 grid gap-3 text-sm sm:grid-cols-3">
            <li className="flex items-start gap-2">
              <TriangleAlert className="mt-0.5 size-4 shrink-0 text-label" aria-hidden />
              <span><b className="text-on-ink">과한 구간</b> — 중간값보다 한참 높고 비싼 쪽 25%도 넘는 칸</span>
            </li>
            <li className="flex items-start gap-2">
              <SearchX className="mt-0.5 size-4 shrink-0 text-label" aria-hidden />
              <span><b className="text-on-ink">빠진 구간</b> — 대부분 업체가 맡는데 청구서에 없는 칸(나중에 따로 청구될 위험)</span>
            </li>
            <li className="flex items-start gap-2">
              <ClipboardCheck className="mt-0.5 size-4 shrink-0 text-label" aria-hidden />
              <span><b className="text-on-ink">참고치로 채운 곳</b> — 요금표가 모자란 칸은 플랫폼 참고치로 견줍니다</span>
            </li>
          </ul>
        </div>
      </section>
      <div className="mx-auto max-w-[1100px] px-4 py-8">
        <InvoiceChecker hubs={ref.hubs} ports={ref.ports} />
      </div>
    </>
  );
}
