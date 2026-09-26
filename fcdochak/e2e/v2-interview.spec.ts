/**
 * v2 interview — 셀러 인터뷰 화면 흐름.
 * 두 모드 모두: 운영이 대상 넣기 → 링크 만들기(화면에 보이고 복사, 발송 없음) → 셀러가 로그인 없이 390 폭에서
 *   동의 → 선적 조건 → (새로 고쳐도 이어짐) → 화면 셋 미리 계산·반응 → 확정가 사다리·반대 질문 → 지금 방식 → 자유 의견 → 끝 → 링크 닫힘.
 *   동의 거부 · 인터뷰어 모드(구두 동의·대신 적기·판 목록) · /check 방문이 퍼널에 한 줄 · 물량 단가 넣기.
 * 데모 켜짐에서만(E2E_DEMO=off 면 건너뜀): 예시 12명으로 판정 셋이 보인다.
 * 꺼짐에서 운영자는 npm run admin:create 로 만든 계정(E2E_ADMIN_EMAIL·E2E_ADMIN_PASSWORD).
 */
import { expect, test, type Browser, type Page } from '@playwright/test';

const demo = process.env.E2E_DEMO !== 'off';
const stamp = Date.now().toString(36);

test.describe.configure({ mode: 'serial' });

async function asAdmin(browser: Browser, width = 1440): Promise<{ page: Page; close: () => Promise<void> }> {
  const ctx = await browser.newContext({ reducedMotion: 'reduce', viewport: { width, height: 900 } });
  const page = await ctx.newPage();
  if (demo) {
    const r = await ctx.request.post('/api/demo-login?as=admin', { maxRedirects: 0 });
    expect(r.status()).toBe(303);
  } else {
    await page.goto('/login');
    await page.locator('#email').fill(process.env.E2E_ADMIN_EMAIL!);
    await page.locator('#password').fill(process.env.E2E_ADMIN_PASSWORD!);
    await page.getByRole('button', { name: '로그인' }).last().click();
    await page.waitForURL((u) => !u.pathname.startsWith('/login'));
  }
  return { page, close: () => ctx.close() };
}

