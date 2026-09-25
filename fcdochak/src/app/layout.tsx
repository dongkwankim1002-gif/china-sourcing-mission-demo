import type { Metadata, Viewport } from 'next';
import { Toaster } from '@/components/toaster';
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

/**
 * 글꼴은 첫 화면 경로에서 뺀다(모바일 LCP·CLS). 처음 온 기기는 이 쪽을 시스템 글꼴로 끝까지 그리고,
 * 한가할 때 글꼴 파일만 캐시에 받아 둔다(이 쪽에서 글꼴을 바꿔 끼우지 않으므로 화면이 밀리지 않는다).
 * 받아 둔 기기는 다음 쪽부터 머리에서 바로 붙인다 — 캐시에 있으니 첫 그리기부터 Pretendard·Black Han Sans.
 */
const fontScript = `(function(){var k='fcd-fonts',h='/fonts/fcd/fonts.css',F=['/fonts/fcd/PretendardVariable.ks.woff2','/fonts/fcd/BlackHanSans.ks.woff2'];var c=false;try{c=localStorage.getItem(k)==='1'}catch(e){}if(c){var l=document.createElement('link');l.rel='stylesheet';l.href=h;document.head.appendChild(l);return}function warm(){Promise.all(F.map(function(u){return fetch(u).then(function(r){return r.ok&&r.blob()})})).then(function(){try{localStorage.setItem(k,'1')}catch(e){}},function(){})}function idle(){(window.requestIdleCallback||function(f){setTimeout(f,500)})(warm,{timeout:4000})}if(document.readyState==='complete')idle();else addEventListener('load',idle)})()`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        <script dangerouslySetInnerHTML={{ __html: fontScript }} />
        <noscript>
          <link rel="stylesheet" href="/fonts/fcd/fonts.css" />
        </noscript>
      </head>
      <body className="min-h-dvh">
        <a
          href="#main"
          className="sr-only z-[100] rounded-sm bg-label px-3 py-2 font-semibold text-on-label focus:not-sr-only focus:fixed focus:left-3 focus:top-3"
        >
          본문으로 건너뛰기
        </a>
        <TooltipProvider>{children}</TooltipProvider>
        <Toaster />
      </body>
    </html>
  );
}
