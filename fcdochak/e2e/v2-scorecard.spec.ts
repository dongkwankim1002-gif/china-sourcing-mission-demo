/**
 * v2 6차 scorecard — 물류사 성적표 화면 흐름. 관세청·쿠팡은 부르지 않는다(UNIPASS_ENABLED 꺼짐 → 흉내).
 * 두 모드 모두: 머리 메뉴 「물류사 성적표」 · 비로그인은 이름 없는 안내(성적순 잠금) · 공개 시장 지표 · /track 은 성적표 안내 + 내 화물 등록 ·
 *   관세사 찾기 · 성적표 API 는 비로그인에게 잠김 · 390 폭 가로 밀림 없음 · 운영 화면 새 판.
 * 데모 켜짐에서만: 화주 성적순·칩 · 업체 화면 「성적표」 탭 · 비교 실질 비용 · 물류사 번호 제출·이의 제기.
 */
import { expect, test, type Browser, type Page } from '@playwright/test';

const demo = process.env.E2E_DEMO !== 'off';

test.describe.configure({ mode: 'serial' });

async function as(browser: Browser, who: 'shipper' | 'partner' | 'admin' | null, width = 1440): Promise<{ page: Page; close: () => Promise<void> }> {
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

const noOverflow = async (page: Page) => {
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(over).toBeLessThanOrEqual(1);
};

test('공개 — 머리 메뉴 「물류사 성적표」 · 비로그인은 이름 붙은 성적 대신 안내', async ({ browser }) => {
  const { page, close } = await as(browser, null);
  await page.goto('/');
  const nav = page.getByRole('navigation', { name: '공개 메뉴' });
  await expect(nav.getByRole('link', { name: '통관 조회', exact: true })).toHaveCount(0);
  await nav.getByRole('link', { name: '물류사 성적표', exact: true }).click();
  await page.waitForURL('**/partners?sort=fast');
  await expect(page.getByTestId('score-sort-locked')).toBeVisible();
  if (demo) await expect(page.getByTestId('score-locked').first()).toBeVisible();
  await expect(page.getByTestId('score-chips')).toHaveCount(0);
  await close();
});

test('공개 — 통관 시장 지표(이름 없음) · /track 은 성적표 안내 + 내 화물 등록 · 390 폭', async ({ browser }) => {
  const { page, close } = await as(browser, null, 390);
  await page.goto('/market/customs');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('통관');
  if (demo) await expect(page.getByTestId('market-customs-table')).toContainText('입항 → 수리');
  else await expect(page.getByText('아직 보여 드릴 만큼 모이지 않았습니다')).toBeVisible();
  await noOverflow(page);
  await page.goto('/track');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('물류사 성적표');
  await expect(page.getByTestId('track-scorecard-guide')).toBeVisible();
  const reg = page.getByRole('link', { name: '내 화물 등록' }).first();
  // 검토 고침 — 로그인한 화주가 로그인 화면을 한 번 더 거치지 않게 곧장(비로그인은 /app/tracking 이 로그인 뒤 돌아오게 보낸다)
  await expect(reg).toHaveAttribute('href', '/app/tracking');
  await reg.click();
  await expect(page).toHaveURL(/\/login\?next=%2Fapp%2Ftracking/);
  await noOverflow(page);
  await page.goto('/brokers');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('관세사 찾기');
  if (demo) await expect(page.getByTestId('broker-list').getByTestId('score-locked').first()).toBeVisible();
  await noOverflow(page);
  await close();
});

test('성적표 API — 비로그인에게는 잠김', async ({ request }) => {
  const r = await request.get('/api/scorecard/00000000-0000-4000-8000-000000000000');
  expect(r.status()).toBe(200);
  expect((await r.json()).locked).toBe(true);
});

test('화주 — 성적순 업체 찾기 · 업체 화면 성적표 탭 · 비교 실질 비용', async ({ browser }) => {
  test.skip(!demo, '데모 계정 필요');
  const { page, close } = await as(browser, 'shipper');
  await page.goto('/partners?sort=fast');
  await expect(page.getByTestId('score-sort-now')).toContainText('빠른 통관순');
  await expect(page.getByTestId('score-chips').first()).toContainText('통관 보통');
  await page.goto('/p/hanbada#scorecard');
  await expect(page.getByRole('tab', { name: '성적표' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('scorecard-detail')).toContainText('입항 → 수리');
  await expect(page.getByTestId('scorecard-ports')).toBeVisible();
  // 검토 고침 — 성적표 탭에 FC도착 거래 기록(견적 응답 속도 등)을 함께
  await expect(page.getByTestId('trade-metrics')).toContainText('견적 응답');
  await page.goto('/app/compare?hub=YIW&port=ICN&mode=LCL&ds=40&mg=3000');
  const panel = page.getByTestId('real-cost-panel');
  await expect(panel).toContainText('실질 비용 = 견적가 + 예상 지연 비용');
  await expect(page.locator('#rc-ds')).toHaveValue('40');
  await expect(page.getByTestId('offer-real-cost').first()).toContainText('늦을 때');
  // 검토 고침 — 실질 비용순
  await page.goto('/app/compare?hub=YIW&port=ICN&mode=LCL&ds=40&mg=3000&sort=real');
  await expect(page.getByTestId('compare-sort-now')).toContainText('실질 비용순');
  await close();
});

test('물류사 — 성적표 · 화물번호 일괄 제출 · 이의 제기', async ({ browser }) => {
  test.skip(!demo, '데모 계정 필요');
  const { page, close } = await as(browser, 'partner');
  await page.goto('/partner/scorecard');
  await expect(page.getByTestId('partner-score-vs')).toBeVisible();
  const n = Date.now().toString(36).toUpperCase();
  await page.locator('#sc-text').fill(`EXE2E-${n}-1\nEXE2E-${n}-2\nP123456789012`);
  await page.getByRole('button', { name: /화물번호 제출/ }).click();
  await expect(page.getByRole('status').filter({ hasText: '새로 2건' })).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: '개인통관고유부호' })).toBeVisible();
  await page.locator('#dp-body').fill('e2e 시험 이의 — 화주 서류 지연');
  await page.getByRole('button', { name: /이의 제기/ }).click();
  await expect(page.getByRole('status').filter({ hasText: '이의를 올렸습니다' })).toBeVisible();
  await close();
});

test('운영 — 성적표 운영 화면 · 새 판', async ({ browser }) => {
  const { page, close } = await as(browser, 'admin');
  await page.goto('/admin/scorecard');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('물류사 성적표 운영');
  await expect(page.getByText('이름 공개 꺼짐')).toBeVisible();
  await page.getByRole('button', { name: '성적표 다시 셈' }).click();
  await expect(page.getByRole('status').filter({ hasText: '성적표 새 판' })).toBeVisible();
  if (demo) await expect(page.getByTestId('admin-codes')).toContainText('EX');
  await close();
});
