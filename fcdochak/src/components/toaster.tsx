'use client';
/** 알림 토스트 — 첫 화면 스크립트에서 빼고 그린 뒤에 불러온다(공개 쪽 LCP). */
import dynamic from 'next/dynamic';

const Sonner = dynamic(() => import('sonner').then((m) => m.Toaster), { ssr: false });

export function Toaster() {
  return (
    <Sonner
      position="bottom-center"
      toastOptions={{
        classNames: {
          toast: '!rounded-sm !border !border-line !bg-surface !text-text !shadow-2 !font-sans',
          description: '!text-muted',
          actionButton: '!bg-label !text-on-label !font-semibold !rounded-xs',
        },
      }}
    />
  );
}
