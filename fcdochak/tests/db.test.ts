import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Driver } from '@/lib/db/driver';
import { migrate } from '@/lib/db/migrate';
import { MIGRATIONS } from '@/lib/db/migrations.generated';
import { seedDemo } from '@seed/demo';
import { seedReference } from '@seed/reference';
import { asRole, hazardDb, todayKst } from './helpers';
import fs from 'node:fs';
import path from 'node:path';

let db: Driver;
let ids: { shipper: string; partner: string; admin: string };

beforeAll(async () => {
  db = await hazardDb();
  const r = await seedDemo(db, { today: todayKst(), password: 'test-only-password' });
  ids = r.demoIds!;
});
afterAll(async () => {
  await db.close();
});

describe('마이그레이션', () => {
  it('생성 파일이 SQL 파일과 같다', () => {
    const dir = path.resolve(__dirname, '../supabase/migrations');
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
    expect(MIGRATIONS.map((m) => m.name)).toEqual(files);
    for (const m of MIGRATIONS) expect(m.sql).toBe(fs.readFileSync(path.join(dir, m.name), 'utf8'));
  });
  it('두 번 올려도 아무 일도 없다', async () => {
    expect(await migrate(db)).toBe(0);
    await db.transaction((tx) => seedReference(tx));
  });
  it('자료를 지우거나 덮는 문장이 마이그레이션에 없다', () => {
    for (const m of MIGRATIONS) {
      const sql = m.sql.replace(/--.*$/gm, '').toLowerCase();
      expect(sql, m.name).not.toMatch(/\bdelete\s+from\b/);
      expect(sql, m.name).not.toMatch(/\btruncate\b/);
      expect(sql, m.name).not.toMatch(/\bdrop\s+(table|schema|view)\b/);
      expect(sql, m.name).not.toMatch(/\bupdate\s+fcd\.\w+\s+set\b/);
    }
  });
});

describe('잠금 — Supabase 기본 ACL 을 깔고도', () => {
  it('RLS 꺼진 표 = 0', async () => {
    const r = await db.query<{ relname: string }>(`
      select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'fcd' and c.relkind in ('r','p') and not c.relrowsecurity`);
    expect(r.map((x) => x.relname)).toEqual([]);
  });
  it('anon·authenticated·service_role 의 권한이 있는 표 = 0', async () => {
    const r = await db.query<{ t: string; role: string }>(`
      select c.relname as t, r.rolname as role
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      cross join (select rolname from pg_roles where rolname in ('anon','authenticated','service_role')) r
      where n.nspname = 'fcd' and c.relkind in ('r','p','v')
        and (has_table_privilege(r.rolname, c.oid, 'SELECT') or has_table_privilege(r.rolname, c.oid, 'INSERT')
          or has_table_privilege(r.rolname, c.oid, 'UPDATE') or has_table_privilege(r.rolname, c.oid, 'DELETE')
          or has_table_privilege(r.rolname, c.oid, 'TRUNCATE'))`);
    expect(r).toEqual([]);
  });
  it('어떤 요청 역할에도 DELETE·TRUNCATE 가 없다(연결표·알림 설정 제외)', async () => {
    const r = await db.query<{ t: string; role: string }>(`
      select c.relname as t, r.rolname as role
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      cross join (select unnest(array['fcd_user','fcd_public']) as rolname) r
      where n.nspname = 'fcd' and c.relkind = 'r'
        and (has_table_privilege(r.rolname, c.oid, 'DELETE') or has_table_privilege(r.rolname, c.oid, 'TRUNCATE'))`);
    expect(r.map((x) => x.t).sort()).toEqual(['notification_prefs', 'org_capabilities', 'org_hubs', 'org_modes']);
  });
  it('거래 기록 표에는 UPDATE 권한이 없다 — 새 판으로만 쌓인다', async () => {
    for (const t of ['rate_cards', 'rate_card_lines', 'rate_card_tiers', 'bids', 'invoices', 'shipment_events', 'grade_records', 'audit_log', 'settings', 'duty_rates']) {
      const r = await db.query<{ u: boolean }>(`select has_table_privilege('fcd_user', 'fcd.${t}', 'UPDATE') as u`);
      expect(r[0].u, t).toBe(false);
    }
  });
  it('비로그인이 쓸 수 있는 표는 인증·삭제 요청 둘뿐', async () => {
    const r = await db.query<{ t: string }>(`
      select c.relname as t from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'fcd' and c.relkind = 'r'
        and (has_table_privilege('fcd_public', c.oid, 'INSERT') or has_table_privilege('fcd_public', c.oid, 'UPDATE'))`);
    expect(r.map((x) => x.t).sort()).toEqual(['deletion_requests', 'verification_requests']);
  });
  it('비밀번호 해시 표는 요청 역할이 못 읽는다', async () => {
    await expect(asRole(db, 'fcd_user', ids.admin, true, (q) => q.query('select * from fcd.local_credentials'))).rejects.toThrow();
  });
});

