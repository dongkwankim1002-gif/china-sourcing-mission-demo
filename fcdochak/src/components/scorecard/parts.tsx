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

/** 소수 첫째 자리 날수 — 「1.2일」(정렬 근거가 보이게) */
const d1 = (v: number) => `${(Math.round(v * 10) / 10).toFixed(1).replace(/\.0$/, '')}일`;

/**
 * 카드·비교 줄의 성적 칩 — 표본 기준 미만이면 「통관 성적 표본 부족」 한 칩.
 * scope: 이 칩이 어느 판인지(예: 「모든 항구·방식 기준」) — 비교 화면에서 항구 × 방식 판이 모자라 전체 판으로 물러설 때 적는다.
 * compact 에서도 제출률·출처 한 줄은 싣는다(부정 방지의 핵심이 첫 화면에 보이게 · 기획 4·5절).
 */
export function ScoreChips({ s, minSamples, compact, className, certified, scope }: { s: Snap | null | undefined; minSamples: number; compact?: boolean; className?: string; certified?: boolean; scope?: string }) {
  if (!s || s.n < minSamples || !s.metrics.clear) {
    return (
      <div className={cn('flex flex-wrap gap-1', className)} data-testid="score-chips">
        <Chip tone="neutral" icon={<Gauge aria-hidden />}>
          통관 성적 표본 부족{s ? `(${s.n}건)` : ''}
        </Chip>
      </div>
    );
  }
  const d = daysLine(s.metrics.clear);
  return (
    <div className={cn('flex flex-wrap items-center gap-1', className)} data-testid="score-chips">
      <Chip tone="info" icon={<Gauge aria-hidden />} title={`관세청 단계 기록 — 입항 → 수입신고 수리, 한국 영업일(보통 = 중앙값 ${d1(s.metrics.clear.p50)}, 늦으면 = 90% 지점 ${d1(s.metrics.clear.p90)})`}>
        통관 보통 {d.usual}일 · 늦으면 {d.late}일
      </Chip>
      {s.metrics.inspectRate != null ? <Chip tone={s.metrics.inspectRate >= 0.15 ? 'caution' : 'neutral'}>검사 {pct(s.metrics.inspectRate, 0)}</Chip> : null}
      <Chip tone="neutral" title={`수리일 기준 ${s.from_on} ~ ${s.to_on}`}>통관 성적 표본 {s.n} · {periodLabel(s)}</Chip>
      {s.submission?.rate != null ? (
        <Chip tone="neutral" title={`셀러 등록·플랫폼 선적으로 이 업체에 귀속된 ${s.submission.registered}건 중 업체도 스스로 낸 ${s.submission.submitted}건`}>제출률 {pct(s.submission.rate, 0)}</Chip>
      ) : null}
      {!compact ? <Chip tone="neutral" title="번호를 알려 준 곳별 수(같은 화물은 한 번). 숫자는 모두 관세청 기록입니다">관세청 실측 · {sourceLine(s.sources)}</Chip> : null}
      {s.certified || certified ? <CertifiedChip /> : null}
      {s.is_example ? <DemoChip /> : null}
      {compact ? <span className="basis-full text-2xs text-muted tnum" title="번호를 알려 준 곳별 수(같은 화물은 한 번). 숫자는 모두 관세청 기록입니다">관세청 실측 · {sourceLine(s.sources)}{scope ? ` · ${scope}` : ''}</span> : scope ? <span className="text-2xs text-muted">{scope}</span> : null}
    </div>
  );
}

/**
 * FC도착 거래 기록 — 통관 성적 옆에 싣는 거래 지표(기획 4절): 견적 응답 속도(요청 → 첫 응찰 중앙값) · 정시 입고율 · 청구 편차 · 30일 FC 회송률 · 화주 평가.
 * 숫자는 모두 이 플랫폼의 거래 기록(v_partner_metrics · 응찰 시각)에서 셈한다 — 손으로 넣는 칸이 아니다. 표본 기준 미만인 견적 응답은 숨긴다.
 */
