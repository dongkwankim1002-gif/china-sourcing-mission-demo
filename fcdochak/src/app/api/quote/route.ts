/**
 * 공개 계산기 — 상위 5곳 총액과, 가장 낮은 곳의 9구간 비중.
 * 비로그인은 공개가 요금표만(RLS), 구간 금액 대신 비중(%)만 내려준다 — 9구간 상세는 가입 후.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { asViewer, todayKst } from '@/lib/db';
import { parseCargoQuery, toCargo } from '@/lib/cargo-params';
import { compare, sortOffers } from '@/lib/server/compare';
import { loadSettings } from '@/lib/server/settings';
import { readSession } from '@/lib/auth/session';
import { allow } from '@/lib/server/rate-limit';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local';
  if (!allow(`quote:${ip}`, 90)) {
    return NextResponse.json({ error: '잠시 뒤 다시 계산해 주세요(1분에 90번까지).' }, { status: 429 });
  }
  const q = parseCargoQuery(req.nextUrl.searchParams);
  const session = await readSession();
  const actor = session ? { id: session.userId } : null;
  const today = todayKst();
  const result = await asViewer(actor, async (db) => {
    const s = await loadSettings(db);
    return compare(db, { hub: q.hub, port: q.port, mode: q.mode, cargo: toCargo(q), traits: q.traits }, s, today);
  });
  const top = sortOffers(result.offers, 'cheapest').slice(0, 5);
  const best = top[0];
  const detail = !!actor;
  return NextResponse.json(
    {
      count: result.offers.length,
      excluded: result.excluded.length,
      top: top.map((o) => ({
        name: o.partner.name,
        slug: o.partner.slug,
        status: o.partner.status,
        logo: o.partner.logo_path,
        total: o.quote.total,
        perUnit: o.quote.perUnit,
        mode: o.mode,
        transit: o.transit,
        filled: o.quote.filled.length,
        related: !!o.partner.related_party_note,
      })),
      bar: best
        ? best.quote.segments.map((s) => ({
            segment: s.segment,
            amount: s.amount == null ? null : detail ? s.amount : Math.round((s.amount / best.quote.total) * 1000),
            certainty: s.certainty,
            filled: s.filled,
          }))
        : null,
      barUnit: detail ? 'won' : 'permille',
      verdicts: result.verdicts.map((v) => ({ code: v.code, name: v.name_ko, text: v.verdict_ko })),
    },
    { headers: { 'Cache-Control': 'private, no-store' } },
  );
}
