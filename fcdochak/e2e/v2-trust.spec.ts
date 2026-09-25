/**
 * v2 trust — 점수·후기 정직하게, 화면 흐름.
 * 데모 켜짐에서만(E2E_DEMO=off 면 건너뜀): 업체 화면 점수 항목·표본 부족·나쁜 끝 후기·업체 답변,
 * 비교 화면 항목별 점수, 물류사 후기 답변 쓰기 → 고치기(새 판) → 공개 화면에 보임.
 * 두 모드 모두: 홈 후기 안내 문구.
 */
import { expect, test, type Browser } from '@playwright/test';

const demo = process.env.E2E_DEMO !== 'off';
const stamp = Date.now().toString(36);

async function as(browser: Browser, who: 'shipper' | 'partner') {
  const ctx = await browser.newContext({ reducedMotion: 'reduce' });
  const r = await ctx.request.post(`/api/demo-login?as=${who}`, { maxRedirects: 0 });
  expect(r.status()).toBe(303);
  return { ctx, page: await ctx.newPage() };
}

test.describe.configure({ mode: 'serial' });

test('홈 후기 — 끝난 선적(회송·반려·분실 포함)에서 받는다고 적는다', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('끝난 선적에서만 평가를 받습니다').first()).toBeVisible();
});

test('업체 화면 — 추천 점수 항목 넷, 표본 기준, 나쁜 끝 후기와 업체 답변', async ({ page }) => {
  test.skip(!demo, '데모 업체가 있어야 한다');
  await page.goto('/p/hanbada');
  const box = page.getByTestId('score-breakdown');
  await expect(box).toBeVisible();
  for (const label of ['정시 입고', '청구 편차', 'FC 회송', '가격 확실성']) await expect(box.getByText(label, { exact: true })).toBeVisible();
  await expect(box).toContainText(/최근 30일 끝난 선적 [\d,]+건 · 점수 기준 20건/);
  await expect(box).toContainText(/나쁜 쪽 10%\([\d,]+건\) 평균/);
  const enough = await box.getAttribute('data-enough');
  if (enough === 'no') await expect(box).toContainText(/표본 부족\([\d,]+건\)/);
  else await expect(box).toContainText('/ 100');
  const reviews = page.getByTestId('partner-reviews');
  await expect(reviews.locator('li[data-outcome="lost"], li[data-outcome="fc_rejected"]').first()).toBeVisible();
  await expect(reviews.getByText(/분실·미도착|FC 입고 반려/).first()).toBeVisible();
  await expect(reviews.getByTestId('review-reply').first()).toContainText('한바다포워딩 답변');
  await expect(reviews.getByText(/고친 판\(v2/).first()).toBeVisible();
});

test('업체 화면 — 표본이 모자란 업체는 점수 대신 「표본 부족(N건)」', async ({ page }) => {
  test.skip(!demo, '데모 업체가 있어야 한다');
  // 데모에서 30일 표본이 적은 공식 업체(카페리 대리점)
  await page.goto('/p/haeden');
  const box = page.getByTestId('score-breakdown');
  if ((await box.count()) === 0) test.skip(true, '이 데모 업체 화면이 없다');
  await expect(box).toHaveAttribute('data-enough', 'no');
  await expect(box).toContainText(/표본 부족\([\d,]+건\)/);
  await expect(box).not.toContainText('/ 100');
});

test('비교 화면 — 업체마다 항목별 점수(또는 표본 부족)가 보인다', async ({ browser }) => {
  test.skip(!demo, '데모 요금표가 있어야 한다');
  const { ctx, page } = await as(browser, 'shipper');
  await page.goto('/app/compare');
  const lines = page.getByTestId('score-breakdown');
  await expect(lines.first()).toBeVisible();
  const n = await lines.count();
  expect(n).toBeGreaterThan(1);
  const texts = await lines.allInnerTexts();
  for (const t of texts) expect(t).toMatch(/정시 입고 [\d.]+\/30 · 청구 편차 [\d.]+\/25 .*FC 회송 [\d.]+\/25 .*가격 확실성 [\d.]+\/20|표본 부족\(\d+건\)/);
  // 추천순: 표본 부족 업체는 점수 있는 업체 뒤
  const flags = await lines.evaluateAll((els) => els.map((e) => e.getAttribute('data-enough')));
  const firstNo = flags.indexOf('no');
  if (firstNo >= 0) expect(flags.slice(firstNo).every((f) => f === 'no')).toBe(true);
  await ctx.close();
});

test('물류사 — 후기에 공개 답변 → 고치기(새 판) → 공개 화면에 현재 판', async ({ browser }) => {
  test.skip(!demo, '데모 물류사 계정이 있어야 한다');
  const { ctx, page } = await as(browser, 'partner');
  await page.goto('/partner/reviews');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('후기·답변');
  await expect(page.getByTestId('score-breakdown')).toBeVisible();
  const item = page.getByTestId('partner-review-list').locator('li[data-review-id]').filter({ has: page.getByRole('button', { name: '공개 답변 남기기' }) }).first();
  const reviewId = await item.getAttribute('data-review-id');
  expect(reviewId).toBeTruthy();
  const row = page.locator(`li[data-review-id="${reviewId}"]`);
  await row.getByRole('button', { name: '공개 답변 남기기' }).click();
  const first = `남겨 주셔서 고맙습니다 — 시험 답변 ${stamp}`;
  await row.getByRole('textbox').fill(first);
  await row.getByRole('button', { name: '공개 답변 남기기' }).click();
  await expect(page.getByText('공개 답변을 남겼습니다').first()).toBeVisible();
  await expect(row.getByTestId('partner-reply')).toContainText(first);
  await expect(row.getByTestId('partner-reply')).toContainText('v1');

  await row.getByRole('button', { name: '답변 고치기' }).click();
  const second = `확인해 보니 라벨 문제였습니다 — 고친 답변 ${stamp}`;
  await row.getByRole('textbox').fill(second);
  await row.getByRole('button', { name: '새 판으로 고치기' }).click();
  await expect(page.getByText('답변을 새 판으로 고쳤습니다').first()).toBeVisible();
  await expect(row.getByTestId('partner-reply')).toContainText(second);
  await expect(row.getByTestId('partner-reply')).toContainText('v2');
  await ctx.close();

  // 공개 화면(다시 그림) — 현재 판만, 「고친 판」 표시
  const pub = await browser.newContext();
  const p = await pub.newPage();
  await expect
    .poll(async () => {
      await p.goto('/p/hanbada');
      return (await p.getByTestId('partner-reviews').innerText()).includes(second);
    }, { timeout: 60_000, intervals: [1000, 2000, 4000] })
    .toBe(true);
  await expect(p.getByTestId('partner-reviews')).not.toContainText(first);
  await pub.close();
});
