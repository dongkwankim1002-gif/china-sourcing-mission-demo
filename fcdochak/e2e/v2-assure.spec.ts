/**
 * v2 assure — 확정가·보장 자리 화면 흐름.
 * 두 모드 모두: 운영 설정에 v2 시범 스위치 넷(기본 꺼짐), 관심 등록 목록 화면.
 * 데모 켜짐에서만(E2E_DEMO=off 면 건너뜀): 화주 비교 화면의 「확정가로 받기(시범 준비 중)」 → 관심 등록 → 운영 목록에 보임
 *   → 운영자가 확정가 시범을 켜면 「사람이 정할 일」 안내와 시범 견적 기록 → 다시 끔(새 판).
 */
import { expect, test, type Browser, type Page } from '@playwright/test';

const demo = process.env.E2E_DEMO !== 'off';
const COMPARE = '/app/compare?hub=YIW&port=ICN&mode=LCL&units=1200&cartons=40&kg=650&cbm=3&goods=24000&cur=RMB&fc=FC-ICH';

test.describe.configure({ mode: 'serial' });

async function as(browser: Browser, who: 'shipper' | 'admin', width = 1440): Promise<{ page: Page; close: () => Promise<void> }> {
  const ctx = await browser.newContext({ reducedMotion: 'reduce', viewport: { width, height: 900 } });
  const page = await ctx.newPage();
  if (who === 'admin' && !demo) {
    await page.goto('/login');
    await page.locator('#email').fill(process.env.E2E_ADMIN_EMAIL!);
    await page.locator('#password').fill(process.env.E2E_ADMIN_PASSWORD!);
    await page.getByRole('button', { name: '로그인' }).last().click();
    await page.waitForURL((u) => !u.pathname.startsWith('/login'));
  } else {
    const r = await ctx.request.post(`/api/demo-login?as=${who}`, { maxRedirects: 0 });
    expect(r.status()).toBe(303);
  }
  return { page, close: () => ctx.close() };
}

async function flip(page: Page, kind: string, label: string, want: '켜기' | '끄기') {
  await page.goto('/admin/settings');
  const row = page.getByTestId(`assure-switch-${kind}`);
  await row.getByRole('button', { name: `${label} 시범 ${want}` }).click();
  const dialog = page.getByRole('dialog');
  await dialog.locator(`#as-${kind}`).fill(`e2e — 시범 ${want}`);
  await dialog.getByRole('button', { name: new RegExp(`${want} — 새 판 저장`) }).click();
  await expect(dialog).toHaveCount(0);
  await expect(row).toContainText(want === '켜기' ? '켜짐' : '꺼짐');
}

test('운영 설정 — v2 시범 스위치 넷이 보이고 꺼짐이 기본, 관심 등록 목록 화면', async ({ browser }) => {
  const { page, close } = await as(browser, 'admin');
  await page.goto('/admin/settings');
  await expect(page.getByRole('heading', { name: 'v2 시범 스위치 — 확정가·보장' })).toBeVisible();
  for (const k of ['firm', 'coverage', 'deferred', 'consolidation']) {
    const row = page.getByTestId(`assure-switch-${k}`);
    await expect(row).toContainText('꺼짐');
    await expect(row).toContainText('사람이 정할 일');
  }
  // 기준값 목록에도 요율 키가 새 판 편집과 함께 실린다
  await expect(page.getByText('v2.firm_price_rates').first()).toBeVisible();
  await page.goto('/admin/assure');
  await expect(page.getByRole('heading', { level: 1, name: '확정가·보장 관심 등록' })).toBeVisible();
  await expect(page.getByText('사람이 정할 일: 주선업 등록·보험사·금융사 제휴')).toBeVisible();
  await close();
});

test('화주 비교 — 꺼짐이면 참고 확정가와 관심 등록만', async ({ browser }) => {
  test.skip(!demo, '데모 화주·요금표는 DEMO_MODE 켜짐에서만');
  const { page, close } = await as(browser, 'shipper');
  await page.goto(COMPARE);
  const card = page.getByTestId('assure-card');
  await expect(card.getByRole('heading', { name: '확정가로 받기(시범 준비 중)' })).toBeVisible();
  await expect(card.getByTestId('assure-firm')).toContainText('참고 확정가');
  await expect(card.getByTestId('assure-firm')).toContainText('중간값');
  await expect(card.getByTestId('assure-notice')).toContainText('계약·결제·보장이 아닙니다');
  await expect(card.getByRole('button', { name: /확정가 견적 받기/ })).toHaveCount(0);
  for (const label of ['회송 보장', '물류비 후불', '공동 혼적']) await expect(card.getByText(label, { exact: true })).toBeVisible();

  const firm = card.getByRole('button', { name: '확정가 관심 등록', exact: true });
  await firm.click();
  await expect(page.getByText('확정가 관심 등록을 남겼습니다').first()).toBeVisible();
  await expect(card.getByRole('button', { name: '확정가 관심 등록함' })).toBeDisabled();
  await card.getByRole('button', { name: '회송 보장 관심 등록', exact: true }).click();
  await expect(card.getByRole('button', { name: '회송 보장 관심 등록함' })).toBeDisabled();
  // 다시 열어도 등록한 상태
  await page.reload();
  await expect(page.getByTestId('assure-card').getByRole('button', { name: '확정가 관심 등록함' })).toBeDisabled();
  await close();
});

