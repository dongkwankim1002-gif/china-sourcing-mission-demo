// npm run smoke — DEMO_MODE 켜짐·꺼짐 각각: 빌드 → 서버 → Playwright 한 바퀴.
//   꺼짐 쪽은 빈 PGlite 폴더에 스키마·운영자 계정만 만들어(데모 없음) 돌린다.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const only = process.argv[2]; // on | off
const modes = only ? [only] : ['on', 'off'];
const run = (cmd, args, env) => {
  const r = spawnSync(cmd, args, { cwd: root, stdio: 'inherit', env: { ...process.env, ...env } });
  if (r.status !== 0) process.exit(r.status ?? 1);
};
const wait = async (url) => {
  for (let i = 0; i < 120; i++) {
    try {
      const r = await fetch(url);
      if (r.status < 500) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error('서버가 뜨지 않았습니다');
};

let failed = false;
for (const mode of modes) {
  if (failed) break;
  // 여러 작업 복사본에서 동시에 돌릴 때는 SMOKE_PORT_BASE 로 포트를 나눈다
  const base = Number(process.env.SMOKE_PORT_BASE || 3201);
  const port = mode === 'on' ? base : base + 1;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `fcd-smoke-${mode}-`));
  const env = { DEMO_MODE: mode, PGLITE_SEED_DEMO: mode, PGLITE_DIR: dir, DEMO_PASSWORD: process.env.DEMO_PASSWORD || 'smoke-demo-password1', SESSION_SECRET: 'smoke-only-session-secret-0123456789abcdef', DATABASE_URL: '', WING_KEY_ENCRYPTION_KEY: 'smoke-only-wing-kek-0123456789abcdefghij', WING_ENABLED: '' };
  const admin = { ADMIN_EMAIL: 'smoke-admin@smoke.test', ADMIN_PASSWORD: 'SmokeAdmin12345', ADMIN_NAME: '시험운영자' };
  console.log(`\n■ DEMO_MODE=${mode}`);
  run('npx', ['next', 'build'], { ...env, PGLITE_DIR: '' });
  if (mode === 'off') {
    run('npx', ['tsx', 'scripts/fcd.ts', 'db:migrate'], env);
    run('npx', ['tsx', 'scripts/fcd.ts', 'admin:create'], { ...env, ...admin });
  }
  const busy = await fetch(`http://localhost:${port}/`).then(() => true, () => false);
  if (busy) throw new Error(`포트 ${port} 에 이미 서버가 떠 있습니다 — 먼저 끄세요`);
  const server = spawn('npx', ['next', 'start', '-p', String(port)], { cwd: root, env: { ...process.env, ...env }, stdio: ['ignore', 'inherit', 'inherit'], detached: true });
  try {
    await wait(`http://localhost:${port}/`);
    const r = spawnSync('npx', ['playwright', 'test'], { cwd: root, stdio: 'inherit', env: { ...process.env, E2E_BASE: `http://localhost:${port}`, E2E_DEMO: mode, DEMO_PASSWORD: env.DEMO_PASSWORD, E2E_ADMIN_EMAIL: admin.ADMIN_EMAIL, E2E_ADMIN_PASSWORD: admin.ADMIN_PASSWORD } });
    if (r.status !== 0) failed = true;
  } finally {
    try {
      process.kill(-server.pid, 'SIGTERM');
    } catch {}
    await new Promise((r) => setTimeout(r, 1500));
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
if (failed) {
  console.error('\nsmoke 실패');
  process.exit(1);
}
console.log('\nsmoke 통과');
