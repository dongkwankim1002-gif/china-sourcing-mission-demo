/**
 * 공개 계산기 — 상위 5곳(가격순·추천 점수순) 총액과 1위의 9구간 비중. 특수관계 업체는 ?related=1 일 때만 순위에 넣는다.
 * 비로그인은 공개가 요금표만(RLS), 구간 금액 대신 비중(%)만 내려준다 — 9구간 상세는 가입 후.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { asViewer, todayKst } from '@/lib/db';
import { parseCargoQuery, toCargo } from '@/lib/cargo-params';
import { compare } from '@/lib/server/compare';
import { buildQuoteResponse, parsePublicSort } from '@/lib/public-quote';
import { loadSettings } from '@/lib/server/settings';
import { readSession } from '@/lib/auth/session';
import { allow, clientIp } from '@/lib/server/rate-limit';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const ip = clientIp(req.headers);
  if (!allow(`quote:${ip}`, 90)) {
    return NextResponse.json({ error: '잠시 뒤 다시 계산해 주세요(1분에 90번까지).' }, { status: 429 });
  }
  const q = parseCargoQuery(req.nextUrl.searchParams);
  const session = await readSession();
  const actor = session ? { id: session.userId } : null;
  const today = todayKst();
  const result = await asViewer(actor, async (db) => {
    const s = await loadSettings(db);
    return compare(db, { hub: q.hub, port: q.port, mode: q.mode, cargo: toCargo(q), traits: q.traits, fc: q.fc }, s, today);
  });
  const sp = req.nextUrl.searchParams;
  const body = buildQuoteResponse(result, { sort: parsePublicSort(sp.get('sort')), includeRelated: sp.get('related') === '1', detail: !!actor });
  return NextResponse.json(
    body,
    { headers: { 'Cache-Control': 'private, no-store' } },
  );
}
