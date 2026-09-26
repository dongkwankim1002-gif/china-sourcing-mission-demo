// 셀러 인터뷰 링크 화면 캡처 — node scripts/shots-interview.mjs <base-url> [out-dir]
// 토큰이 그때그때 만들어지므로(해시만 저장) 운영자로 들어가 예시 대상과 링크를 만든 뒤, 로그인 없는 창으로 연다.
// 390·768·1440 × 밝음·어두움: 동의 → 선적 조건 단계. 가로 밀림도 잰다. 로컬(PGlite) 데모에서만 쓴다.
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const base = process.argv[2] ?? 'http://localhost:3100';
const out = process.argv[3] ?? 'docs/screens';
const exe = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: exe, args: ['--disable-background-networking', '--disable-component-update', '--no-first-run'] });

// 1) 운영자 — 예시 대상 한 명과 1회용 링크(링크마다 새 대상 — 동의를 누르면 그 링크의 흐름이 이어지므로)
async function makeLink(n) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
  const r = await ctx.request.post(`${base}/api/demo-login?as=admin`, { maxRedirects: 0 });
  if (r.status() !== 303) throw new Error(`데모 로그인 실패: ${r.status()}`);
  const page = await ctx.newPage();
  await page.goto(`${base}/admin/research`, { waitUntil: 'load' });
  const label = `캡처용 예시 셀러 ${Date.now().toString(36)}-${n}`;
  await page.locator('#rp-label').fill(label);
  await page.getByRole('button', { name: '대상 넣기' }).last().click();
  const row = page.locator('tr[data-testid^="participant-"]', { hasText: label });
  await row.waitFor();
  await row.getByRole('button', { name: /인터뷰 링크 만들기|새 링크 만들기/ }).click();
  const link = await row.getByTestId('research-link').inputValue();
  await ctx.close();
  return new URL(link).pathname;
}

const overflow = [];
let n = 0;
for (const theme of ['light', 'dark']) {
  for (const w of [390, 768, 1440]) {
    const p = await makeLink(n++);
    const ctx = await browser.newContext({
      viewport: { width: w, height: w < 500 ? 844 : w < 1000 ? 1024 : 900 },
      colorScheme: theme === 'dark' ? 'dark' : 'light',
      locale: 'ko-KR',
      timezoneId: 'Asia/Seoul',
      reducedMotion: 'reduce',
      isMobile: w < 500,
      hasTouch: w < 500,
    });
    await ctx.addInitScript(() => { try { localStorage.setItem('fcd-fonts', '1'); } catch {} });
    const page = await ctx.newPage();
    await page.goto(base + p, { waitUntil: 'load' });
    for (const [step, act] of [
      ['consent', null],
      ['lane', async () => page.getByRole('button', { name: '동의하고 시작' }).click()],
    ]) {
      if (act) await act();
      await page.locator(`[data-testid="interview-flow"][data-step="${step}"]`).waitFor({ timeout: 10_000 }).catch(() => {});
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(250);
      const docW = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth));
      if (docW > w + 1) overflow.push(`interview/${step} @${w}/${theme}: 문서 폭 ${docW}px`);
      const name = `interview_${step}.${w}.${theme}.jpg`;
      await page.screenshot({ path: path.join(out, name), type: 'jpeg', quality: 55 });
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
