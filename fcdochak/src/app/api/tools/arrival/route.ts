/**
 * 공개 판매손익 계산기 — 구간 + 화물 + 특성 → 9구간 합계 중간값(집계 숫자만)과 특성 때문에 뺀 업체(이름·사유).
 * 업체별 가격은 싣지 않는다(가입 후 같은 조건 비교에서). IP 당 분당 60회.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { parseCargoQuery, toCargo } from '@/lib/cargo-params';
import { arrivalEstimate } from '@/lib/server/tools';
import { allow } from '@/lib/server/rate-limit';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local';
  if (!allow(`arrival:${ip}`, 60)) {
    return NextResponse.json({ error: '잠시 뒤 다시 계산해 주세요(1분에 60번까지).' }, { status: 429 });
  }
  const q = parseCargoQuery(req.nextUrl.searchParams);
  const body = await arrivalEstimate({ hub: q.hub, port: q.port, mode: q.mode, cargo: toCargo(q), traits: q.traits });
  return NextResponse.json(body, { headers: { 'Cache-Control': 'private, no-store' } });
}
