/**
 * v2 2차 wing — 쿠팡 WING 연동 화면 흐름. 쿠팡을 부르지 않는다(WING_ENABLED 꺼짐).
 * 두 모드 모두: 화주 가입 → 연결 안내 · 「바로 가져오기」는 연동 준비 중 · WING 파일 올리기(별칭 · 칸 잇기) · 키 저장(끝 4자리만) · 폐기(새 판).
 * 데모 켜짐에서만: 예시 입고 요청 · 제안 짝 확정 · 바코드 PDF → 서류함 「쿠팡 바코드 PDF」 칸.
 */
import { expect, test, type Browser, type Page } from '@playwright/test';

const demo = process.env.E2E_DEMO !== 'off';
const stamp = Date.now().toString(36);
const PW = `Wg${stamp}9xY`;

test.describe.configure({ mode: 'serial' });

async function fresh(browser: Browser) {
  const ctx = await browser.newContext({ reducedMotion: 'reduce' });
  return { ctx, page: await ctx.newPage() };
}
const next = (page: Page) => page.getByRole('button', { name: /^다음/ }).click();
const csv = (s: string) => Buffer.from('﻿' + s, 'utf8');

test('화주 — 연결 안내 · 연동 준비 중 · WING 파일 올리기(칸 잇기) · 키 저장과 폐기', async ({ browser }) => {
  const s = await fresh(browser);
  const page = s.page;
  await page.goto('/join/shipper');
  await page.locator('#company').fill(`윙상사 ${stamp}`);
  await next(page);
  await page.locator('#name').fill('윙화주');
  await page.locator('#email').fill(`wing-${stamp}@smoke.test`);
  await page.locator('#pw').fill(PW);
  await next(page);
  await page.getByRole('button', { name: /이우/ }).click();
  await page.getByRole('checkbox').click();
  await page.getByRole('button', { name: '가입하고 시작하기' }).click();
  await page.waitForURL(/\/app\?welcome=1/);

  await page.getByRole('link', { name: '쿠팡 WING 연동' }).first().click();
  await expect(page).toHaveURL(/\/app\/integrations\/wing$/);
  await expect(page.getByRole('heading', { level: 1, name: '쿠팡 WING 연동' })).toBeVisible();
  await expect(page.getByTestId('wing-steps').locator('li')).toHaveCount(6);
  await expect(page.getByText('연동 준비 중').first()).toBeVisible();
  // 실제 셀러에게는 예시 가져오기가 없다
  await expect(page.getByRole('button', { name: '예시 입고 요청 가져오기' })).toHaveCount(0);

  // 바로 가져오기 — 스위치 꺼짐이라 부르지 않는다
  await page.getByRole('button', { name: 'WING 에서 바로 가져오기' }).click();
  await expect(page.getByText('연동 준비 중입니다').first()).toBeVisible();

  // 파일 올리기 ① 별칭으로 맞는 머리글
  await page.getByRole('button', { name: 'WING 파일 올리기' }).click();
  const box = page.getByTestId('wing-file-import');
  const noA = `E2E${stamp}A`.toUpperCase();
  const noB = `E2E${stamp}B`.toUpperCase();
  await box.getByLabel('파일 고르기').setInputFiles({
    name: 'wing-inbound.csv',
    mimeType: 'text/csv',
    buffer: csv(`입고요청번호,센터,입고예정일,수량,박스수\r\n${noA},이천1센터,2026-10-02,"1,200",40\r\n입고-틀림,평택,2026-10-03,10,1\r\n`),
  });
  await expect(box.getByTestId('column-mapping')).toBeVisible();
  await expect(box.getByTestId('column-mapping')).toContainText('열 이름 확인 필요');
  await expect(box.getByText('오류 1')).toBeVisible();
  await box.getByRole('button', { name: /^확정/ }).click();
  await expect(page.getByTestId('wing-inbound-list')).toContainText(noA);
  await expect(page.locator(`[data-external-no="${noA}"]`)).toContainText('이천 FC');
  await expect(page.locator(`[data-external-no="${noA}"]`)).toContainText('WING 파일');

  // ② 모르는 머리글 → 칸 잇기에서 사람이 고른다
  if (!(await page.getByTestId('wing-file-import').isVisible())) await page.getByRole('button', { name: 'WING 파일 올리기' }).click();
  await box.getByLabel('파일 고르기').setInputFiles({ name: 'wing-other.csv', mimeType: 'text/csv', buffer: csv(`번호,수량\r\n${noB},300\r\n`) });
  await expect(box.getByText('머리글이 없습니다: 입고 요청 번호')).toBeVisible();
  await box.getByLabel('입고 요청 번호 칸').selectOption({ label: '번호' });
  await expect(box.getByText('올릴 수 있음 1')).toBeVisible();
  await box.getByRole('button', { name: /^확정/ }).click();
  await expect(page.getByTestId('wing-inbound-list')).toContainText(noB);
  await expect(page.getByText('가져온 입고 요청 2건')).toBeVisible();

  // 키 저장 — 끝 4자리만 보인다(시험용 가짜 키)
  const secret = `e2e-secret-${stamp}-000000000000`;
  await page.locator('#wk-vendor').fill('A00012345');
  await page.locator('#wk-access').fill(`e2e-access-${stamp}-0000000000wxyz`);
  await page.locator('#wk-secret').fill(secret);
  await page.getByRole('button', { name: '키 저장' }).click();
  const cur = page.getByTestId('wing-key-current');
  await expect(cur).toBeVisible();
  await expect(cur).toContainText('••••2345');
  await expect(cur).toContainText('••••wxyz');
  await expect(cur).toContainText('연동 준비 중');
  expect(await page.content()).not.toContain(secret);
  await expect(page.getByTestId('wing-access-log')).toContainText('키 저장');
  await expect(page.getByTestId('wing-access-log')).toContainText('입고 요청 가져오기');

  // 폐기 — 새 판으로 「폐기함」
  page.once('dialog', (d) => void d.accept());
  await page.getByRole('button', { name: '키 폐기' }).click();
  await expect(page.getByText('폐기함').first()).toBeVisible();
  await expect(page.getByTestId('wing-key-current')).toHaveCount(0);
  await expect(page.getByTestId('wing-access-log')).toContainText('키 폐기');
  await s.ctx.close();
});