export function TradeMetrics({ metrics, quote, minSamples, zh }: { metrics: Record<string, number | null> | null; quote: { hours: number; n: number } | null; minSamples: number; zh?: boolean }) {
  const m = metrics;
  const L = (ko: string, c: string) => (zh ? `${c} · ${ko}` : ko);
  const items: [string, string, string][] = [
    [L('견적 응답', '报价响应'), quote && quote.n >= minSamples ? `보통 ${quote.hours < 1 ? '1시간 안' : `${Math.round(quote.hours)}시간`}` : '표본 부족', quote ? `요청 → 첫 응찰 · ${quote.n}건` : '응찰 기록 없음'],
    [L('정시 입고율', '准时入库率'), m?.shipments_done ? pct(m.on_time_rate ?? null, 0) : '실측 없음', `완료 ${m?.shipments_done ?? 0}건`],
    [L('청구 편차', '账单偏差'), m?.invoiced_count ? pct(m.avg_signed_deviation ?? null, 1, true) : '실측 없음', `견적 대비 청구 · ${m?.invoiced_count ?? 0}건`],
    [L('30일 FC 회송률', '30天FC退回率'), m?.done_30d ? pct(m.return_rate_30d ?? null, 1) : '실측 없음', `30일 입고 ${m?.done_30d ?? 0}건`],
    [L('화주 평가', '货主评价'), m?.reviews_count ? `${Number(m.avg_rating).toFixed(1)} / 5` : '평가 없음', `${m?.reviews_count ?? 0}건`],
  ];
  return (
    <Panel data-testid="trade-metrics">
      <PanelHead title={L('FC도착 거래 기록', 'FC到达交易记录')} sub="이 플랫폼에서 끝난 견적·선적·청구·후기로 셈한 거래 지표 — 통관 성적과 함께 보세요" />
      <dl className="grid grid-cols-2 gap-px bg-line-2 sm:grid-cols-3 lg:grid-cols-5">
        {items.map(([k, v, sub]) => (
          <div key={k} className="min-w-0 bg-surface p-4">
            <dt className="text-xs text-muted">{k}</dt>
            <dd className="mt-1 text-base font-bold tnum">{v}</dd>
            <dd className="text-2xs text-muted">{sub}</dd>
          </div>
        ))}
      </dl>
    </Panel>
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


/** 항구 × 방식 표 + 모든 항구 판의 분포·추이 */
export function ScorecardDetail({
  all,
  rows,
  minSamples,
  portName,
  modeName,
  title = '성적표',
  sub,
  zh,
}: {
  all: Snap | null | undefined;
  rows: Snap[];
  minSamples: number;
  portName: (c: string) => string;
  modeName: (c: string) => string;
  title?: string;
  sub?: React.ReactNode;
  /** 물류사 화면(중국어) — 한·중 병기 */
  zh?: boolean;
}) {
  const L = (ko: string, c: string) => (zh ? `${c} · ${ko}` : ko);
  const day = zh ? '天' : '일';
  const fmtDist = (d: { p50: number; p90: number } | null) => {
    if (!d) return '—';
    const x = daysLine(d);
    return zh ? `中位 ${x.usual}天 · 慢时 ${x.late}天` : `보통 ${x.usual}일 · 늦으면 ${x.late}일`;
  };
  const delta = (v: number | null) => (v == null ? '—' : v === 0 ? L('평균과 같음', '与平均相同') : `${v > 0 ? '+' : '−'}${Math.abs(v)}${day}`);
  const shown = rows.filter((r) => r.n >= minSamples && r.metrics.clear);
  if (!all || all.n < minSamples || !all.metrics.clear) {
    return (
      <Panel data-testid="scorecard-detail">
        <PanelHead title={title} sub={sub} />
        <p className="px-4 py-6 text-sm text-muted">
          {zh ? `样本不足 ${minSamples} 票${all ? `(当前 ${all.n})` : ''}。卖家登记或贵司提交单号后会累积。 · ` : ''}아직 표본이 {minSamples}건이 안 됩니다{all ? `(지금 ${all.n}건)` : ''}. 셀러가 이 업체 화물번호를 등록하거나 업체가 제출하면 쌓입니다.
        </p>
      </Panel>
    );
  }
  const trend = all.metrics.trend;
  return (
    <Panel data-testid="scorecard-detail">
      <PanelHead
        title={title}
        sub={sub ?? (zh ? `按海关节点时间计算 · 近 ${all.window_days} 天 · 韩国工作日 · 样本不足 ${minSamples} 票的格子隐藏` : `관세청 단계 기록으로 셈한 실측 · ${periodLabel(all)} · 한국 영업일 · 표본 ${minSamples}건 미만인 칸은 숨깁니다`)}
        action={<span className="flex flex-wrap gap-1">{all.certified ? <CertifiedChip /> : null}{all.is_example ? <DemoChip /> : null}</span>}
      />
      <dl className="grid grid-cols-2 gap-px bg-line-2 sm:grid-cols-4">
        {[
          [L('입항 → 수리', '到港 → 放行'), fmtDist(all.metrics.clear), `${L('전체 대비', '对比整体')} ${delta(all.metrics.vsOverall.deltaP50)}`],
          [L('늦는 폭(p90−p50)', '波动幅度'), `${all.metrics.clear.spread}${day}`, L('작을수록 안정적', '越小越稳定')],
          [L('검사 비율', '查验率'), pct(all.metrics.inspectRate, 1), `${all.metrics.inspected}${zh ? '票' : '건'} · ${L('낱말 기준 가정(확인 필요)', '按关键词推定(待确认)')}`],
          [L('제출률', '提交率'), all.submission?.rate != null ? pct(all.submission.rate, 0) : '—', all.submission ? `${L('등록', '登记')} ${all.submission.registered} · ${L('제출', '提交')} ${all.submission.submitted}` : L('물류사만', '仅物流商')],
        ].map(([k, v, s]) => (
          <div key={k} className="min-w-0 bg-surface p-4">
            <dt className="text-xs text-muted">{k}</dt>
            <dd className="mt-1 text-base font-bold tnum">{v}</dd>
            <dd className="text-2xs text-muted">{s}</dd>
          </div>
        ))}
      </dl>
      <p className="border-t border-line-2 px-4 py-2 text-2xs text-muted">
        {L('표본', '样本')} {all.n} · {L('관세청 실측', '海关实测')} · {sourceLine(all.sources)}{all.sources.outliers ? ` · ${L(`이상치 ${all.sources.outliers}건은 분위수에서 뺌`, `异常值 ${all.sources.outliers} 票不计入分位数`)}` : ''} · {L('수리일', '放行日')} {all.from_on} ~ {all.to_on}
      </p>
      {shown.length ? (
        <>
          <p className="px-4 pt-2 text-2xs text-muted md:hidden">{L('표를 옆으로 넘기면 반입 → 반출·반출 → FC 입고·전체 대비 칸이 더 있습니다.', '表格可左右滑动查看更多列。')}</p>
          <div className="overflow-x-auto border-t border-line-2">
            <table className="w-full min-w-[760px] whitespace-nowrap text-sm" data-testid="scorecard-ports">
              <caption className="sr-only">항구 × 방식별 성적</caption>
              <thead className="text-left text-xs text-muted">
                <tr className="border-b border-line-2">
                  <th scope="col" className="px-4 py-2">{L('항구 · 방식', '港口 · 方式')}</th>
                  <th scope="col" className="px-4 py-2">{L('입항 → 수리', '到港 → 放行')}</th>
                  <th scope="col" className="px-4 py-2">{L('검사', '查验')}</th>
                  <th scope="col" className="px-4 py-2">{L('반입 → 반출', '入库 → 出库')}</th>
                  <th scope="col" className="px-4 py-2">{L('반출 → FC 입고', '出库 → FC入库')}</th>
                  <th scope="col" className="px-4 py-2">{L('같은 항구·방식 전체 대비', '对比同港口·方式整体')}</th>
                  <th scope="col" className="px-4 py-2 text-right">{L('표본', '样本')}</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={`${r.port}-${r.mode}`} className="border-b border-line-2 last:border-0">
                    <th scope="row" className="px-4 py-2 text-left font-semibold">{portName(r.port!)} · {modeName(r.mode!)}</th>
                    <td className="px-4 py-2 tnum">{fmtDist(r.metrics.clear)}</td>
                    <td className="px-4 py-2 tnum">{pct(r.metrics.inspectRate, 0)}</td>
                    <td className="px-4 py-2 tnum">{fmtDist(r.metrics.bondedRelease)}</td>
                    <td className="px-4 py-2 tnum">{r.metrics.releaseFc ? fmtDist(r.metrics.releaseFc) : <span className="text-muted">{L('선적 기록 없음', '无订单记录')}</span>}</td>
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
        <DistBars hist={all.metrics.clear.hist} n={all.n} p50={all.metrics.clear.p50} p90={all.metrics.clear.p90} title={L('입항 → 수리 분포(모든 항구)', '到港 → 放行分布(全部港口)')} />
        <TrendFigure trend={trend} zh={zh} />
      </div>
    </Panel>
  );
}

/**
 * 주별 추이 — 표본 2건 미만인 주는 선을 끊고 비운다(0 으로 그리지 않는다 · 검토 고침). 가장 낮은·높은 값을 적는다.
 */
export function TrendFigure({ trend, title = '주별 추이(보통 = 중앙값)', zh }: { trend: Snap['metrics']['trend']; title?: string; zh?: boolean }) {
  const known = trend.filter((t): t is typeof t & { p50: number } => t.p50 != null);
  const L = (ko: string, c: string) => (zh ? `${c} · ${ko}` : ko);
  const w = 240;
  const h = 64;
  const lo = known.length ? Math.min(...known.map((t) => t.p50)) : 0;
  const hi = known.length ? Math.max(...known.map((t) => t.p50)) : 1;
  const x = (i: number) => (i / Math.max(trend.length - 1, 1)) * (w - 8) + 4;
  const y = (v: number) => h - 8 - ((v - lo) / (hi - lo || 1)) * (h - 16);
  // 끊긴 구간마다 따로 그린다
  const paths: string[] = [];
  let cur = '';
  trend.forEach((t, i) => {
    if (t.p50 == null) {
      if (cur) paths.push(cur);
      cur = '';
      return;
    }
    cur += `${cur ? 'L' : 'M'}${x(i).toFixed(1)},${y(t.p50).toFixed(1)}`;
  });
  if (cur) paths.push(cur);
  const empty = trend.length - known.length;
  return (
    <figure className="min-w-0">
      <figcaption className="text-xs font-semibold text-muted">{zh ? `${L(title, '每周趋势(中位)')}` : title} · {zh ? `近 ${trend.length} 周` : `최근 ${trend.length}주`}</figcaption>
      {known.length >= 2 ? (
        <>
          <div className="mt-3 grid grid-cols-[auto_minmax(0,1fr)] gap-2">
            <div className="flex h-16 flex-col justify-between text-right text-2xs text-muted tnum" aria-hidden>
              <span>{hi}{zh ? '天' : '일'}</span>
              <span>{lo}{zh ? '天' : '일'}</span>
            </div>
            <svg viewBox={`0 0 ${w} ${h}`} className="h-16 w-full" role="img" preserveAspectRatio="none" aria-label={`주별 중앙값 ${trend.map((t) => `${t.week} ${t.p50 == null ? '표본 부족' : `${t.p50}일`}`).join(', ')}`}>
              <line x1={0} x2={w} y1={y(lo)} y2={y(lo)} stroke="var(--line-2)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
              {paths.map((d, i) => (
                <path key={i} d={d} fill="none" stroke="var(--chart-1)" strokeWidth={1.5} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
              ))}
              {trend.map((t, i) => (t.p50 != null ? <circle key={t.week} cx={x(i)} cy={y(t.p50)} r={2} fill="var(--chart-1)" /> : null))}
            </svg>
          </div>
          <p className="mt-1 text-2xs text-muted tnum">
            {known[0].week} {known[0].p50}{zh ? '天' : '일'} → {known[known.length - 1].week} {known[known.length - 1].p50}{zh ? '天' : '일'}
            {empty ? ` · ${L(`표본 2건 미만인 ${empty}주는 비움(선이 끊김)`, `样本不足2票的 ${empty} 周留空`)}` : ''}
          </p>
        </>
      ) : (
        <p className="mt-3 text-sm text-muted">{L('주별로 셀 만큼 모이지 않았습니다.', '每周样本不足。')}</p>
      )}
    </figure>
  );
}
