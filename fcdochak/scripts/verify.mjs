// npm run verify — 시험 → 형 검사 → 빌드. 하나라도 빨간불이면 멈춘다.
//   --no-demo : DEMO_MODE=off · 데모 시드 없이 한 번 더 빌드(걷어낸 뒤와 같은 상태)
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const noDemo = process.argv.includes('--no-demo');

const steps = [
  ['마이그레이션 묶음', 'node', ['scripts/gen-migrations.mjs']],
  ['시험', 'npx', ['vitest', 'run']],
  ['형 검사', 'npx', ['tsc', '--noEmit']],
  ['빌드', 'npx', ['next', 'build']],
];
if (noDemo) steps.push(['빌드(데모 없음)', 'npx', ['next', 'build'], { DEMO_MODE: 'off', PGLITE_SEED_DEMO: 'off' }]);

for (const [name, cmd, args, extra] of steps) {
  const t = Date.now();
  process.stdout.write(`\n▶ ${name}\n`);
  const r = spawnSync(cmd, args, { cwd: root, stdio: 'inherit', env: { ...process.env, ...(extra ?? {}) } });
  if (r.status !== 0) {
    console.error(`\n✖ ${name} 실패 — 여기서 멈춥니다.`);
    process.exit(r.status ?? 1);
  }
  console.log(`✔ ${name} (${((Date.now() - t) / 1000).toFixed(1)}초)`);
}
console.log('\n모두 통과했습니다.');
