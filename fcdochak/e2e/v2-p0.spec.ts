/**
 * v2 p0 — 신뢰 버그 화면 흐름.
 * 데모 켜짐에서만 도는 시험(E2E_DEMO=off 면 건너뜀): 헤더 데모 메뉴로 화주·물류사·운영 들어가기, 정렬·특수관계 토글.
 * 두 모드 모두: H1 읽히는 이름, 기준 화물 첫 값·「이 조건 기준」, 9구간 막대 대체 글 + 표, 미리보기 띠(PREVIEW_BANNER 없으면 안 보임).
 */
import { expect, test } from '@playwright/test';

const demo = process.env.E2E_DEMO !== 'off';
const previewOn = !!process.env.E2E_PREVIEW_BANNER;

test('⑤ 홈 H1 의 읽히는 이름이 한 문장 그대로', async ({ page }) => {
  await page.goto('/');
  const h1 = page.getByRole('heading', { level: 1 });
  await expect(h1).toHaveAccessibleName('중국 공장에서 쿠팡 FC까지, 같은 조건으로 한 줄 비교.');
  await expect(h1).toContainText('같은 조건');
});

test('① 계산기 첫 값은 공표 기준 화물, 총액 옆에 「이 조건 기준」', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#c-kg')).toHaveValue(/^650/);
  await expect(page.locator('#c-cbm')).toHaveValue(/^3(\.0+)?$/);
  await expect(page.locator('#c-units')).toHaveValue('1,200');
  await expect(page.locator('#c-cartons')).toHaveValue('40');
  await expect(page.locator('#c-goods')).toHaveValue('24,000');
  const cond = page.getByTestId('calc-condition');
  await expect(cond).toContainText('이 조건 기준');
  await expect(cond).toContainText('1,200개 · 40박스 · 650 kg · 3 CBM · 물품가 24,000 RMB');
  // 구간 시세 표의 기준 화물과 같은 말
  await expect(page.getByText('기준 화물 3 CBM · 650 kg · 40박스 · 1,200개').first()).toBeVisible();
  // 입력을 바꾸면 조건 글도 바뀐다
  await page.locator('#c-kg').fill('900');
  await expect(cond).toContainText('900 kg');
});

test('②⑥⑦ 제목은 실제 개수, 막대 대체 글은 짧고 표가 따로, 확정·참고치 포함 합계가 따로', async ({ page }) => {
  await page.goto('/');
  const result = page.locator('section[aria-live="polite"][aria-busy]');
  const title = result.getByRole('heading', { level: 2 }).first();
  const rows = page.getByTestId('calc-top').locator('li');
  const n = await rows.count();
  if (n >= 2) await expect(title).toHaveText(`상위 ${n}곳 총액`);
  else if (n === 1) await expect(title).toHaveText('맞는 1곳 총액');
  else await expect(title).toHaveText('맞는 업체 없음');
  if (!demo) return;
  const bar = result.getByRole('img', { name: /9구간/ }).first();
  await expect(bar).toBeVisible();
  const name = (await bar.getAttribute('aria-label')) ?? '';
  expect(name.length).toBeLessThan(140);
  expect(name).toMatch(/가장 큰 구간/);
  // 구간별 숫자는 표로(화면 읽기용)
  const tableId = await bar.getAttribute('aria-describedby');
  expect(tableId).toBeTruthy();
  const table = page.locator(`[id="${tableId}"] table`);
  await expect(table.locator('tbody tr')).toHaveCount(9);
  await expect(table).toContainText('국제운송');
  const totals = page.getByTestId('calc-totals');
  await expect(totals).toContainText('확정 합계');
  await expect(totals).toContainText('참고치 포함 합계');
});

