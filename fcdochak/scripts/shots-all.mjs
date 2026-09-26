// 모든 화면 캡처 — node scripts/shots-all.mjs <base-url> [out-dir]
// 390·768·1440 × 밝음·어두움. 물류사 콘솔은 중국어도 한 벌(1440·390 밝음).
import { spawnSync } from 'node:child_process';

const base = process.argv[2] ?? 'http://localhost:3100';
const out = process.argv[3] ?? 'docs/screens';
const all = ['--widths', '390,768,1440', '--themes', 'light,dark', '--quality', '55'];
const groups = [
  { paths: ['/', '/lanes', '/lanes/yiw-icn-lcl', '/partners', '/p/hanbada', '/faq', '/policy', '/login', '/join/shipper', '/join/partner', '/no-such-page', '/check', '/tools/pnl'] },
  { login: 'shipper', paths: ['/app', '/app/compare', '/app/pnl', '/app/requests', '/app/requests>/app/requests/', '/app/requests/new', '/app/shipments', '/app/shipments>/app/shipments/', '/app/skus', '/app/notifications', '/app/settings', '/forbidden', '/app/checks', '/app/checks>/app/checks/', '/app/docs', '/app/partners', '/app/integrations/wing'] },
  { login: 'partner', paths: ['/partner', '/partner/inbox', '/partner/inbox>/partner/inbox/', '/partner/rates', '/partner/rates>/partner/rates/', '/partner/rates/new', '/partner/rates/upload', '/partner/shipments', '/partner/shipments>/partner/shipments/', '/partner/invoices', '/partner/market', '/partner/profile', '/partner/notifications', '/partner/reviews', '/partner/alliance'] },
  { login: 'partner', extra: ['--widths', '390,1440', '--themes', 'light', '--locale', 'zh', '--suffix', '.zh', '--quality', '55'], paths: ['/partner', '/partner/inbox', '/partner/inbox>/partner/inbox/', '/partner/rates/new', '/partner/shipments>/partner/shipments/', '/partner/alliance'] },
  { login: 'shipper', paths: ['/app/sales', '/app/sales/products', '/app/sales/pnl', '/app/sales/returns', '/app/sales/inbound'] }, // v2 3차 sales
  { login: 'admin', paths: ['/admin', '/admin/queues', '/admin/data', '/admin/grades', '/admin/ads', '/admin/commission', '/admin/related', '/admin/settings', '/admin/audit', '/admin/demo', '/styleguide', '/admin/metrics', '/admin/assure', '/admin/alliance', '/admin/research', '/admin/research>/admin/research/'] },
  // v2 3차 sourcing — 패밀리 소개(공개) · 화주 코너 · 운영 대기열
  { paths: ['/family/sourcing'] },
  { login: 'shipper', paths: ['/app/sourcing', '/app/sourcing>/app/sourcing/'] },
  { login: 'admin', paths: ['/admin/sourcing', '/admin/sourcing>/admin/sourcing/'] },
  // v2 4차 onestop — 원스톱 구역(공개 홈·요금표) · 화주 주문서·목록·상세 · 운영 대기열·상세
  { paths: ['/onestop', '/onestop/price'] },
  { login: 'shipper', paths: ['/onestop/order', '/onestop/orders', '/onestop/orders>/onestop/orders/'] },
  { login: 'admin', paths: ['/admin/onestop', '/admin/onestop>/admin/onestop/'] },
  // v2 5차 tracker — 공개 통관 조회·소요 분포 · 화주 통관 알림 목록·상세 · 운영 폴링
  { paths: ['/track', '/track/stats'] },
  { login: 'shipper', paths: ['/app/tracking', '/app/tracking>/app/tracking/'] },
  { login: 'admin', paths: ['/admin/tracking'] },
  // v2 6차 scorecard — 공개 시장 지표·관세사 찾기(비로그인 = 이름 없음·흐림) · 화주 성적순 업체 찾기·관세사·비교(실질 비용) · 물류사 성적표(한·中) · 운영
  { paths: ['/market/customs', '/brokers', '/brokers>/brokers/'] },
  { login: 'shipper', paths: ['/partners?sort=fast', '/partners?sort=stable', '/app/compare?hub=YIW&port=ICN&mode=LCL&ds=40&mg=3000'] },
  { login: 'partner', paths: ['/partner/scorecard'] },
  { login: 'partner', extra: ['--widths', '390,1440', '--themes', 'light', '--locale', 'zh', '--suffix', '.zh', '--quality', '55'], paths: ['/partner/scorecard'] },
  { login: 'admin', paths: ['/admin/scorecard'] },
];
let bad = 0;
for (const g of groups) {
  const args = ['scripts/shots.mjs', base, out, g.paths.join(','), ...(g.extra ?? all), ...(g.login ? ['--login', g.login] : [])];
  const r = spawnSync('node', args, { stdio: 'inherit' });
  if (r.status === 2) bad++;
  else if (r.status !== 0) process.exit(r.status ?? 1);
}
// v2 5차 tracker — 공개 조회 결과(예시 번호로 조회) · 선적 화면의 「관세청 실측」 줄 · 업체 화면의 「실측 통관 소요」 칸
{
  const r = spawnSync('node', ['scripts/shots-track.mjs', base, out], { stdio: 'inherit' });
  if (r.status === 2) bad++;
  else if (r.status !== 0) process.exit(r.status ?? 1);
}
// 셀러 인터뷰 링크(토큰이 그때 만들어짐) — 운영자로 대상·링크를 만든 뒤 로그인 없는 창으로 연다
{
  const r = spawnSync('node', ['scripts/shots-interview.mjs', base, out], { stdio: 'inherit' });
  if (r.status === 2) bad++;
  else if (r.status !== 0) process.exit(r.status ?? 1);
}
process.exit(bad ? 2 : 0);
