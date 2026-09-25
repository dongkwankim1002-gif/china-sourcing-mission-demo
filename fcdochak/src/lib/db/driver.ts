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

/**
 * 연결 문자열 정리 — Vercel 의 Supabase 연동이 붙이는 도구용 매개변수(supa·pgbouncer 등)는
 * postgres.js 가 서버 설정으로 넘겨 거절되므로 뗀다. sslmode 는 그대로 둔다.
 */
export function cleanDatabaseUrl(raw: string): string {
  try {
    const u = new URL(raw);
    for (const k of ['supa', 'pgbouncer', 'connection_limit', 'pool_timeout', 'schema']) u.searchParams.delete(k);
    return u.toString();
  } catch {
    return raw;
  }
}

/**
 * json·jsonb 읽기 — 한 번 더 글자로 감싸 저장된 값(아래 쓰기 문제로 2026-09-25 첫 시드에 생김)은 한 겹 벗긴다.
 * 진짜 글자 값('abc' 같은)은 그대로 둔다.
 */
export function parseJsonValue(raw: string): unknown {
  const v = JSON.parse(raw);
  if (typeof v === 'string') {
    try {
      const inner = JSON.parse(v);
      if (inner !== null && typeof inner === 'object') return inner;
      if (typeof inner === 'number' || typeof inner === 'boolean') return inner;
    } catch {
      /* 진짜 글자 값 */
    }
  }
  return v;
}

/** json·jsonb 쓰기 — toParam 이 이미 JSON 글자로 만들어 넘기므로 다시 감싸지 않는다(postgres.js 기본은 JSON.stringify 를 한 번 더 함) */
export function serializeJsonParam(v: unknown): string {
  return typeof v === 'string' ? v : JSON.stringify(v);
}

async function createPostgres(rawUrl: string): Promise<Driver> {
  const postgres = (await import('postgres')).default;
  const url = cleanDatabaseUrl(rawUrl);
  const local = /@(localhost|127\.0\.0\.1)[:/]/.test(url);
  const sql = postgres(url, {
    ssl: local || /sslmode=/.test(url) ? undefined : 'require',
    prepare: false, // Supabase 트랜잭션 풀러
    max: Number(process.env.DATABASE_POOL_MAX || 5),
    idle_timeout: 20,
    connection: { TimeZone: 'UTC', application_name: 'fcdochak' },
    types: {
      int8: { to: OID.int8, from: [OID.int8], serialize: String, parse: parseNum },
      json: { to: 3802, from: [114, 3802], serialize: serializeJsonParam, parse: parseJsonValue },
      // text[]·varchar[]·uuid[] / int[] — toParam 이 이미 배열 글자로 넘긴다
      textArray: { to: 1009, from: [1009, 1015, 2951], serialize: (v: unknown) => (typeof v === 'string' ? v : pgArray(v as unknown[])), parse: (s: string) => parsePgArray(s) },
      intArray: { to: 1007, from: [1005, 1007, 1016], serialize: (v: unknown) => (typeof v === 'string' ? v : pgArray(v as unknown[])), parse: (s: string) => parsePgArray(s, Number) },
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

/** Postgres 1차원 배열 글자('{a,"b c",NULL}') → 배열. postgres.js 가 배열 형식을 못 알아낼 때(풀러 등)를 대비해 직접 푼다. */
export function parsePgArray(raw: string, item: (s: string) => unknown = (s) => s): unknown[] {
  if (raw == null) return raw as never;
  if (raw === '{}') return [];
  const out: unknown[] = [];
  let i = 1;
  while (i < raw.length - 1) {
    if (raw[i] === '"') {
      let s = '';
      i++;
      while (i < raw.length && raw[i] !== '"') {
        if (raw[i] === '\\') i++;
        s += raw[i++];
      }
      i++; // 닫는 따옴표
      out.push(item(s));
    } else {
      let j = i;
      while (j < raw.length - 1 && raw[j] !== ',') j++;
      const s = raw.slice(i, j);
      out.push(s === 'NULL' ? null : item(s));
      i = j;
    }
    if (raw[i] === ',') i++;
  }
  return out;
}

export async function createDriver(opts: { url?: string | null; dataDir?: string | null }): Promise<Driver> {
  if (opts.url) return createPostgres(opts.url);
  return createPglite(opts.dataDir ?? null);
}
