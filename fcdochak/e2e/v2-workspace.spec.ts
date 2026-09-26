/**
 * v2 workspace — 셀러 공간 화면 흐름.
 * 데모 켜짐에서만(E2E_DEMO=off 면 건너뜀): 선적 한눈 타임라인 · 서류함(칸·올리기) · 청구 승인/이의.
 * 두 모드 모두: 화주 가입 → 거래처 초대 링크 만들기(화면에 보이고 복사) → 그 링크로 물류사 입점 → 화주의 거래처로 연결.
 */
import { expect, test, type Browser, type Page } from '@playwright/test';

const demo = process.env.E2E_DEMO !== 'off';
const stamp = Date.now().toString(36);
const PW = `Ws${stamp}9xY`;

test.describe.configure({ mode: 'serial' });

async function fresh(browser: Browser) {
  const ctx = await browser.newContext({ reducedMotion: 'reduce' });
  return { ctx, page: await ctx.newPage() };
}
async function demoShipper(browser: Browser) {
  const f = await fresh(browser);
  const r = await f.ctx.request.post('/api/demo-login?as=shipper', { maxRedirects: 0 });
  expect(r.status()).toBe(303);
  return f;
}
const next = (page: Page) => page.getByRole('button', { name: /^다음/ }).click();

async function shipmentLinks(page: Page) {
  await page.goto('/app/shipments');
  await expect(page.getByRole('heading', { level: 1, name: '선적' })).toBeVisible();
  const hrefs = await page.locator('a[href^="/app/shipments/"]').evaluateAll((as) => as.map((a) => a.getAttribute('href')!));
  return [...new Set(hrefs.filter((h) => /\/app\/shipments\/[0-9a-f-]{36}$/.test(h)))];
}

test('선적 한눈 타임라인 — 일곱 마디가 순서대로, 표준 9단계는 접어서', async ({ browser }) => {
  test.skip(!demo, '데모 선적이 있어야 한다');
  const { ctx, page } = await demoShipper(browser);
  const links = await shipmentLinks(page);
  expect(links.length).toBeGreaterThan(0);
  await page.goto(links[0]);
  const tl = page.getByTestId('shipment-timeline');
  await expect(tl).toBeVisible();
  const items = tl.locator('li');
  await expect(items).toHaveCount(7);
  const text = await items.allInnerTexts();
  const labels = ['견적', '예약', '출항', '입항', '통관', 'FC 입고', '청구'];
  labels.forEach((l, i) => expect(text[i]).toContain(l));
  await expect(items.first()).toHaveAttribute('data-state', 'done');
  await expect(page.getByText('표준 9단계 자세히')).toBeVisible();
  await ctx.close();
});

