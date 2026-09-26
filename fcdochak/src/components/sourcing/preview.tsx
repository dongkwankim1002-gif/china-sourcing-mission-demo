import { Eye } from 'lucide-react';
import { Chip } from '@/components/ui/core';
import { cn } from '@/lib/cn';

/** 「준비 중 · 미리보기」 표시 — sourcing.enabled 가 꺼져 있으면 모든 소싱 화면 맨 위에 */
export function SourcingPreviewNotice({ on, className }: { on: boolean; className?: string }) {
  if (on)
    return (
      <p data-testid="sourcing-notice" className={cn('mb-4 flex flex-wrap items-center gap-2 rounded-md border border-ok/40 bg-ok-bg px-4 py-2.5 text-sm text-ok', className)}>
        <Chip tone="ok">시범 운영</Chip>
        현지 소싱 담당이 후보를 찾습니다. 앱은 공급처에 직접 연락하지 않습니다.
      </p>
    );
  return (
    <p data-testid="sourcing-notice" className={cn('mb-4 flex flex-wrap items-center gap-2 rounded-md border border-caution/40 bg-caution-bg px-4 py-2.5 text-sm text-caution', className)}>
      <Chip tone="caution" icon={<Eye aria-hidden />}>
        준비 중 · 미리보기
      </Chip>
      <span className="min-w-0">
        차후 개발 예정 기능을 미리 보여 드립니다. 요청은 기록만 하고, 공급처·담당에게 연락하거나 알림을 보내지 않습니다.
      </span>
    </p>
  );
}
