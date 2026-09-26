import type { Metadata } from 'next';
import Link from 'next/link';
import { BellRing, CalendarClock, ShieldCheck } from 'lucide-react';
import { TrackLookup } from '@/components/tracker/lookup';
import { todayKst } from '@/lib/db';
import { env } from '@/lib/env';
import { TRACK_ACTION } from '@/lib/terms';

export const metadata: Metadata = {
  title: '통관 조회',
  description: 'B/L·화물관리번호로 수입 통관 단계(입항·반입·수입신고·수리·반출)와 예상 통관일·예상 쿠팡 FC 입고일을 봅니다. 관세청 공공 자료 기준. 로그인 없이 됩니다.',
  alternates: { canonical: '/track' },
};

export default async function TrackPage({ searchParams }: { searchParams: Promise<{ kind?: string; no?: string; year?: string }> }) {
  const sp = await searchParams;
  const thisYear = Number(todayKst().slice(0, 4));
  return (
    <>
      <section className="bg-ink text-on-ink">
        <div className="mx-auto max-w-[1100px] px-4 pb-10 pt-8 md:pt-12">
          <p className="text-xs font-bold text-on-ink-muted">{TRACK_ACTION.lookup} · 로그인 없이 · LCL·FCL·항공 일반 수입</p>
          <h1 className="display mt-2 max-w-3xl text-[clamp(28px,4.4vw,46px)] leading-[1.1]">
            지금 어디 있고, <span className="text-label">언제 FC</span>에 들어가나
          </h1>
          <p className="mt-3 max-w-2xl text-md text-on-ink-muted">
            B/L 번호 하나로 관세청 통관 단계를 보고, 같은 항구·같은 방식으로 실제 걸린 날에서 셈한 예상일을 「보통 · 늦으면」으로 드립니다.
          </p>
          <ul className="mt-6 grid gap-3 text-sm sm:grid-cols-3">
            <li className="flex items-start gap-2">
              <CalendarClock className="mt-0.5 size-4 shrink-0 text-label" aria-hidden />
              <span><b className="text-on-ink">예상 통관일 · FC 입고일</b> — 실측 중앙값과 90% 지점, 한국 영업일 기준</span>
            </li>
            <li className="flex items-start gap-2">
              <BellRing className="mt-0.5 size-4 shrink-0 text-label" aria-hidden />
              <span><b className="text-on-ink">알림</b> — 화주로 저장하면 입항·수리·반출 때 알림 센터에</span>
            </li>
            <li className="flex items-start gap-2">
              <ShieldCheck className="mt-0.5 size-4 shrink-0 text-label" aria-hidden />
              <span><b className="text-on-ink">저장하지 않음</b> — 로그인 없이 본 번호는 남기지 않습니다. 개인통관고유부호는 받지 않습니다</span>
            </li>
          </ul>
        </div>
      </section>
      <div className="mx-auto grid max-w-[1100px] gap-6 px-4 py-8">
        <TrackLookup thisYear={thisYear} initial={{ kind: sp.kind, number: sp.no, year: sp.year }} />
        <p className="text-xs text-muted">
          자료: 관세청 UNI-PASS 화물통관진행정보{env.unipassEnabled ? '' : '(연결 준비 중 — 지금은 예시 자료)'} · 예상일은 참고치이며 약속이 아닙니다 ·{' '}
          <Link href="/track/stats" className="font-semibold text-text underline underline-offset-4">{TRACK_ACTION.stats}</Link>
        </p>
      </div>
    </>
  );
}