describe('RLS — 누가 무엇을 보는가', () => {
  it('화주는 자기 요청만 본다', async () => {
    const mine = await asRole(db, 'fcd_user', ids.shipper, true, (q) =>
      q.query<{ n: number; orgs: number }>(`select count(*)::int n, count(distinct org_id)::int orgs from fcd.quote_requests`),
    );
    expect(mine[0].n).toBeGreaterThan(10);
    expect(mine[0].orgs).toBe(1);
  });
  it('물류사는 남의 응찰을 못 본다', async () => {
    const r = await asRole(db, 'fcd_user', ids.partner, true, (q) => q.query<{ n: number }>(`select count(distinct org_id)::int n from fcd.bids`));
    expect(r[0].n).toBe(1);
  });
  it('물류사는 예약 전 화주 조직을 못 본다', async () => {
    const r = await asRole(db, 'fcd_user', ids.partner, true, (q) =>
      q.query<{ n: number }>(`select count(*)::int n from fcd.orgs o where o.kind='shipper'
        and not exists (select 1 from fcd.bookings b where b.shipper_org_id = o.id)`),
    );
    expect(r[0].n).toBe(0);
  });
  it('비로그인은 공개 가격 요금표만, 화주 조직·요청·선적은 못 본다', async () => {
    const r = await asRole(db, 'fcd_public', null, true, async (q) => ({
      priv: (await q.query<{ n: number }>(`select count(*)::int n from fcd.rate_cards where not is_public_price`))[0].n,
      pub: (await q.query<{ n: number }>(`select count(*)::int n from fcd.rate_cards where is_public_price`))[0].n,
      shippers: (await q.query<{ n: number }>(`select count(*)::int n from fcd.orgs where kind <> 'partner'`))[0].n,
    }));
    expect(r.priv).toBe(0);
    expect(r.pub).toBeGreaterThan(0);
    expect(r.shippers).toBe(0);
    await expect(asRole(db, 'fcd_public', null, true, (q) => q.query('select * from fcd.quote_requests'))).rejects.toThrow();
  });
  it('요금표는 수정할 수 없다(권한 없음)', async () => {
    await expect(
      asRole(db, 'fcd_user', ids.partner, true, (q) => q.query(`update fcd.rate_cards set valid_to = valid_to + 30`)),
    ).rejects.toThrow();
  });
  it('남의 조직 이름으로 요금표를 넣을 수 없다', async () => {
    const other = await db.query<{ id: string }>(`select id from fcd.orgs where slug = 'garam'`);
    await expect(
      asRole(db, 'fcd_user', ids.partner, true, (q) =>
        q.query(`insert into fcd.rate_cards (org_id, card_no, origin_hub, port, mode, valid_from, valid_to, certainty, transit_days_min, transit_days_max)
                 values ($1, 'X-1', 'YIW', 'ICN', 'LCL', current_date, current_date + 30, 'confirmed', 7, 12)`, [other[0].id]),
      ),
    ).rejects.toThrow();
  });
});

describe('DEMO_MODE', () => {
  it('끄면 공개·화주·물류사 어디에도 데모가 안 보인다', async () => {
    const counts = await asRole(db, 'fcd_public', null, false, async (q) => ({
      orgs: (await q.query<{ n: number }>('select count(*)::int n from fcd.orgs'))[0].n,
      cards: (await q.query<{ n: number }>('select count(*)::int n from fcd.rate_cards'))[0].n,
      reviews: (await q.query<{ n: number }>('select count(*)::int n from fcd.reviews'))[0].n,
      market: (await q.query<{ r: number; p: number }>('select requests_week r, partners_listed p from fcd.v_market_counts'))[0],
      metrics: (await q.query<{ n: number }>('select count(*)::int n from fcd.v_partner_metrics'))[0].n,
    }));
    expect(counts).toEqual({ orgs: 0, cards: 0, reviews: 0, market: { r: 0, p: 0 }, metrics: 0 });
    const shipper = await asRole(db, 'fcd_user', ids.shipper, false, (q) => q.query<{ n: number }>('select count(*)::int n from fcd.quote_requests'));
    expect(shipper[0].n).toBe(0);
  });
  it('운영자는 꺼도 본다', async () => {
    const r = await asRole(db, 'fcd_user', ids.admin, false, (q) => q.query<{ n: number }>('select count(*)::int n from fcd.orgs where is_demo'));
    expect(r[0].n).toBeGreaterThan(40);
  });
});