test('데모 — 예시 입고 요청 · 제안 짝 확정 · 바코드 PDF 가 서류함으로', async ({ browser }) => {
  test.skip(!demo, '데모 선적이 있어야 한다');
  const { ctx, page } = await fresh(browser);
  const r = await ctx.request.post('/api/demo-login?as=shipper', { maxRedirects: 0 });
  expect(r.status()).toBe(303);
  await page.goto('/app/integrations/wing');
  await expect(page.getByRole('heading', { level: 1, name: '쿠팡 WING 연동' })).toBeVisible();
  const list = page.getByTestId('wing-inbound-list');
  await expect(list).toContainText('EX-RG-');
  await expect(list.getByText('예시').first()).toBeVisible();
  await expect(list.getByTestId('wing-match').first()).toBeVisible();
  await expect(page.getByTestId('wing-return-rate')).toBeVisible();

  // 예시를 다시 가져와도 같은 번호는 늘지 않는다(바뀐 것만 새 판)
  const before = await page.getByTestId('wing-inbound').count();
  await page.getByRole('button', { name: '예시 입고 요청 가져오기' }).click();
  await expect(page.getByText('예시 입고 요청을 가져왔습니다').first()).toBeVisible();
  await page.reload();
  expect(await page.getByTestId('wing-inbound').count()).toBeGreaterThanOrEqual(before);

  // 제안을 확정
  const sug = list.getByTestId('wing-suggestion').first();
  expect(await list.getByTestId('wing-suggestion').count(), '데모에는 확정 전 제안이 남아 있다').toBeGreaterThan(0);
  {
    const line = page.getByTestId('wing-inbound').filter({ has: page.getByTestId('wing-suggestion') }).first();
    const no = await line.getAttribute('data-external-no');
    await sug.getByRole('button', { name: '짝 확정' }).click();
    await expect(page.getByText('짝을 확정했습니다').first()).toBeVisible();
    await expect(page.locator(`[data-external-no="${no}"]`).getByTestId('wing-match')).toBeVisible();
  }

  // 바코드 PDF — 짝 맞은 줄 중 아직 없는 곳에 올린다
  const need = page.getByTestId('wing-match').filter({ has: page.getByRole('button', { name: '바코드 PDF 올리기' }) }).first();
  if (await need.count()) {
    const shipNo = (await need.getByRole('link').first().innerText()).trim();
    const name = `wing-barcode-${stamp}.pdf`;
    await need.getByLabel(/바코드 PDF 고르기/).setInputFiles({ name, mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 e2e') });
    await expect(page.getByText('바코드 PDF 를 서류함에 넣었습니다').first()).toBeVisible();
    await page.goto('/app/docs');
    const shelf = page.getByTestId('shelf-coupang_barcode');
    await expect(shelf.getByText(name)).toBeVisible();
    await expect(shelf).toContainText(shipNo);
  }

  // 짝 풀기 — 새 판
  await page.goto('/app/integrations/wing');
  const m = page.getByTestId('wing-match').first();
  await m.getByRole('button', { name: '짝 풀기' }).click();
  await expect(page.getByText('짝을 풀었습니다').first()).toBeVisible();
  await ctx.close();
});
