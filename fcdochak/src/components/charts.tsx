'use client';
/**
 * 차트 — 한 차트 한 계열, 이중 축 없음, 1px 실선 격자, 막대 ≤ 24px·끝 4px 둥글림, 손을 대면 값.
 * 색: 계열 1 = --chart-1. 열지도는 파랑 순차 단계.
 */
import * as React from 'react';
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis, Area, AreaChart } from 'recharts';
import { cn } from '@/lib/cn';
import { fmt, fmtFull, type Fmt } from '@/lib/chart-format';
import { Tooltip as Tip } from '@/components/ui/radix';

function ChartTip({ active, payload, label, f, name }: { active?: boolean; payload?: { value: number }[]; label?: string; f: Fmt; name: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-sm border border-line bg-surface px-3 py-2 text-xs shadow-2">
      <div className="text-sm font-bold text-text tnum">{fmtFull(payload[0].value, f)}</div>
      <div className="flex items-center gap-1.5 text-muted">
        <span className="inline-block h-0.5 w-3 bg-[var(--chart-1)]" aria-hidden />
        {name} · {label}
      </div>
    </div>
  );
}

const axis = { fontSize: 11, fill: 'var(--muted)' };

export function DailyBars({ data, f = 'num', name, height = 200 }: { data: { d: string; v: number }[]; f?: Fmt; name: string; height?: number }) {
  return (
    <div style={{ height }} className="w-full min-w-0">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--grid)" strokeWidth={1} />
          <XAxis dataKey="d" tick={axis} tickLine={false} axisLine={{ stroke: 'var(--line)' }} interval="preserveStartEnd" minTickGap={28} />
          <YAxis tick={axis} tickLine={false} axisLine={false} width={64} tickFormatter={(v) => fmt(v, f).replace(' 원', '')} />
          <Tooltip cursor={{ fill: 'var(--surface-2)' }} content={<ChartTip f={f} name={name} />} />
          <Bar dataKey="v" fill="var(--chart-1)" radius={[4, 4, 0, 0]} maxBarSize={24} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function DailyLine({ data, f = 'num', name, height = 200, area = false }: { data: { d: string; v: number | null }[]; f?: Fmt; name: string; height?: number; area?: boolean }) {
  const C = area ? AreaChart : LineChart;
  return (
    <div style={{ height }} className="w-full min-w-0">
      <ResponsiveContainer width="100%" height="100%">
        <C data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--grid)" strokeWidth={1} />
          <XAxis dataKey="d" tick={axis} tickLine={false} axisLine={{ stroke: 'var(--line)' }} interval="preserveStartEnd" minTickGap={28} />
          <YAxis tick={axis} tickLine={false} axisLine={false} width={64} tickFormatter={(v) => fmt(v, f).replace(' 원', '')} />
          <Tooltip cursor={{ stroke: 'var(--muted)', strokeWidth: 1 }} content={<ChartTip f={f} name={name} />} />
          {area ? (
            <Area type="monotone" dataKey="v" stroke="var(--chart-1)" strokeWidth={2} fill="var(--chart-1)" fillOpacity={0.1} dot={false} activeDot={{ r: 4, stroke: 'var(--surface)', strokeWidth: 2 }} isAnimationActive={false} connectNulls />
          ) : (
            <Line type="monotone" dataKey="v" stroke="var(--chart-1)" strokeWidth={2} dot={false} activeDot={{ r: 4, stroke: 'var(--surface)', strokeWidth: 2 }} isAnimationActive={false} connectNulls />
          )}
        </C>
      </ResponsiveContainer>
    </div>
  );
}

/** 추세선 — 지표 칸 안. 앞 기간은 옅게, 이번 기간은 강조. */
export function Sparkline({ values, className, label }: { values: (number | null)[]; className?: string; label?: string }) {
  const vs = values.map((v) => v ?? 0);
  const max = Math.max(...vs, 1);
  const min = Math.min(...vs, 0);
  const w = 120;
  const h = 28;
  const pts = vs.map((v, i) => [(i / Math.max(vs.length - 1, 1)) * w, h - 2 - ((v - min) / (max - min || 1)) * (h - 4)]);
  const d = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join('');
  const last = pts[pts.length - 1];
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className={cn('h-7 w-full', className)} role="img" aria-label={label ?? '추세'} preserveAspectRatio="none">
      <path d={d} fill="none" stroke="var(--chart-1)" strokeWidth={1.5} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
      {last ? <circle cx={last[0]} cy={last[1]} r={2.5} fill="var(--chart-1)" /> : null}
    </svg>
  );
}

const SEQ = ['#cde2fb', '#9ec5f4', '#6da7ec', '#3987e5', '#256abf', '#184f95', '#0d366b'];

/** 열지도 — 행(구간) × 열(주). 칸에 손을 대면 값. 표 보기는 aria 로 */
export function HeatGrid({ rows, cols, values, f = 'num', caption }: { rows: string[]; cols: string[]; values: number[][]; f?: Fmt; caption: string }) {
  const flat = values.flat();
  const max = Math.max(...flat, 1);
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[520px] border-separate border-spacing-[2px] text-2xs">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            <th scope="col" className="w-36 text-left font-semibold text-muted">
              구간
            </th>
            {cols.map((c) => (
              <th key={c} scope="col" className="font-normal text-muted">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r}>
              <th scope="row" className="truncate pr-2 text-left text-xs font-semibold text-text">
                {r}
              </th>
              {values[i].map((v, j) => {
                const step = v === 0 ? -1 : Math.min(SEQ.length - 1, Math.floor((v / max) * (SEQ.length - 1) + 0.5));
                return (
                  <td key={j} className="p-0">
                    <Tip content={`${r} · ${cols[j]} · ${fmtFull(v, f)}`}>
                      <span
                        tabIndex={0}
                        className="block h-6 rounded-[3px] outline-offset-1 hover:outline hover:outline-2 hover:outline-label"
                        style={{ background: step < 0 ? 'var(--surface-2)' : SEQ[step] }}
                        aria-label={`${r} ${cols[j]} ${fmtFull(v, f)}`}
                      />
                    </Tip>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-2 flex items-center gap-1 text-2xs text-muted">
        적음
        {SEQ.map((c) => (
          <span key={c} className="inline-block h-2.5 w-5 rounded-[2px]" style={{ background: c }} />
        ))}
        많음
      </div>
    </div>
  );
}
