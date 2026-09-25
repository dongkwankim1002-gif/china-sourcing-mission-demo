/**
 * 키보드만으로 — 건너뛰기 링크, 보이는 초점 테두리, 로그인 → 화주 대시보드 → 견적 요청 쓰기 화면.
 * 데모 계정을 쓰므로 DEMO_MODE 가 켜졌을 때만 돈다.
 */
import { expect, test, type Page } from '@playwright/test';

const demo = process.env.E2E_DEMO !== 'off';
const pw = process.env.DEMO_PASSWORD;

async function tabTo(page: Page, match: (el: { id: string; text: string; tag: string }) => boolean, max = 60) {
  for (let i = 0; i < max; i++) {
    await page.keyboard.press('Tab');
    const el = await page.evaluate(() => {
      const a = document.activeElement as HTMLElement | null;
      return { id: a?.id ?? '', text: (a?.textContent ?? '').trim().slice(0, 40), tag: a?.tagName ?? '' };
    });
    if (match(el)) return el;
  }
  throw new Error('Tab 으로 닿지 못했습니다');
}

async function focusRing(page: Page) {
  return page.evaluate(() => {
    const s = getComputedStyle(document.activeElement as Element);
    return s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) >= 2;
  });
}

test('첫 Tab 은 「본문으로 건너뛰기」, 초점 테두리가 보인다', async ({ page }) => {
  await page.goto('/');
  await page.keyboard.press('Tab');
  await expect(page.locator(':focus')).toHaveText('본문으로 건너뛰기');
  expect(await focusRing(page)).toBe(true);
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/#main$/);
});

test('키보드만으로 로그인하고 견적 요청 쓰기까지', async ({ page }) => {
  test.skip(!demo || !pw, '데모 계정이 있을 때만');
  await page.goto('/login');
  await tabTo(page, (e) => e.id === 'email');
  expect(await focusRing(page)).toBe(true);
  await page.keyboard.type('demo-shipper@fcdochak.example');
  await page.keyboard.press('Tab');
  await page.keyboard.type(pw!);
  await page.keyboard.press('Enter');
  await page.waitForURL(/\/app/);
  await tabTo(page, (e) => e.tag === 'A' && e.text.includes('견적 요청 올리기'));
  expect(await focusRing(page)).toBe(true);
  await page.keyboard.press('Enter');
  await page.waitForURL(/\/app\/requests\/new/);
  await tabTo(page, (e) => e.id === 'cf-units');
  expect(await focusRing(page)).toBe(true);
});
