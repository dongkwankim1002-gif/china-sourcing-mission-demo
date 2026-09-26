import { expect, test } from '@playwright/test';

test('버전 비교실 — 판 단추로 한 판씩 연다', async ({ page }) => {
  await page.goto('/lab');
  await expect(page.getByRole('heading', { name: '버전 비교실' })).toBeVisible();
  const frames = page.locator('main iframe');
  await expect(frames).toHaveCount(1);
  await expect(frames.first()).toHaveAttribute('src', '/');
  // 운영 판은 같은 주소라 안이 실제로 그려진다
  await expect(page.frameLocator('main iframe').first().getByRole('heading', { level: 1 })).toBeVisible();

  const pick = page.getByRole('group', { name: '띄울 판' });
  await pick.getByRole('button', { name: 'v2', exact: true }).click();
  await expect(frames).toHaveCount(1);
  await expect(frames.first()).toHaveAttribute('src', /^https:\/\/fcdochak-v2-live\.vercel\.app\/$/);

  // 원스톱은 v2 안의 구역 — 구역 첫 화면으로 연다
  await pick.getByRole('button', { name: '원스톱', exact: true }).click();
  await expect(frames.first()).toHaveAttribute('src', /\/onestop$/);

  // 운영으로 돌아오면 구역 밖 첫 화면으로
  await pick.getByRole('button', { name: '운영', exact: true }).click();
  await expect(frames.first()).toHaveAttribute('src', '/');
});

test('버전 비교실 — 나란히 보기를 켜면 판을 나란히 띄우고 모두 같은 경로로 옮긴다', async ({ page }) => {
  await page.goto('/lab');
  await page.getByLabel('나란히 보기').check();
  const frames = page.locator('main iframe');
  await expect(frames).toHaveCount(2);
  await page.getByLabel('경로').fill('/lanes');
  await page.getByRole('button', { name: '모두 이동' }).click();
  await expect(frames.first()).toHaveAttribute('src', '/lanes');
  await expect(frames.nth(1)).toHaveAttribute('src', /\/lanes$/);
});

test('끼워 보기 머리글 — 기본은 같은 주소만 담을 수 있다', async ({ request }) => {
  const r = await request.get('/');
  expect(r.headers()['content-security-policy']).toContain("frame-ancestors 'self'");
});
