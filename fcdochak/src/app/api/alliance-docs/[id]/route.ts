import { NextResponse } from 'next/server';
import { asUser } from '@/lib/db';
import { readSession } from '@/lib/auth/session';
import { signDoc, storageReady } from '@/lib/server/doc-storage';

export const dynamic = 'force-dynamic';

/** 제휴 요건 서류 내려받기 — 그 물류사와 운영자만(RLS), 60초 서명 주소로 넘긴다 */
export async function GET(_: Request, ctx: { params: Promise<{ id: string }> }) {
  const s = await readSession();
  if (!s) return new NextResponse('로그인이 필요합니다', { status: 401 });
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new NextResponse('없는 서류입니다', { status: 404 });
  const doc = (await asUser({ id: s.userId }, (q) => q.query<{ storage_path: string | null; file_name: string | null }>('select storage_path, file_name from fcd.alliance_requirements where id = $1', [id])))[0];
  if (!doc || !doc.file_name) return new NextResponse('없거나 볼 수 없는 서류입니다', { status: 404 });
  if (!doc.storage_path || !storageReady()) {
    return new NextResponse(`「${doc.file_name}」 — 이 환경에는 파일 저장소가 연결되어 있지 않아 기록만 있습니다(예시 데이터이거나 로컬 실행).`, { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } });
  }
  const url = await signDoc(doc.storage_path);
  if (!url) return new NextResponse('서명 주소를 만들지 못했습니다', { status: 502 });
  return NextResponse.redirect(url);
}
