/**
 * v2 metrics — 운영 지표 화면 · 목적지 넓히기.
 * 두 모드 모두: 계산기 목적지 목록(쿠팡 FC 기본 + 예시 3PL·쇼핑몰 창고)과 안내, 운영 지표 화면(메뉴 연결·지표 칸·390 폭 넘침 없음).
 * 데모 켜짐에서만(E2E_DEMO=off 면 건너뜀): 데모 화주가 3PL 목적지로 견적 요청, 데모 숫자가 지표 칸에 채워짐.
 * 꺼짐에서 운영자는 npm run admin:create 로 만든 계정(E2E_ADMIN_EMAIL·E2E_ADMIN_PASSWORD).
 */
import { expect, test, type Browser, type Page } from '@playwright/test';

const demo = process.env.E2E_DEMO !== 'off';

async function asAdmin(browser: Browser, width = 1440): Promise<{ page: Page; close: () => Promise<void> }> {
  const ctx = await browser.newContext({ reducedMotion: 'reduce', viewport: { width, height: 900 } });
  const page = await ctx.newPage();
  if (demo) {
    const r = await ctx.request.post('/api/demo-login?as=admin', { maxRedirects: 0 });
    expect(r.status()).toBe(303);
  } else {
    await page.goto('/login');
    await page.locator('#email').fill(process.env.E2E_ADMIN_EMAIL!);
    await page.locator('#password').fill(process.env.E2E_ADMIN_PASSWORD!);
    await page.getByRole('button', { name: '로그인' }).last().click();
    await page.waitForURL((u) => !u.pathname.startsWith('/login'));
  }
  return { page, close: () => ctx.close() };
}

test('계산기 목적지 — 기본은 쿠팡 FC, 예시 3PL·쇼핑몰 창고를 고르면 마지막 구간 안내', async ({ page }) => {
  await page.goto('/');
  const sel = page.locator('#c-fc');
  await expect(sel).toHaveValue('FC-ICH');
  await expect(page.getByTestId('destination-note')).toHaveCount(0);
  await expect(sel.locator('optgroup[label="쿠팡 FC"] option')).toHaveCount(10);
  await expect(sel.locator('optgroup[label="국내 3PL 창고"] option')).toHaveCount(3);
  await expect(sel.locator('optgroup[label="다른 쇼핑몰 물류센터"] option')).toHaveCount(3);
  for (const t of await sel.locator('optgroup:not([label="쿠팡 FC"]) option').allInnerTexts()) expect(t.trim()).toMatch(/^예시 /);
  await sel.selectOption('TP-BSN');
  const note = page.getByTestId('destination-note');
  await expect(note).toBeVisible();
  await expect(note).toContainText('예시 3PL 창고 · 부산');
  await expect(note).toContainText('참고치');
  // API — 쿠팡 FC 는 목적지 반영 없음, 3PL 은 있음
  const q = 'hub=YIW&port=ICN&mode=ANY&units=1200&cartons=40&kg=650&cbm=3&goods=24000&cur=RMB';
  const fc = await (await page.request.get(`/api/quote?${q}&fc=FC-ICH`)).json();
  const tpl = await (await page.request.get(`/api/quote?${q}&fc=TP-BSN`)).json();
  expect(fc.destination).toBeNull();
  expect(tpl.destination).toMatchObject({ code: 'TP-BSN', kind: '3pl' });
  if (demo && fc.top[0] && tpl.top[0]) expect(tpl.top[0].total).not.toBe(fc.top[0].total);
  await sel.selectOption('FC-ICH');
  await expect(page.getByTestId('destination-note')).toHaveCount(0);
});

test('운영 지표 — 운영 메뉴에서 들어가고 일곱 칸이 보인다', async ({ browser }) => {
  const { page, close } = await asAdmin(browser);
  await page.goto('/admin');
  await page.getByRole('navigation').getByRole('link', { name: '운영 지표' }).first().click();
  await page.waitForURL(/\/admin\/metrics/);
  await expect(page.getByRole('heading', { level: 1, name: '운영 지표' })).toBeVisible();
  const tiles = page.getByTestId('metrics-tiles');
  for (const label of ['월간 활성 셀러', '관리 선적 수', '초대로 들어온 업체', '재선적률', '견적 대비 청구 차이', '회송률', '선적당 매출(수수료 기준)']) {
    await expect(tiles.getByText(label, { exact: true })).toBeVisible();
  }
  await expect(page.getByTestId('metrics-funnel').locator('tbody tr')).toHaveCount(10);
  // 초대 기록이 없으면 0 · 준비 중
  await expect(tiles.getByText('초대 기록 준비 중')).toBeVisible();
  if (demo) {
    const booked = page.getByTestId('metrics-funnel').locator('tr').filter({ has: page.getByRole('rowheader', { name: '예약', exact: true }) });
    const n = Number((await booked.locator('td').first().innerText()).replace(/,/g, ''));
    expect(n).toBeGreaterThan(0);
    await expect(page.getByText('예시', { exact: true }).first()).toBeVisible();
    // 「예시 빼고」면 데모 숫자가 빠진다
    await page.getByRole('group', { name: '예시 데이터' }).getByRole('link', { name: '예시 빼고' }).click();
    await page.waitForURL(/demo=0/);
    await expect(page.getByTestId('metrics-tiles')).toBeVisible();
  }
  await close();
});

test('운영 지표 — 390 폭에서 가로로 넘치지 않는다', async ({ browser }) => {
  const { page, close } = await asAdmin(browser, 390);
  await page.goto('/admin/metrics');
  await expect(page.getByTestId('metrics-tiles')).toBeVisible();
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(over).toBeLessThanOrEqual(1);
  await close();
});

test('견적 요청 — 목적지를 예시 쇼핑몰 창고로 골라 올리면 요청에 그 목적지가 적힌다', async ({ browser }) => {
  test.skip(!demo, '데모 화주 계정은 DEMO_MODE 켜짐에서만');
  const ctx = await browser.newContext({ reducedMotion: 'reduce' });
  const r = await ctx.request.post('/api/demo-login?as=shipper', { maxRedirects: 0 });
  expect(r.status()).toBe(303);
  const page = await ctx.newPage();
  await page.goto('/app/requests/new?hub=YIW&port=ICN&mode=LCL&units=800&cartons=20&kg=300&cbm=1.6&goods=12000');
  const sel = page.locator('#cf-fc');
  await expect(sel).toHaveValue('FC-ICH');
  await sel.selectOption('MK-GMP');
  const title = `목적지 시험 ${Date.now().toString(36)}`;
  await page.locator('#rq-title').fill(title);
  await page.getByRole('button', { name: '견적 요청 올리기' }).click();
  await page.waitForURL(/\/app\/requests\/[0-9a-f-]{36}/);
  await expect(page.getByText(title).first()).toBeVisible();
  await page.getByRole('tab', { name: '화물' }).click();
  await expect(page.getByText('예시 쇼핑몰 물류센터 · 경기 김포').first()).toBeVisible();
  await ctx.close();
});
