// 모든 화면 캡처 — node scripts/shots-all.mjs <base-url> [out-dir]
// 390·768·1440 × 밝음·어두움. 물류사 콘솔은 중국어도 한 벌(1440·390 밝음).
import { spawnSync } from 'node:child_process';

const base = process.argv[2] ?? 'http://localhost:3100';
const out = process.argv[3] ?? 'docs/screens';
const all = ['--widths', '390,768,1440', '--themes', 'light,dark', '--quality', '55'];
const groups = [
  { paths: ['/', '/lanes', '/lanes/yiw-icn-lcl', '/partners', '/p/hanbada', '/faq', '/policy', '/login', '/join/shipper', '/join/partner', '/no-such-page', '/check', '/tools/pnl'] },
  { login: 'shipper', paths: ['/app', '/app/compare', '/app/pnl', '/app/requests', '/app/requests>/app/requests/', '/app/requests/new', '/app/shipments', '/app/shipments>/app/shipments/', '/app/skus', '/app/notifications', '/app/settings', '/forbidden', '/app/checks', '/app/checks>/app/checks/', '/app/docs', '/app/partners'] },
  { login: 'partner', paths: ['/partner', '/partner/inbox', '/partner/inbox>/partner/inbox/', '/partner/rates', '/partner/rates>/partner/rates/', '/partner/rates/new', '/partner/rates/upload', '/partner/shipments', '/partner/shipments>/partner/shipments/', '/partner/invoices', '/partner/market', '/partner/profile', '/partner/notifications', '/partner/reviews', '/partner/alliance'] },
  { login: 'partner', extra: ['--widths', '390,1440', '--themes', 'light', '--locale', 'zh', '--suffix', '.zh', '--quality', '55'], paths: ['/partner', '/partner/inbox', '/partner/inbox>/partner/inbox/', '/partner/rates/new', '/partner/shipments>/partner/shipments/', '/partner/alliance'] },
  { login: 'admin', paths: ['/admin', '/admin/queues', '/admin/data', '/admin/grades', '/admin/ads', '/admin/commission', '/admin/related', '/admin/settings', '/admin/audit', '/admin/demo', '/styleguide', '/admin/metrics', '/admin/assure', '/admin/alliance'] },
];
let bad = 0;
for (const g of groups) {
  const args = ['scripts/shots.mjs', base, out, g.paths.join(','), ...(g.extra ?? all), ...(g.login ? ['--login', g.login] : [])];
  const r = spawnSync('node', args, { stdio: 'inherit' });
  if (r.status === 2) bad++;
  else if (r.status !== 0) process.exit(r.status ?? 1);
}
process.exit(bad ? 2 : 0);
