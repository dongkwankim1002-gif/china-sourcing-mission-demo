/**
 * 한 바퀴 — 비로그인 계산 → 화주·물류사 가입 → 견적 요청 → 응찰 → 예약 → 9단계 → 청구 → 평가 → 운영 승인·대시보드.
 * DEMO_MODE 가 켜졌을 때와 꺼졌을 때 둘 다 돈다(E2E_DEMO=on|off).
 * 꺼졌을 때 운영자는 npm run admin:create 로 만든 계정(E2E_ADMIN_EMAIL·E2E_ADMIN_PASSWORD).
 */
import { expect, test, type Browser, type Page } from '@playwright/test';

const demo = process.env.E2E_DEMO !== 'off';
const stamp = Date.now().toString(36);
const PW = `Smoke${stamp}9x`;
const shipper = { company: `스모크상사 ${stamp}`, name: '시험화주', email: `shipper-${stamp}@smoke.test` };
const partner = { company: `스모크물류 ${stamp}`, name: '시험물류', email: `partner-${stamp}@smoke.test` };

async function fresh(browser: Browser) {
  const ctx = await browser.newContext({ reducedMotion: 'reduce' });
  return { ctx, page: await ctx.newPage() };
}
const next = (page: Page) => page.getByRole('button', { name: /^다음/ }).click();

test.describe.configure({ mode: "serial" });

let requestUrl = '';
let shipmentId = '';

test('비로그인 계산기 — 입력하면 합계와 9구간 막대가 바뀐다(데모가 없으면 빈 상태 안내)', async ({ page }) => {
  await page.goto('/');
  const result = page.locator('section[aria-live="polite"][aria-busy]');
  await expect(result).toBeVisible();
  if (!demo) {
    // 데모가 없으면 공개 요금표가 없다 — 빈 상태가 다음 행동(가입·견적 요청)을 안내해야 한다
    await expect(result.getByText('맞는 공개 요금이 없습니다')).toBeVisible();
    await expect(page.getByText(/가입하면 공개하지 않은 요금까지/)).toBeVisible();
    await expect(page.getByText('한바다')).toHaveCount(0);
  } else {
    const before = await result.innerText();
    await page.locator('#c-kg').fill('2400');
    await page.locator('#c-cbm').fill('9.5');
    await expect.poll(async () => (await result.innerText()) !== before, { timeout: 15_000 }).toBe(true);
    await expect(page.getByRole('img', { name: /9구간/ }).first()).toBeVisible();
  }
  if (demo) await expect(page.getByText('예시 데이터').first()).toBeVisible();
  else await expect(page.getByText('예시 데이터')).toHaveCount(0);
});

test('물류사 입점 — 네 단계, 첫 요금표 포함', async ({ browser }) => {
  const { ctx, page } = await fresh(browser);
  await page.goto('/join/partner');
  await page.locator('#co').fill(partner.company);
  await page.locator('#brn').fill('123-45-67890');
  await page.locator('#city').fill('이우');
  await next(page);
  await page.getByRole('group', { name: '출발 거점' }).getByRole('button', { name: /이우/ }).click();
  await page.getByRole('group', { name: '도착항' }).getByRole('button', { name: /인천/ }).click();
  await page.getByRole('group', { name: '운송 방식' }).getByRole('button', { name: /LCL|혼재/ }).first().click();
  await next(page);
  await next(page);
  // 첫 요금표 — 9구간 모두 포함/제외를 고르고 포함 구간엔 단가
  const prices = [300, 200, 250, 60000, 40000, 30000, 5000, 900, 0];
  const radios = page.getByRole('radiogroup', { name: /포함 여부/ });
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
  await page.locator('#nm').fill(partner.name);
  await page.locator('#em').fill(partner.email);
  await page.locator('#pw').fill(PW);
  await page.getByRole('checkbox').last().click();
  await page.getByRole('button', { name: '입점 신청하기' }).click();
  await page.waitForURL(/\/partner\?welcome=1/);
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
  await ctx.close();
});

test('화주 가입 → 견적 요청', async ({ browser }) => {
  const { ctx, page } = await fresh(browser);
  await page.goto('/join/shipper');
  await page.locator('#company').fill(shipper.company);
  await next(page);
  await page.locator('#name').fill(shipper.name);
  await page.locator('#email').fill(shipper.email);
  await page.locator('#pw').fill(PW);
  await next(page);
  await page.getByRole('button', { name: /이우/ }).click();
  await page.getByRole('checkbox').click();
  await page.getByRole('button', { name: '가입하고 시작하기' }).click();
  await page.waitForURL(/\/app\?welcome=1/);

  await page.goto('/app/requests/new?hub=YIW&port=ICN&mode=LCL&units=2000&cartons=50&kg=900&cbm=4.2&goods=40000');
  await page.locator('#rq-title').fill(`스모크 요청 ${stamp}`);
  await page.getByRole('button', { name: '견적 요청 올리기' }).click();
  await page.waitForURL(/\/app\/requests\/[0-9a-f-]{36}/);
  requestUrl = new URL(page.url()).pathname;
  await expect(page.getByText(`스모크 요청 ${stamp}`).first()).toBeVisible();
  await ctx.close();
});

