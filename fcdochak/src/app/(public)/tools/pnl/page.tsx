import type { Metadata } from 'next';
import { laneStats, STANDARD_CARGO } from '@/lib/server/public';
import { getReference } from '@/lib/server/reference';
import { arrivalEstimate, publicToolBasis } from '@/lib/server/tools';
import { STANDARD_ROUTE } from '@/lib/standard-cargo';
import { basisLabel } from '@/lib/tools-settings';
import { PageTitle } from '@/components/ui/core';
import { PnlTool, type ToolLane } from './tool';

export const revalidate = 600;
export const metadata: Metadata = {
  title: '판매손익 계산기 — 중국 수입 원가로 쿠팡 개당 마진 계산',
  description:
    '구간 시세로 쿠팡 FC 도착원가를 잡고, 관세·부가세 참고 추정과 쿠팡 판매 수수료·로켓그로스 비용·광고비를 넣어 개당 마진과 손익분기 판매가를 봅니다. 가입 없이 씁니다.',
  alternates: { canonical: '/tools/pnl' },
};

export default async function PnlToolPage() {
  const [ref, lanes, basis] = await Promise.all([getReference(), laneStats(), publicToolBasis()]);
  const toolLanes: ToolLane[] = lanes.map((l) => ({
    slug: l.slug,
    hub: l.hub,
    port: l.port,
    mode: l.mode,
    label: `${l.hubName} → ${l.portName} · ${l.modeName}`,
    hubName: l.hubName,
    cards: l.cards,
  }));
  // 첫 값: 기준 구간(이우 → 인천)의 첫 방식 × 기준 화물 — 구간 시세와 같은 조건
  const first = toolLanes.find((l) => l.hub === STANDARD_ROUTE.hub && l.port === STANDARD_ROUTE.port) ?? toolLanes[0] ?? null;
  const initial = first
    ? await arrivalEstimate({ hub: first.hub, port: first.port, mode: first.mode, cargo: STANDARD_CARGO, traits: [] })
    : null;
  return (
    <div className="mx-auto max-w-[1280px] px-4 py-10">
      <PageTitle
        eyebrow="가입 없이 쓰는 도구"
        title={<span className="display text-[clamp(28px,4vw,44px)] font-normal">판매손익 계산기</span>}
        sub={`중국 공장에서 쿠팡 FC까지 도착원가를 잡고, 쿠팡에서 팔면 개당 얼마가 남는지 봅니다. 관세·부가세는 참고 추정이고, 쿠팡 요율(${basisLabel(basis.fee)})은 내 값으로 바꿔 넣을 수 있습니다.`}
      />
      <PnlTool
        lanes={toolLanes}
        initialLane={first?.slug ?? null}
        initialArrival={initial}
        traits={ref.traits.map((t) => ({ code: t.code, name: t.name_ko, needsCapability: t.needs_capability, blockedModes: t.blocked_modes, verdict: t.verdict_ko }))}
        modes={ref.modes.map((m) => ({ code: m.code, name: m.name_ko }))}
        basis={basis}
      />
    </div>
  );
}
