/**
 * v2 alliance — 제휴 주선사 화면 흐름.
 * 두 모드 모두: 운영 /admin/alliance 에 스위치(기본 꺼짐)와 「사람이 정할 일」.
 * 데모 켜짐에서만(E2E_DEMO=off 면 건너뜀): 예시 제휴 두 곳·30일 만료 경고·체크리스트 → 꺼짐이면 물류사 신청이 잠기고 화주 카드는 「제휴 주선사 확정 전」
 *   → 운영자가 켜면 물류사(한바다포워딩) 신청·서류 올리기 → 운영 확인(새 판) · 계약 첫 판 · 정산 명세 → 화주 카드에 「계약 상대: 가람해운항공(끝 0218)」 → 다시 끔.
 */
import { expect, test, type Browser, type Page } from '@playwright/test';

const demo = process.env.E2E_DEMO !== 'off';
const COMPARE = '/app/compare?hub=YIW&port=ICN&mode=LCL&units=1200&cartons=40&kg=650&cbm=3&goods=24000&cur=RMB&fc=FC-ICH';

test.describe.configure({ mode: 'serial' });

async function as(browser: Browser, who: 'shipper' | 'partner' | 'admin', width = 1440): Promise<{ page: Page; close: () => Promise<void> }> {
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

async function flip(page: Page, want: '켜기' | '끄기') {
  await page.goto('/admin/alliance');
  const row = page.getByTestId('alliance-switch');
  await row.getByRole('button', { name: `제휴 주선사 스위치 ${want}` }).click();
  const dialog = page.getByRole('dialog');
  await dialog.locator('#al-switch-note').fill(`e2e — 제휴 ${want}`);
  await dialog.getByRole('button', { name: `${want} — 새 판 저장` }).click();
  await expect(dialog).toHaveCount(0);
  await expect(row).toContainText(want === '켜기' ? '켜짐' : '꺼짐');
}

test('운영 — 제휴 주선사 화면, 스위치는 꺼짐이 기본', async ({ browser }) => {
  const { page, close } = await as(browser, 'admin');
  await page.goto('/admin/alliance');
  await expect(page.getByRole('heading', { level: 1, name: '제휴 주선사' })).toBeVisible();
  await expect(page.getByTestId('alliance-switch')).toContainText('꺼짐');
  await expect(page.getByTestId('alliance-human')).toContainText('사람이 정할 일: 법률 검토');
  if (!demo) await expect(page.getByText('아직 제휴 후보가 없습니다')).toBeVisible();
  // 설정 화면에도 새 키가 새 판 편집과 함께 실린다
  await page.goto('/admin/settings');
  await expect(page.getByText('alliance.default_terms').first()).toBeVisible();
  await close();
});

test('운영 — 예시 제휴 두 곳, 30일 만료 경고, 요건 체크리스트·계약 판·정산 명세', async ({ browser }) => {
  test.skip(!demo, '예시 제휴는 DEMO_MODE 켜짐에서만');
  const { page, close } = await as(browser, 'admin');
  await page.goto('/admin/alliance');
  const table = page.getByRole('table', { name: '제휴 후보 목록' });
  await expect(table.getByRole('row').filter({ hasText: '가람해운항공' })).toContainText('제휴 중');
  await expect(table.getByRole('row').filter({ hasText: '블루웨이브혼재' })).toContainText('요건 확인 중');
  await expect(page.getByTestId('alliance-warnings')).toContainText('보증보험 증권');
  await expect(page.getByTestId('alliance-warnings')).toContainText(/\d+일 남음/);
  const check = page.getByTestId('alliance-checklist');
  await expect(check.locator('[data-kind="registration_cert"]')).toContainText('확인함');
  await expect(check.locator('[data-kind="guarantee_bond"]')).toContainText('곧 만료');
  await expect(page.getByTestId('alliance-terms')).toContainText('AT-DEMO-0001 v2');
  await expect(page.getByTestId('alliance-settlements')).toContainText('예시-세금계산서-0001');
  await close();
});

test('꺼짐 — 물류사 신청은 잠기고, 화주 확정가 카드는 「제휴 주선사 확정 전」', async ({ browser }) => {
  test.skip(!demo, '데모 계정은 DEMO_MODE 켜짐에서만');
  const p = await as(browser, 'partner');
  await p.page.goto('/partner/alliance');
  await expect(p.page.getByTestId('alliance-locked')).toBeVisible();
  await expect(p.page.getByRole('button', { name: '제휴 신청하기' })).toBeDisabled();
  await p.close();
  const s = await as(browser, 'shipper');
  await s.page.goto(COMPARE);
  await expect(s.page.getByTestId('assure-party')).toContainText('계약 상대: 제휴 주선사 확정 전');
  await s.close();
});

test('켜면 — 물류사 신청·서류 → 운영 확인·계약 첫 판·정산 명세 → 화주 카드에 계약 상대 → 다시 끔', async ({ browser }) => {
  test.skip(!demo, '데모 계정은 DEMO_MODE 켜짐에서만');
  const admin = await as(browser, 'admin');
  await flip(admin.page, '켜기');
  try {
    // 물류사 — 신청하고 사업자등록증을 올린다(저장소가 없는 환경이면 기록만)
    const p = await as(browser, 'partner');
    await p.page.goto('/partner/alliance');
    await expect(p.page.getByTestId('alliance-locked')).toHaveCount(0);
    await p.page.locator('#ap-no').fill('국제물류주선업 제2019-인천-0412호');
    await p.page.getByRole('button', { name: '제휴 신청하기' }).click();
    await expect(p.page.getByTestId('alliance-mine')).toContainText('신청함');
    const item = p.page.getByTestId('alliance-partner-checklist').locator('[data-kind="biz_reg"]');
    // 필수 서류 칸은 처음부터 펼쳐져 있다(닫혀 있으면 연다)
    if ((await item.locator('details').getAttribute('open')) === null) await item.locator('summary').click();
    const form = p.page.getByTestId('alliance-upload-biz_reg');
    await form.locator('input[name="refNo"]').fill('999-90-10000');
    await form.locator('input[type="file"]').setInputFiles({ name: '사업자등록증.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 e2e') });
    await form.getByRole('button', { name: '사업자등록증 올리기' }).click();
    await expect(item).toContainText('올림 — 확인 전');
    await p.close();

    // 운영 — 새 후보를 열어 확인함(새 판), 계약 첫 판(초안)
    await admin.page.goto('/admin/alliance');
    await admin.page.getByRole('table', { name: '제휴 후보 목록' }).getByRole('link', { name: '한바다포워딩' }).click();
    await expect(admin.page.getByRole('heading', { level: 2, name: '한바다포워딩' })).toBeVisible();
    const row = admin.page.getByTestId('alliance-checklist').locator('[data-kind="biz_reg"]');
    await row.getByRole('button', { name: '사업자등록증 확인함' }).click();
    await expect(row).toContainText('확인함');
    await expect(row).toContainText('v2');
    await admin.page.getByTestId('alliance-terms-form').getByRole('button', { name: '계약 조건 첫 판 만들기' }).click();
    await expect(admin.page.getByTestId('alliance-terms')).toContainText('초안');

    // 운영 — 가람해운항공 정산 명세(예시 줄)
    await admin.page.goto('/admin/alliance');
    await admin.page.getByRole('table', { name: '제휴 후보 목록' }).getByRole('link', { name: '가람해운항공' }).click();
    const before = await admin.page.getByTestId('alliance-settlements').locator(':scope > li').count();
    const sf = admin.page.getByTestId('alliance-settlement-form');
    await sf.getByRole('button', { name: '예시 줄 넣어 보기' }).click();
    await expect(admin.page.getByTestId('alliance-settlement-preview')).toContainText('주선사가 낼 돈');
    await sf.getByRole('button', { name: '정산 명세 만들기' }).click();
    await expect(admin.page.getByTestId('alliance-settlements').locator(':scope > li')).toHaveCount(before + 1);

    // 화주 — 확정가 카드의 계약 상대(이름·등록번호 끝 4자리만)
    const s = await as(browser, 'shipper');
    await s.page.goto(COMPARE);
    const party = s.page.getByTestId('assure-party');
    await expect(party).toContainText('가람해운항공');
    await expect(party).toContainText('등록번호 끝 0218');
    await expect(party).not.toContainText('제2016');
    await s.close();
  } finally {
    await flip(admin.page, '끄기');
    await admin.close();
  }
});

for (const width of [390, 768]) {
  test(`제휴 화면이 ${width} 폭에서 넘치지 않는다`, async ({ browser }) => {
    test.skip(!demo, '데모 계정은 DEMO_MODE 켜짐에서만');
    for (const [who, path] of [['admin', '/admin/alliance'], ['partner', '/partner/alliance']] as const) {
      const { page, close } = await as(browser, who, width);
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(over, `${path} @${width}`).toBeLessThanOrEqual(0);
      await close();
    }
  });
}
