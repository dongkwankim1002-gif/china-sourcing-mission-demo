/**
 * v2 tools — 가입 전 가치 화면 흐름.
 * 두 모드 모두: /tools/pnl 직접 입력 → 개당 이익·손익분기·민감도, 「예시 기준값 · 확인일」, 공개 화면 사이 링크,
 *   홈 계산기 특성 토글 → 추가비용 경고, 구간 시세의 「공개 / 가입 후」 안내, 390 폭에서 가로 넘침 없음.
 * 데모 켜짐에서만(E2E_DEMO=off 면 건너뜀): 구간 시세로 9구간 합계, 특성 때문에 뺀 업체와 사유, 구간 화면 → 계산기 이어짐.
 */
import { expect, test, type Page } from '@playwright/test';

const demo = process.env.E2E_DEMO !== 'off';

async function noHorizontalOverflow(page: Page) {
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(over).toBeLessThanOrEqual(1);
}

test('판매손익 계산기 — 직접 입력으로 개당 이익·손익분기·민감도, 기준값과 확인일이 보인다', async ({ page }) => {
  await page.goto('/tools/pnl');
  await expect(page.getByRole('heading', { level: 1, name: '판매손익 계산기' })).toBeVisible();
  await expect(page.getByTestId('tool-basis')).toContainText(/예시 기준값 · 확인일 (\d{4}-\d{2}-\d{2}|없음)/);
  await page.getByRole('group', { name: '도착원가 넣는 방법' }).getByRole('button', { name: '직접 입력' }).click();
  await page.locator('#t-total').fill('1200000');
  await page.locator('#t-toport').fill('600000');
  await page.locator('#t-units').fill('1200');
  await page.locator('#t-price').fill('19900');
  const profit = page.getByTestId('tool-profit');
  await expect(profit).toHaveText(/원$/);
  const before = await profit.innerText();
  await page.locator('#t-price').fill('29900');
  await expect.poll(async () => profit.innerText()).not.toBe(before);
  // 광고비율을 올리면 손익분기 판매가가 오른다
  const be = page.getByTestId('tool-breakeven');
  const be0 = Number((await be.innerText()).replace(/[^\d]/g, ''));
  await page.locator('#t-ad').fill('10');
  await expect.poll(async () => Number((await be.innerText()).replace(/[^\d]/g, ''))).toBeGreaterThan(be0);
  await expect(page.getByTestId('tool-sensitivity').locator('tbody tr')).toHaveCount(6);
  // 기준값으로 되돌리기
  await page.getByRole('button', { name: '기준값으로' }).click();
  await expect(page.locator('#t-ad')).toHaveValue(/^0?$/);
  // 가입 후에 보이는 것이 무엇인지
  await expect(page.getByText('업체별 9구간 가격 같은 조건 비교')).toBeVisible();
});

test('특성을 고르면 추가비용 경고 — 판매손익 계산기와 홈 계산기', async ({ page }) => {
  await page.goto('/tools/pnl');
  await page.getByRole('button', { name: '배터리', exact: true }).click();
  const w = page.getByTestId('tool-warnings');
  await expect(w).toContainText('특성 때문에 더 들 수 있는 돈');
  await expect(w).toContainText('UN38.3');
  await expect(w).toContainText('항공 불가');

  await page.goto('/');
  await page.getByRole('button', { name: '배터리', exact: true }).click();
  await expect(page.getByTestId('calc-extra-cost').first()).toContainText('추가비용 가능');
});

test('공개 화면 사이 링크 — 홈·머리·바닥글·구간 시세에서 판매손익 계산기로', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('home-tool-link')).toHaveAttribute('href', '/tools/pnl');
  await expect(page.getByRole('contentinfo').getByRole('link', { name: '판매손익 계산기' })).toHaveAttribute('href', '/tools/pnl');
  await expect(page.getByTestId('calc-to-pnl')).toHaveAttribute('href', /^\/tools\/pnl\?hub=/);
  await page.goto('/lanes');
  const gate = page.getByTestId('open-gate');
  await expect(gate).toContainText('가입 없이 공개');
  await expect(gate).toContainText('구간별 9구간 중간값과 합계');
  await expect(gate).toContainText('가입 후');
  await expect(gate).toContainText('업체별 9구간 가격 비교 · 견적 요청');
  await gate.getByRole('link', { name: '판매손익 계산기' }).click();
  await expect(page).toHaveURL(/\/tools\/pnl/);
});

test('390 폭에서 가로로 넘치지 않는다', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const url of ['/tools/pnl', '/lanes', '/']) {
    await page.goto(url);
    await noHorizontalOverflow(page);
  }
});

test('구간 시세로 도착원가 — 9구간 합계 중간값, 특성 때문에 뺀 업체와 사유', async ({ page }) => {
  test.skip(!demo, '데모 요금표가 있어야 구간 시세가 생긴다');
  await page.goto('/tools/pnl');
  const total = page.getByTestId('tool-arrival-total');
  await expect(total).toHaveText(/\d/);
  await expect(page.getByTestId('tool-arrival')).toContainText('업체');
  // 위험물·배터리 취급이 없는 업체가 있는 구간을 API 로 찾는다(업체별 가격은 응답에 없다)
  const slugs = await page.locator('#t-lane option').evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value));
  let target: string | null = null;
  for (const slug of slugs) {
    const [hub, port, mode] = slug.toUpperCase().split('-');
    const j = await (await page.request.get(`/api/tools/arrival?hub=${hub}&port=${port}&mode=${mode}&traits=dg,battery`)).json();
    expect(JSON.stringify(j.excluded)).not.toMatch(/"total"/);
    if (j.excluded.length) {
      target = slug;
      break;
    }
  }
  expect(target).not.toBeNull();
  await page.locator('#t-lane').selectOption(target!);
  await page.getByRole('button', { name: '위험물', exact: true }).click();
  await page.getByRole('button', { name: '배터리', exact: true }).click();
  const ex = page.getByTestId('tool-excluded');
  await expect(ex).toContainText('화물 특성 때문에 뺀 업체');
  await expect(ex).toContainText(/취급 등록 없음|보낼 수 없음/);
});

test('구간 화면 — 9구간 중간값 합계는 공개, 판매손익 계산기로 그 구간이 이어진다', async ({ page }) => {
  test.skip(!demo, '데모 요금표가 있어야 구간 화면이 생긴다');
  await page.goto('/lanes');
  const first = page.locator('table a[href^="/lanes/"]').first();
  const href = (await first.getAttribute('href'))!;
  await page.goto(href);
  await expect(page.getByTestId('lane-seg-sum')).toContainText(/구간별 중간값 합계\s*[\d,]+원/);
  await expect(page.getByText('이름은 공개 · 업체별 가격과 견적 요청은 가입 후')).toBeVisible();
  await page.getByTestId('lane-to-pnl').click();
  await expect(page).toHaveURL(/\/tools\/pnl\?lane=/);
  await expect(page.locator('#t-lane')).toHaveValue(href.replace('/lanes/', ''));
});
