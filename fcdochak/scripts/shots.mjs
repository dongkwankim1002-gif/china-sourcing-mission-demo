// 화면 캡처 — node scripts/shots.mjs <base-url> <out-dir> <path[,path...]> [--widths 390,768,1440] [--themes light,dark] [--login shipper|partner|admin] [--full]
// 가로 밀림(390px)도 함께 잰다: 문서 폭이 창 폭보다 크면 목록으로 알린다.
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const base = args[0] ?? 'http://localhost:3100';
const out = args[1] ?? 'docs/screens';
const paths = (args[2] ?? '/').split(',');
const opt = (k, d) => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : d;
};
const widths = opt('--widths', '390,1440').split(',').map(Number);
const themes = opt('--themes', 'light').split(',');
const login = opt('--login', null);
const cookieLocale = opt('--locale', null);
const suffix = opt('--suffix', '');
const full = args.includes('--full');
const quality = Number(opt('--quality', '62'));
const exe = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: exe, args: ['--disable-background-networking', '--disable-component-update', '--no-first-run'] });
const overflow = [];
for (const theme of themes) {
  for (const w of widths) {
    const ctx = await browser.newContext({
      viewport: { width: w, height: w < 500 ? 844 : w < 1000 ? 1024 : 900 },
      deviceScaleFactor: 1,
      colorScheme: theme === 'dark' ? 'dark' : 'light',
      locale: 'ko-KR',
      timezoneId: 'Asia/Seoul',
      reducedMotion: 'reduce',
    });
    // 재방문 상태 — 글꼴을 받아 둔 기기처럼 처음부터 Pretendard·Black Han Sans 로 그린다(layout.tsx fontScript)
    await ctx.addInitScript(() => { try { localStorage.setItem('fcd-fonts', '1'); } catch {} });
    const page = await ctx.newPage();
    if (login) {
      const r = await ctx.request.post(`${base}/api/demo-login?as=${login}`, { maxRedirects: 0 });
      if (r.status() !== 303) throw new Error(`데모 로그인 실패: ${r.status()}`);
      const loc = r.headers()['location'] ?? '';
      if (loc.includes('/login')) throw new Error(`데모 로그인 거부: ${loc}`);
    }
    // 글꼴을 이 창의 캐시에 먼저 받아 둔다(재방문과 같은 조건)
    await page.goto(base + '/robots.txt');
    await page.evaluate(() => Promise.all(['/fonts/fcd/PretendardVariable.ks.woff2', '/fonts/fcd/BlackHanSans.ks.woff2'].map((u) => fetch(u).then((r) => r.blob()))));
    if (cookieLocale) await ctx.addCookies([{ name: 'fcd_locale', value: cookieLocale, url: base }]);
    for (const spec of paths) {
      // 「목록>접두어」 — 목록에서 그 접두어로 시작하는 첫 상세 링크를 따라간다
      let p = spec;
      let label = spec;
      if (spec.includes('>')) {
        const [list, prefix] = spec.split('>');
        await page.goto(base + list, { waitUntil: 'load' });
        const href = await page.evaluate((pre) => {
          const a = [...document.querySelectorAll('a[href]')].find((x) => {
            const h = x.getAttribute('href') ?? '';
            return h.startsWith(pre) && /[0-9a-f]{8}-[0-9a-f]{4}/.test(h);
          });
          return a?.getAttribute('href') ?? null;
        }, prefix);
        if (!href) {
          console.log('skip', spec, '(상세 링크 없음)');
          continue;
        }
        p = href;
        label = prefix.replace(/\/$/, '') + '/detail';
      }
      const url = base + p;
      await page.goto(url, { waitUntil: 'load' });
      await page.waitForLoadState('networkidle', { timeout: 4000 }).catch(() => {});
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(250);
      const docW = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth));
      if (docW > w + 1) overflow.push(`${label} @${w}/${theme}: 문서 폭 ${docW}px`);
      const name = `${(label === '/' ? 'home' : label.replace(/^\//, '').replace(/[/?=&]+/g, '_'))}${suffix}.${w}.${theme}.jpg`;
      await page.screenshot({ path: path.join(out, name), fullPage: full, type: 'jpeg', quality });
      console.log('shot', name, docW > w + 1 ? `(가로 밀림 ${docW})` : '');
    }
    await ctx.close();
  }
}
await browser.close();
if (overflow.length) {
  console.log('\n가로 밀림:\n' + overflow.join('\n'));
  process.exitCode = 2;
}
