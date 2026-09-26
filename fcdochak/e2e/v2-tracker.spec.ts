/**
 * v2 5차 tracker — 통관·입고 알리미 화면 흐름. 관세청은 부르지 않는다(UNIPASS_ENABLED 꺼짐 → 흉내).
 * 두 모드 모두: 머리·바닥의 「통관 조회」 · 개인통관고유부호 막기 · 공개 조회(예시 띠·아홉 단계·예상일·저장 안 함 안내) ·
 *   소요 분포 화면 · 예약 경로는 CRON_SECRET 없으면 닫힘 · 390 폭 가로 밀림 없음 · 운영 폴링 화면.
 * 데모 켜짐에서만: 화주 통관 알림 목록 → 번호 더하기 → 상세(알림 끄기/켜기·잇기 폼) · 이은 선적 화면의 「관세청 실측」 줄.
 */
import { expect, test, type Browser, type Page } from '@playwright/test';

const demo = process.env.E2E_DEMO !== 'off';

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

const noOverflow = async (page: Page) => {
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(over).toBeLessThanOrEqual(1);
};

test('공개 — 머리·바닥의 「통관 조회」, 개인통관고유부호는 막고, B/L 은 예시 결과만(저장 안 함)', async ({ browser }) => {
  const { page, close } = await as(browser, null);
  await page.goto('/');
  const nav = page.getByRole('navigation', { name: '공개 메뉴' });
  await expect(nav.getByRole('link', { name: '통관 조회', exact: true })).toBeVisible();
  await expect(page.getByRole('contentinfo').getByRole('link', { name: /통관 조회/ })).toBeVisible();
  await nav.getByRole('link', { name: '통관 조회', exact: true }).click();
  await page.waitForURL('**/track');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('언제 FC');

  await page.locator('#trk-number').fill('P123456789012');
  await page.getByRole('button', { name: '조회하기' }).click();
  await expect(page.getByTestId('track-personal-block')).toContainText('개인통관고유부호');
  await expect(page.locator('#trk-number')).toHaveValue('');
  await expect(page.getByTestId('track-result')).toHaveCount(0);

  await page.locator('#trk-number').fill('EXHBL-E2E-0001');
  await page.locator('#trk-year').fill('2026');
  await page.getByRole('button', { name: '조회하기' }).click();
  const res = page.getByTestId('track-result');
  await expect(res).toBeVisible();
  await expect(res).toContainText('예시 자료');
  await expect(page.getByTestId('track-steps').getByRole('listitem')).toHaveCount(9);
  await expect(res).toContainText('예상 통관(수리)일');
  await expect(res).toContainText('예상 FC 입고일');
  await expect(page.getByText('로그인하지 않아 이 결과는 저장하지 않았습니다')).toBeVisible();
  await close();
});

test('공개 — 소요 분포 화면 · 390 폭 가로 밀림 없음', async ({ browser }) => {
  const { page, close } = await as(browser, null, 390);
  await page.goto('/track/stats');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('통관 소요');
  if (demo) await expect(page.getByRole('table')).toContainText('입항 → 수리');
  else await expect(page.getByText('아직 보여 드릴 만큼 모이지 않았습니다')).toBeVisible();
  await noOverflow(page);
  await page.goto('/track');
  await noOverflow(page);
  await close();
});

test('예약 경로 — CRON_SECRET 이 없으면 닫혀 있다', async ({ request }) => {
  const r = await request.get('/api/cron/unipass');
  expect([401, 503]).toContain(r.status());
});

test('운영 — 폴링 화면: 관세청 조회 꺼짐 · 한 번 돌리기(흉내)', async ({ browser }) => {
  const { page, close } = await as(browser, 'admin');
  await page.goto('/admin/tracking');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('통관 조회 폴링');
  await expect(page.getByText('꺼짐 — 흉내만')).toBeVisible();
  await page.getByRole('button', { name: '폴링 한 번 돌리기' }).click();
  await expect(page.getByRole('status').filter({ hasText: '본 번호' })).toBeVisible();
  await close();
});

test('화주 — 통관 알림 목록 · 번호 더하기 · 알림 끄기 · 이은 선적의 관세청 실측', async ({ browser }) => {
  test.skip(!demo, '데모 계정이 있을 때만');
  const { page, close } = await as(browser, 'shipper');
  await page.goto('/app/tracking');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('통관 알림');
  await expect(page.getByTestId('tracking-open').getByRole('listitem').first()).toBeVisible();

  const n = `EXHBL-E2E-${Date.now().toString(36).toUpperCase()}`;
  await page.locator('#add-number').fill(n);
  await page.locator('#add-label').fill('e2e 시험(예시)');
  await page.getByRole('button', { name: '내 목록에 저장' }).click();
  await page.waitForURL(/\/app\/tracking\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('e2e 시험(예시)');
  await expect(page.getByTestId('track-steps')).toBeVisible();
  await page.getByRole('button', { name: '알림 끄기' }).click();
  await expect(page.getByRole('button', { name: '알림 켜기' })).toBeVisible();
  await expect(page.getByRole('form', { name: '선적·업체 잇기' })).toBeVisible();

  // 이은 선적 — 반출까지 끝난 예시 번호 중 선적과 이은 것
  await page.goto('/app/tracking');
  const linked = page.getByTestId('tracking-done').getByRole('link').filter({ hasText: '선적 SH-' }).first();
  await linked.click();
  await page.waitForURL(/\/app\/tracking\/[0-9a-f-]{36}$/);
  await page.locator('dd a[href^="/app/shipments/"]').click();
  await page.waitForURL(/\/app\/shipments\/[0-9a-f-]{36}$/);
  await expect(page.getByTestId('shipment-customs-actual')).toContainText('관세청 실측');
  await close();
});
