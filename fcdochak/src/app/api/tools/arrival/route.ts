/**
 * 공개 판매손익 계산기 — 구간 + 화물 + 특성 → 9구간 합계 중간값(집계 숫자만)과 특성 때문에 뺀 업체(이름·사유).
 * 업체별 가격은 싣지 않는다(가입 후 같은 조건 비교에서). IP 당 분당 횟수·최소 표본은 설정 tools.arrival_rule.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { parseCargoQuery, toCargo } from '@/lib/cargo-params';
import { arrivalEstimate, publicArrivalRule } from '@/lib/server/tools';
import { allow, clientIp } from '@/lib/server/rate-limit';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const rule = await publicArrivalRule();
  if (!allow(`arrival:${clientIp(req.headers)}`, rule.perMinute)) {
    return NextResponse.json({ error: `잠시 뒤 다시 계산해 주세요(1분에 ${rule.perMinute}번까지).` }, { status: 429 });
  }
  const q = parseCargoQuery(req.nextUrl.searchParams);
  const body = await arrivalEstimate({ hub: q.hub, port: q.port, mode: q.mode, cargo: toCargo(q), traits: q.traits });
  return NextResponse.json(body, { headers: { 'Cache-Control': 'private, no-store' } });
}
