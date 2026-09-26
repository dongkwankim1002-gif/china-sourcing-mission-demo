/**
 * v2 4차 onestop — 원스톱 대행형 구역(미리보기) 화면 흐름.
 * 두 모드 모두: 공개 홈(「원스톱 · 미리보기」·가격 하나·맡기기 → 로그인) · 요금표(가정치·예시 한 건) · FC도착 머리/바닥의 「원스톱」 · 운영 대기열·설정 키.
 * 데모 켜짐에서만(E2E_DEMO=off 면 건너뜀): 화주가 주문서로 맡기기(접수 기록만) → 타임라인 → 취소 · 대시보드 카드 ·
 *   운영자가 데모 주문에 단계 남기기. 어느 단계도 결제·발송·밖 호출이 없다(스위치 onestop.enabled 꺼짐).
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

test('공개 — 원스톱 홈: 미리보기 표시·가격 하나·맡기기는 로그인으로, 머리/바닥에 「원스톱」', async ({ browser }) => {
  const { page, close } = await as(browser, null);
  await page.goto('/');
  const nav = page.getByRole('navigation', { name: '공개 메뉴' });
  await expect(nav.getByRole('link', { name: '원스톱', exact: true })).toBeVisible();
  await expect(page.getByRole('contentinfo').getByRole('link', { name: /원스톱/ })).toBeVisible();
  await nav.getByRole('link', { name: '원스톱', exact: true }).click();
  await page.waitForURL('**/onestop');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('가격 하나로');
  await expect(page.getByRole('banner').getByText('원스톱 · 미리보기')).toBeVisible();
  await expect(page.getByTestId('onestop-notice')).toContainText('접수 기록만 · 대행 계약 전');
  // v2 공개 메뉴는 이 구역에 없다(자체 머리)
  await expect(page.getByRole('navigation', { name: '공개 메뉴' })).toHaveCount(0);
  const total = page.getByTestId('onestop-price-total');
  await expect(total).toContainText('원');
  const before = await total.textContent();
  await page.getByLabel('부피(전체)').fill('2.5');
  await expect(total).not.toHaveText(before ?? '');
  await expect(page.getByTestId('onestop-price-nine')).toContainText('9구간');
  await expect(page.getByTestId('onestop-cutoff')).toContainText('다음 혼적 마감');
  await page.getByRole('button', { name: '맡기기', exact: true }).click();
  await page.waitForURL(/\/login\?next=/);
  // 로그인하러 가도 적은 값이 next 에 실려 있다(로그인 뒤 같은 주문서·같은 가격)
  const next = new URL(page.url()).searchParams.get('next') ?? '';
  expect(next).toMatch(/^\/onestop\/order\?/);
  expect(new URLSearchParams(next.split('?')[1]).get('cbm')).toBe('2.5');
  await page.goto('/onestop');
  await page.setViewportSize({ width: 390, height: 800 });
  await noOverflow(page);
  await close();
});

test('공개 — 요금표: 허브·방식별 CBM당, 개당 작업, 가정치, 예시 한 건', async ({ browser }) => {
  const { page, close } = await as(browser, null, 390);
  await page.goto('/onestop/price');
  await expect(page.getByRole('heading', { level: 1, name: '원스톱 요금표' })).toBeVisible();
  await expect(page.getByTestId('onestop-lanes')).toContainText('이우');
  await expect(page.getByTestId('onestop-services')).toContainText('최소 요금');
  await expect(page.getByTestId('onestop-tariff-basis')).toContainText('가정치');
  await expect(page.getByTestId('onestop-example-total')).toContainText('원');
  await noOverflow(page);
  await close();
});