describe('데모 시드', () => {
  it('규모와 경우의 수', async () => {
    const q = async (sql: string) => (await db.query<{ n: number }>(sql))[0].n;
    expect(await q(`select count(*)::int n from fcd.orgs where kind='partner' and is_demo`)).toBe(30);
    expect(await q(`select count(distinct business_type)::int n from fcd.orgs where kind='partner'`)).toBe(6);
    expect(await q(`select count(*)::int n from fcd.orgs where kind='shipper' and is_demo`)).toBe(12);
    expect(await q(`select count(*)::int n from fcd.rate_cards`)).toBeGreaterThanOrEqual(300);
    expect(await q(`select count(*)::int n from fcd.shipments`)).toBeGreaterThanOrEqual(60);
    expect(await q(`select count(distinct stage)::int n from fcd.shipments`)).toBe(9);
    expect(await q(`select count(distinct kind)::int n from fcd.exceptions`)).toBe(5);
    expect(await q(`select count(*)::int n from fcd.notifications`)).toBe(200);
    expect(await q(`select count(*)::int n from fcd.orgs where related_party_note is not null`)).toBe(2);
    expect(await q(`select count(*)::int n from fcd.ad_slots where status='active'`)).toBeGreaterThanOrEqual(1);
    const statuses = await db.query<{ s: string }>(`select distinct display_status s from fcd.v_quote_requests`);
    expect(statuses.map((x) => x.s).sort()).toEqual(['bidding', 'cancelled', 'closing_soon', 'comparable', 'expired', 'selected', 'waiting']);
    const partnerStatuses = await db.query<{ s: string }>(`select distinct status s from fcd.orgs where kind='partner'`);
    expect(partnerStatuses.map((x) => x.s).sort()).toEqual(['deletion_requested', 'official', 'pending_verification', 'public_info']);
  });
  it('요금표 경우의 수 — 만료·10일 내 만료·공개가·확정·예상·유류할증 별도·카페리 할인표', async () => {
    const r = (await db.query<Record<string, number>>(`
      select
        count(*) filter (where valid_to < current_date)::int expired,
        count(*) filter (where valid_to between current_date and current_date + 10)::int expiring,
        count(*) filter (where is_public_price)::int public_price,
        count(*) filter (where certainty='confirmed')::int confirmed,
        count(*) filter (where certainty='estimated')::int estimated,
        count(*) filter (where fuel_surcharge_separate)::int fuel,
        count(*) filter (where created_at >= date_trunc('day', now()))::int today
      from fcd.v_rate_cards_current`))[0];
    for (const [k, v] of Object.entries(r)) expect(v, k).toBeGreaterThan(0);
    expect((await db.query<{ n: number }>(`select count(distinct t.rate_card_id)::int n from fcd.rate_card_tiers t join fcd.rate_cards r on r.id=t.rate_card_id where r.mode='FERRY'`))[0].n).toBeGreaterThan(0);
  });
  it('FC 입고 준비 인증 대상과 청구 편차 좋은 곳·나쁜 곳이 기록에서 나온다', async () => {
    const m = await asRole(db, 'fcd_public', null, true, (q) =>
      q.query<{ slug: string; shipments_done: number; avg_deviation: number | null; return_rate_30d: number | null }>(`
        select o.slug, m.shipments_done, m.avg_deviation, m.return_rate_30d from fcd.v_partner_metrics m join fcd.orgs o on o.id = m.org_id`),
    );
    const ready = m.filter((x) => x.shipments_done >= 60 && (x.return_rate_30d ?? 1) <= 0.035);
    expect(ready.length).toBeGreaterThanOrEqual(2);
    const devs = m.filter((x) => x.avg_deviation != null).map((x) => x.avg_deviation!);
    expect(Math.min(...devs)).toBeLessThan(0.015);
    expect(Math.max(...devs)).toBeGreaterThan(0.07);
  });
  it('후기 문장이 서로 다르다', async () => {
    const r = (await db.query<{ n: number; d: number }>(`select count(*)::int n, count(distinct body)::int d from fcd.reviews`))[0];
    expect(r.n).toBeGreaterThan(50);
    expect(r.d).toBe(r.n);
  });
  it('요일 효과 — 평일 요청이 주말보다 많다', async () => {
    const r = await db.query<{ wd: number; we: number }>(`
      select avg(n) filter (where dow between 1 and 5)::float8 wd, avg(n) filter (where dow in (0,6))::float8 we
      from (select extract(dow from (created_at at time zone 'Asia/Seoul'))::int dow, (created_at at time zone 'Asia/Seoul')::date d, count(*) n
            from fcd.quote_requests group by 1, 2) x`);
    expect(r[0].wd).toBeGreaterThan(r[0].we * 1.5);
  });
  it('멱등 — 두 번째는 아무것도 넣지 않는다', async () => {
    const before = (await db.query<{ n: number }>('select count(*)::int n from fcd.rate_cards'))[0].n;
    const r = await seedDemo(db, { today: todayKst() });
    expect(r.inserted).toBe(false);
    expect((await db.query<{ n: number }>('select count(*)::int n from fcd.rate_cards'))[0].n).toBe(before);
  });
});
