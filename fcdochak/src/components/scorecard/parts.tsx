/**
 * 물류사 성적표 부품(v2 6차 scorecard) — 서버·브라우저 공용(상태 없음).
 *   · 칩: 「통관 보통 1일 · 늦으면 3일」 · 검사 비율 · 표본·기간 · 출처 · 「실측 인증」
 *   · 잠금: 비로그인에게 이름 붙은 성적 대신 흐린 자리 + 안내
 *   · 항구 × 방식 표 · 분포 · 추이
 * 색은 역할 토큰만. 상태색은 늘 글자와 함께.
 */
import Link from 'next/link';
import { Gauge, Lock, ShieldCheck } from 'lucide-react';
import { Chip, Panel, PanelHead } from '@/components/ui/core';
import { DemoChip } from '@/components/badges';
import { Sparkline } from '@/components/charts';
import { DistBars } from '@/components/tracker/result';
import { daysLine, sourceLine } from '@/lib/scorecard/engine';
import type { Snap } from '@/lib/server/scorecard';
import { pct } from '@/lib/format';
import { cn } from '@/lib/cn';

export function CertifiedChip({ zh }: { zh?: boolean }) {
  return (
    <Chip tone="ok" icon={<ShieldCheck aria-hidden />} title="셀러가 등록한 이 업체 화물을 업체도 빠짐없이 제출했고(제출률 기준 이상), 표본이 충분합니다. 돈으로 살 수 없습니다.">
      {zh ? '实测认证' : '실측 인증'}
    </Chip>
  );
}

export const periodLabel = (s: Pick<Snap, 'window_days'>) => `최근 ${s.window_days}일`;

/** 카드·비교 줄의 성적 칩 — 표본 기준 미만이면 「표본 부족」 한 칩 */
export function ScoreChips({ s, minSamples, compact, className, certified }: { s: Snap | null | undefined; minSamples: number; compact?: boolean; className?: string; certified?: boolean }) {
  if (!s || s.n < minSamples || !s.metrics.clear) {
    return (
      <div className={cn('flex flex-wrap gap-1', className)} data-testid="score-chips">
        <Chip tone="neutral" icon={<Gauge aria-hidden />}>
          성적 표본 부족{s ? `(${s.n}건)` : ''}
        </Chip>
      </div>
    );
  }
  const d = daysLine(s.metrics.clear);
  return (
    <div className={cn('flex flex-wrap gap-1', className)} data-testid="score-chips">
      <Chip tone="info" icon={<Gauge aria-hidden />} title="관세청 단계 기록 — 입항 → 수입신고 수리, 한국 영업일(보통 = 중앙값, 늦으면 = 90% 지점)">
        통관 보통 {d.usual}일 · 늦으면 {d.late}일
      </Chip>
      {s.metrics.inspectRate != null ? <Chip tone={s.metrics.inspectRate >= 0.15 ? 'caution' : 'neutral'}>검사 {pct(s.metrics.inspectRate, 0)}</Chip> : null}
      <Chip tone="neutral" title={`수리일 기준 ${s.from_on} ~ ${s.to_on}`}>표본 {s.n} · {periodLabel(s)}</Chip>
      {!compact ? <Chip tone="neutral" title="번호를 알려 준 곳별 수(같은 화물은 한 번). 숫자는 모두 관세청 기록입니다">관세청 실측 · {sourceLine(s.sources)}</Chip> : null}
      {s.certified || certified ? <CertifiedChip /> : null}
      {s.is_example ? <DemoChip /> : null}
    </div>
  );
}

/** 비로그인 — 이름 붙은 성적 자리를 흐리게, 로그인 안내 */
export function LockedScore({ next, className, plain }: { next: string; className?: string; plain?: boolean }) {
  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)} data-testid="score-locked">
      <span aria-hidden className="flex select-none gap-1 blur-[3px]">
        <Chip tone="info">통관 보통 ○일 · 늦으면 ○일</Chip>
        <Chip tone="neutral">표본 ○○</Chip>
      </span>
      {plain ? (
        <span className="inline-flex items-center gap-1 text-xs font-semibold text-muted">
          <Lock className="size-3.5" aria-hidden /> 로그인한 화주에게 성적표가 보입니다
        </span>
      ) : (
        <Link href={`/login?next=${encodeURIComponent(next)}`} className="inline-flex items-center gap-1 text-xs font-semibold text-text underline underline-offset-4">
          <Lock className="size-3.5" aria-hidden /> 로그인한 화주에게 성적표가 보입니다
        </Link>
      )}
    </div>
  );
}

const fmtDist = (d: { p50: number; p90: number } | null) => {
  if (!d) return '—';
  const x = daysLine(d);
  return `보통 ${x.usual}일 · 늦으면 ${x.late}일`;
};
const delta = (v: number | null) => (v == null ? '—' : v === 0 ? '평균과 같음' : `${v > 0 ? '+' : '−'}${Math.abs(v)}일`);

