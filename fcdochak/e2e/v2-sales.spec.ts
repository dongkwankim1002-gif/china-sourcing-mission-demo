/**
 * v2 3차 sales — 쿠팡 API 제공 · 판매 분석 화면 흐름. 쿠팡을 부르지 않는다(WING_ENABLED 꺼짐).
 * 두 모드 모두: 새 화주 → 판매 분석은 연결 권유 + 「예시」 미리보기 → 단계 안내(연동 IP 준비 중) → 동의 → 키 저장 → 연결 시험 「시험 모드」
 *              → 판매 분석은 「시험 모드」 띠 + 예시 · 가져오기도 시험 모드.
 * 데모 켜짐에서만: 데모 화주의 180일 예시 → 개요·상품별(ABC·재입고·지금 견적 요청 → 요청 화면에 채워짐)·손익(적자 SKU)·반품·입고 성과 · 다시 가져오기.
 */
import { expect, test, type Browser, type Page } from '@playwright/test';

const demo = process.env.E2E_DEMO !== 'off';
const stamp = Date.now().toString(36);
const PW = `Sl${stamp}9xY`;

test.describe.configure({ mode: 'serial' });

async function fresh(browser: Browser) {
  const ctx = await browser.newContext({ reducedMotion: 'reduce' });
  return { ctx, page: await ctx.newPage() };
}
const next = (page: Page) => page.getByRole('button', { name: /^다음/ }).click();

test('새 화주 — 연결 권유와 예시 미리보기 · 단계 안내 · 동의 · 키 · 연결 시험(시험 모드)', async ({ browser }) => {
  const { ctx, page } = await fresh(browser);
  await page.goto('/join/shipper');
  await page.locator('#company').fill(`판매상사 ${stamp}`);
  await next(page);
  await page.locator('#name').fill('판매화주');
  await page.locator('#email').fill(`sales-${stamp}@smoke.test`);
  await page.locator('#pw').fill(PW);
  await next(page);
  await page.getByRole('button', { name: /이우/ }).click();
  await page.getByRole('checkbox').click();
  await page.getByRole('button', { name: '가입하고 시작하기' }).click();
  await page.waitForURL(/\/app\?welcome=1/);

  // 메뉴 → 판매 분석(연결 없음)
  await page.getByRole('link', { name: '판매 분석' }).first().click();
  await expect(page).toHaveURL(/\/app\/sales$/);
  await expect(page.getByRole('heading', { level: 1, name: '판매 분석' })).toBeVisible();
  await expect(page.getByTestId('sales-connect-cta')).toBeVisible();
  await expect(page.getByText('예시', { exact: true }).first()).toBeVisible();
  await expect(page.getByTestId('sales-tiles')).toBeVisible();
  // 미리보기에는 가져오기 버튼이 없다
  await expect(page.getByRole('button', { name: '판매 기록 가져오기' })).toHaveCount(0);
  const tabs = page.getByRole('navigation', { name: '판매 분석' });
  await tabs.getByRole('link', { name: '상품별' }).click();
  await expect(page.getByTestId('sales-product')).toHaveCount(5);
  await expect(page.getByTestId('sales-products')).toContainText('예시 상품');
  await expect(page.getByTestId('sales-quote-link')).toHaveCount(0);
  for (const [tab, h] of [
    ['손익', '손익'],
    ['반품', '반품'],
    ['입고 성과', '입고 성과'],
  ] as const) {
    await tabs.getByRole('link', { name: tab, exact: true }).click();
    await expect(page.getByRole('heading', { level: 1, name: h })).toBeVisible();
  }

  // 연결하러 가기 → 단계 안내
  await page.getByRole('link', { name: '쿠팡 연결하러 가기' }).click();
  await expect(page).toHaveURL(/\/app\/integrations\/wing$/);
  const steps = page.getByTestId('wing-steps');
  await expect(steps.locator(':scope > li')).toHaveCount(8);
  await expect(steps).toContainText('OPEN API 키 발급');
  await expect(steps).toContainText('로켓그로스 상품 API 동의');
  await expect(page.getByTestId('wing-egress-ips')).toContainText('준비 중 — 운영이 정하면 표시');
  await expect(page.getByText('입고 생성·바코드 라벨 API 는 찾지 못했습니다', { exact: false })).toBeVisible();

  // 동의 전에는 키 칸이 닫혀 있다
  const consent = page.getByTestId('wing-consent');
  await expect(consent.getByTestId('consent-reads')).toContainText('주문');
  await expect(consent.getByTestId('consent-not-do')).toContainText('가격 변경');
  await expect(page.locator('#wk-vendor')).toHaveCount(0);
  await page.getByRole('button', { name: '동의하고 키 넣기' }).click();
  await expect(consent).toContainText('동의함');

  // 키 저장(시험용 가짜 키) → 연결 시험은 시험 모드
  await page.locator('#wk-vendor').fill('A00054321');
  await page.locator('#wk-access').fill(`e2e-sales-access-${stamp}-00000abcd`);
  await page.locator('#wk-secret').fill(`e2e-sales-secret-${stamp}-000000000`);
  await page.locator('#wk-issued').fill('2026-01-01');
  await page.getByRole('button', { name: '키 저장' }).click();
  await expect(page.getByTestId('wing-key-current')).toContainText('••••4321');
  const test1 = page.getByTestId('wing-connection-test');
  await expect(test1).toContainText('시험 모드');
  await test1.getByRole('button', { name: '연결 시험' }).click();
  const res = page.getByTestId('wing-test-result');
  await expect(res).toContainText('쿠팡을 부르지 않았습니다');
  await expect(res).toContainText('WING 키 저장');
  await expect(res).toContainText('연동 IP 준비');

  // 판매 분석 — 키를 맡겼지만 연동이 꺼져 있다 → 시험 모드 띠 + 예시
  await page.goto('/app/sales');
  await expect(page.getByTestId('sales-test-mode')).toBeVisible();
  await expect(page.getByTestId('sales-connect-cta')).toHaveCount(0);
  await page.getByRole('button', { name: '판매 기록 가져오기' }).click();
  await expect(page.getByText('시험 모드 — 쿠팡 연동이 아직 꺼져 있어').first()).toBeVisible();

  // 발급일 2026-01-01 은 180일이 지나 만료 — 화면과 알림함에 한 번
  await page.goto('/app/integrations/wing');
  await expect(page.getByTestId('wing-expiry-alert')).toBeVisible();
  await page.goto('/app/notifications');
  await expect(page.getByText('쿠팡 OPEN API 키가 만료됐습니다').first()).toBeVisible();
  await ctx.close();
});

