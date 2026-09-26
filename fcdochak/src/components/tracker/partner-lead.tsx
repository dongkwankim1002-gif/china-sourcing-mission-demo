/** 업체 화면의 「실측 통관 소요(표본 N)」 — 표본 기준 이상인 판만(모자라면 이 칸 자체를 싣지 않는다) */
import Link from 'next/link';
import { DemoChip } from '@/components/badges';
import { Panel, PanelHead } from '@/components/ui/core';
import { displayDays } from '@/lib/tracker/leadtime';
import type { PublicStat } from '@/lib/server/tracker';

export function PartnerLeadTime({ rows, portName, modeName }: { rows: PublicStat[]; portName: (c: string) => string; modeName: (c: string) => string }) {
  const clear = rows.filter((r) => r.metric === 'arrival_to_clearance').sort((a, b) => b.n - a.n);
  if (!clear.length) return null;
  const fcOf = (r: PublicStat) => rows.find((x) => x.metric === 'clearance_to_fc' && x.port === r.port && x.mode === r.mode);
  return (
    <Panel data-testid="partner-lead-time">
      <PanelHead
        title={`실측 통관 소요(표본 ${clear.reduce((t, r) => t + r.n, 0)}건)`}
        sub={<>FC도착에서 이 업체와 거래한 선적에 이은 B/L 의 관세청 단계 시각으로 셈합니다(같은 화물은 한 번만) — 입항 → 수리, 한국 영업일 · <Link href="/track/stats" className="underline underline-offset-4">항구별 분포</Link></>}
      />
      <ul className="divide-y divide-line-2">
        {clear.map((r) => {
          const c = displayDays(r);
          const f = fcOf(r);
          const fd = f ? displayDays(f) : null;
          return (
            <li key={`${r.port}-${r.mode}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-sm">
              <b className="min-w-0">{portName(r.port)} · {modeName(r.mode)}</b>
              <span className="tnum">통관 보통 {c.usual}일 · 늦으면 {c.late}일</span>
              {fd ? <span className="text-muted tnum">수리 → FC 입고 보통 {fd.usual}일 · 늦으면 {fd.late}일</span> : null}
              <span className="text-xs text-muted tnum">표본 {r.n}</span>
              {r.is_example ? <DemoChip /> : null}
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}