async function login(page: Page, email: string) {
  await page.goto('/login');
  await page.locator('#email').fill(email);
  await page.locator('#password').fill(PW);
  await page.getByRole('button', { name: '로그인' }).last().click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'));
}

test('물류사 — 수신함에서 자동 금액으로 응찰', async ({ browser }) => {
  const { ctx, page } = await fresh(browser);
  await login(page, partner.email);
  const id = requestUrl.split('/').pop()!;
  await page.goto(`/partner/inbox/${id}`);
  await page.getByRole('button', { name: '이대로 응찰' }).click();
  await expect(page.getByText('응찰했습니다').first()).toBeVisible();
  await ctx.close();
});

test('화주 — 응찰을 골라 예약으로 전환', async ({ browser }) => {
  const { ctx, page } = await fresh(browser);
  await login(page, shipper.email);
  await page.goto(requestUrl);
  const row = page.locator('li, tr, article').filter({ hasText: partner.company }).first();
  await row.getByRole('button', { name: '예약으로 전환' }).click();
  await page.getByRole('dialog').getByRole('button', { name: '예약으로 전환' }).click();
  await page.waitForURL(/\/app\/shipments\/[0-9a-f-]{36}/);
  shipmentId = new URL(page.url()).pathname.split('/').pop()!;
  await ctx.close();
});

test('물류사 — 9단계 갱신과 청구서', async ({ browser }) => {
  const { ctx, page } = await fresh(browser);
  await login(page, partner.email);
  await page.goto(`/partner/shipments/${shipmentId}`);
  // 2단계부터 9단계까지 한 단계씩 — 매번 「다음 단계」가 저절로 다음 번호로 넘어가야 한다
  for (let n = 2; n <= 9; n++) {
    await expect(page.locator('#st-next')).toHaveValue(String(n));
    await page.locator('#st-raw').fill(`단계 ${n}`);
    await page.getByRole('button', { name: '상태 갱신' }).last().click();
    await expect(page.getByText(`${n}. `, { exact: false }).filter({ hasText: `「단계 ${n}」` }).first()).toBeVisible();
  }
  await expect(page.locator('#st-next')).toHaveCount(0);
  await page.goto(`/partner/shipments/${shipmentId}?tab=invoice`);
  await page.getByRole('button', { name: '청구서 등록' }).click();
  await expect(page.getByText('청구서를 등록했습니다').first()).toBeVisible();
  await ctx.close();
});

test('화주 — FC 입고 뒤 평가', async ({ browser }) => {
  const { ctx, page } = await fresh(browser);
  await login(page, shipper.email);
  await page.goto(`/app/shipments/${shipmentId}?tab=review`);
  await page.getByRole('radiogroup', { name: '점수' }).getByRole('radio', { name: '5' }).click();
  await page.locator('#rv-body').fill('스모크 시험 — 라벨 부착까지 깔끔했습니다.');
  await page.getByRole('button', { name: '평가 남기기' }).last().click();
  await expect(page.getByText('평가를 남겼습니다').first()).toBeVisible();
  await ctx.close();
});

test('운영 — 입점 승인과 대시보드', async ({ browser }) => {
  const { ctx, page } = await fresh(browser);
  if (demo) {
    const r = await ctx.request.post('/api/demo-login?as=admin', { maxRedirects: 0 });
    expect(r.status()).toBe(303);
    expect(r.headers()['location']).toContain('/admin');
  } else {
    const email = process.env.E2E_ADMIN_EMAIL!;
    await page.goto('/login');
    await page.locator('#email').fill(email);
    await page.locator('#password').fill(process.env.E2E_ADMIN_PASSWORD!);
    await page.getByRole('button', { name: '로그인' }).last().click();
    await page.waitForURL((u) => !u.pathname.startsWith('/login'));
  }
  await page.goto('/admin/queues');
  const item = page.locator('li, article, div').filter({ hasText: partner.company }).filter({ has: page.getByRole('button', { name: '승인' }) }).last();
  await item.getByRole('button', { name: '승인' }).click();
  await page.getByRole('dialog').locator('#ca-note').fill('스모크 — 서류 확인');
  await page.getByRole('dialog').getByRole('button', { name: /승인|확인|처리/ }).last().click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.goto('/admin');
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
  if (!demo) {
    // 데모가 꺼지면 운영 화면 외에는 예시가 없다 — 공개 업체 목록에 데모 업체가 없다
    await page.goto('/partners');
    await expect(page.getByText('한바다')).toHaveCount(0);
  }
  await ctx.close();
});
