/**
 * DB 드라이버 — DATABASE_URL 이 있으면 Postgres(Supabase), 없으면 PGlite(프로세스 안 Postgres).
 * 두 드라이버는 같은 SQL 을 같은 결과 모양으로 돌려준다:
 *   date → 'YYYY-MM-DD' 문자열, timestamptz → ISO 문자열, int8·numeric → number.
 */
export type Row = Record<string, unknown>;

export interface Queryable {
  query<T = Row>(sql: string, params?: unknown[]): Promise<T[]>;
  exec(sql: string): Promise<void>;
}

export interface Driver extends Queryable {
  kind: 'pglite' | 'postgres';
  transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

const OID = { int8: 20, numeric: 1700, date: 1082, timestamp: 1114, timestamptz: 1184 } as const;

export function parseTimestamp(v: string): string {
  // '2026-09-25 06:38:47.123+00' / '2026-09-25 06:38:47+09' / ISO
  let s = v.trim().replace(' ', 'T');
  if (/[+-]\d\d$/.test(s)) s += ':00';
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? v : d.toISOString();
}

const parseNum = (v: string) => (v == null ? v : Number(v));
const identity = (v: string) => v;

async function createPglite(dataDir: string | null): Promise<Driver> {
  const { PGlite } = await import('@electric-sql/pglite');
  const parsers = {
    [OID.int8]: parseNum,
    [OID.numeric]: parseNum,
    [OID.date]: identity,
    [OID.timestamp]: (v: string) => parseTimestamp(v + 'Z'),
    [OID.timestamptz]: parseTimestamp,
  };
  const db = await PGlite.create(dataDir ?? undefined, { parsers });
  await db.exec(`set timezone = 'UTC'`);
  const wrap = (q: { query: typeof db.query; exec: typeof db.exec }): Queryable => ({
    async query<T>(sql: string, params: unknown[] = []) {
      const r = await q.query<T>(sql, params.map(toParam));
      return r.rows;
    },
    async exec(sql: string) {
      await q.exec(sql);
    },
  });
  const base = wrap(db);
  return {
    kind: 'pglite',
    ...base,
    transaction: (fn) => db.transaction((tx) => fn(wrap(tx as never))),
    close: () => db.close(),
  };
}

async function createPostgres(url: string): Promise<Driver> {
  const postgres = (await import('postgres')).default;
  const sql = postgres(url, {
    prepare: false, // Supabase 트랜잭션 풀러
    max: Number(process.env.DATABASE_POOL_MAX || 5),
    idle_timeout: 20,
    connection: { TimeZone: 'UTC', application_name: 'fcdochak' },
    types: {
      int8: { to: OID.int8, from: [OID.int8], serialize: String, parse: parseNum },
      numeric: { to: OID.numeric, from: [OID.numeric], serialize: String, parse: parseNum },
      date: { to: OID.date, from: [OID.date], serialize: identity, parse: identity },
      timestamptz: { to: OID.timestamptz, from: [OID.timestamptz, OID.timestamp], serialize: identity, parse: parseTimestamp },
    } as never,
    onnotice: () => {},
  });
  const wrap = (q: typeof sql): Queryable => ({
    async query<T>(text: string, params: unknown[] = []) {
      const r = await q.unsafe(text, params.map(toParam) as never[]);
      return r as unknown as T[];
    },
    async exec(text: string) {
      await q.unsafe(text);
    },
  });
  const base = wrap(sql);
  return {
    kind: 'postgres',
    ...base,
    transaction: async (fn) => (await sql.begin((tx) => fn(wrap(tx as never)))) as never,
    close: () => sql.end({ timeout: 5 }),
  };
}

/** 매개변수 정규화 — 배열은 Postgres 배열 글자로, 객체는 JSON 글자로. SQL 쪽에서 ::text[] / ::jsonb 로 받는다. */
export function toParam(v: unknown): unknown {
  if (v === undefined) return null;
  if (Array.isArray(v)) return pgArray(v);
  if (v instanceof Date) return v.toISOString();
  if (v !== null && typeof v === 'object') return JSON.stringify(v);
  return v;
}

export function pgArray(list: unknown[]): string {
  return (
    '{' +
    list
      .map((x) => (x == null ? 'NULL' : '"' + String(x).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"'))
      .join(',') +
    '}'
  );
}

export async function createDriver(opts: { url?: string | null; dataDir?: string | null }): Promise<Driver> {
  if (opts.url) return createPostgres(opts.url);
  return createPglite(opts.dataDir ?? null);
}
