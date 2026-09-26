/**
 * 업체 성적표(v2 6차 scorecard) — 업체 화면(/p/[slug], 정적 페이지)의 「성적표」 탭이 부른다. 정적 페이지를 동적으로 만들지 않으려고 따로 둔다.
 *   · 이름 붙은 성적은 로그인 화주·그 업체·운영자에게만(RLS · scorecard.public_named 꺼짐). 아니면 { locked: true }.
 *   · 표본 기준 미만은 보기가 거른다. 입점 업체(공식·인증 대기)만 — 공개정보 기준 업체는 성적을 싣지 않는다(0025).
 *   · 거래 지표(FC도착 거래 기록): 정시 입고·청구 편차·30일 FC 회송률·화주 평가(v_partner_metrics) + 견적 응답 속도(요청 → 첫 응찰 중앙값)
 *   · 설정·보기를 읽지 못하면 빈 성적(snapsForSafe) — 탭이 오류로 멈추지 않게.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { asPublic } from '@/lib/db';
import { getViewer } from '@/lib/server/viewer';
import { quoteResponseHours, snapsForSafe } from '@/lib/server/scorecard';

export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: '업체를 찾지 못했습니다' }, { status: 404 });
  const v = await getViewer();
  const { snaps, named, config } = await snapsForSafe(v);
  const org = (await asPublic((q) => q.query<{ business_type: string | null; status: string }>(`select business_type, status from fcd.orgs where id = $1 and kind = 'partner' and fcd.partner_listed(id)`, [id])))[0];
  if (!org) return NextResponse.json({ error: '업체를 찾지 못했습니다' }, { status: 404 });
  const kind = org.business_type === 'customs_broker' ? 'broker' : 'partner';
  const listed = org.status === 'official' || org.status === 'pending_verification';
  const mine = snaps.filter((s) => s.entity_org_id === id && s.entity_kind === kind);
  const allowed = named === 'all' || (named === 'own' && !!v?.orgs.some((o) => o.id === id));
  const headers = { 'Cache-Control': 'private, no-store' };
  if (!allowed || !listed) return NextResponse.json({ locked: true, loggedIn: !!v, minSamples: config.rules.minSamples, unlisted: !listed }, { headers });
  const [metrics, quote] = await Promise.all([
    asPublic(async (q) => (await q.query<Record<string, number | null>>('select * from fcd.v_partner_metrics where org_id = $1', [id]))[0] ?? null),
    quoteResponseHours([id]).then((m) => m.get(id) ?? null).catch(() => null),
  ]);
  return NextResponse.json({ locked: false, loggedIn: !!v, minSamples: config.rules.minSamples, rows: mine, trade: { metrics, quote } }, { headers });
}
