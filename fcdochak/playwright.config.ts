import { defineConfig } from '@playwright/test';

/** smoke — 서버는 scripts/smoke.mjs 가 DEMO_MODE 별로 띄운다(E2E_BASE). */
export default defineConfig({
  testDir: 'e2e',
  timeout: 180_000,
  expect: { timeout: 15_000 },
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE ?? 'http://localhost:3100',
    locale: 'ko-KR',
    timezoneId: 'Asia/Seoul',
    trace: 'retain-on-failure',
    launchOptions: {
      executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
      args: ['--disable-background-networking', '--disable-component-update', '--no-first-run'],
    },
  },
});
