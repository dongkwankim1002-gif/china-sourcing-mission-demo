import Link from 'next/link';
import { Check, LockKeyhole } from 'lucide-react';
import { cn } from '@/lib/cn';

/**
 * 「무엇이 공개이고 무엇이 가입 뒤인가」 — 구간 시세 쪽에서 같은 말로 보인다.
 * 공개: 구간별 9구간 중간값·합계·최저, 이 구간 업체 이름. 가입 후: 업체별 가격, 견적 요청.
 */
export function OpenGate({ className, toolHref = '/tools/pnl' }: { className?: string; toolHref?: string }) {
  return (
    <div className={cn('grid gap-px overflow-hidden rounded-md border border-line bg-line-2 text-sm sm:grid-cols-2', className)} data-testid="open-gate">
      <div className="bg-surface px-4 py-3">
        <p className="flex items-center gap-1.5 text-xs font-bold text-ok">
          <Check className="size-3.5" aria-hidden /> 가입 없이 공개
        </p>
        <p className="mt-1 text-text">
          구간별 9구간 중간값과 합계 · 최저 · 이 구간 업체 이름 ·{' '}
          <Link href={toolHref} className="font-semibold underline underline-offset-2">
            판매손익 계산기
          </Link>
        </p>
      </div>
      <div className="bg-surface px-4 py-3">
        <p className="flex items-center gap-1.5 text-xs font-bold text-muted">
          <LockKeyhole className="size-3.5" aria-hidden /> 가입 후
        </p>
        <p className="mt-1 text-text">
          업체별 9구간 가격 비교 · 견적 요청 올리기 ·{' '}
          <Link href="/join/shipper" className="font-semibold underline underline-offset-2">
            화주로 시작하기
          </Link>
        </p>
      </div>
    </div>
  );
}