test('운영 — 원스톱 주문 대기열 화면과 스위치 설정 키', async ({ browser }) => {
  const { page, close } = await as(browser, 'admin');
  await page.goto('/admin/onestop');
  await expect(page.getByRole('heading', { level: 1, name: '원스톱 주문 대기열' })).toBeVisible();
  await expect(page.getByTestId('onestop-notice')).toContainText('원스톱 · 미리보기');
  await expect(page.getByTestId('onestop-metrics')).toContainText('다음 혼적 마감');
  await page.goto('/admin/settings');
  await expect(page.getByText('onestop.enabled').first()).toBeVisible();
  await expect(page.getByText('onestop.tariff').first()).toBeVisible();
  await close();
});

test('화주 — 주문서로 맡기기(접수 기록만) → 타임라인 → 취소 · 대시보드 카드', async ({ browser }) => {
  test.skip(!demo, '데모 화주 계정이 있을 때만');
  const { page, close } = await as(browser, 'shipper', 390);
  await page.goto('/app');
  await expect(page.getByTestId('onestop-card')).toContainText('원스톱 주문');
  await page.goto('/onestop/order?units=250&cartons=6&cbm=0.5&lane=QDG-LCL');
  await expect(page.getByRole('heading', { level: 1, name: '원스톱 주문서' })).toBeVisible();
  await expect(page.getByLabel('수량')).toHaveValue('250');
  await expect(page.getByTestId('onestop-cutoff')).toContainText('다음 혼적 마감');
  await page.getByLabel('상품명').fill('시험용 원스톱 상품(예시)');
  await expect(page.getByTestId('onestop-price-total')).toContainText('원');
  await noOverflow(page);
  await page.getByRole('button', { name: /이대로 맡기기/ }).click();
  await page.waitForURL(/\/onestop\/orders\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('시험용 원스톱 상품');
  await expect(page.getByTestId('onestop-timeline')).toBeVisible();
  await expect(page.getByText('접수 기록만 · 대행 계약 전').first()).toBeVisible();
  await expect(page.getByTestId('onestop-order-price-nine')).toContainText('9구간');
  await noOverflow(page);
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: '주문 취소' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('취소');
  await page.goto('/onestop/orders');
  await expect(page.getByTestId('onestop-orders')).toContainText('시험용 원스톱 상품');
  await expect(page.getByTestId('onestop-orders')).toContainText('OS-EX-0003');
  await close();
});

test('화주 — 선적과 이은 데모 주문은 출항 뒤 단계가 선적을 따라간다', async ({ browser }) => {
  test.skip(!demo, '데모 자료가 있을 때만');
  const { page, close } = await as(browser, 'shipper');
  await page.goto('/onestop/orders');
  await page.getByRole('link', { name: /접이식 수납 바구니/ }).click();
  await expect(page.getByTestId('onestop-shipment')).toContainText('이은 선적');
  await expect(page.getByTestId('onestop-timeline')).toContainText('기록에서');
  await close();
});

test('운영 — 데모 주문에 단계 남기기(앞으로만)', async ({ browser }) => {
  test.skip(!demo, '데모 자료가 있을 때만');
  const { page, close } = await as(browser, 'admin', 768);
  await page.goto('/admin/onestop');
  await page.getByTestId('onestop-queue').getByRole('link', { name: /실리콘 냄비받침/ }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('실리콘 냄비받침');
  const form = page.getByTestId('onestop-stage-form');
  await form.getByLabel(/단계/).selectOption('payment_confirmed');
  await form.getByLabel(/메모/).fill('e2e 시험 — 대금 확인');
  await form.getByRole('button', { name: '단계 남기기' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('사입 대금 확인');
  // 이제 대금 확인은 고를 수 없다(앞으로만)
  await expect(form.getByLabel(/단계/).locator('option[value="payment_confirmed"]')).toHaveCount(0);
  // 바로 한 번 더 — 보이는 첫 항목(중국 창고 입고)이 그대로 남는다(예전엔 앞서 남긴 단계를 다시 보내 실패했다)
  await expect(form.getByLabel(/단계/)).toHaveValue('factory_received');
  await form.getByRole('button', { name: '단계 남기기' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('중국 창고 입고');
  await noOverflow(page);
  await close();
});
