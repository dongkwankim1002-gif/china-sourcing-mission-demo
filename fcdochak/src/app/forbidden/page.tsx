import Link from 'next/link';
import { Lock } from 'lucide-react';
import { Button } from '@/components/ui/core';
import { getViewer, homeOf } from '@/lib/server/viewer';

export const metadata = { title: '권한 없음', robots: { index: false } };

const AREA: Record<string, string> = { app: '화주 워크스페이스', partner: '물류사 콘솔', admin: '운영 어드민' };

export default async function Forbidden({ searchParams }: { searchParams: Promise<{ area?: string }> }) {
  const { area } = await searchParams;
  const v = await getViewer();
  return (
    <main id="main" className="grid min-h-dvh place-items-center px-4">
      <div className="max-w-md">
        <span className="grid size-12 place-items-center rounded-sm border-2 border-stamp text-stamp"><Lock className="size-5" /></span>
        <h1 className="mt-4 text-xl font-bold">이 화면을 볼 권한이 없습니다</h1>
        <p className="mt-2 text-sm text-muted">
          {AREA[area ?? ''] ?? '이 화면'}은 {area === 'admin' ? '운영자' : area === 'partner' ? '물류사 소속' : '화주 소속'} 계정만 들어갈 수 있습니다.
          {v ? ` 지금은 「${v.org.name}」로 들어와 있습니다.` : ' 로그인하지 않았습니다.'} 다른 조직에 속해 있다면 오른쪽 위 조직 전환에서 바꾸세요.
        </p>
        <div className="mt-6 flex gap-2">
          {v ? <Button asChild variant="primary"><Link href={homeOf(v)}>내 작업공간으로</Link></Button> : <Button asChild variant="primary"><Link href="/login">로그인</Link></Button>}
          <Button asChild variant="secondary"><Link href="/">첫 화면</Link></Button>
        </div>
      </div>
    </main>
  );
}
