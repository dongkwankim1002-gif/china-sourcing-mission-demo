/**
 * 운영 명령 — npm run db:migrate · demo:seed · demo:status · demo:purge · admin:create
 *
 *   DATABASE_URL 이 있으면 그 Postgres(Supabase), 없으면 PGLITE_DIR(기본 .pglite) 의 로컬 PGlite.
 *   이 명령들은 자료를 지우거나 덮지 않는다. demo:purge 도 SQL 파일만 만든다 — 실행은 사람이 한다.
 *   비밀값(DB 주소·키·비밀번호)은 환경변수에서만 읽고, 화면에 찍지 않는다.
 */
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createDriver, type Driver } from '../src/lib/db/driver';
import { migrate } from '../src/lib/db/migrate';
import { hashPassword } from '../src/lib/auth/password';
import { demoCounts } from '../src/lib/server/demo-status';
import { PLATFORM_ORG_ID, seedReference } from '../seed/reference';
import { DEMO_ACCOUNTS, seedDemo } from '../seed/demo';
import { buildPurgeSql, planPurge } from '../seed/demo/purge';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
for (const f of ['.env.local', '.env']) {
  try {
    process.loadEnvFile(path.join(root, f));
  } catch {
    /* 없으면 넘어간다 */
  }
}

const E = (k: string) => process.env[k] || null;
const dbUrl = () => E('DATABASE_URL_DIRECT') ?? E('DATABASE_URL') ?? E('POSTGRES_URL');
const supabase = () => {
  const url = E('NEXT_PUBLIC_SUPABASE_URL') ?? E('SUPABASE_URL');
  const key = E('SUPABASE_SERVICE_ROLE_KEY');
  return url && key ? { url, key } : null;
};
const todayKst = () => E('FCD_TODAY') ?? new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);

async function open(): Promise<Driver> {
  const url = dbUrl();
  const dir = url ? null : path.resolve(root, E('PGLITE_DIR') ?? '.pglite');
  console.log(url ? '대상: 환경변수의 Postgres' : `대상: 로컬 PGlite (${path.relative(root, dir!) || '.'})`);
  return createDriver({ url, dataDir: dir });
}

async function schemaReady(db: Driver) {
  const r = await db.query<{ t: string | null }>(`select to_regclass('fcd.orgs')::text t`);
  if (!r[0]?.t) throw new Error('fcd 스키마가 없습니다. 먼저 npm run db:migrate 를 실행하세요.');
}

