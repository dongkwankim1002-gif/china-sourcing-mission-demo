import type { Metadata } from 'next';
import Link from 'next/link';
import { asPublic } from '@/lib/db';
import { getReference, nameOf } from '@/lib/server/reference';
import { loadTrackerConfig, publicStats } from '@/lib/server/tracker';
import { DistBars } from '@/components/tracker/result';
import { DemoChip } from '@/components/badges';
import { EmptyState, Panel, PanelHead } from '@/components/ui/core';
import { dateKo } from '@/lib/format';
import { displayDays } from '@/lib/tracker/leadtime';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: '통관 소요 분포',
  description: '항구 × 운송 방식별 입항 → 수입신고 수리, 수리 → 쿠팡 FC 입고에 실제 걸린 영업일 분포(중앙값·90% 지점·표본). 표본이 적은 칸은 숨깁니다.',
  alternates: { canonical: '/track/stats' },
};

export default async function TrackStatsPage() {
  const [d, ref] = await Promise.all([asPublic(async (q) => ({ cfg: await loadTrackerConfig(q), rows: await publicStats(q) })), getReference()]);
  const pm = d.rows.filter((r) => r.level === 'port_mode');
  const ord = (list: { code: string }[], c: string) => list.findIndex((x) => x.code === c);
  const clear = pm.filter((r) => r.metric === 'arrival_to_clearance').sort((a, b) => ord(ref.ports, a.port) - ord(ref.ports, b.port) || ord(ref.modes, a.mode) - ord(ref.modes, b.mode));
  const fcOf = (port: string, mode: string) => pm.find((r) => r.metric === 'clearance_to_fc' && r.port === port && r.mode === mode);
  const example = pm.some((r) => r.is_example);
  const at = pm[0]?.computed_at ?? null;
  return (
    <div className="mx-auto grid max-w-[1100px] gap-6 px-4 py-8">
      <div>
        <p className="text-xs font-bold text-muted"><Link href="/track" className="underline underline-offset-4">내 화물 등록</Link> · 실측 분포 · <Link href="/market/customs" className="underline underline-offset-4">통관 시장 지표(검사·반입 → 반출·추이)</Link></p>
        <h1 className="mt-1 text-xl font-bold">항구 × 방식별 통관 소요</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          셀러가 넣은 번호의 관세청 단계 시각으로 셈한 실제 걸린 날입니다. 최근 {d.cfg.rules.windowDays}일 · 한국 영업일 · 표본 {d.cfg.rules.minSamples}건 미만인 칸은 숨깁니다.
          {at ? ` 셈한 때 ${dateKo(at)}.` : ''}
        </p>
        {example ? <p className="mt-2 flex items-center gap-2 text-xs text-muted"><DemoChip /> 예시 자료로 셈한 칸이 있습니다(실제 서비스 시작 전에 걷어냅니다).</p> : null}
      </div>
      {clear.length ? (
        <>
          <Panel>
            <PanelHead title="한눈에" sub="보통 = 중앙값(반올림) · 늦으면 = 90% 지점(올림)" />
            <p className="px-4 pt-2 text-2xs text-muted md:hidden">표를 옆으로 넘기면 수리 → FC 입고·표본 칸이 더 있습니다.</p>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] whitespace-nowrap text-sm">
                <thead className="text-left text-xs text-muted">
                  <tr className="border-b border-line-2">
                    <th scope="col" className="px-4 py-2">항구</th>
                    <th scope="col" className="px-4 py-2">방식</th>
                    <th scope="col" className="px-4 py-2">입항 → 수리</th>
                    <th scope="col" className="px-4 py-2">수리 → FC 입고</th>
                    <th scope="col" className="px-4 py-2 text-right">표본</th>
                  </tr>
                </thead>
                <tbody>
                  {clear.map((r) => {
                    const c = displayDays(r);
                    const f = fcOf(r.port, r.mode);
                    const fd = f ? displayDays(f) : null;
                    return (
                      <tr key={`${r.port}-${r.mode}`} className="border-b border-line-2 last:border-0">
                        <td className="px-4 py-2 font-semibold">{nameOf(ref, 'port', r.port)}</td>
                        <td className="px-4 py-2">{nameOf(ref, 'mode', r.mode)}</td>
                        <td className="px-4 py-2 tnum">보통 {c.usual}일 · 늦으면 {c.late}일</td>
                        <td className="px-4 py-2 tnum">{fd ? `보통 ${fd.usual}일 · 늦으면 ${fd.late}일` : <span className="text-muted">표본 부족</span>}</td>
                        <td className="px-4 py-2 text-right tnum">통관 {r.n}{f ? ` · FC ${f.n}` : ''}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Panel>
          <div className="grid gap-4 md:grid-cols-2">
            {clear.map((r) => (
              <Panel key={`d-${r.port}-${r.mode}`} className="p-4">
                <DistBars hist={r.hist} n={r.n} p50={r.p50} p90={r.p90} title={`${nameOf(ref, 'port', r.port)} · ${nameOf(ref, 'mode', r.mode)} — 입항 → 수리`} />
              </Panel>
            ))}
          </div>
        </>
      ) : (
        <Panel>
          <EmptyState title="아직 보여 드릴 만큼 모이지 않았습니다" body={`항구·방식마다 표본 ${d.cfg.rules.minSamples}건이 모이면 여기에 분포가 뜹니다. 화주로 번호를 저장하고 선적·물류사와 이을수록 빨리 모입니다(로그인 없이 조회만 한 번호는 셈에 들지 않습니다).`} action={<Link href="/track" className="font-semibold underline underline-offset-4">내 화물 등록</Link>} />
        </Panel>
      )}
      <p className="text-xs text-muted">자료: 관세청 UNI-PASS 화물통관진행정보(처리 일시) · FC 입고는 FC도착에서 이은 선적 기록 · 공휴일 목록은 확인 필요 표시가 붙은 첫 판입니다.</p>
    </div>
  );
}
