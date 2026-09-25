'use client';
import Link from 'next/link';
import { Button } from '@/components/ui/core';

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main id="main" className="grid min-h-[70dvh] place-items-center px-4">
      <div className="max-w-md">
        <p className="display text-[64px] leading-none text-stamp">500</p>
        <h1 className="mt-3 text-xl font-bold">화면을 그리다 멈췄습니다</h1>
        <p className="mt-2 text-sm text-muted">
          서버에서 처리하던 중 문제가 생겼습니다. 적어 두신 내용은 사라지지 않았습니다. 다시 시도해 보시고, 같은 일이 되풀이되면 이 번호와 함께 알려 주세요.
        </p>
        {error.digest ? <p className="mt-2 font-mono text-xs text-muted">오류 번호 {error.digest}</p> : null}
        <div className="mt-6 flex gap-2">
          <Button variant="primary" onClick={() => reset()}>다시 시도</Button>
          <Button asChild variant="secondary"><Link href="/">첫 화면으로</Link></Button>
        </div>
      </div>
    </main>
  );
}