async function seller(browser: Browser) {
  const ctx = await browser.newContext({ reducedMotion: 'reduce', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  return { ctx, page: await ctx.newPage() };
}

const noOverflow = async (page: Page) => {
  const w = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
  expect(w.sw, '가로 밀림').toBeLessThanOrEqual(w.iw + 1);
};

/** 대상을 넣고 그 줄의 번호를 돌려준다 */
async function addParticipant(page: Page, label: string): Promise<string> {
  await page.goto('/admin/research');
  await page.locator('#rp-label').fill(label);
  await page.locator('#rp-ms').fill('3');
  await page.getByRole('button', { name: '대상 넣기' }).last().click();
  const row = page.locator('tr[data-testid^="participant-"]', { hasText: label });
  await expect(row).toBeVisible();
  return (await row.getAttribute('data-testid'))!.replace('participant-', '');
}

async function makeLink(page: Page, label: string): Promise<string> {
  const row = page.locator('tr[data-testid^="participant-"]', { hasText: label });
  await row.getByRole('button', { name: /인터뷰 링크 만들기|새 링크 만들기/ }).click();
  const input = row.getByTestId('research-link');
  await expect(input).toBeVisible();
  const link = await input.inputValue();
  expect(link).toMatch(/\/interview\/[A-Za-z0-9_-]{43}$/);
  return new URL(link).pathname;
}

test('결정 보드 — 판정 셋·대상 표·물량 단가 폼이 보이고 메뉴에서 들어간다', async ({ browser }) => {
  const { page, close } = await asAdmin(browser);
  await page.goto('/admin');
  await page.getByRole('link', { name: '셀러 인터뷰' }).first().click();
  await expect(page.getByRole('heading', { level: 1, name: '셀러 인터뷰 · 결정 보드' })).toBeVisible();
  for (const id of ['verdict-wtp', 'verdict-upload', 'verdict-vendor']) await expect(page.getByTestId(id)).toBeVisible();
  await expect(page.getByTestId('vendor-quote-form')).toBeVisible();
  if (demo) {
    await expect(page.getByTestId('wtp-verdict')).toHaveAttribute('data-verdict', 'met');
    await expect(page.getByTestId('upload-verdict')).toHaveAttribute('data-verdict', 'met');
    await expect(page.getByTestId('vendor-verdict')).toHaveAttribute('data-verdict', 'met');
    await expect(page.locator('tr[data-testid^="participant-"]', { hasText: '예시 셀러' })).toHaveCount(14);
    await expect(page.getByTestId('wtp-chart')).toBeVisible();
    await expect(page.getByTestId('quotes').locator('li').first()).toBeVisible();
    await expect(page.getByTestId('volume-curves')).toBeVisible();
    // 연락처는 가려서 — 풀어 보면 감사 기록(여기서는 풀린 값이 보이는지만)
    const row = page.locator('tr[data-testid="participant-P-01"]');
    await expect(row.getByText('010-****-')).toBeVisible();
  } else {
    await expect(page.getByTestId('wtp-verdict')).toHaveAttribute('data-verdict', 'insufficient');
  }
  await close();
});

test('셀러 흐름 — 링크로 390 폭에서 끝까지, 새로 고쳐도 이어지고 끝나면 닫힌다', async ({ browser }) => {
  const admin = await asAdmin(browser);
  const label = `시험 셀러 ${stamp}`;
  const code = await addParticipant(admin.page, label);
  const path = await makeLink(admin.page, label);

  const { ctx, page } = await seller(browser);
  await page.goto(path);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.getByTestId('consent-text')).toContainText('동의하지 않으셔도 아무 불이익이 없습니다');
  await noOverflow(page);
  await page.getByRole('button', { name: '동의하고 시작' }).click();
  await expect(page.getByTestId('interview-flow')).toHaveAttribute('data-step', 'lane');
  await page.locator('#iv-hub').selectOption('YIW');
  await page.locator('#iv-port').selectOption('ICN');
  await page.locator('#iv-mode').selectOption('LCL');
  await page.locator('#iv-cbm').fill('3');
  await page.locator('#iv-price').fill('19900');
  await page.locator('#iv-last').fill('3500000');
  await page.getByRole('button', { name: '저장하고 다음' }).click();
  await expect(page.getByTestId('interview-flow')).toHaveAttribute('data-step', 'screens');

  // 새로 고쳐도 같은 단계에서 이어진다(진행 저장)
  await page.reload();
  await expect(page.getByTestId('interview-flow')).toHaveAttribute('data-step', 'screens');
  await expect(page.getByTestId('preview-firm')).toContainText('확정가');
  await expect(page.getByTestId('preview-check')).toContainText('3,500,000원');
  await expect(page.getByTestId('preview-pnl')).toContainText('개당 도착원가');
  for (const k of ['check', 'firm', 'pnl']) await page.getByTestId(`react-${k}`).locator('label', { hasText: /^4$/ }).click();
  await page.locator('#iv-why-firm').fill('추가비용이 없으면 좋겠다');
  await noOverflow(page);
  await page.getByRole('button', { name: '저장하고 다음' }).click();

  await expect(page.getByTestId('interview-flow')).toHaveAttribute('data-step', 'ladder');
  const next = page.getByRole('button', { name: '저장하고 다음' });
  await expect(next).toBeDisabled();
  await page.getByTestId('rung-100').getByRole('button', { name: '예' }).click();
  await page.getByTestId('rung-300').getByRole('button', { name: '예' }).click();
  await page.getByTestId('rung-500').getByRole('button', { name: '아니오' }).click();
  await expect(page.getByTestId('rung-800')).toHaveCount(0); // 처음 「아니오」에서 멈춤
  await page.getByText('아니다 — 확정가가 낫다').click();
  await page.getByText('2~3번').click();
  await page.getByTestId('pilot').getByRole('button', { name: '예' }).click();
  await expect(page.getByTestId('shown-premium')).toBeVisible();
  await next.click();

  await expect(page.getByTestId('interview-flow')).toHaveAttribute('data-step', 'habits');
  await page.getByText('견적에 없던 추가비용·청구가 견적과 다름').click();
  await page.getByText('매번 견적 비교').click();
  await page.getByText('안 써 봤다').click();
  await page.getByRole('button', { name: '저장하고 다음' }).click();

  await expect(page.getByTestId('interview-flow')).toHaveAttribute('data-step', 'comment');
  await page.locator('#iv-comment').fill(`청구서 대조가 제일 힘들어요 ${stamp}`);
  await page.getByText('이름 없이').click();
  await page.getByRole('button', { name: '끝내기' }).click();
  await expect(page.getByTestId('interview-done')).toBeVisible();

  await page.goto(path);
  await expect(page.getByTestId('interview-closed')).toHaveAttribute('data-status', 'completed');
  await ctx.close();

  await admin.page.goto('/admin/research');
  await expect(admin.page.getByTestId(`participant-${code}`)).toHaveAttribute('data-progress', 'done');
  await expect(admin.page.getByTestId('quotes')).toContainText(stamp);
  await admin.close();
});

test('동의하지 않으면 여기서 끝 — 아무것도 저장하지 않는다', async ({ browser }) => {
  const admin = await asAdmin(browser);
  const label = `거부 셀러 ${stamp}`;
  const code = await addParticipant(admin.page, label);
  const path = await makeLink(admin.page, label);
  const { ctx, page } = await seller(browser);
  await page.goto(path);
  await page.getByRole('button', { name: '동의하지 않음' }).click();
  await expect(page.getByTestId('interview-declined')).toBeVisible();
  await ctx.close();
  await admin.page.goto('/admin/research');
  await expect(admin.page.getByTestId(`participant-${code}`)).toHaveAttribute('data-progress', 'declined');
  await admin.close();
});

test('모르는 링크는 「찾을 수 없습니다」', async ({ page }) => {
  await page.goto(`/interview/${'x'.repeat(43)}`);
  await expect(page.getByTestId('interview-closed')).toHaveAttribute('data-status', 'not_found');
  await page.goto('/interview/short');
  await expect(page.getByTestId('interview-closed')).toHaveAttribute('data-status', 'not_found');
});

test('인터뷰어 모드 — 읽을 말, 구두 동의, 대신 적은 답이 새 판으로', async ({ browser }) => {
  const admin = await asAdmin(browser);
  const label = `통화 셀러 ${stamp}`;
  const code = await addParticipant(admin.page, label);
  const row = admin.page.getByTestId(`participant-${code}`);
  await row.getByRole('link', { name: /통화하며 대신 적기/ }).click();
  await expect(admin.page.getByRole('heading', { level: 1 })).toContainText('인터뷰어 모드');
  await expect(admin.page.getByTestId('interviewer-script')).toBeVisible();
  await admin.page.getByRole('button', { name: '구두 동의 받음' }).click();
  await expect(admin.page.getByTestId('interview-flow')).toHaveAttribute('data-step', 'lane');
  await admin.page.locator('#iv-cbm').fill('5');
  await admin.page.getByRole('button', { name: '저장하고 다음' }).click();
  await expect(admin.page.getByTestId('interview-flow')).toHaveAttribute('data-step', 'screens');
  await expect(admin.page.getByTestId('preview-firm')).toBeVisible();
  await admin.page.reload();
  await expect(admin.page.getByTestId('versions').locator('li')).toHaveCount(1);
  await expect(admin.page.getByTestId('versions')).toContainText('대신 적음');
  await admin.page.goto('/admin/research');
  await expect(admin.page.getByTestId(`participant-${code}`)).toHaveAttribute('data-progress', 'in_progress');
  await admin.close();
});

test('실험 ② — /check 를 연 기기가 퍼널 방문에 한 대 더해진다', async ({ browser }) => {
  const admin = await asAdmin(browser);
  await admin.page.goto('/admin/research');
  const before = Number(await admin.page.getByTestId('verdict-upload').getAttribute('data-visitors'));
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  await p.goto('/check');
  await expect(p.getByRole('heading', { level: 1 })).toBeVisible();
  await expect
    .poll(
      async () => {
        await admin.page.reload();
        return Number(await admin.page.getByTestId('verdict-upload').getAttribute('data-visitors'));
      },
      { timeout: 15_000 },
    )
    .toBe(before + 1);
  await ctx.close();
  await admin.close();
});

test('실험 ③ — 물량 단가를 넣으면 곡선에 들어간다', async ({ browser }) => {
  const admin = await asAdmin(browser);
  await admin.page.goto('/admin/research');
  const f = admin.page.getByTestId('vendor-quote-form');
  await f.locator('#vq-label').fill(`시험 콘솔사 ${stamp}`);
  await f.locator('#vq-vol').fill('12');
  await f.locator('#vq-price').fill('51000');
  await f.getByRole('button', { name: '단가 넣기' }).click();
  await expect(admin.page.getByText('단가를 넣었습니다')).toBeVisible();
  await expect(admin.page.getByTestId('volume-curves')).toContainText('콘솔사 · 해상+CFS');
  await admin.page.getByText(/받은 단가 \d+건 보기/).click();
  await expect(admin.page.getByText(`시험 콘솔사 ${stamp}`)).toBeVisible();
  await admin.close();
});

test('결정 보드 390 폭 — 가로 밀림 없음(표는 제 칸 안에서 밀린다)', async ({ browser }) => {
  const { page, close } = await asAdmin(browser, 390);
  await page.goto('/admin/research');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await noOverflow(page);
  await close();
});
