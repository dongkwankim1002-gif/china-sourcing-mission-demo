import { expect, test } from '@playwright/test';

test('버전 비교실 — 판을 나란히 띄우고 모두 같은 경로로 옮긴다', async ({ page }) => {
  await page.goto('/lab');
  await expect(page.getByRole('heading', { name: '버전 비교실' })).toBeVisible();
  const frames = page.locator('main iframe');
  await expect(frames).toHaveCount(2);
  await page.getByLabel('경로').fill('/lanes');
  await page.getByRole('button', { name: '모두 이동' }).click();
  await expect(frames.first()).toHaveAttribute('src', '/lanes');
  await expect(frames.nth(1)).toHaveAttribute('src', /\/lanes$/);
  // 운영 판은 같은 주소라 안이 실제로 그려진다
  await expect(page.frameLocator('main iframe').first().getByRole('heading', { level: 1 })).toBeVisible();
});

test('끼워 보기 머리글 — 기본은 같은 주소만 담을 수 있다', async ({ request }) => {
  const r = await request.get('/');
  expect(r.headers()['content-security-policy']).toContain("frame-ancestors 'self'");
});
