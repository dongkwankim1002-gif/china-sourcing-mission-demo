/**
 * v2 3차 sourcing — 소싱처 찾기(패밀리 확장 모듈, 미리보기) 화면 흐름.
 * 두 모드 모두: 공개 패밀리 소개(「준비 중 · 미리보기」·예시 후보·수수료 가정치) · FC도착 머리/바닥의 「패밀리 사이트」 · 운영 대기열 화면.
 * 데모 켜짐에서만(E2E_DEMO=off 면 건너뜀): 화주가 직접 입력으로 요청 → 예시 후보 3곳과 도착원가·마진 → 물류 비교 링크 →
 *   데모 요청의 후보에 샘플 요청(관심 등록) → 운영자가 예시 후보 채우기·상태 남기기 → 화주가 요청 취소.
 * 어느 단계도 밖으로 연락하지 않는다(스위치 sourcing.enabled 꺼짐).
 */
import { expect, test, type Browser, type Page } from '@playwright/test';

const demo = process.env.E2E_DEMO !== 'off';
const stamp = Date.now().toString(36);

test.describe.configure({ mode: 'serial' });

async function as(browser: Browser, who: 'shipper' | 'admin' | null, width = 1440): Promise<{ page: Page; close: () => Promise<void> }> {
  const ctx = await browser.newContext({ reducedMotion: 'reduce', viewport: { width, height: 900 } });
  const page = await ctx.newPage();
  if (who === 'admin' && !demo) {
    await page.goto('/login');
    await page.locator('#email').fill(process.env.E2E_ADMIN_EMAIL!);
    await page.locator('#password').fill(process.env.E2E_ADMIN_PASSWORD!);
    await page.getByRole('button', { name: '로그인' }).last().click();
    await page.waitForURL((u) => !u.pathname.startsWith('/login'));
  } else if (who) {
    const r = await ctx.request.post(`/api/demo-login?as=${who}`, { maxRedirects: 0 });
    expect(r.status()).toBe(303);
  }
  return { page, close: () => ctx.close() };
}

test('공개 — 패밀리 소개: 미리보기 표시·예시 후보·수수료 가정치, 머리/바닥에 「패밀리 사이트」', async ({ browser }) => {
  const { page, close } = await as(browser, null);
  await page.goto('/');
  await expect(page.getByRole('navigation', { name: '공개 메뉴' }).getByRole('link', { name: '패밀리 사이트' })).toBeVisible();
  await expect(page.getByRole('contentinfo').getByRole('link', { name: /패밀리 사이트/ })).toBeVisible();
  await page.getByRole('navigation', { name: '공개 메뉴' }).getByRole('link', { name: '패밀리 사이트' }).click();
  await page.waitForURL('**/family/sourcing');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('더 좋은 공장에서');
  await expect(page.getByTestId('sourcing-notice')).toContainText('준비 중 · 미리보기');
  const table = page.getByTestId('sourcing-compare');
  await expect(table).toContainText(/예시 (공장|무역상) A/);
  await expect(table.getByText('예시', { exact: true }).first()).toBeVisible();
  await expect(page.getByTestId('family-fees')).toContainText('5.0%');
  await expect(page.getByText('가정치입니다').first()).toBeVisible();
  await expect(page.getByRole('link', { name: /FC도착으로 돌아가기/ })).toBeVisible();
  // 390 폭에서 가로로 밀리지 않는다(표는 표 안에서만 넘긴다)
  await page.setViewportSize({ width: 390, height: 800 });
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(over).toBeLessThanOrEqual(1);
  await close();
});

test('운영 — 소싱 요청 대기열 화면과 스위치 설정 키', async ({ browser }) => {
  const { page, close } = await as(browser, 'admin');
  await page.goto('/admin/sourcing');
  await expect(page.getByRole('heading', { level: 1, name: '소싱 요청 대기열' })).toBeVisible();
  await expect(page.getByTestId('sourcing-notice')).toContainText('준비 중 · 미리보기');
  await page.goto('/admin/settings');
  await expect(page.getByText('sourcing.enabled').first()).toBeVisible();
  await close();
});

let createdId = '';

