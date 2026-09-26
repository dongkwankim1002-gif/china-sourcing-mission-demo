import type { Metadata } from 'next';
import Link from 'next/link';
import { asPublic } from '@/lib/db';
import { getReference, nameOf } from '@/lib/server/reference';
import { loadScorecardConfig, publicSnaps } from '@/lib/server/scorecard';
import { daysLine, sourceLine } from '@/lib/scorecard/engine';
import { TrendFigure } from '@/components/scorecard/parts';
import { DistBars } from '@/components/tracker/result';
import { DemoChip } from '@/components/badges';
import { EmptyState, Panel, PanelHead } from '@/components/ui/core';
import { dateKo, pct } from '@/lib/format';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: '통관 시장 지표 — 항구·방식별 입항 → 수리 추이',
  description: '인천·평택 항구와 LCL·FCL·카페리·항공 방식별로 입항 → 수입신고 수리에 실제 걸린 영업일(중앙값·90% 지점)·검사 비율·주별 추이. 업체 이름 없이 관세청 단계 기록으로 셉니다.',
  alternates: { canonical: '/market/customs' },
};

const days = (d: { p50: number; p90: number } | null) => {
  if (!d) return '—';
  const x = daysLine(d);
  return `보통 ${x.usual}일 · 늦으면 ${x.late}일`;
};