test('데모 — 180일 예시 판매 기록 · ABC·재입고 · 지금 견적 요청 · 적자 SKU · 반품 · 입고 성과', async ({ browser }) => {
  test.skip(!demo, '데모 판매 기록이 있어야 한다');
  const { ctx, page } = await fresh(browser);
  const r = await ctx.request.post('/api/demo-login?as=shipper', { maxRedirects: 0 });
  expect(r.status()).toBe(303);
  await page.goto('/app/sales');
  await expect(page.getByTestId('sales-example-note')).toBeVisible();
  await expect(page.getByTestId('sales-connect-cta')).toHaveCount(0);
  await expect(page.getByTestId('sales-tiles')).toContainText('추정 순이익');

  await page.goto('/app/sales/products?p=90');
  const rows = page.getByTestId('sales-product');
  expect(await rows.count()).toBeGreaterThanOrEqual(3);
  await expect(rows.first()).toHaveAttribute('data-abc', 'A');
  const link = page.getByTestId('sales-quote-link').first();
  const href = await link.getAttribute('href');
  expect(href).toMatch(/^\/app\/requests\/new\?sku=/);
  await link.click();
  await expect(page).toHaveURL(/\/app\/requests\/new\?sku=/);
  await expect(page.getByRole('heading', { level: 1, name: '견적 요청 올리기' })).toBeVisible();
  const units = new URL(href!, 'http://x').searchParams.get('units');
  await expect.poll(async () => (await page.locator('#cf-units').inputValue()).replace(/[^0-9]/g, '')).toBe(units);

  await page.goto('/app/sales/pnl');
  await expect(page.getByTestId('sales-loss-alert')).toBeVisible();
  await expect(page.locator('[data-testid="sales-pnl-row"][data-loss="1"]').first()).toBeVisible();
  await expect(page.getByTestId('sales-pnl')).toContainText('실제');

  await page.goto('/app/sales/returns');
  await expect(page.getByTestId('sales-reasons')).toBeVisible();

  await page.goto('/app/sales/inbound');
  await expect(page.getByTestId('sales-inbound')).toBeVisible();
  await expect(page.getByTestId('sales-inbound-median')).toContainText('일');

  await page.goto('/app/sales');
  await page.getByRole('button', { name: '판매 기록 가져오기' }).click();
  await expect(page.getByText('판매 기록을 가져왔습니다').first()).toBeVisible();
  await ctx.close();
});
