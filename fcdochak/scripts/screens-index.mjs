// docs/screens/README.md — 캡처 목록(화면 × 폭 × 테마). node scripts/screens-index.mjs
import fs from 'node:fs';
const dir = 'docs/screens';
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.jpg')).sort();
const pages = new Map();
for (const f of files) {
  const m = f.match(/^(.*?)\.(390|768|1440)\.(light|dark)\.jpg$/);
  if (!m) continue;
  const [, name, w, t] = m;
  if (!pages.has(name)) pages.set(name, {});
  pages.get(name)[`${w}.${t}`] = f;
}
const group = (n) => (n.startsWith('app') || n === 'forbidden' ? '화주 /app' : n.startsWith('partner') && n !== 'partners' ? '물류사 /partner' : n.startsWith('admin') || n === 'styleguide' ? '운영 /admin' : '공개');
const cols = ['390.light', '768.light', '1440.light', '390.dark', '768.dark', '1440.dark'];
const lines = ['# 화면 캡처', '', `모두 ${files.length}장 · 390/768/1440 × 밝음/어두움 · 데모 켬 · 재방문 상태(글꼴 적용) · \`node scripts/shots-all.mjs\``, '', '가로 밀림 검사: 모든 화면 0건(`scripts/shots.mjs` 가 문서 폭 > 창 폭이면 알림). Lighthouse 결과는 [lighthouse.md](lighthouse.md).', ''];
for (const g of ['공개', '화주 /app', '물류사 /partner', '운영 /admin']) {
  lines.push(`## ${g}`, '', `| 화면 | ${cols.join(' | ')} |`, `|---|${cols.map(() => '---').join('|')}|`);
  for (const [name, v] of pages) {
    if (group(name) !== g) continue;
    lines.push(`| \`${name}\` | ${cols.map((c) => (v[c] ? `[보기](${v[c]})` : '—')).join(' | ')} |`);
  }
  lines.push('');
}
fs.writeFileSync(`${dir}/README.md`, lines.join('\n'));
console.log('pages', pages.size, 'files', files.length);