test('화주 — 직접 입력 요청 → 예시 후보 3곳과 도착원가·마진 → 물류 비교 링크', async ({ browser }) => {
  test.skip(!demo, '데모 화주는 DEMO_MODE 켜짐에서만');
  const { page, close } = await as(browser, 'shipper');
  await page.goto('/app/sourcing');
  await expect(page.getByRole('heading', { level: 1, name: '소싱처 찾기' })).toBeVisible();
  await expect(page.getByTestId('sourcing-notice')).toContainText('준비 중 · 미리보기');
  await expect(page.getByTestId('sourcing-list')).toContainText('접이식 욕실 선반');
  // 저장한 SKU 를 고르면 이름이 채워진다
  const from = page.locator('#sr-from');
  const skuOpt = from.locator('optgroup[label="저장한 SKU"] option').first();
  const skuName = (await skuOpt.textContent())!.trim();
  await from.selectOption({ value: (await skuOpt.getAttribute('value'))! });
  await expect(page.locator('#sr-name')).toHaveValue(skuName);
  // 직접 입력으로 바꿔 새 이름
  await from.selectOption('manual');
  const name = `e2e 원목 수저받침 ${stamp}`;
  await page.locator('#sr-name').fill(name);
  await page.locator('#sr-kw').fill('수저받침, 筷子架');
  await page.locator('#sr-price').fill('9900');
  await page.locator('#sr-first').fill('800');
  await page.getByRole('button', { name: '소싱 요청 남기기' }).click();
  await page.waitForURL(/\/app\/sourcing\/[0-9a-f-]{36}$/);
  createdId = page.url().split('/').pop()!;
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
  await expect(page.getByRole('heading', { name: /예시 후보 3곳/ })).toBeVisible();
  const sims = page.getByTestId('sourcing-sim');
  await expect(sims).toHaveCount(3);
  await expect(sims.first()).toContainText('개당 도착원가');
  await expect(sims.first()).toContainText('개당 마진');
  await expect(sims.first()).toContainText('관세·부가세는 참고 추정');
  await expect(sims.first().getByText('예시 후보는 샘플 요청을 받지 않습니다')).toBeVisible();
  const link = sims.first().getByRole('link', { name: '이 조건으로 물류 비교' });
  await expect(link).toHaveAttribute('href', /^\/app\/compare\?hub=[A-Z]{3}&port=ICN&mode=LCL&units=800&/);
  // 수량을 바꿔 다시 셈
  await page.locator('#sim-qty').fill('2000');
  await page.getByRole('button', { name: '다시 셈' }).click();
  await expect(page.getByRole('heading', { name: /2,000개/ })).toBeVisible();
  await link.click();
  await page.waitForURL('**/app/compare?**');
  await close();
});

test('화주 — 데모 요청의 후보에 샘플 요청(관심 등록)', async ({ browser }) => {
  test.skip(!demo, '데모 화주는 DEMO_MODE 켜짐에서만');
  const { page, close } = await as(browser, 'shipper', 390);
  await page.goto('/app/sourcing');
  await page.getByTestId('sourcing-list').getByRole('link').filter({ has: page.getByText('후보 있음') }).first().click();
  await expect(page.getByRole('heading', { name: /후보 공급처 3곳/ })).toBeVisible();
  const card = page.getByTestId('sourcing-sim').first();
  const btn = card.getByRole('button', { name: /샘플 요청\(관심 등록\)$/ });
  await btn.click();
  await expect(page.getByText(/샘플 요청\(관심 등록\)을 남겼습니다/).first()).toBeVisible();
  await expect(card.getByRole('button', { name: /샘플 요청함$/ })).toBeDisabled();
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(over).toBeLessThanOrEqual(1);
  await close();
});

test('운영 — 새 요청에 예시 후보 채우기·상태 남기기, 화주가 요청 취소', async ({ browser }) => {
  test.skip(!demo || !createdId, '앞 시험에서 만든 요청이 있어야 한다');
  const a = await as(browser, 'admin');
  await a.page.goto('/admin/sourcing');
  await expect(a.page.getByTestId('sourcing-queue')).toContainText(`e2e 원목 수저받침 ${stamp}`);
  await a.page.goto(`/admin/sourcing/${createdId}`);
  await a.page.getByRole('button', { name: '예시 후보 채우기' }).click();
  await expect(a.page.getByText(/예시 후보 3곳을 넣었습니다/).first()).toBeVisible();
  await expect(a.page.getByTestId('sourcing-sim')).toHaveCount(3);
  await a.page.locator('#st-status').selectOption('candidates_ready');
  await a.page.locator('#st-note').fill('e2e — 후보 셋');
  await a.page.getByRole('button', { name: '상태 남기기' }).click();
  await expect(a.page.getByRole('list', { name: '상태 기록' })).toContainText('e2e — 후보 셋');
  await a.close();

  const s = await as(browser, 'shipper');
  await s.page.goto(`/app/sourcing/${createdId}`);
  await expect(s.page.getByRole('heading', { name: /후보 공급처 3곳/ })).toBeVisible();
  s.page.once('dialog', (d) => void d.accept());
  await s.page.getByRole('button', { name: '요청 취소' }).click();
  await expect(s.page.getByText('요청을 취소했습니다').first()).toBeVisible();
  await expect(s.page.getByRole('button', { name: '요청 취소' })).toHaveCount(0);
  await s.close();
});
