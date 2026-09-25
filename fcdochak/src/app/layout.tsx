import type { Metadata, Viewport } from 'next';
import { Toaster } from 'sonner';
import { TooltipProvider } from '@/components/ui/radix';
import { BRAND } from '@/lib/brand';
import { env } from '@/lib/env';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL(env.siteUrl),
  title: { default: `${BRAND.name} — ${BRAND.tagline}`, template: `%s · ${BRAND.name}` },
  description: BRAND.description,
  applicationName: BRAND.name,
  openGraph: { siteName: BRAND.name, locale: 'ko_KR', type: 'website' },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#0e2340' },
    { media: '(prefers-color-scheme: dark)', color: '#060d18' },
  ],
  width: 'device-width',
  initialScale: 1,
};

/** 첫 칠 전에 저장된 테마를 입힌다(깜빡임 방지). 저장값이 없으면 기기 설정을 따른다. */
const themeScript = `try{var t=localStorage.getItem('fcd-theme');if(t==='dark'||t==='light')document.documentElement.dataset.theme=t}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        <link rel="preload" href="/fonts/pretendard/PretendardVariable.subset.91.woff2" as="font" type="font/woff2" crossOrigin="" />
      </head>
      <body className="min-h-dvh">
        <a
          href="#main"
          className="sr-only z-[100] rounded-sm bg-label px-3 py-2 font-semibold text-on-label focus:not-sr-only focus:fixed focus:left-3 focus:top-3"
        >
          본문으로 건너뛰기
        </a>
        <TooltipProvider>{children}</TooltipProvider>
        <Toaster
          position="bottom-center"
          toastOptions={{
            classNames: {
              toast: '!rounded-sm !border !border-line !bg-surface !text-text !shadow-2 !font-sans',
              description: '!text-muted',
              actionButton: '!bg-label !text-on-label !font-semibold !rounded-xs',
            },
          }}
        />
      </body>
    </html>
  );
}