test('서류함 — 다섯 칸으로 보이고, 쿠팡 바코드 PDF 를 올리면 그 칸에 들어간다', async ({ browser }) => {
  test.skip(!demo, '데모 선적이 있어야 한다');
  const { ctx, page } = await demoShipper(browser);
  await page.goto('/app/docs');
  await expect(page.getByRole('heading', { level: 1, name: '서류함' })).toBeVisible();
  for (const s of ['invoice', 'packing_list', 'coupang_barcode', 'bl', 'other']) await expect(page.getByTestId(`shelf-${s}`)).toBeVisible();
  await expect(page.getByTestId('shelf-coupang_barcode').getByRole('heading')).toContainText('쿠팡 바코드 PDF');
  const name = `barcode-e2e-${stamp}.pdf`;
  await page.getByLabel('서류 종류').selectOption('coupang_barcode:other');
  await page.getByLabel('파일 고르기').setInputFiles({ name, mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 e2e') });
  await expect(page.getByText('서류를 올렸습니다').first()).toBeVisible();
  await expect(page.getByTestId('shelf-coupang_barcode').getByText(name)).toBeVisible();
  await ctx.close();
});

test('청구 승인/이의 — 견적 대비 차이를 보고 이의(사유)를 남긴 뒤 새 판으로 승인', async ({ browser }) => {
  test.skip(!demo, '데모 청구서가 있어야 한다');
  const { ctx, page } = await demoShipper(browser);
  const links = await shipmentLinks(page);
  let found = false;
  for (const l of links.slice(0, 60)) {
    await page.goto(`${l}?tab=billing`);
    const panel = page.getByTestId('invoice-decision');
    if ((await panel.count()) === 0) continue;
    if (!(await panel.innerText()).includes('결정 기다림')) continue;
    found = true;
    await expect(panel.getByTestId('billing-diff')).toContainText('견적 대비');
    await panel.getByRole('button', { name: '이의 남기기' }).click();
    // 사유가 짧으면 막는다
    await panel.locator('#dec-reason').fill('짧음');
    await panel.getByRole('button', { name: '이의 남기기' }).click();
    await expect(panel.getByText('다섯 글자 이상')).toBeVisible();
    await panel.locator('#dec-reason').fill('항만 비용이 응찰보다 많습니다. 근거 자료를 보내 주세요.');
    await panel.getByRole('button', { name: '이의 남기기' }).click();
    await expect(page.getByText('이의를 남겼습니다').first()).toBeVisible();
    await expect(panel.getByText('이의 제기함')).toBeVisible();
    await expect(panel).toContainText('사유: 항만 비용이 응찰보다 많습니다');
    await expect(page.getByTestId('shipment-timeline').locator('li').last()).toHaveAttribute('data-state', 'attention');
    // 근거를 받고 승인 — 결정은 고치지 않고 새 판으로
    await panel.getByRole('button', { name: '결정 바꾸기' }).click();
    await panel.getByRole('button', { name: '청구 승인' }).click();
    await expect(panel.getByText('승인함')).toBeVisible();
    await expect(panel.getByText('결정 기록 2건')).toBeVisible();
    await expect(page.getByTestId('shipment-timeline').locator('li').last()).toHaveAttribute('data-state', 'done');
    break;
  }
  expect(found, '결정을 기다리는 데모 청구서').toBe(true);
  await ctx.close();
});

test('거래처 초대 — 링크를 화면에 보여 주고, 그 링크로 입점한 물류사가 내 거래처로 연결된다', async ({ browser }) => {
  const shipper = { company: `초대상사 ${stamp}`, email: `ws-shipper-${stamp}@smoke.test` };
  const partnerName = `초대물류 ${stamp}`;
  const s = await fresh(browser);
  await s.page.goto('/join/shipper');
  await s.page.locator('#company').fill(shipper.company);
  await next(s.page);
  await s.page.locator('#name').fill('초대화주');
  await s.page.locator('#email').fill(shipper.email);
  await s.page.locator('#pw').fill(PW);
  await next(s.page);
  await s.page.getByRole('button', { name: /이우/ }).click();
  await s.page.getByRole('checkbox').click();
  await s.page.getByRole('button', { name: '가입하고 시작하기' }).click();
  await s.page.waitForURL(/\/app\?welcome=1/);

  await s.page.goto('/app/partners');
  await expect(s.page.getByRole('heading', { level: 1, name: '거래처' })).toBeVisible();
  await s.page.locator('#iv-name').fill(partnerName);
  await s.page.getByRole('button', { name: '초대 링크 만들기' }).click();
  const box = s.page.getByTestId('invite-link-box');
  await expect(box).toBeVisible();
  await expect(box).toContainText('발송 기능이 꺼져 있어');
  const link = await s.page.getByTestId('invite-link').inputValue();
  expect(link).toMatch(/\/join\/partner\?invite=[A-Za-z0-9_-]{43}$/);
  await expect(s.page.getByTestId('invite-list')).toContainText(partnerName);
  await expect(s.page.getByTestId('invite-list')).toContainText('기다리는 중');

  // 잘린 링크는 알아듣게
  const bad = await fresh(browser);
  await bad.page.goto('/join/partner?invite=broken');
  await expect(bad.page.getByTestId('invite-banner')).toContainText('초대 링크를 찾을 수 없습니다');
  await bad.ctx.close();

  // 그 링크로 입점
  const p = await fresh(browser);
  await p.page.goto(new URL(link).pathname + new URL(link).search);
  await expect(p.page.getByTestId('invite-banner')).toContainText(`「${shipper.company}」`);
  await expect(p.page.locator('#co')).toHaveValue(partnerName);
  await p.page.locator('#brn').fill('123-45-67890');
  await p.page.locator('#city').fill('이우');
  await next(p.page);
  await p.page.getByRole('group', { name: '출발 거점' }).getByRole('button', { name: /이우/ }).click();
  await p.page.getByRole('group', { name: '도착항' }).getByRole('button', { name: /인천/ }).click();
  await p.page.getByRole('group', { name: '운송 방식' }).getByRole('button', { name: /LCL|혼재/ }).first().click();
  await next(p.page);
  await next(p.page);
  const prices = [300, 200, 250, 60000, 40000, 30000, 5000, 900, 0];
  const radios = p.page.getByRole('radiogroup', { name: /포함 여부/ });
  await expect(radios).toHaveCount(9);
  for (let i = 0; i < 9; i++) {
    const g = radios.nth(i);
    if (prices[i] > 0) {
      await g.getByRole('radio', { name: '포함' }).click();
      await g.locator('xpath=..').getByLabel('단가').fill(String(prices[i]));
    } else {
      await g.getByRole('radio', { name: '제외' }).click();
    }
  }
  await p.page.locator('#nm').fill('초대물류담당');
  await p.page.locator('#em').fill(`ws-partner-${stamp}@smoke.test`);
  await p.page.locator('#pw').fill(PW);
  await p.page.getByRole('checkbox').last().click();
  await p.page.getByRole('button', { name: '입점 신청하기' }).click();
  await p.page.waitForURL(/\/partner\?welcome=1&invited=1/);
  await p.ctx.close();

  // 화주 쪽: 거래처로 연결, 초대는 「가입함」, 같은 링크는 다시 못 쓴다
  await s.page.goto('/app/partners');
  await expect(s.page.getByTestId('client-partners')).toContainText(partnerName);
  await expect(s.page.getByTestId('client-partners')).toContainText('초대로 연결');
  await expect(s.page.getByTestId('invite-list')).toContainText('가입함');
  const again = await fresh(browser);
  await again.page.goto(new URL(link).pathname + new URL(link).search);
  await expect(again.page.getByTestId('invite-banner')).toContainText('이미 쓰인 초대 링크');
  await again.ctx.close();
  await s.ctx.close();
});