test('운영 — 관심 등록 목록에 보인다', async ({ browser }) => {
  test.skip(!demo, '데모 화주가 등록한 것을 본다');
  const { page, close } = await as(browser, 'admin');
  await page.goto('/admin/assure');
  const table = page.getByRole('table', { name: '관심 등록 목록' });
  await expect(table.getByRole('row').filter({ hasText: '확정가' }).first()).toBeVisible();
  await expect(table.getByRole('row').filter({ hasText: '회송 보장' }).first()).toBeVisible();
  await expect(page.getByTestId('assure-count-firm')).toContainText('1명');
  await close();
});

test('확정가 시범을 켜면 — 사람이 정할 일 안내, 시범 견적 기록(계약·결제 없음), 다시 끄기', async ({ browser }) => {
  test.skip(!demo, '데모 화주·요금표는 DEMO_MODE 켜짐에서만');
  const admin = await as(browser, 'admin');
  await flip(admin.page, 'firm', '확정가', '켜기');
  try {
    const { page, close } = await as(browser, 'shipper');
    await page.goto(COMPARE);
    const card = page.getByTestId('assure-card');
    await expect(card.getByRole('heading', { name: '확정가로 받기(시범)' })).toBeVisible();
    await expect(card.getByTestId('assure-notice')).toContainText('실제 계약·결제는 없습니다');
    await expect(card.getByTestId('assure-notice')).toContainText('사람이 정할 일: 주선업 등록·보험사·금융사 제휴');
    const offerable = (await card.getByText('변동폭이 커서 시범 대상 아님').count()) === 0;
    if (offerable) {
      await card.getByRole('button', { name: '확정가 견적 받기(시범)' }).click();
      await expect(card.getByTestId('assure-current')).toContainText(/FP-\d{4}-[0-9A-F]{6}/);
      await expect(card.getByTestId('assure-current')).toContainText('계약·결제 없음');
      // 같은 조건으로 다시 받으면 새 판
      await card.getByRole('button', { name: '지금 조건으로 다시 받기' }).click();
      await expect(card.getByTestId('assure-current')).toContainText(' v2 ');
    } else {
      await expect(card.getByRole('button', { name: /확정가 견적 받기/ })).toHaveCount(0);
    }
    await close();
    if (offerable) {
      await admin.page.goto('/admin/assure');
      await expect(admin.page.getByText(/FP-\d{4}-[0-9A-F]{6} v2/).first()).toBeVisible();
    }
  } finally {
    await flip(admin.page, 'firm', '확정가', '끄기');
    await admin.close();
  }
});

test('화주 견적 요청 — 예약 전 요청에도 같은 카드, 관심 등록은 사람마다 한 번', async ({ browser }) => {
  test.skip(!demo, '데모 요청은 DEMO_MODE 켜짐에서만');
  const { page, close } = await as(browser, 'shipper');
  await page.goto('/app/requests');
  const hrefs = (await page.locator('a[href^="/app/requests/"]').evaluateAll((as) => as.map((a) => a.getAttribute('href') ?? ''))).filter((h) => /[0-9a-f-]{36}$/.test(h));
  let found = false;
  for (const h of [...new Set(hrefs)].slice(0, 12)) {
    await page.goto(h);
    if (await page.getByTestId('assure-card').count()) {
      found = true;
      break;
    }
  }
  expect(found).toBe(true);
  const card = page.getByTestId('assure-card');
  await expect(card.getByRole('heading', { name: '확정가로 받기(시범 준비 중)' })).toBeVisible();
  // 비교 화면에서 이미 등록했다 — 요청 화면에서도 등록한 상태로 보인다
  await expect(card.getByRole('button', { name: '확정가 관심 등록함' })).toBeDisabled();
  await card.getByRole('button', { name: '공동 혼적 관심 등록', exact: true }).click();
  await expect(card.getByRole('button', { name: '공동 혼적 관심 등록함' })).toBeDisabled();
  await close();
});

for (const width of [390, 768]) {
  test(`화주 비교 — 카드가 ${width} 폭에서 넘치지 않는다`, async ({ browser }) => {
    test.skip(!demo, '데모 화주는 DEMO_MODE 켜짐에서만');
    const { page, close } = await as(browser, 'shipper', width);
    await page.goto(COMPARE);
    const card = page.getByTestId('assure-card');
    await expect(card).toBeVisible();
    const box = await card.boundingBox();
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(width);
    const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(over).toBeLessThanOrEqual(0);
    await close();
  });
}