export default async function MarketCustomsPage() {
  const [d, ref] = await Promise.all([asPublic(async (q) => ({ cfg: await loadScorecardConfig(q), rows: await publicSnaps(q) })), getReference()]);
  const overall = d.rows.filter((r) => r.entity_kind === 'overall');
  const all = overall.find((r) => r.port == null && r.mode == null) ?? null;
  const ord = (list: { code: string }[], c: string | null) => list.findIndex((x) => x.code === c);
  const pm = overall.filter((r) => r.port && r.mode && r.metrics.clear).sort((a, b) => ord(ref.ports, a.port) - ord(ref.ports, b.port) || ord(ref.modes, a.mode) - ord(ref.modes, b.mode));
  const example = overall.some((r) => r.is_example);
  return (
    <>
      <section className="bg-ink text-on-ink">
        <div className="mx-auto max-w-[1100px] px-4 pb-8 pt-8 md:pt-12">
          <p className="text-xs font-bold text-on-ink-muted">물류사 성적표 · 통관 시장 지표 · 업체 이름 없음</p>
          <h1 className="display mt-2 max-w-3xl break-keep text-[clamp(28px,4.4vw,46px)] leading-[1.1]">
            지금 <span className="text-label">인천·평택 통관</span>은 며칠 걸리나
          </h1>
          <p className="mt-3 max-w-2xl text-md text-on-ink-muted">
            셀러·물류사가 모은 화물번호의 관세청 단계 기록으로 셈한 항구·방식별 실측입니다. 업체별 성적표는 로그인한 화주에게 <Link href="/partners?sort=fast" className="font-semibold text-on-ink underline underline-offset-4">업체 찾기</Link>에서 보입니다.
          </p>
          {all?.metrics.clear ? (
            <dl className="mt-6 grid max-w-3xl grid-cols-2 gap-4 sm:grid-cols-4">
              {[
                ['입항 → 수리', days(all.metrics.clear)],
                ['늦는 폭', `${all.metrics.clear.spread}일`],
                ['검사 비율', pct(all.metrics.inspectRate, 1)],
                ['표본', `${all.n}건`],
              ].map(([k, v]) => (
                <div key={k} className="min-w-0">
                  <dt className="text-xs text-on-ink-muted">{k}</dt>
                  <dd className="mt-1 text-lg font-bold tnum">{v}</dd>
                </div>
              ))}
            </dl>
          ) : null}
        </div>
      </section>
      <div className="mx-auto grid max-w-[1100px] gap-6 px-4 py-8">
        <p className="text-sm text-muted">
          최근 {d.cfg.rules.windowDays}일(수리일 기준) · 한국 영업일 · 표본 {d.cfg.rules.minSamples}건 미만 칸은 숨깁니다 · 이상치(입항 → 수리 {d.cfg.rules.outlierDays}영업일 넘음)는 분위수에서 뺍니다
          {all ? ` · 셈한 때 ${dateKo(all.computed_at)}` : ''}
          {example ? <span className="ml-2 inline-flex align-middle"><DemoChip /></span> : null}
        </p>
        {pm.length ? (
          <>
            <Panel>
              <PanelHead title="항구 × 방식" sub="보통 = 중앙값(반올림) · 늦으면 = 90% 지점(올림) · 검사 비율은 처리구분 낱말 기준 가정(확인 필요)" />
              <p className="px-4 pt-2 text-2xs text-muted md:hidden">표를 옆으로 넘기면 반입 → 반출·반출 → FC·출처 칸이 더 있습니다.</p>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[820px] whitespace-nowrap text-sm" data-testid="market-customs-table">
                  <caption className="sr-only">항구 × 방식별 통관 실측</caption>
                  <thead className="text-left text-xs text-muted">
                    <tr className="border-b border-line-2">
                      <th scope="col" className="px-4 py-2">항구 · 방식</th>
                      <th scope="col" className="px-4 py-2">입항 → 수리</th>
                      <th scope="col" className="px-4 py-2">늦는 폭</th>
                      <th scope="col" className="px-4 py-2">검사</th>
                      <th scope="col" className="px-4 py-2">반입 → 반출</th>
                      <th scope="col" className="px-4 py-2">반출 → FC 입고</th>
                      <th scope="col" className="px-4 py-2">번호 출처</th>
                      <th scope="col" className="px-4 py-2 text-right">표본</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pm.map((r) => (
                      <tr key={`${r.port}-${r.mode}`} className="border-b border-line-2 last:border-0">
                        <th scope="row" className="px-4 py-2 text-left font-semibold">{nameOf(ref, 'port', r.port!)} · {nameOf(ref, 'mode', r.mode!)}</th>
                        <td className="px-4 py-2 tnum">{days(r.metrics.clear)}</td>
                        <td className="px-4 py-2 tnum">{r.metrics.clear!.spread}일</td>
                        <td className="px-4 py-2 tnum">{pct(r.metrics.inspectRate, 0)}</td>
                        <td className="px-4 py-2 tnum">{days(r.metrics.bondedRelease)}</td>
                        <td className="px-4 py-2 tnum">{r.metrics.releaseFc ? days(r.metrics.releaseFc) : <span className="text-muted">선적 기록 없음</span>}</td>
                        <td className="px-4 py-2 text-xs text-muted">{sourceLine(r.sources)}</td>
                        <td className="px-4 py-2 text-right tnum">{r.n}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>
            <div className="grid gap-4 md:grid-cols-2">
              {pm.map((r) => (
                <Panel key={`t-${r.port}-${r.mode}`} className="grid gap-4 p-4">
                  <h2 className="text-sm font-bold">{nameOf(ref, 'port', r.port!)} · {nameOf(ref, 'mode', r.mode!)}</h2>
                  <TrendFigure trend={r.metrics.trend} />
                  <DistBars hist={r.metrics.clear!.hist} n={r.n} p50={r.metrics.clear!.p50} p90={r.metrics.clear!.p90} title="입항 → 수리 분포" />
                </Panel>
              ))}
            </div>
          </>
        ) : (
          <Panel>
            <EmptyState
              title="아직 보여 드릴 만큼 모이지 않았습니다"
              body={`항구·방식마다 표본 ${d.cfg.rules.minSamples}건이 모이면 여기에 추이가 뜹니다. 화주는 내 화물을 등록하고, 물류사는 화물번호를 제출하면 빨리 모입니다.`}
              action={<Link href="/app/tracking" className="font-semibold underline underline-offset-4">내 화물 등록</Link>}
            />
          </Panel>
        )}
        <div className="grid gap-3 rounded-md border border-line bg-surface p-4 text-sm sm:grid-cols-2">
          <p><b>셀러라면</b> — 내 B/L 을 등록하면 통관 알림을 받고, 그 화물이 성적표에 보태집니다. <Link href="/app/tracking" className="font-semibold underline underline-offset-4">내 화물 등록</Link></p>
          <p><b>물류사라면</b> — 화물번호를 제출하면 표본이 늘고, 제출률이 기준을 넘으면 「실측 인증」이 붙습니다. <Link href="/partner/scorecard" className="font-semibold underline underline-offset-4">화물번호 제출</Link></p>
        </div>
        <p className="text-2xs text-muted">
          자료: 관세청 UNI-PASS 화물통관진행정보(처리 일시) · FC 입고는 FC도착에서 이은 선적 기록 · 관세청은 업체별 전체 통관 통계를 공개하지 않습니다(확인 필요) — 그래서 모은 번호로만 셉니다. 계산 방법은 <Link href="/faq" className="underline underline-offset-4">자주 묻는 질문</Link>과 기획서에 공개합니다.
        </p>
      </div>
    </>
  );
}