/** 항구 × 방식 표 + 모든 항구 판의 분포·추이 */
export function ScorecardDetail({
  all,
  rows,
  minSamples,
  portName,
  modeName,
  title = '성적표',
  sub,
}: {
  all: Snap | null | undefined;
  rows: Snap[];
  minSamples: number;
  portName: (c: string) => string;
  modeName: (c: string) => string;
  title?: string;
  sub?: React.ReactNode;
}) {
  const shown = rows.filter((r) => r.n >= minSamples && r.metrics.clear);
  if (!all || all.n < minSamples || !all.metrics.clear) {
    return (
      <Panel data-testid="scorecard-detail">
        <PanelHead title={title} sub={sub} />
        <p className="px-4 py-6 text-sm text-muted">아직 표본이 {minSamples}건이 안 됩니다{all ? `(지금 ${all.n}건)` : ''}. 셀러가 이 업체 화물번호를 등록하거나 업체가 제출하면 쌓입니다.</p>
      </Panel>
    );
  }
  const trend = all.metrics.trend;
  return (
    <Panel data-testid="scorecard-detail">
      <PanelHead
        title={title}
        sub={sub ?? `관세청 단계 기록으로 셈한 실측 · ${periodLabel(all)} · 한국 영업일 · 표본 ${minSamples}건 미만인 칸은 숨깁니다`}
        action={<span className="flex flex-wrap gap-1">{all.certified ? <CertifiedChip /> : null}{all.is_example ? <DemoChip /> : null}</span>}
      />
      <dl className="grid grid-cols-2 gap-px bg-line-2 sm:grid-cols-4">
        {[
          ['입항 → 수리', fmtDist(all.metrics.clear), `전체 대비 ${delta(all.metrics.vsOverall.deltaP50)}`],
          ['늦는 폭(p90−p50)', `${all.metrics.clear.spread}일`, '작을수록 안정적'],
          ['검사 비율', pct(all.metrics.inspectRate, 1), `${all.metrics.inspected}건 · 낱말 기준 가정(확인 필요)`],
          ['제출률', all.submission?.rate != null ? pct(all.submission.rate, 0) : '—', all.submission ? `등록 ${all.submission.registered} 중 제출 ${all.submission.submitted}` : '물류사만'],
        ].map(([k, v, s]) => (
          <div key={k} className="min-w-0 bg-surface p-4">
            <dt className="text-xs text-muted">{k}</dt>
            <dd className="mt-1 text-base font-bold tnum">{v}</dd>
            <dd className="text-2xs text-muted">{s}</dd>
          </div>
        ))}
      </dl>
      <p className="border-t border-line-2 px-4 py-2 text-2xs text-muted">
        표본 {all.n}건 · 관세청 실측 · {sourceLine(all.sources)}{all.sources.outliers ? ` · 이상치 ${all.sources.outliers}건은 분위수에서 뺌` : ''} · 수리일 {all.from_on} ~ {all.to_on}
      </p>
      {shown.length ? (
        <>
          <p className="px-4 pt-2 text-2xs text-muted md:hidden">표를 옆으로 넘기면 반입 → 반출·반출 → FC 입고·전체 대비 칸이 더 있습니다.</p>
          <div className="overflow-x-auto border-t border-line-2">
            <table className="w-full min-w-[760px] whitespace-nowrap text-sm" data-testid="scorecard-ports">
              <caption className="sr-only">항구 × 방식별 성적</caption>
              <thead className="text-left text-xs text-muted">
                <tr className="border-b border-line-2">
                  <th scope="col" className="px-4 py-2">항구 · 방식</th>
                  <th scope="col" className="px-4 py-2">입항 → 수리</th>
                  <th scope="col" className="px-4 py-2">검사</th>
                  <th scope="col" className="px-4 py-2">반입 → 반출</th>
                  <th scope="col" className="px-4 py-2">반출 → FC 입고</th>
                  <th scope="col" className="px-4 py-2">전체 대비</th>
                  <th scope="col" className="px-4 py-2 text-right">표본</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={`${r.port}-${r.mode}`} className="border-b border-line-2 last:border-0">
                    <th scope="row" className="px-4 py-2 text-left font-semibold">{portName(r.port!)} · {modeName(r.mode!)}</th>
                    <td className="px-4 py-2 tnum">{fmtDist(r.metrics.clear)}</td>
                    <td className="px-4 py-2 tnum">{pct(r.metrics.inspectRate, 0)}</td>
                    <td className="px-4 py-2 tnum">{fmtDist(r.metrics.bondedRelease)}</td>
                    <td className="px-4 py-2 tnum">{r.metrics.releaseFc ? fmtDist(r.metrics.releaseFc) : <span className="text-muted">선적 기록 없음</span>}</td>
                    <td className={cn('px-4 py-2 tnum', (r.metrics.vsOverall.deltaP50 ?? 0) > 0.5 && 'font-semibold text-caution')}>{delta(r.metrics.vsOverall.deltaP50)}</td>
                    <td className="px-4 py-2 text-right tnum">{r.n}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
      <div className="grid gap-6 border-t border-line-2 p-4 md:grid-cols-2">
        <DistBars hist={all.metrics.clear.hist} n={all.n} p50={all.metrics.clear.p50} p90={all.metrics.clear.p90} title="입항 → 수리 분포(모든 항구)" />
        <TrendFigure trend={trend} />
      </div>
    </Panel>
  );
}

export function TrendFigure({ trend, title = '주별 추이(보통 = 중앙값)' }: { trend: Snap['metrics']['trend']; title?: string }) {
  const known = trend.filter((t) => t.p50 != null);
  return (
    <figure className="min-w-0">
      <figcaption className="text-xs font-semibold text-muted">{title} · 최근 {trend.length}주</figcaption>
      {known.length >= 2 ? (
        <>
          <Sparkline values={trend.map((t) => t.p50)} className="mt-3 h-16" label={`주별 중앙값 ${known.map((t) => `${t.week} ${t.p50}일`).join(', ')}`} />
          <p className="mt-1 text-2xs text-muted tnum">
            {known[0].week} {known[0].p50}일 → {known[known.length - 1].week} {known[known.length - 1].p50}일 · 한 주 표본 2건 미만은 비움(0 으로 그림)
          </p>
        </>
      ) : (
        <p className="mt-3 text-sm text-muted">주별로 셀 만큼 모이지 않았습니다.</p>
      )}
    </figure>
  );
}
