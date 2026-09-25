import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Driver } from '@/lib/db/driver';
import { demoCounts } from '@/lib/server/demo-status';
import { seedDemo } from '@seed/demo';
import { buildPurgeSql, planPurge } from '@seed/demo/purge';
import { asRole, hazardDb, todayKst } from './helpers';

/**
 * 걷어내기 SQL 을 시험 DB(메모리 PGlite)에서 실제로 돌려 본다 — 운영 DB 가 아니다.
 * 데모만 사라지고, 같이 넣어 둔 「실제」 조직·요금표는 그대로여야 한다.
 */
let db: Driver;
const REAL_ORG = '10000000-0000-4000-8000-000000000001';
const REAL_USER = '10000000-0000-4000-8000-0000000000aa';

beforeAll(async () => {
  db = await hazardDb();
  await seedDemo(db, { today: todayKst(), password: 'test-only-password' });
  await db.exec(`
    insert into fcd.orgs (id, kind, name, slug, is_demo, status) values ('${REAL_ORG}', 'partner', '실제물류', 'real-partner', false, 'official');
    insert into fcd.profiles (id, home_org_id, email, name) values ('${REAL_USER}', '${REAL_ORG}', 'real@example.com', '실제');
    insert into fcd.memberships (user_id, org_id, role) values ('${REAL_USER}', '${REAL_ORG}', 'partner_admin');
    insert into fcd.org_hubs (org_id, hub) values ('${REAL_ORG}', 'YIW');
    insert into fcd.org_modes (org_id, mode) values ('${REAL_ORG}', 'LCL');
    insert into fcd.rate_cards (id, org_id, card_no, version, origin_hub, port, mode, valid_from, valid_to, certainty, is_public_price, transit_days_min, transit_days_max, status)
      values ('10000000-0000-4000-8000-0000000000c1', '${REAL_ORG}', 'RC-REAL-1', 1, 'YIW', 'ICN', 'LCL', current_date - 1, current_date + 30, 'confirmed', true, 5, 8, 'active');
  `);
});
afterAll(async () => {
  await db.close();
});

describe('데모 걷어내기', () => {
  it('SQL 은 데모 조직만 지우고, 실제 자료는 건드리지 않는다', async () => {
    const before = await db.transaction((tx) => demoCounts(tx));
    const plan = await db.transaction((tx) => planPurge(tx));
    expect(plan.demoOrgs).toBeGreaterThan(40);
    const sql = buildPurgeSql(plan);
    expect(sql).not.toMatch(/truncate|drop /i);
    expect(sql).toMatch(/delete from fcd\.orgs where is_demo;/);
    await db.exec(sql);
    const after = await db.transaction((tx) => demoCounts(tx));
    for (const c of after) expect(c.demo, c.table).toBe(0);
    for (const c of after) {
      if (c.table === 'audit_log') continue;
      expect(c.real, c.table).toBe(before.find((b) => b.table === c.table)!.real);
    }
    const left = await db.query<{ n: number }>(`select count(*)::int n from fcd.profiles where lower(email) like '%fcdochak.example'`);
    expect(left[0].n).toBe(0);
  });

  it('걷어낸 뒤 공개 면에는 실제 요금표만 보이고, 운영 조직은 남는다', async () => {
    const cards = await asRole(db, 'fcd_public', null, true, (q) => q.query<{ card_no: string }>('select card_no from fcd.v_rate_cards_current'));
    expect(cards.map((c) => c.card_no)).toEqual(['RC-REAL-1']);
    const platform = await db.query<{ n: number }>(`select count(*)::int n from fcd.orgs where kind = 'platform'`);
    expect(platform[0].n).toBeGreaterThanOrEqual(1);
    const reqs = await asRole(db, 'fcd_user', REAL_USER, true, (q) => q.query('select id from fcd.quote_requests'));
    expect(reqs).toEqual([]);
  });

  it('두 번째 계획은 지울 것이 없다', async () => {
    const plan = await db.transaction((tx) => planPurge(tx));
    expect(plan.demoOrgs).toBe(0);
    expect(plan.demoUserIds).toEqual([]);
  });
});
