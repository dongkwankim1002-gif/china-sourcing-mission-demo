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
    const page = await ctx.newPage();
    if (login) {
      await page.goto(base + '/login');
      await page.evaluate(async (as) => {
        const f = document.createElement('form');
        f.method = 'post';
        f.action = `/api/demo-login?as=${as}`;
        document.body.append(f);
        f.submit();
      }, login);
      await page.waitForLoadState('load');
    }
    for (const p of paths) {
      const url = base + p;
      await page.goto(url, { waitUntil: 'load' });
      await page.waitForLoadState('networkidle', { timeout: 4000 }).catch(() => {});
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(250);
      const docW = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth));
      if (docW > w + 1) overflow.push(`${p} @${w}/${theme}: 문서 폭 ${docW}px`);
      const name = `${(p === '/' ? 'home' : p.replace(/^\//, '').replace(/[/?=&]+/g, '_'))}.${w}.${theme}.jpg`;
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
