// v2 5차 tracker 캡처 중 목록 캡처(scripts/shots.mjs)로 안 잡히는 것 — node scripts/shots-track.mjs <base-url> [out-dir]
//   track_result      공개 /track 에 예시 번호를 넣고 조회한 결과(관세청 꺼짐 → 흉내, 저장 없음)
//   app_shipments_customs  화주 선적 화면의 「관세청 실측」 줄(이은 번호가 있는 첫 선적, 그 줄로 내려서)
//   p_hanbada_lead    업체 화면의 「실측 통관 소요(표본 N)」 칸(그 칸으로 내려서)
// 390·768·1440 × 밝음·어두움. 가로 밀림도 잰다. 로컬(PGlite) 데모에서만 쓴다 — 관세청을 부르지 않는다.
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const base = process.argv[2] ?? 'http://localhost:3100';
const out = process.argv[3] ?? 'docs/screens';
const exe = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: exe, args: ['--disable-background-networking', '--disable-component-update', '--no-first-run'] });

// 이은 번호가 있는 선적 하나 — 화주로 목록의 상세를 차례로 열어 「관세청 실측」 줄이 있는 첫 곳
async function findCustomsShipment() {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const r = await ctx.request.post(`${base}/api/demo-login?as=shipper`, { maxRedirects: 0 });
  if (r.status() !== 303) throw new Error(`데모 로그인 실패: ${r.status()}`);
  const html = await (await ctx.request.get(`${base}/app/shipments`)).text();
  const hrefs = [...new Set([...html.matchAll(/href="(\/app\/shipments\/[0-9a-f-]{36})"/g)].map((m) => m[1]))];
  let found = null;
  for (const h of hrefs.slice(0, 40)) {
    const body = await (await ctx.request.get(base + h)).text();
    if (body.includes('shipment-customs-actual')) {
      found = h;
      break;
    }
  }
  await ctx.close();
  return found;
}

const customsHref = await findCustomsShipment();
if (!customsHref) console.log('skip app_shipments_customs (「관세청 실측」 줄이 있는 선적 없음)');

const shots = [
  {
    name: 'track_result',
    path: '/track',
    act: async (page) => {
      // v2 6차 — 공개 /track 의 조회는 「번호 한 번 보기」 접힘 안에 있다
      await page.locator('summary', { hasText: '번호 한 번 보기' }).click();
      await page.locator('#trk-number').fill('EXHBL-SHOT-0001');
      await page.locator('#trk-year').fill('2026');
      await page.getByRole('button', { name: '조회하기' }).click();
      await page.getByTestId('track-result').waitFor({ timeout: 10_000 });
    },
    scrollTo: 'track-result',
  },
  ...(customsHref ? [{ name: 'app_shipments_customs', login: 'shipper', path: customsHref, scrollTo: 'shipment-customs-actual' }] : []),
  // v2 6차 scorecard — 5차 실측 칸은 업체 화면 「성적표」 탭으로 합쳤다(#scorecard 로 바로 열림)
  { name: 'p_hanbada_lead', path: '/p/hanbada#scorecard', scrollTo: 'partner-lead-time' },
];

const overflow = [];
for (const theme of ['light', 'dark']) {
  for (const w of [390, 768, 1440]) {
    for (const s of shots) {
      const ctx = await browser.newContext({
        viewport: { width: w, height: w < 500 ? 844 : w < 1000 ? 1024 : 900 },
        deviceScaleFactor: 1,
        colorScheme: theme === 'dark' ? 'dark' : 'light',
        locale: 'ko-KR',
        timezoneId: 'Asia/Seoul',
        reducedMotion: 'reduce',
      });
      await ctx.addInitScript(() => { try { localStorage.setItem('fcd-fonts', '1'); } catch {} });
      if (s.login) {
        const r = await ctx.request.post(`${base}/api/demo-login?as=${s.login}`, { maxRedirects: 0 });
        if (r.status() !== 303) throw new Error(`데모 로그인 실패: ${r.status()}`);
      }
      const page = await ctx.newPage();
      await page.goto(base + s.path, { waitUntil: 'load' });
      await page.waitForLoadState('networkidle', { timeout: 4000 }).catch(() => {});
      await page.evaluate(() => document.fonts.ready);
      if (s.act) await s.act(page);
      if (s.scrollTo) {
        // 고정 머리 밑으로 가리지 않게 칸의 위를 창 위에서 조금 내려 둔다
        await page.getByTestId(s.scrollTo).first().evaluate((el) => window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 96));
      }
      await page.waitForTimeout(350);
      const docW = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth));
      if (docW > w + 1) overflow.push(`${s.name} @${w}/${theme}: 문서 폭 ${docW}px`);
      const file = `${s.name}.${w}.${theme}.jpg`;
      await page.screenshot({ path: path.join(out, file), type: 'jpeg', quality: 55 });
      console.log('shot', file, docW > w + 1 ? `(가로 밀림 ${docW})` : '');
      await ctx.close();
    }
  }
}
await browser.close();
if (overflow.length) {
  console.log('\n가로 밀림:\n' + overflow.join('\n'));
  process.exitCode = 2;
}
