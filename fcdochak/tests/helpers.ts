import { createDriver, type Driver } from '@/lib/db/driver';
import { migrate } from '@/lib/db/migrate';
import { seedReference } from '@seed/reference';

/**
 * Supabase 와 같은 위험을 일부러 깔고 시작한다:
 * anon·authenticated·service_role 역할 + 「새 표마다 권한 전부」 기본 ACL(전역과 public 둘 다).
 * 그 위에서 마이그레이션을 올려 잠금이 실제로 걸리는지 본다.
 */
export async function hazardDb(): Promise<Driver> {
  const db = await createDriver({ url: null, dataDir: null });
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin;
    alter default privileges grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges grant all on functions to anon, authenticated;
  `);
  await migrate(db);
  await db.transaction((tx) => seedReference(tx));
  return db;
}

export async function asRole<T>(db: Driver, role: 'fcd_user' | 'fcd_public', userId: string | null, demo: boolean, fn: (q: Driver) => Promise<T>) {
  return db.transaction(async (tx) => {
    await tx.query(`select set_config('app.user_id', $1, true), set_config('app.demo_mode', $2, true)`, [userId ?? '', demo ? 'on' : 'off']);
    await tx.exec(`set local role ${role}`);
    return fn(tx as Driver);
  });
}

export function todayKst() {
  return new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
}
