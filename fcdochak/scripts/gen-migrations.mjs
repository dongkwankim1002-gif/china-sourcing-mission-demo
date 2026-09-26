// supabase/migrations/*.sql → src/lib/db/migrations.generated.ts
// 앱이 파일시스템 없이(서버리스) 마이그레이션을 들고 다니게 한다. 손으로 고치지 않는다.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'supabase/migrations');
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
const body = files
  .map((f) => `  { name: ${JSON.stringify(f)}, sql: ${JSON.stringify(fs.readFileSync(path.join(dir, f), 'utf8'))} },`)
  .join('\n');
const out = `// 생성 파일 — scripts/gen-migrations.mjs. 손으로 고치지 않는다.\nexport const MIGRATIONS: { name: string; sql: string }[] = [\n${body}\n];\n`;
const target = path.join(root, 'src/lib/db/migrations.generated.ts');
const prev = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : '';
if (prev !== out) fs.writeFileSync(target, out);
console.log(`migrations: ${files.length} (${prev === out ? 'unchanged' : 'written'})`);
