// 공개 쪽 Lighthouse — node scripts/lighthouse.mjs <base-url> [out-dir]
//   LIGHTHOUSE_BIN(없으면 npx lighthouse) · CHROME_PATH. 모바일(기본 설정)과 데스크톱 둘 다.
//   결과는 <out-dir>/lighthouse.md 표 + lighthouse.json 요약. 90 밑이면 끝 코드 2.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const base = process.argv[2] ?? 'http://localhost:3100';
const out = process.argv[3] ?? 'docs/screens';
const pages = ['/', '/lanes', '/lanes/yiw-icn-lcl', '/partners', '/p/hanbada', '/faq', '/policy', '/join/shipper', '/join/partner', '/login'];
const bin = process.env.LIGHTHOUSE_BIN;
const chrome = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fcd-lh-'));
const cats = ['performance', 'accessibility', 'best-practices', 'seo'];
const rows = [];
for (const preset of ['mobile', 'desktop']) {
  for (const p of pages) {
    const file = path.join(tmp, `${preset}-${p.replace(/\W+/g, '_') || 'home'}.json`);
    const args = [
      base + p,
      '--output=json',
      `--output-path=${file}`,
      '--quiet',
      `--only-categories=${cats.join(',')}`,
      '--chrome-flags=--headless=new --no-sandbox --disable-gpu',
      ...(preset === 'desktop' ? ['--preset=desktop'] : []),
    ];
    const r = bin
      ? spawnSync(bin, args, { stdio: 'inherit', env: { ...process.env, CHROME_PATH: chrome } })
      : spawnSync('npx', ['-y', 'lighthouse@12', ...args], { stdio: 'inherit', env: { ...process.env, CHROME_PATH: chrome } });
    if (r.status !== 0 || !fs.existsSync(file)) {
      rows.push({ preset, page: p, error: true });
      continue;
    }
    const j = JSON.parse(fs.readFileSync(file, 'utf8'));
    const s = Object.fromEntries(cats.map((c) => [c, Math.round((j.categories[c]?.score ?? 0) * 100)]));
    rows.push({ preset, page: p, ...s, lcp: j.audits['largest-contentful-paint']?.displayValue, cls: j.audits['cumulative-layout-shift']?.displayValue, tbt: j.audits['total-blocking-time']?.displayValue });
    console.log(preset, p, JSON.stringify(s));
  }
}
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'lighthouse.json'), JSON.stringify({ measuredAt: new Date().toISOString(), base, rows }, null, 2));
const md = [
  '# Lighthouse — 공개 쪽',
  '',
  `잰 때 ${new Date().toISOString()} · 로컬 \`next start\`(프로덕션 빌드) · Lighthouse 12 · 모바일 = 기본(느린 4G·CPU 4배 느림), 데스크톱 = --preset=desktop`,
  '',
  '| 기기 | 쪽 | 성능 | 접근성 | 권장 | SEO | LCP | TBT | CLS |',
  '|---|---|---:|---:|---:|---:|---:|---:|---:|',
  ...rows.map((r) => (r.error ? `| ${r.preset} | ${r.page} | 실패 | | | | | | |` : `| ${r.preset} | \`${r.page}\` | ${r.performance} | ${r.accessibility} | ${r['best-practices']} | ${r.seo} | ${r.lcp} | ${r.tbt} | ${r.cls} |`)),
  '',
].join('\n');
fs.writeFileSync(path.join(out, 'lighthouse.md'), md);
const low = rows.filter((r) => r.error || cats.some((c) => r[c] < 90));
if (low.length) {
  console.log('\n90 밑:', low.map((r) => `${r.preset} ${r.page}`).join(', '));
  process.exitCode = 2;
}
