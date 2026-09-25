import Link from 'next/link';
import { BrandMark } from '@/components/brand-mark';
import { Button } from '@/components/ui/core';

export default function NotFound() {
  return (
    <main id="main" className="grid min-h-dvh place-items-center bg-paper px-4">
      <div className="max-w-md text-center">
        <Link href="/" className="inline-block rounded-sm bg-ink p-2"><BrandMark /></Link>
        <p className="display mt-8 text-[72px] leading-none text-text">404</p>
        <h1 className="mt-3 text-xl font-bold">찾는 페이지가 없습니다</h1>
        <p className="mt-2 text-sm text-muted">주소가 바뀌었거나, 업체가 게시를 내렸거나, 요금표가 만료됐을 수 있습니다. 번호로 찾으려면 로그인 후 ⌘K 검색을 쓰세요.</p>
        <div className="mt-6 flex justify-center gap-2">
          <Button asChild variant="primary"><Link href="/">첫 화면으로</Link></Button>
          <Button asChild variant="secondary"><Link href="/lanes">구간 시세 보기</Link></Button>
        </div>
      </div>
    </main>
  );
}
