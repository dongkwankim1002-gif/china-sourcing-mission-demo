/**
 * 결정 보드의 작은 그림들 — 서버에서 그리는 HTML 막대(한 그림 한 계열, 막대 ≤ 24px·끝 4px 둥글림, 1px 격자).
 * 값은 막대 옆 글자와 표로도 있다(색만으로 뜻을 싣지 않는다). 손·초점을 대면 풍선(title) + 초점 고리.
 */
import type { WtpCurve, VolumeCurve, UploadRead } from '@/lib/money/research';
import { num, pct } from '@/lib/format';

const bpPct = (bp: number | null | undefined, d = 0) => (bp == null ? '—' : pct(bp / 10000, d));

/** 지불 의향 곡선 — 막대 = 확인된 의향(반대 질문 통과), 가는 세로 눈금 = 말로 한 의향, 옅은 띠 = 윌슨 95% 구간 */
export function WtpBars({ curve, majorityBp, thresholdBp }: { curve: WtpCurve; majorityBp: number; thresholdBp: number }) {
  return (
    <figure className="min-w-0" data-testid="wtp-chart">
      <figcaption className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-2xs text-muted">
        <span className="inline-flex items-center gap-1.5"><span className="inline-block h-2.5 w-4 rounded-xs bg-[var(--chart-1)]" aria-hidden /> 확인된 의향(반대 질문 통과)</span>
        <span className="inline-flex items-center gap-1.5"><span className="inline-block h-3 w-0.5 bg-text" aria-hidden /> 말로 한 의향</span>
        <span className="inline-flex items-center gap-1.5"><span className="inline-block h-2.5 w-4 rounded-xs bg-[var(--chart-1)] opacity-20" aria-hidden /> 95% 구간</span>
        <span className="inline-flex items-center gap-1.5"><span className="inline-block h-3 w-0 border-l border-dashed border-stamp" aria-hidden /> 다수 기준 {bpPct(majorityBp)}</span>
      </figcaption>
      <div className="relative grid gap-2.5">
        <div className="pointer-events-none absolute inset-y-0 left-[4.5rem] right-[6.5rem]" aria-hidden>
          {[0, 25, 50, 75, 100].map((t) => (
            <span key={t} className="absolute inset-y-0 border-l border-[var(--grid)]" style={{ left: `${t}%` }} />
          ))}
          <span className="absolute inset-y-0 border-l border-dashed border-stamp" style={{ left: `${majorityBp / 100}%` }} />
        </div>
        {curve.steps.map((s) => {
          const w = (s.confirmedBp ?? 0) / 100;
          const st = (s.statedBp ?? 0) / 100;
          const ci = s.confirmedCi;
          const isT = s.bp === (curve.threshold.confirmed?.bp ?? thresholdBp);
          return (
            <div key={s.bp} className="grid grid-cols-[4rem_minmax(0,1fr)_6rem] items-center gap-2" data-testid={`wtp-row-${s.bp}`}>
              <span className={`text-right text-sm tnum ${isT ? 'font-bold' : 'text-muted'}`}>+{bpPct(s.bp)}</span>
              <div
                tabIndex={0}
                title={`+${bpPct(s.bp)} 이상 받겠다 — 확인 ${s.confirmed}/${curve.n}명(${bpPct(s.confirmedBp)}), 말로 ${s.stated}명(${bpPct(s.statedBp)})${ci ? ` · 95% 구간 ${bpPct(ci[0])}~${bpPct(ci[1])}` : ''}`}
                className="relative h-6 rounded-xs outline-none focus-visible:ring-2 focus-visible:ring-label"
              >
                {ci ? <span className="absolute inset-y-1 rounded-xs bg-[var(--chart-1)] opacity-20" style={{ left: `${ci[0] / 100}%`, width: `${Math.max(0.5, (ci[1] - ci[0]) / 100)}%` }} aria-hidden /> : null}
                <span className="absolute inset-y-1.5 left-0 rounded-r-[4px] bg-[var(--chart-1)]" style={{ width: `${w}%` }} aria-hidden />
                <span className="absolute inset-y-0 w-0.5 bg-text" style={{ left: `calc(${st}% - 1px)` }} aria-hidden />
              </div>
              <span className="text-sm tnum"><b>{bpPct(s.confirmedBp)}</b> <span className="text-2xs text-muted">({s.confirmed}/{curve.n})</span></span>
            </div>
          );
        })}
      </div>
      <details className="mt-3 text-sm">
        <summary className="cursor-pointer text-xs font-semibold text-muted">표로 보기</summary>
        <table className="mt-2 w-full text-sm tnum">
          <caption className="sr-only">사다리 값별 지불 의향</caption>
          <thead className="text-left text-xs text-muted">
            <tr><th scope="col" className="py-1">값</th><th scope="col">말로 한 의향</th><th scope="col">확인된 의향</th><th scope="col">95% 구간(확인)</th></tr>
          </thead>
          <tbody>
            {curve.steps.map((s) => (
              <tr key={s.bp} className="border-t border-line-2">
                <td className="py-1">+{bpPct(s.bp)}</td>
                <td>{s.stated}명 · {bpPct(s.statedBp)}</td>
                <td>{s.confirmed}명 · {bpPct(s.confirmedBp)}</td>
                <td>{s.confirmedCi ? `${bpPct(s.confirmedCi[0])}~${bpPct(s.confirmedCi[1])}` : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}

/** 가로 막대 목록 — 순위(불편·방식·점수 분포 등) */
export function RankBars({ rows, caption, testid }: { rows: { label: string; n: number; bp: number | null }[]; caption: string; testid?: string }) {
  const max = Math.max(1, ...rows.map((r) => r.n));
  return (
    <figure className="min-w-0" data-testid={testid}>
      <figcaption className="sr-only">{caption}</figcaption>
      <ol className="grid gap-2">
        {rows.map((r, i) => (
          <li key={r.label} className="grid grid-cols-[minmax(0,1fr)_4.5rem] items-center gap-2" title={`${r.label} — ${r.n}명(${bpPct(r.bp)})`}>
            <div className="min-w-0">
              <p className="truncate text-sm"><span className="mr-1 text-2xs text-muted tnum">{i + 1}</span>{r.label}</p>
              <span className="mt-1 block h-2 rounded-r-[4px] bg-[var(--chart-1)]" style={{ width: `${(r.n / max) * 100}%`, minWidth: r.n ? 4 : 0 }} aria-hidden />
            </div>
            <span className="text-right text-sm tnum"><b>{r.n}</b>명 <span className="text-2xs text-muted">{bpPct(r.bp)}</span></span>
          </li>
        ))}
      </ol>
    </figure>
  );
}

/** 점검 퍼널 — 방문 → 입력 → 점검 → 보관(기기 수) */
export function FunnelBars({ read }: { read: UploadRead }) {
  const c = read.counts;
  const rows = [
    { k: '방문', n: c.visitors, bp: c.visitors ? 10000 : null },
    { k: '청구서 입력', n: Math.min(c.inputters, c.visitors), bp: read.inputBp },
    { k: '점검까지', n: Math.min(c.runners, c.visitors), bp: read.runBp },
    { k: '보관', n: Math.min(c.savers, c.visitors), bp: read.saveBp },
  ];
  return (
    <figure className="min-w-0" data-testid="funnel-chart">
      <figcaption className="sr-only">청구서 점검 퍼널(기기 수)</figcaption>
      <ol className="grid gap-2">
        {rows.map((r) => (
          <li key={r.k} className="grid grid-cols-[5.5rem_minmax(0,1fr)_6.5rem] items-center gap-2" title={`${r.k} ${r.n}대(${bpPct(r.bp, 1)})`}>
            <span className="text-sm">{r.k}</span>
            <span className="relative h-5 rounded-xs bg-surface-2">
              <span className="absolute inset-y-0 left-0 rounded-r-[4px] bg-[var(--chart-1)]" style={{ width: `${(r.bp ?? 0) / 100}%` }} aria-hidden />
            </span>
            <span className="text-right text-sm tnum"><b>{num(r.n)}</b> <span className="text-2xs text-muted">{bpPct(r.bp, 1)}</span></span>
          </li>
        ))}
      </ol>
    </figure>
  );
}

const KIND: Record<string, string> = { consolidator: '콘솔사', forwarder: '포워더' };
export const INCLUDES_LABEL: Record<string, string> = { sea_cfs: '해상+CFS', to_port: '도착항까지', to_fc: 'FC 입고까지' };

/** 물량 단가 곡선 — 종류·포함 범위마다 작은 그림 하나(같은 세로 척도) */
export function VolumeCurves({ curves }: { curves: VolumeCurve[] }) {
  const max = Math.max(1, ...curves.flatMap((c) => c.points.map((p) => p.median ?? 0)));
  return (
    <div className="grid gap-4 md:grid-cols-2" data-testid="volume-curves">
      {curves.map((c) => (
        <figure key={`${c.kind}-${c.includes}`} className="relative min-w-0 rounded-sm border border-line-2 p-3">
          <figcaption className="mb-2 text-sm font-semibold">
            {KIND[c.kind]} · {INCLUDES_LABEL[c.includes]} <span className="text-2xs font-normal text-muted">견적 {c.n}건 · CBM 당 단가 중간값</span>
          </figcaption>
          <div className="flex h-32 items-end gap-1.5 border-b border-line" role="list">
            {c.points.map((p) => (
              <div key={p.bucket} role="listitem" className="flex min-w-0 flex-1 flex-col items-center justify-end gap-1" title={`${p.bucket} CBM~ · ${p.n}건 · ${p.median == null ? '없음' : `${num(p.median)}원`}${p.discountBp != null ? ` · 첫 구간 대비 ${bpPct(p.discountBp)} 쌈` : ''}`}>
                {p.median != null ? <span className="text-2xs tnum text-muted">{Math.round(p.median / 1000)}천</span> : null}
                <span className="w-full max-w-6 rounded-t-[4px] bg-[var(--chart-1)]" style={{ height: `${((p.median ?? 0) / max) * 96}px` }} aria-hidden />
              </div>
            ))}
          </div>
          <div className="mt-1 flex gap-1.5" aria-hidden>
            {c.points.map((p) => <span key={p.bucket} className="min-w-0 flex-1 text-center text-2xs text-muted tnum">{p.bucket}</span>)}
          </div>
          <p className="mt-1 text-right text-2xs text-muted">물량(CBM/월)</p>
          <table className="sr-only">
            <caption>{KIND[c.kind]} {INCLUDES_LABEL[c.includes]} 물량별 단가</caption>
            <tbody>
              {c.points.map((p) => (
                <tr key={p.bucket}><th scope="row">{p.bucket} CBM~</th><td>{p.median == null ? '없음' : `${p.median}원`}</td><td>{p.n}건</td></tr>
              ))}
            </tbody>
          </table>
        </figure>
      ))}
    </div>
  );
}
