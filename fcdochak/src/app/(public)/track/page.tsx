import type { Metadata } from 'next';
import Link from 'next/link';
import { BarChart3, BellRing, ShieldCheck, Truck } from 'lucide-react';
import { TrackLookup } from '@/components/tracker/lookup';
import { asPublic, todayKst } from '@/lib/db';
import { env } from '@/lib/env';
import { SCORECARD_ACTION, TRACK_ACTION } from '@/lib/terms';
import { publicSnaps } from '@/lib/server/scorecard';
import { daysLine } from '@/lib/scorecard/engine';
import { Button } from '@/components/ui/core';
import { pct } from '@/lib/format';

/**
 * v2 6차 scorecard — 공개 /track 은 단독 조회 목적지가 아니다(동관 김: 단순한 통관 조회 화면은 의미가 없다).
 * 「내 화물 등록 → 물류사 성적표에 보탬」 창구로 쓴다: 성적표 안내 + 내 화물 등록(로그인 화주 /app/tracking) + 물류사 제출.
 * 번호 한 번 보기(저장 안 함)는 아래에 작게 남긴다.
 */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: '내 화물 등록 — 물류사 성적표에 보태기',
  description: 'B/L 을 등록하면 통관 단계 알림을 받고, 그 화물의 관세청 단계 기록이 물류사·관세사 성적표(입항 → 수리 실측)에 보태집니다. 개인통관고유부호는 받지 않습니다.',
  alternates: { canonical: '/track' },
};

export default async function TrackPage({ searchParams }: { searchParams: Promise<{ kind?: string; no?: string; year?: string }> }) {
  const sp = await searchParams;
  const thisYear = Number(todayKst().slice(0, 4));
  const snaps = await asPublic(publicSnaps).catch(() => []);
  const all = snaps.find((s) => s.entity_kind === 'overall' && s.port == null && s.mode == null && s.metrics.clear) ?? null;
  const d = all?.metrics.clear ? daysLine(all.metrics.clear) : null;
  const lookupOpen = !!sp.no;
  return (
    <>
      <section className="bg-ink text-on-ink">
        <div className="mx-auto max-w-[1100px] px-4 pb-10 pt-8 md:pt-12">
          <p className="text-xs font-bold text-on-ink-muted">{SCORECARD_ACTION.title} · 관세청 실측 · LCL·FCL·카페리·항공 일반 수입</p>
          <h1 className="display mt-2 max-w-3xl break-keep text-[clamp(28px,4.4vw,46px)] leading-[1.1]">
            내 화물번호 하나가 <span className="text-label">물류사 성적표</span>가 됩니다
          </h1>
          <p className="mt-3 max-w-2xl text-md text-on-ink-muted">
            관세청은 업체별 통관 통계를 공개하지 않습니다. 셀러가 등록하고 물류사가 제출한 B/L 의 관세청 단계 기록을 모아, 어느 포워더·관세사가 실제로 빨리·안정적으로 통관하는지 셉니다.
          </p>
          <div className="mt-6 flex flex-wrap gap-2">
            <Button asChild variant="primary">
              <Link href={`/login?next=${encodeURIComponent('/app/tracking')}`}>{SCORECARD_ACTION.register}</Link>
            </Button>
            <Button asChild variant="onInk">
              <Link href="/partners?sort=fast">{SCORECARD_ACTION.title} 보기</Link>
            </Button>
            <Button asChild variant="onInk">
              <Link href="/market/customs">{SCORECARD_ACTION.market}</Link>
            </Button>
          </div>
          <ul className="mt-6 grid gap-3 text-sm sm:grid-cols-3">
            <li className="flex items-start gap-2">
              <BarChart3 className="mt-0.5 size-4 shrink-0 text-label" aria-hidden />
              <span><b className="text-on-ink">성적표에 보탬</b> — 입항 → 수리 · 검사 비율 · 반입 → 반출 · 반출 → FC 입고 실측(같은 화물은 한 번)</span>
            </li>
            <li className="flex items-start gap-2">
              <BellRing className="mt-0.5 size-4 shrink-0 text-label" aria-hidden />
              <span><b className="text-on-ink">내 화물 알림</b> — 등록하면 입항·수리·반출 때 알림 센터에, 예상 통관일·FC 입고일도</span>
            </li>
            <li className="flex items-start gap-2">
              <ShieldCheck className="mt-0.5 size-4 shrink-0 text-label" aria-hidden />
              <span><b className="text-on-ink">개인정보 없음</b> — 번호와 관세청 단계만 셉니다. 개인통관고유부호는 받지 않습니다</span>
            </li>
          </ul>
        </div>
      </section>
      <div className="mx-auto grid max-w-[1100px] gap-6 px-4 py-8">
        <div className="grid gap-3 md:grid-cols-3" data-testid="track-scorecard-guide">
          <div className="rounded-md border border-line bg-surface p-4">
            <p className="text-xs font-semibold text-muted">지금 모인 실측(모든 항구·방식)</p>
            {all && d ? (
              <>
                <p className="display mt-1 text-2xl tnum">보통 {d.usual}일 · 늦으면 {d.late}일</p>
                <p className="text-2xs text-muted tnum">입항 → 수리 · 표본 {all.n} · 검사 {pct(all.metrics.inspectRate, 0)} · 최근 {all.window_days}일{all.is_example ? ' · 예시 자료' : ''}</p>
              </>
            ) : (
              <p className="mt-1 text-sm text-muted">아직 보여 드릴 만큼 모이지 않았습니다 — 첫 번호를 보태 주세요.</p>
            )}
          </div>
          <div className="rounded-md border border-line bg-surface p-4">
            <p className="text-xs font-semibold text-muted">셀러라면</p>
            <p className="mt-1 text-sm">B/L 을 등록하고 물류사·관세사를 고르면(또는 FC도착 선적과 이으면) 그 업체 성적에 들어갑니다.</p>
            <Link href={`/login?next=${encodeURIComponent('/app/tracking')}`} className="mt-2 inline-block text-sm font-semibold underline underline-offset-4">{SCORECARD_ACTION.register}</Link>
          </div>
          <div className="rounded-md border border-line bg-surface p-4">
            <p className="text-xs font-semibold text-muted">물류사라면 · 物流商</p>
            <p className="mt-1 flex items-start gap-1.5 text-sm"><Truck className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden />화물번호를 제출하면 표본이 늘고, 제출률이 기준을 넘으면 「실측 인증」이 붙습니다.</p>
            <Link href="/partner/scorecard" className="mt-2 inline-block text-sm font-semibold underline underline-offset-4">화물번호 제출 · 提交单号</Link>
          </div>
        </div>
        <details className="group rounded-md border border-line bg-surface" open={lookupOpen}>
          <summary className="cursor-pointer list-none px-4 py-3 text-sm font-bold [&::-webkit-details-marker]:hidden">
            번호 한 번 보기(저장하지 않음 · 성적표에 들지 않음) <span className="font-normal text-muted">— 열기</span>
          </summary>
          <div className="border-t border-line-2 p-4">
            <TrackLookup thisYear={thisYear} initial={{ kind: sp.kind, number: sp.no, year: sp.year }} />
          </div>
        </details>
        <p className="text-xs text-muted">
          자료: 관세청 UNI-PASS 화물통관진행정보{env.unipassEnabled ? '' : '(연결 준비 중 — 지금은 예시 자료)'} · 예상일은 참고치이며 약속이 아닙니다 ·{' '}
          <Link href="/track/stats" className="font-semibold text-text underline underline-offset-4">{TRACK_ACTION.stats}</Link>
        </p>
      </div>
    </>
  );
}
