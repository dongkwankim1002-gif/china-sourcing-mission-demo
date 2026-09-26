import type { Driver } from './driver';
import { MIGRATIONS } from './migrations.generated';

/**
 * 스키마를 새로 만드는 마이그레이션만 올린다(자료를 지우거나 덮는 SQL 은 여기 두지 않는다).
 * 이미 올린 것은 fcd.schema_migrations 에 이름이 있어 건너뛴다.
 */
export async function migrate(db: Driver, log: (m: string) => void = () => {}) {
  await db.exec(`
    create schema if not exists fcd;
    create table if not exists fcd.schema_migrations (
      name text primary key,
      applied_at timestamptz not null default now()
    );
    alter table fcd.schema_migrations enable row level security;
    revoke all on fcd.schema_migrations from public;
  `);
  const applied = new Set<string>();
  for (const r of await db.query<{ name: string }>('select name from fcd.schema_migrations')) applied.add(r.name);
  let n = 0;
  for (const m of MIGRATIONS) {
    if (applied.has(m.name)) continue;
    await db.transaction(async (tx) => {
      await tx.exec(m.sql);
      await tx.query('insert into fcd.schema_migrations (name) values ($1)', [m.name]);
    });
    log(`applied ${m.name}`);
    n++;
  }
  const lock = await db.query<{ f: string | null }>(`select to_regprocedure('fcd.lockdown()')::text as f`);
  if (lock[0]?.f) await db.exec('select fcd.lockdown()');
  return n;
}
