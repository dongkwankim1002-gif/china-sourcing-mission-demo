/**
 * 업체 성적표(v2 6차 scorecard) — 업체 화면(/p/[slug], 정적 페이지)의 「성적표」 탭이 부른다. 정적 페이지를 동적으로 만들지 않으려고 따로 둔다.
 *   · 이름 붙은 성적은 로그인 화주·그 업체·운영자에게만(RLS · scorecard.public_named 꺼짐). 아니면 { locked: true }.
 *   · 표본 기준 미만은 보기가 거른다.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { getViewer } from '@/lib/server/viewer';
import { snapsFor } from '@/lib/server/scorecard';

export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: '업체를 찾지 못했습니다' }, { status: 404 });
  const v = await getViewer();
  const { snaps, named, config } = await snapsFor(v);
  const mine = snaps.filter((s) => s.entity_org_id === id);
  const allowed = named === 'all' || (named === 'own' && !!v?.orgs.some((o) => o.id === id));
  const headers = { 'Cache-Control': 'private, no-store' };
  if (!allowed) return NextResponse.json({ locked: true, loggedIn: !!v, minSamples: config.rules.minSamples }, { headers });
  return NextResponse.json({ locked: false, loggedIn: !!v, minSamples: config.rules.minSamples, rows: mine }, { headers });
}