async function createSupabaseUser(u: { id: string; email: string; password: string; name: string }) {
  const s = supabase()!;
  const r = await fetch(`${s.url}/auth/v1/admin/users`, {
    method: 'POST',
    headers: { apikey: s.key, authorization: `Bearer ${s.key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ id: u.id, email: u.email, password: u.password, email_confirm: true, user_metadata: { name: u.name } }),
  });
  if (r.status === 422) {
    console.log(`  · ${u.email}: 이미 있는 계정 — 그대로 둡니다`);
    return;
  }
  if (!r.ok) throw new Error(`Supabase 계정 생성 실패(${r.status}) — ${u.email}`);
  console.log(`  · ${u.email}: 계정을 만들었습니다`);
}

function table(rows: { table: string; demo: number; real: number }[]) {
  const w = Math.max(...rows.map((r) => r.table.length));
  console.log(`  ${'표'.padEnd(w)}   예시    실제`);
  for (const r of rows) console.log(`  ${r.table.padEnd(w)} ${String(r.demo).padStart(6)} ${String(r.real).padStart(7)}`);
  console.log(`  ${'합계'.padEnd(w - 1)} ${String(rows.reduce((t, r) => t + r.demo, 0)).padStart(6)}`);
}

const commands: Record<string, (db: Driver, args: string[]) => Promise<void>> = {
  /** 스키마를 만드는 마이그레이션 + 참조 첫 판(있으면 건너뜀) */
  async 'db:migrate'(db) {
    const n = await migrate(db, (m) => console.log(`  · ${m}`));
    await db.transaction((tx) => seedReference(tx));
    console.log(`마이그레이션 ${n}개를 올렸고, 참조표·설정 첫 판을 확인했습니다.`);
  },

  async 'demo:seed'(db) {
    await schemaReady(db);
    const pw = E('DEMO_PASSWORD');
    const sb = supabase();
    if (!pw) console.log('DEMO_PASSWORD 가 비어 있어 데모 계정은 로그인할 수 없게 만듭니다(나머지 데이터는 넣습니다).');
    const r = await seedDemo(db, {
      today: todayKst(),
      password: pw,
      localCredentials: !sb,
      createAuthUser: sb ? createSupabaseUser : undefined,
      log: (m) => console.log(m),
    });
    if (r.inserted) console.log('데모 계정:', Object.values(DEMO_ACCOUNTS).map((a) => a.email).join(', '));
    const env = E('DEMO_MODE');
    console.log(`DEMO_MODE=${env ?? '(비어 있음 → 켜짐)'} — 꺼져 있으면 화면에는 보이지 않습니다.`);
  },

  async 'demo:status'(db) {
    await schemaReady(db);
    const counts = await db.transaction(async (tx) => demoCounts(tx));
    table(counts);
    console.log(`DEMO_MODE=${E('DEMO_MODE') ?? '(비어 있음 → 켜짐)'}`);
  },

  async 'demo:purge'(db) {
    await schemaReady(db);
    const plan = await db.transaction((tx) => planPurge(tx));
    console.log('지울 대상(예시만):');
    table(plan.counts);
    const sql = buildPurgeSql(plan);
    const out = path.join(root, 'supabase/purge-demo.sql');
    fs.writeFileSync(out, sql);
    console.log(`\n${path.relative(root, out)} 를 만들었습니다. 이 명령은 아무것도 지우지 않았습니다.`);
    console.log('파일을 읽어 본 뒤 Supabase SQL 편집기에서 사람이 직접 실행하세요 — 순서는 docs/DEMO.md.');
  },

  /**
   * Vercel 빌드 앞단 — DB 가 연결돼 있으면 스키마(만들기만)·참조 첫 판을 올리고, DEMO_MODE 가 켜져 있으면
   * 데모를 한 번 넣는다(이미 있으면 건너뜀), 서류 버킷이 없으면 만든다. DB 가 없으면 아무것도 하지 않는다(PGlite 미리보기).
   */
  async 'vercel:prepare'(db) {
    await commands['db:migrate'](db, []);
    const demoOn = !['off', '0', 'false', 'no'].includes((E('DEMO_MODE') ?? 'on').toLowerCase());
    if (demoOn) await commands['demo:seed'](db, []);
    const sb = supabase();
    if (sb) {
      const r = await fetch(`${sb.url}/storage/v1/bucket`, {
        method: 'POST',
        headers: { apikey: sb.key, authorization: `Bearer ${sb.key}`, 'content-type': 'application/json' },
        body: JSON.stringify({ id: 'fcd-docs', name: 'fcd-docs', public: false, file_size_limit: 20 * 1024 * 1024 }),
      });
      console.log(r.ok ? '서류 버킷 fcd-docs 를 만들었습니다(비공개).' : r.status === 409 || r.status === 400 ? '서류 버킷 fcd-docs 가 이미 있습니다.' : `서류 버킷을 만들지 못했습니다(${r.status}) — 나중에 대시보드에서 만드세요.`);
    }
  },

  /** 첫 운영자 계정 — ADMIN_EMAIL · ADMIN_PASSWORD · ADMIN_NAME */
  async 'admin:create'(db) {
    await schemaReady(db);
    const email = E('ADMIN_EMAIL')?.trim().toLowerCase();
    const pw = E('ADMIN_PASSWORD');
    const name = E('ADMIN_NAME') ?? '운영자';
    if (!email || !pw) throw new Error('ADMIN_EMAIL 과 ADMIN_PASSWORD 를 환경변수로 넣어 주세요(값은 화면에 찍지 않습니다).');
    if (pw.length < 10) throw new Error('ADMIN_PASSWORD 는 10자 이상');
    const exists = await db.query('select 1 from fcd.profiles where lower(email) = $1', [email]);
    if (exists.length) {
      console.log('이미 있는 계정입니다 — 바꾸지 않았습니다.');
      return;
    }
    const id = randomUUID();
    const sb = supabase();
    if (sb) await createSupabaseUser({ id, email, password: pw, name });
    await db.transaction(async (tx) => {
      await tx.query(`insert into fcd.profiles (id, home_org_id, email, name, locale) values ($1,$2,$3,$4,'ko')`, [id, PLATFORM_ORG_ID, email, name]);
      await tx.query(`insert into fcd.memberships (user_id, org_id, role) values ($1,$2,'platform_admin')`, [id, PLATFORM_ORG_ID]);
      if (!sb) await tx.query(`insert into fcd.local_credentials (user_id, password_hash) values ($1,$2)`, [id, await hashPassword(pw)]);
      await tx.query(`insert into fcd.audit_log (actor_id, org_id, action, target) values ($1,$2,'admin.created','cli')`, [id, PLATFORM_ORG_ID]);
    });
    console.log(`운영자 계정을 만들었습니다: ${email}`);
  },
};

const [cmd, ...args] = process.argv.slice(2);
const run = commands[cmd ?? ''];
if (cmd === 'vercel:prepare' && !dbUrl()) {
  console.log('DB 연결값이 없어 건너뜁니다 — PGlite 데모 미리보기로 빌드합니다.');
  process.exit(0);
}
if (!run) {
  console.log(`쓸 수 있는 명령: ${Object.keys(commands).join(' · ')}`);
  process.exit(cmd ? 1 : 0);
}
const db = await open();
try {
  await run(db, args);
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
} finally {
  await db.close();
}
