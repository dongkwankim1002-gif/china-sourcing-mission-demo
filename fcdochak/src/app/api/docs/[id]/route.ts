import { NextResponse } from 'next/server';
import { asUser } from '@/lib/db';
import { env } from '@/lib/env';
import { readSession } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';

/** 서류 내려받기 — 볼 수 있는 사람(RLS)만, 60초짜리 서명 주소로 넘긴다. */
export async function GET(_: Request, ctx: { params: Promise<{ id: string }> }) {
  const s = await readSession();
  if (!s) return new NextResponse('로그인이 필요합니다', { status: 401 });
  const { id } = await ctx.params;
  const doc = (await asUser({ id: s.userId }, (q) => q.query<{ storage_path: string | null; file_name: string }>('select storage_path, file_name from fcd.documents where id = $1', [id])))[0];
  if (!doc) return new NextResponse('없거나 볼 수 없는 서류입니다', { status: 404 });
  if (!doc.storage_path || !env.supabaseUrl || !env.supabaseServiceKey) {
    return new NextResponse(`「${doc.file_name}」 — 이 환경에는 파일 저장소가 연결되어 있지 않아 기록만 있습니다(예시 데이터이거나 로컬 실행).`, { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } });
  }
  const r = await fetch(`${env.supabaseUrl}/storage/v1/object/sign/fcd-docs/${encodeURI(doc.storage_path)}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${env.supabaseServiceKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({ expiresIn: 60 }),
  });
  if (!r.ok) return new NextResponse('서명 주소를 만들지 못했습니다', { status: 502 });
  const j = (await r.json()) as { signedURL: string };
  return NextResponse.redirect(`${env.supabaseUrl}/storage/v1${j.signedURL}`);
}
