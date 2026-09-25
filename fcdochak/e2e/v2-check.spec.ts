/**
 * v2 check — 청구서 점검 화면 흐름.
 * 두 모드 모두: 홈 첫 행동 → /check, 표 붙여넣기 → 9구간 분류 → 점검 결과(저장 안 함), 직접 입력, 390 폭에서 가로 넘침 없음.
 * 데모 켜짐에서만(E2E_DEMO=off 면 건너뜀): 데모 화주로 들어가 보관 목록(시드) → 새로 점검해 보관 → 고쳐서 다시 보관(새 판).
 */
import { expect, test, type Page } from '@playwright/test';

const demo = process.env.E2E_DEMO !== 'off';

async function pasteExampleAndCheck(page: Page) {
  await page.goto('/check');
  await page.getByRole('button', { name: '예시 넣어 보기' }).click();
  await page.getByRole('button', { name: '표 읽기' }).click();
  const lines = page.getByTestId('check-lines').locator('li');
  await expect(lines).toHaveCount(7);
  await page.getByTestId('check-run').click();
  const result = page.getByTestId('check-result');
  await expect(result).toBeVisible({ timeout: 30_000 });
  return result;
}

test('홈 첫 행동은 「내 견적서·청구서 점검받기」, 누르면 /check', async ({ page }) => {
  await page.goto('/');
  const hero = page.getByTestId('hero-check');
  await expect(hero).toHaveText(/내 견적서·청구서 점검받기/);
  // 계산기의 가입 버튼은 둘째(보조 버튼)로 내려왔다 — 첫 화면의 노란 주 버튼은 점검 하나
  await expect(hero).toHaveClass(/bg-label/);
  await expect(page.getByRole('link', { name: /9구간 상세·견적 요청은 가입 후/ })).not.toHaveClass(/bg-label/);
  await hero.click();
  await page.waitForURL(/\/check$/);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('받은 견적서·청구서');
});

test('표 붙여넣기 → 9구간으로 가르고 점검 — 로그인 없이 결과, 저장은 안 함', async ({ page }) => {
  const result = await pasteExampleAndCheck(page);
  // 자동 분류: 관세는 비교에서 빼는 세금으로, 해상운임은 국제운송으로
  const selects = page.getByTestId('check-lines').locator('select[aria-label$="번째 구간"]');
  await expect(selects.nth(3)).toHaveValue('freight');
  await expect(selects.nth(6)).toHaveValue('tax');
  // 구간 표 9줄, 판정 칩, 빠진 구간(국내 창고·FC 운송이 예시에 없다)
  const table = result.locator('table');
  await expect(table.locator('tbody tr')).toHaveCount(9);
  await expect(table.locator('tr[data-seg="fc_delivery"]')).toContainText(/빠짐|보통 따로/);
  await expect(page.getByTestId('check-findings')).toContainText('청구서에 없습니다');
  await expect(result).toContainText('관세·부가세');
  await expect(page.getByTestId('check-save')).toContainText('이 결과는 저장하지 않았습니다');
  await expect(page.getByTestId('check-save').getByRole('link', { name: '로그인' })).toHaveAttribute('href', '/login?next=/check');
});

test('직접 입력 — 9구간 칸을 만들고 일부만 채워도 점검된다', async ({ page }) => {
  await page.goto('/check');
  await page.getByRole('tab', { name: /직접 입력/ }).click();
  await page.getByRole('button', { name: '9구간 칸 만들기' }).click();
  await expect(page.getByTestId('check-lines').locator('li')).toHaveCount(9);
  await page.getByLabel('4번째 금액').fill('900000');
  await page.getByLabel('5번째 금액').fill('80000');
  // 방식을 고르면 같은 방식 요금표끼리 견준다(항공과 해상이 섞이면 폭이 넓어진다)
  await page.locator('#ck-mode').selectOption('LCL');
  await page.getByTestId('check-run').click();
  const result = page.getByTestId('check-result');
  await expect(result).toBeVisible({ timeout: 30_000 });
  const freight = result.locator('tr[data-seg="freight"]');
  await expect(freight).toContainText('900,000원');
  // 90만 원 국제운송은 어느 기준으로도 과하다
  await expect(freight).toContainText('과함');
  await expect(page.getByTestId('check-headline')).toContainText('과한 구간');
});

test('390 폭 — 점검 결과까지 가로로 넘치지 않는다', async ({ browser }) => {
  const ctx = await browser.newContext({ reducedMotion: 'reduce', viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await pasteExampleAndCheck(page);
  const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(over).toBeLessThanOrEqual(0);
  await ctx.close();
});

test('데모 화주 — 보관 목록(최신 판만), 새로 보관, 고쳐서 새 판', async ({ page }) => {
  test.skip(!demo, '데모 계정은 DEMO_MODE 켜짐에서만');
  const r = await page.request.post('/api/demo-login?as=shipper');
  expect(r.ok()).toBe(true);

  await page.goto('/app/checks');
  const list = page.getByTestId('checks-list');
  await expect(list).toContainText('청도 카페리 견적서');
  await expect(list).toContainText('한바다포워딩 9월 청구서(수정본)');
  // 이전 판(수정 전)은 목록에 따로 나오지 않는다
  await expect(list.locator('li').filter({ hasText: /한바다포워딩 9월 청구서$/ })).toHaveCount(0);
  await list.getByRole('link', { name: /청도 카페리 견적서/ }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('청도 카페리 견적서');
  await expect(page.getByTestId('check-result').locator('tbody tr')).toHaveCount(9);

  // 새로 점검해 보관
  await pasteExampleAndCheck(page);
  const save = page.getByTestId('check-save');
  await save.getByRole('button', { name: '이 결과 보관' }).click();
  await expect(save).toContainText('보관했습니다');
  await save.getByRole('link', { name: /보관한 결과 보기/ }).click();
  await page.waitForURL(/\/app\/checks\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('청구서 점검');
  const firstUrl = page.url();

  // 고쳐서 다시 점검 → 새 판
  await page.getByRole('link', { name: '고쳐서 다시 점검' }).click();
  await page.waitForURL(/\/check\?from=/);
  await expect(page.getByRole('status').filter({ hasText: '불러왔습니다' })).toBeVisible();
  await expect(page.getByTestId('check-lines').locator('li')).toHaveCount(7);
  await page.getByRole('button', { name: '한 줄 더하기' }).first().click();
  await page.getByLabel('8번째 항목 이름').fill('쿠팡 FC 입고 운송');
  await page.getByLabel('8번째 금액').fill('110000');
  await expect(page.getByLabel('8번째 구간')).toHaveValue('fc_delivery');
  await page.getByTestId('check-run').click();
  await expect(page.getByTestId('check-result')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('check-save').getByRole('button', { name: /이 결과 보관\(새 판\)/ }).click();
  await expect(page.getByTestId('check-save')).toContainText('보관했습니다');
  await page.getByTestId('check-save').getByRole('link', { name: /보관한 결과 보기/ }).click();
  await expect(page.getByText(/2판 \(이전 판을 고친 것\)/)).toBeVisible();

  // 이전 판은 그대로 남고 「새 판 보기」로 이어진다
  await page.goto(firstUrl);
  await expect(page.getByRole('link', { name: '새 판 보기' })).toBeVisible();
});
