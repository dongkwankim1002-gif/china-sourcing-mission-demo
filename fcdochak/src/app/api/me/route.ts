import { NextResponse } from 'next/server';
import { getViewer, homeOf } from '@/lib/server/viewer';

export const dynamic = 'force-dynamic';

/** 공개 머리 띠가 「로그인 / 내 작업공간」을 고르려고 부른다. 정적 페이지를 동적으로 만들지 않기 위해. */
export async function GET() {
  const v = await getViewer();
  return NextResponse.json(v ? { name: v.name, home: homeOf(v) } : null, { headers: { 'Cache-Control': 'private, no-store' } });
}
