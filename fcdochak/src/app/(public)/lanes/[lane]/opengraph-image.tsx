import { laneBySlug, STANDARD_CARGO } from '@/lib/server/public';
import { ogCard, OG_SIZE } from '@/lib/og';
import { wonShort } from '@/lib/format';
import { SEGMENTS } from '@/lib/money/segments';

export const size = OG_SIZE;
export const contentType = 'image/png';
export const alt = '구간 시세';
export const revalidate = 3600;

export default async function Image({ params }: { params: Promise<{ lane: string }> }) {
  const { lane: slug } = await params;
  const { lane } = await laneBySlug(slug);
  if (!lane) return ogCard({ eyebrow: '구간 시세', title: '중국 → 쿠팡 FC 구간 시세' });
  return ogCard({
    eyebrow: '구간 시세',
    title: `${lane.hubName} → ${lane.portName} · ${lane.modeName}`,
    value: `중간값 ${wonShort(lane.median)}`,
    sub: `기준 화물 ${STANDARD_CARGO.cbm} CBM · FC 도착 9구간 합계 · 요금표 ${lane.cards}장 · ${lane.transitMin}~${lane.transitMax}일`,
    shares: SEGMENTS.map((s) => lane.medianSegments[s] ?? 0),
  });
}
