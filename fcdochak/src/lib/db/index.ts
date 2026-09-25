/**
 * 요청 문맥 DB 접근.
 *
 *   asUser(user, fn)  — 로그인 사용자: role fcd_user + app.user_id. RLS 가 그대로 걸린다.
 *   asPublic(fn)      — 비로그인: role fcd_public.
 *   asSystem(fn)      — 서버의 신뢰 경로(가입·시드·알림 발송). RLS 를 받지 않으므로 쓰는 곳을 좁게 둔다.
 *
 * 세 경로 모두 app.demo_mode 를 DEMO_MODE 에서 싣는다 — RLS 쪽 데모 숨김의 근거.
 */
import { env } from '../env';
import { createDriver, type Driver, type Queryable } from './driver';
import { migrate } from './migrate';

type G = typeof globalThis & { __fcdDb?: Promise<Driver> };
const g = globalThis as G;

async function boot(): Promise<Driver> {
  const db = await createDriver({ url: env.databaseUrl, dataDir: env.pgliteDir });
  if (db.kind === 'pglite') {
    // 로컬·시험·환경변수 없는 미리보기: 스키마와 참조 시드를 직접 세운다.
    await migrate(db);
    const { seedReference } = await import('@seed/reference');
    await db.transaction((tx) => seedReference(tx));
    if (env.pgliteSeedDemo) {
      const { seedDemo } = await import('@seed/demo');
      await seedDemo(db, { today: todayKst() });
    }
  }
  return db;
}

export function getDb(): Promise<Driver> {
  if (!g.__fcdDb) {
    g.__fcdDb = boot().catch((e) => {
      g.__fcdDb = undefined;
      throw e;
    });
  }
  return g.__fcdDb;
}

/** 시험용 — 이미 만든 드라이버를 꽂는다 */
export function setDbForTests(db: Driver | undefined) {
  g.__fcdDb = db ? Promise.resolve(db) : undefined;
}

export interface Actor {
  id: string;
}

async function withContext<T>(role: 'fcd_user' | 'fcd_public' | null, userId: string | null, fn: (q: Queryable) => Promise<T>) {
  const db = await getDb();
  return db.transaction(async (tx) => {
    await tx.query(`select set_config('app.user_id', $1, true), set_config('app.demo_mode', $2, true)`, [
      userId ?? '',
      env.demoMode ? 'on' : 'off',
    ]);
    if (role) await tx.exec(`set local role ${role}`);
    return fn(tx);
  });
}

export function asUser<T>(actor: Actor, fn: (q: Queryable) => Promise<T>) {
  return withContext('fcd_user', actor.id, fn);
}

export function asPublic<T>(fn: (q: Queryable) => Promise<T>) {
  return withContext('fcd_public', null, fn);
}

export function asViewer<T>(actor: Actor | null, fn: (q: Queryable) => Promise<T>) {
  return actor ? asUser(actor, fn) : asPublic(fn);
}

export function asSystem<T>(fn: (q: Queryable) => Promise<T>, actorId: string | null = null) {
  return withContext(null, actorId, fn);
}

/** 오늘(KST) 'YYYY-MM-DD'. 시험은 FCD_TODAY 로 고정. */
export function todayKst(): string {
  if (env.today) return env.today;
  return new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
}

export type { Queryable, Driver };
