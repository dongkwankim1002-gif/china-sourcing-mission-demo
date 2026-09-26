/**
 * 폴링 예약 경로 — 관세청 UNI-PASS 조회 한 회차 + (마지막 판이 6시간 넘었으면) 통계 새 판.
 *   · Authorization: Bearer <CRON_SECRET> 가 맞아야 한다(Vercel Cron 이 CRON_SECRET 을 이 머리글로 붙인다 — 확인 필요).
 *     CRON_SECRET 이 서버에 없으면 경로가 닫힌다(503).
 *   · UNIPASS_ENABLED 꺼짐이면 예시 조직 번호만 흉내로 돌린다(관세청 호출 없음).
 *   · 예약 자체(vercel.json crons)는 넣지 않았다 — 켤지는 사람이 정한다(docs/tracker-plan.md 5-2).
 */
import { NextResponse, type NextRequest } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { asSystem } from '@/lib/db';
import { env } from '@/lib/env';
import { pollOnce, recomputeIfStale } from '@/lib/server/tracker';
import { recomputeScorecardsIfStale, refreshSubmitted } from '@/lib/server/scorecard'; // v2 6차 scorecard — 물류사 제출 번호 조회 · 성적표 새 판

export const dynamic = 'force-dynamic';
// 한 회차 시간 한도(pollOnce POLL_TIME_LIMIT_MS 45초) + 통계 새 판이 들어가게. 플랫폼 한도는 요금제마다 다르다(확인 필요)
export const maxDuration = 60;

function same(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export async function GET(req: NextRequest) {
  const secret = env.cronSecret;
  if (!secret) return NextResponse.json({ error: '예약 경로가 닫혀 있습니다(CRON_SECRET 없음).' }, { status: 503 });
  const auth = req.headers.get('authorization') ?? '';
  if (!same(auth, `Bearer ${secret}`)) return NextResponse.json({ error: '권한이 없습니다.' }, { status: 401 });
  const summary = await pollOnce({ trigger: 'cron', actorId: null });
  const stats = await asSystem((q) => recomputeIfStale(q));
  // 폴링 회차가 시간 한도 대부분을 쓰므로 제출 번호는 한 번에 몇 건만(남은 것은 다음 회차 · 운영 버튼)
  const submitted = await refreshSubmitted({ actorId: null, limit: 5 });
  const score = await asSystem((q) => recomputeScorecardsIfStale(q));
  return NextResponse.json({ ok: true, summary, statsRows: stats?.rows ?? null, submitted, scorecardRows: score?.rows ?? null }, { headers: { 'Cache-Control': 'no-store' } });
}