test('⑧⑨ 정렬 기준 토글과 특수관계 포함 — 현재 기준이 보이고, 1위가 특수관계면 경고 띠', async ({ page }) => {
  test.skip(!demo, '데모 요금표가 있어야 순위가 생긴다');
  await page.goto('/');
  const now = page.getByTestId('calc-sort-now');
  await expect(now).toContainText('현재 기준: 가격순');
  const group = page.getByRole('group', { name: '정렬 기준' });
  await expect(group.getByRole('button', { name: '가격순' })).toHaveAttribute('aria-pressed', 'true');

  // API 도 같은 규칙: 기본은 특수관계 제외
  const base = await (await page.request.get('/api/quote?hub=YIW&port=ICN&mode=ANY&units=1200&cartons=40&kg=650&cbm=3&goods=24000&cur=RMB&fc=FC-ICH')).json();
  expect(base.includeRelated).toBe(false);
  expect(base.top.every((t: { related: boolean }) => !t.related)).toBe(true);
  const withRel = await (await page.request.get('/api/quote?hub=YIW&port=ICN&mode=ANY&units=1200&cartons=40&kg=650&cbm=3&goods=24000&cur=RMB&fc=FC-ICH&related=1')).json();
  expect(withRel.includeRelated).toBe(true);
  expect(withRel.relatedTop).toBe(!!withRel.top[0]?.related);

  await group.getByRole('button', { name: '추천 점수순' }).click();
  await expect(now).toContainText('현재 기준: 추천 점수순');
  await expect(page.getByText('FC 도착 총액(참고치 포함 합계) · 추천 점수 1위')).toBeVisible();
  const scores = await page.getByTestId('calc-top').locator('li').allInnerTexts();
  // v2 trust: 표본이 모자란 업체는 점수 대신 「표본 부족(N건)」, 추천순에서 점수 있는 업체 뒤에 온다
  const lacking = scores.map((t) => /표본 부족\(\d+건\)/.test(t));
  const firstLacking = lacking.indexOf(true);
  if (firstLacking >= 0) expect(lacking.slice(firstLacking).every(Boolean)).toBe(true);
  const nums = scores.filter((_, i) => !lacking[i]).map((t) => Number(/추천 ([\d.]+)점/.exec(t)?.[1] ?? 'NaN'));
  expect(nums.every((x) => Number.isFinite(x))).toBe(true);
  for (let i = 1; i < nums.length; i++) expect(nums[i - 1]).toBeGreaterThanOrEqual(nums[i]);

  await group.getByRole('button', { name: '가격순' }).click();
  await expect(now).toContainText('현재 기준: 가격순');
  const box = page.getByRole('checkbox', { name: '특수관계 포함' });
  await box.check();
  await expect(now).not.toContainText('순위에서 뺐습니다');
  const first = page.getByTestId('calc-top').locator('li').first();
  await expect(first).toBeVisible();
  const firstText = await first.innerText();
  const alert = page.getByRole('alert').filter({ hasText: '특수관계' });
  if (firstText.includes('특수관계')) await expect(alert).toBeVisible();
  else await expect(alert).toHaveCount(0);
});

for (const [label, path] of [
  ['화주로 둘러보기', /\/app(\?|$|\/)/],
  ['물류사로 둘러보기', /\/partner(\?|$|\/)/],
  ['운영자로 둘러보기', /\/admin(\?|$|\/)/],
] as const) {
  test(`④ 헤더 데모 메뉴 — ${label}`, async ({ browser }) => {
    test.skip(!demo, '데모 계정은 DEMO_MODE 켜짐에서만');
    const ctx = await browser.newContext({ reducedMotion: 'reduce', viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    await page.goto('/');
    await page.getByRole('banner').getByRole('button', { name: '데모로 둘러보기' }).click();
    const item = page.getByRole('menuitem', { name: new RegExp(label) });
    await expect(item).toBeVisible();
    await item.click();
    await page.waitForURL(path, { timeout: 30_000 });
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
    // 업무 화면에도 미리보기 띠 규칙이 같다
    if (previewOn) await expect(page.getByTestId('preview-banner')).toHaveText(/v2 미리보기 — 운영 아님/);
    else await expect(page.getByTestId('preview-banner')).toHaveCount(0);
    await ctx.close();
  });
}

test('④ 모바일 메뉴 안 데모 메뉴도 들어가진다', async ({ browser }) => {
  test.skip(!demo, '데모 계정은 DEMO_MODE 켜짐에서만');
  const ctx = await browser.newContext({ reducedMotion: 'reduce', viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await page.goto('/');
  await page.getByRole('button', { name: '메뉴 열기' }).click();
  await page.getByRole('dialog').getByRole('button', { name: '데모로 둘러보기' }).click();
  await page.getByRole('menuitem', { name: /물류사로 둘러보기/ }).click();
  await page.waitForURL(/\/partner(\?|$|\/)/, { timeout: 30_000 });
  await ctx.close();
});

test('⑩ 미리보기 띠 — PREVIEW_BANNER 가 있을 때만, 공개·업무 화면 모두 맨 위', async ({ page }) => {
  await page.goto('/');
  const band = page.getByTestId('preview-banner');
  if (!previewOn) {
    await expect(band).toHaveCount(0);
    await page.goto('/login');
    await expect(page.getByTestId('preview-banner')).toHaveCount(0);
    return;
  }
  await expect(band).toHaveText(/v2 미리보기 — 운영 아님/);
  const top = await band.boundingBox();
  expect(top?.y).toBe(0);
});
