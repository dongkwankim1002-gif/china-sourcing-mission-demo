import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getViewer } from '@/lib/server/viewer';
import { LoginForm } from './login-form';
import { env } from '@/lib/env';
import { DemoMenu } from '@/components/public/header-client';

export const metadata: Metadata = { title: '로그인', alternates: { canonical: '/login' } };

const DEMO_MSG: Record<string, string> = {
  off: '예시 데이터를 걷어낸 뒤라 데모로 둘러볼 수 없습니다.',
  nopass: '데모 계정 비밀번호가 설정되지 않았습니다(DEMO_PASSWORD). 운영자에게 알려 주세요.',
  missing: '데모 계정이 아직 없습니다. 데모 시드를 넣은 뒤 다시 시도해 주세요.',
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  // 이미 로그인한 사람이 「로그인 뒤 여기로」(next) 주소로 오면 곧장 그리로 — 공개 「내 화물 등록」 같은 단추가 한 단계를 덜 거치게(v2 6차 검토 고침).
  // next 가 없으면 로그인 화면을 그대로 보인다(다른 계정으로 들어가기). 안의 주소만(session.ts safeNext 와 같은 규칙)
  const next = sp.next && sp.next.startsWith('/') && !sp.next.startsWith('//') && !sp.next.includes('\\') ? sp.next : null;
  if (next && (await getViewer())) redirect(next);
  return (
    <div className="mx-auto grid max-w-[960px] gap-8 px-4 py-12 md:grid-cols-2">
      <div>
        <h1 className="display text-[clamp(28px,4vw,40px)]">로그인</h1>
        <p className="mt-2 text-sm text-muted">화주·물류사·운영자 모두 같은 곳에서 들어갑니다. 들어가면 소속에 맞는 화면으로 갑니다.</p>
        {sp.demo && DEMO_MSG[sp.demo] ? <p role="alert" className="mt-4 rounded-sm border border-caution/40 bg-caution-bg p-3 text-sm text-caution">{DEMO_MSG[sp.demo]}</p> : null}
        <LoginForm next={sp.next ?? ''} />
        <p className="mt-6 text-sm text-muted">
          처음이신가요? <Link href="/join/shipper" className="font-semibold text-text underline">화주로 시작하기</Link> ·{' '}
          <Link href="/join/partner" className="font-semibold text-text underline">물류사 입점 신청</Link>
        </p>
      </div>
      {env.demoMode ? (
        <aside className="self-start rounded-md border border-line bg-surface p-5">
          <h2 className="font-bold">둘러보기만 하시려면</h2>
          <p className="mt-1 text-sm text-muted">예시 데이터로 채워진 화주·물류사·운영 화면을 가입 없이 볼 수 있습니다.</p>
          <div className="mt-4">
            <DemoMenu variant="primary" align="start" />
          </div>
        </aside>
      ) : null}
    </div>
  );
}
