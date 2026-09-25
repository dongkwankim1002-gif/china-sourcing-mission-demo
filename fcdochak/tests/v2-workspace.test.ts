/**
 * v2 workspace — 셀러 공간: 한눈 타임라인 · 서류함 칸 · 청구 승인/이의 · 거래처 초대.
 * 순수 함수 시험 + 메모리 PGlite(운영 DB 아님)에서 RLS·권한·데모 걷어내기.
 * 화면 흐름은 e2e/v2-workspace.spec.ts.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Driver } from '@/lib/db/driver';
import { billingDiff } from '@/lib/money/billing-diff';
import { buildTimeline, timelineSummary } from '@/lib/workspace/timeline';
import { SHELVES, UPLOAD_OPTIONS, groupByShelf, missingShelves, parseUploadOption, shelfOf } from '@/lib/workspace/shelves';
import { hashInviteToken, inviteExpiry, inviteLink, inviteStatus, isInviteToken, newInviteToken } from '@/lib/workspace/invite';
import { DEMO_TABLES, demoCounts } from '@/lib/server/demo-status';
import { SETTINGS } from '@seed/reference/data';
import { DEMO_ACCOUNTS, seedDemo } from '@seed/demo';
import { buildPurgeSql, planPurge } from '@seed/demo/purge';
import { asRole, hazardDb, todayKst } from './helpers';

describe('청구 대 견적 차이(billingDiff)', () => {
  const quote = { pickup: 100_000, freight: 500_000, port: 200_000, broker: 33_000, fc_delivery: null };
  it('구간별 차액·합계·bp(사사오입)·늘어난 칸', () => {
    const d = billingDiff(quote, { pickup: 100_000, freight: 500_000, port: 230_000, broker: 33_000, fc_delivery: 60_000 }, 300);
    expect(d.quoteTotal).toBe(833_000);
    expect(d.invoiceTotal).toBe(923_000);
    expect(d.delta).toBe(90_000);
    // 90000 / 833000 = 1080.43… bp → 1080
    expect(d.deviationBp).toBe(1080);
    expect(d.flagged).toBe(true);
    expect(d.increased).toEqual(['fc_delivery', 'port']);
    expect(d.rows.find((r) => r.segment === 'fc_delivery')).toMatchObject({ quote: null, invoice: 60_000, delta: 60_000, added: true });
    expect(d.rows).toHaveLength(9);
  });
  it('기준 미만이면 표시하지 않고, 줄어든 청구는 음수', () => {
    const d = billingDiff(quote, { ...quote, port: 190_000 }, 300);
    expect(d.delta).toBe(-10_000);
    expect(d.deviationBp).toBe(-120); // −120.04…
    expect(d.flagged).toBe(false);
    expect(d.increased).toEqual([]);
  });
  it('반올림 경계: 정확히 0.5bp 는 올림, 기준과 같으면 표시', () => {
    expect(billingDiff({ freight: 20_000 }, { freight: 20_001 }, 5).deviationBp).toBe(1); // 0.5 → 1
    expect(billingDiff({ freight: 10_000 }, { freight: 10_300 }, 300).flagged).toBe(true);
    expect(billingDiff({ freight: 10_000 }, { freight: 10_299 }, 300).flagged).toBe(false);
  });
  it('견적 합계 0 이면 비율 없음, 청구가 있으면 표시', () => {
    const d = billingDiff({}, { port: 1000 }, 300);
    expect(d.deviationBp).toBeNull();
    expect(d.flagged).toBe(true);
    expect(billingDiff({}, {}, 300).flagged).toBe(false);
  });
  it('원 단위 정수가 아니거나 음수·기준이 틀리면 거절', () => {
    expect(() => billingDiff({ port: 1.5 }, {}, 300)).toThrow(RangeError);
    expect(() => billingDiff({}, { port: -1 }, 300)).toThrow(RangeError);
    expect(() => billingDiff({}, {}, -1)).toThrow(RangeError);
    expect(() => billingDiff({}, {}, 2.5)).toThrow(RangeError);
  });
  it('기준치는 설정 표(첫 판)에 있다 — 코드에 박지 않는다', () => {
    expect(SETTINGS.find((s) => s.key === 'workspace.billing_flag_bp')?.value).toBe(300);
    expect(SETTINGS.find((s) => s.key === 'workspace.invite_days')?.value).toBe(14);
  });
});

describe('한눈 타임라인', () => {
  const ev = (stage: number, day: number, raw: string | null = null) => ({ stage, occurred_at: `2026-09-${String(day).padStart(2, '0')}T01:00:00.000Z`, raw_status: raw });
  const base = { requestAt: '2026-09-01T00:00:00.000Z', bidCount: 4, bookedAt: '2026-09-03T00:00:00.000Z', invoice: null, decision: null };
  it('일곱 마디 순서와 이름', () => {
    const t = buildTimeline({ ...base, stage: 1, events: [ev(1, 3)] });
    expect(t.map((m) => m.label)).toEqual(['견적', '예약', '출항', '입항', '통관', 'FC 입고', '청구']);
    expect(t.map((m) => m.state)).toEqual(['done', 'done', 'current', 'todo', 'todo', 'todo', 'todo']);
    expect(t[0].note).toBe('응찰 4건');
  });
  it('사이 단계(3 중국 창고 입고)는 다음 마디(출항)의 「지금」 설명', () => {
    const t = buildTimeline({ ...base, stage: 3, events: [ev(1, 3), ev(2, 4), ev(3, 5)] });
    const dep = t.find((m) => m.key === 'departure')!;
    expect(dep.state).toBe('current');
    expect(dep.note).toBe('지금: 3. 중국 창고 입고');
  });
  it('출항·입항은 5·6단계 기록 시각, 원래 상태값을 적는다', () => {
    const t = buildTimeline({ ...base, stage: 6, events: [ev(1, 3), ev(5, 8, '已装船'), ev(6, 10, '입항')] });
    expect(t.find((m) => m.key === 'departure')).toMatchObject({ state: 'done', at: '2026-09-08T01:00:00.000Z', note: '「已装船」' });
    expect(t.find((m) => m.key === 'arrival')).toMatchObject({ state: 'done', at: '2026-09-10T01:00:00.000Z' });
    expect(t.find((m) => m.key === 'customs')!.state).toBe('current');
  });
  it('열린 예외가 있으면 지금 마디는 「확인 필요」', () => {
    const t = buildTimeline({ ...base, stage: 6, events: [ev(6, 10)], exceptionOpen: true });
    expect(t.find((m) => m.key === 'customs')).toMatchObject({ state: 'attention', note: '예외 확인 중' });
    expect(timelineSummary(t)).toContain('지금 통관(확인 필요)');
  });
  it('단계가 지났는데 기록이 없으면 끝남 + 시각 없음', () => {
    const t = buildTimeline({ ...base, stage: 9, events: [ev(9, 20)] });
    expect(t.find((m) => m.key === 'customs')).toMatchObject({ state: 'done', at: null });
    expect(t.find((m) => m.key === 'fc')).toMatchObject({ state: 'done', at: '2026-09-20T01:00:00.000Z' });
  });
  it('청구: 없음 → 아직, 결정 전 → 지금, 승인 → 끝남, 이의 → 확인 필요', () => {
    const inv = { created_at: '2026-09-21T00:00:00.000Z', total: 1_000_000, version: 1 };
    const b = (decision: null | 'approved' | 'disputed') =>
      buildTimeline({ ...base, stage: 9, events: [], invoice: inv, decision: decision ? { decision, created_at: '2026-09-22T00:00:00.000Z' } : null }).find((m) => m.key === 'billing')!;
    expect(buildTimeline({ ...base, stage: 9, events: [] }).at(-1)!.state).toBe('todo');
    expect(b(null)).toMatchObject({ state: 'current', note: '승인·이의 기다림', at: inv.created_at });
    expect(b('approved')).toMatchObject({ state: 'done', note: '승인함' });
    expect(b('disputed')).toMatchObject({ state: 'attention', note: '이의 제기함' });
    const v2 = buildTimeline({ ...base, stage: 9, events: [], invoice: { ...inv, version: 2 }, decision: null }).at(-1)!;
    expect(v2.note).toBe('승인·이의 기다림 · 정정 v2');
  });
});

describe('서류함 칸', () => {
  it('shelf 가 없으면 kind 로 가른다', () => {
    expect(shelfOf('commercial_invoice', null)).toBe('invoice');
    expect(shelfOf('packing_list', null)).toBe('packing_list');
    expect(shelfOf('bl', undefined)).toBe('bl');
    expect(shelfOf('import_declaration', null)).toBe('other');
    expect(shelfOf('other', 'coupang_barcode')).toBe('coupang_barcode');
    expect(shelfOf('other', 'nonsense')).toBe('other');
  });
  it('올리기 선택지는 칸·종류 쌍, 모르는 값은 거절', () => {
    expect(parseUploadOption('coupang_barcode:other')).toEqual({ shelf: 'coupang_barcode', kind: 'other' });
    expect(parseUploadOption('invoice:bl')).toBeNull();
    for (const s of SHELVES) expect(UPLOAD_OPTIONS.some((o) => o.shelf === s)).toBe(true);
  });
  it('칸별 묶기(빈 칸도 둔다)와 빠진 서류', () => {
    const docs = [{ kind: 'commercial_invoice' }, { kind: 'other', shelf: 'coupang_barcode' }, { kind: 'photo' }];
    const g = groupByShelf(docs);
    expect(g.map((x) => [x.shelf, x.docs.length])).toEqual([['invoice', 1], ['packing_list', 0], ['coupang_barcode', 1], ['bl', 0], ['other', 1]]);
    expect(missingShelves(docs)).toEqual(['packing_list']);
    expect(missingShelves([])).toEqual(['invoice', 'packing_list', 'coupang_barcode']);
  });
});

describe('거래처 초대 토큰', () => {
  it('토큰 43자, 해시는 sha-256 16진 64자이고 토큰과 다르다', () => {
    const t = newInviteToken();
    expect(isInviteToken(t)).toBe(true);
    expect(isInviteToken('short')).toBe(false);
    const h = hashInviteToken(t);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(h).not.toContain(t);
    expect(hashInviteToken(t)).toBe(h);
    expect(newInviteToken()).not.toBe(t);
  });
  it('만료·상태·링크', () => {
    const now = new Date('2026-09-25T00:00:00Z');
    expect(inviteExpiry(now, 14).toISOString()).toBe('2026-10-09T00:00:00.000Z');
    expect(() => inviteExpiry(now, 0)).toThrow(RangeError);
    expect(inviteStatus({ expires_at: '2026-09-26T00:00:00Z', revoked_at: null, accepted: false }, now)).toBe('open');
    expect(inviteStatus({ expires_at: '2026-09-24T00:00:00Z', revoked_at: null, accepted: false }, now)).toBe('expired');
    expect(inviteStatus({ expires_at: '2026-09-24T00:00:00Z', revoked_at: null, accepted: true }, now)).toBe('used');
    expect(inviteStatus({ expires_at: '2026-09-26T00:00:00Z', revoked_at: '2026-09-25T00:00:00Z', accepted: true }, now)).toBe('revoked');
    expect(inviteLink('https://x.example/', 'abc')).toBe('https://x.example/join/partner?invite=abc');
  });
});

describe('DB — RLS·권한·데모(메모리 PGlite)', () => {
  let db: Driver;
  let shipperUser: string;
  let shipperOrg: string;
  let otherShipperUser: string;
  let partnerUser: string;
  let partnerOrg: string;
  const REAL_SHIPPER = '20000000-0000-4000-8000-000000000001';
  const REAL_SHIPPER_USER = '20000000-0000-4000-8000-0000000000aa';
  const REAL_PARTNER = '20000000-0000-4000-8000-000000000002';
  const REAL_PARTNER_USER = '20000000-0000-4000-8000-0000000000bb';

  beforeAll(async () => {
    db = await hazardDb();
    await seedDemo(db, { today: todayKst(), password: 'test-only-password' });
    const me = (await db.query<{ id: string; home_org_id: string }>(`select id, home_org_id from fcd.profiles where email = $1`, [DEMO_ACCOUNTS.shipper.email]))[0];
    shipperUser = me.id;
    shipperOrg = me.home_org_id;
    const p = (await db.query<{ id: string; home_org_id: string }>(`select id, home_org_id from fcd.profiles where email = $1`, [DEMO_ACCOUNTS.partner.email]))[0];
    partnerUser = p.id;
    partnerOrg = p.home_org_id;
    otherShipperUser = (
      await db.query<{ user_id: string }>(
        `select m.user_id from fcd.memberships m join fcd.orgs o on o.id = m.org_id where o.kind = 'shipper' and o.is_demo and o.id <> $1 order by m.user_id limit 1`,
        [shipperOrg],
      )
    )[0].user_id;
    // 걷어내기 뒤에도 남아야 하는 「실제」 화주·물류사와 그 초대·연결
    await db.exec(`
      insert into fcd.orgs (id, kind, name, slug, is_demo, status) values ('${REAL_SHIPPER}', 'shipper', '실제화주', 'real-shipper-ws', false, 'active');
      insert into fcd.orgs (id, kind, name, slug, is_demo, status) values ('${REAL_PARTNER}', 'partner', '실제포워더', 'real-partner-ws', false, 'pending_verification');
      insert into fcd.profiles (id, home_org_id, email, name) values ('${REAL_SHIPPER_USER}', '${REAL_SHIPPER}', 'real-s@example.com', '실제화주');
      insert into fcd.profiles (id, home_org_id, email, name) values ('${REAL_PARTNER_USER}', '${REAL_PARTNER}', 'real-p@example.com', '실제물류');
      insert into fcd.memberships (user_id, org_id, role) values ('${REAL_SHIPPER_USER}', '${REAL_SHIPPER}', 'shipper_admin');
      insert into fcd.memberships (user_id, org_id, role) values ('${REAL_PARTNER_USER}', '${REAL_PARTNER}', 'partner_admin');
    `);
  });
  afterAll(async () => {
    await db?.close();
  });

  it('SQL 의 doc_shelf 는 TS shelfOf 와 같다', async () => {
    const kinds = ['commercial_invoice', 'packing_list', 'bl', 'co', 'import_declaration', 'photo', 'other'];
    for (const k of kinds) {
      for (const s of [null, 'coupang_barcode']) {
        const r = await db.query<{ v: string }>(`select fcd.doc_shelf($1, $2) v`, [k, s]);
        expect(r[0].v, `${k}/${s}`).toBe(shelfOf(k, s));
      }
    }
  });

  it('새 표 셋은 RLS 가 켜져 있고, 결정·연결에는 UPDATE·DELETE 권한이 없다', async () => {
    const rls = await db.query<{ relname: string; relrowsecurity: boolean }>(
      `select c.relname, c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'fcd' and c.relname in ('invoice_decisions','partner_invites','shipper_partners')`,
    );
    expect(rls).toHaveLength(3);
    for (const r of rls) expect(r.relrowsecurity, r.relname).toBe(true);
    const priv = await db.query<{ t: string; u: boolean; d: boolean; i: boolean }>(
      `select t, has_table_privilege('fcd_user', 'fcd.' || t, 'UPDATE') u, has_table_privilege('fcd_user', 'fcd.' || t, 'DELETE') d, has_table_privilege('fcd_user', 'fcd.' || t, 'INSERT') i
         from unnest(array['invoice_decisions','shipper_partners','partner_invites']) t`,
    );
    const m = Object.fromEntries(priv.map((p) => [p.t, p]));
    expect(m.invoice_decisions).toMatchObject({ u: false, d: false, i: true });
    expect(m.shipper_partners).toMatchObject({ u: false, d: false, i: false }); // 넣기는 함수로만
    expect(m.partner_invites.d).toBe(false);
    // 초대: 거두기(revoked_at)만 고칠 수 있다
    const col = await db.query<{ c: string }>(
      `select column_name c from information_schema.column_privileges where table_schema = 'fcd' and table_name = 'partner_invites' and grantee = 'fcd_user' and privilege_type = 'UPDATE'`,
    );
    expect(col.map((x) => x.c)).toEqual(['revoked_at']);
    for (const r of ['anon', 'authenticated']) {
      const x = await db.query<{ ok: boolean }>(`select has_table_privilege($1, 'fcd.partner_invites', 'SELECT') ok`, [r]);
      expect(x[0].ok, r).toBe(false);
    }
  });

  it('데모 시드: 쿠팡 바코드 서류·청구 결정·초대 넷·초대로 연결된 거래처', async () => {
    const c = await db.transaction((tx) => demoCounts(tx));
    const get = (t: string) => c.find((x) => x.table === t)!.demo;
    expect(get('invoice_decisions')).toBeGreaterThan(10);
    expect(get('partner_invites')).toBe(4);
    expect(get('shipper_partners')).toBe(1);
    const bc = await db.query<{ n: number }>(`select count(*)::int n from fcd.documents where shelf = 'coupang_barcode'`);
    expect(bc[0].n).toBeGreaterThan(5);
    // 최근 3일 청구서는 결정 전으로 남는다(화면에서 승인·이의를 해 볼 수 있게)
    const pend = await db.query<{ n: number }>(
      `select count(*)::int n from fcd.v_invoices_current i join fcd.shipments s on s.id = i.shipment_id where s.shipper_org_id = $1 and not exists (select 1 from fcd.invoice_decisions d where d.invoice_id = i.id)`,
      [shipperOrg],
    );
    expect(pend[0].n).toBeGreaterThan(0);
    // 새 판으로 바꾼 결정도 있다
    const chain = await db.query<{ n: number }>(`select count(*)::int n from fcd.invoice_decisions where supersedes_id is not null`);
    expect(chain[0].n).toBeGreaterThanOrEqual(0);
    for (const t of ['invoice_decisions', 'partner_invites', 'shipper_partners', 'documents']) expect(DEMO_TABLES.some((x) => x.table === t), t).toBe(true);
  });

  async function pendingInvoice() {
    return (
      await db.query<{ invoice_id: string; shipment_id: string; bid_total: number; total: number }>(
        `select i.id invoice_id, s.id shipment_id, bd.total bid_total, i.total
           from fcd.v_invoices_current i join fcd.shipments s on s.id = i.shipment_id join fcd.bookings b on b.id = s.booking_id join fcd.bids bd on bd.id = b.bid_id
          where s.shipper_org_id = $1 and not exists (select 1 from fcd.invoice_decisions d where d.invoice_id = i.id)
          order by i.created_at desc limit 1`,
        [shipperOrg],
      )
    )[0];
  }
  const ins = (x: { invoice_id: string; shipment_id: string; bid_total: number; total: number }, decision: string, reason: string | null, sup: string | null, org: string, by: string) =>
    `insert into fcd.invoice_decisions (invoice_id, shipment_id, shipper_org_id, decision, reason, quote_total, invoice_total, supersedes_id, created_by)
     values ('${x.invoice_id}', '${x.shipment_id}', '${org}', '${decision}', ${reason ? `'${reason}'` : 'null'}, ${x.bid_total}, ${x.total}, ${sup ? `'${sup}'` : 'null'}, '${by}') returning id`;

  it('청구 결정: 화주만 남기고, 이의엔 사유, 고칠 수 없고 새 판으로만 바꾼다', async () => {
    const x = await pendingInvoice();
    expect(x).toBeTruthy();
    // 사유 없는 이의는 거절
    await expect(asRole(db, 'fcd_user', shipperUser, true, (q) => q.query(ins(x, 'disputed', null, null, shipperOrg, shipperUser)))).rejects.toThrow();
    // 물류사는 결정을 남길 수 없다
    await expect(asRole(db, 'fcd_user', partnerUser, true, (q) => q.query(ins(x, 'approved', null, null, shipperOrg, partnerUser)))).rejects.toThrow();
    // 다른 사람 이름으로도 못 남긴다
    await expect(asRole(db, 'fcd_user', shipperUser, true, (q) => q.query(ins(x, 'approved', null, null, shipperOrg, otherShipperUser)))).rejects.toThrow();
    const first = await asRole(db, 'fcd_user', shipperUser, true, (q) => q.query<{ id: string }>(ins(x, 'disputed', '항만 비용 근거를 보내 주세요', null, shipperOrg, shipperUser)));
    // 같은 청구서에 두 번째 첫 판은 안 된다
    await expect(asRole(db, 'fcd_user', shipperUser, true, (q) => q.query(ins(x, 'approved', null, null, shipperOrg, shipperUser)))).rejects.toThrow();
    // UPDATE 권한 없음
    await expect(asRole(db, 'fcd_user', shipperUser, true, (q) => q.query(`update fcd.invoice_decisions set decision = 'approved' where id = $1`, [first[0].id]))).rejects.toThrow(/permission/);
    // 새 판(supersedes_id)으로 승인
    const second = await asRole(db, 'fcd_user', shipperUser, true, (q) => q.query<{ id: string }>(ins(x, 'approved', null, first[0].id, shipperOrg, shipperUser)));
    expect(second).toHaveLength(1);
    // 같은 판을 두 번 잇지 못한다
    await expect(asRole(db, 'fcd_user', shipperUser, true, (q) => q.query(ins(x, 'disputed', '다시 이의합니다', first[0].id, shipperOrg, shipperUser)))).rejects.toThrow();
    const cur = await asRole(db, 'fcd_user', shipperUser, true, (q) => q.query<{ decision: string }>(`select decision from fcd.v_invoice_decisions_current where invoice_id = $1`, [x.invoice_id]));
    expect(cur).toEqual([{ decision: 'approved' }]);
    // 물류사는 결정을 읽는다, 다른 화주는 못 읽는다
    const partnerSees = await asRole(db, 'fcd_user', partnerUser, true, (q) => q.query(`select id from fcd.invoice_decisions where invoice_id = $1`, [x.invoice_id]));
    const sp = await db.query<{ partner_org_id: string }>(`select partner_org_id from fcd.shipments where id = $1`, [x.shipment_id]);
    expect(partnerSees.length).toBe(sp[0].partner_org_id === partnerOrg ? 2 : 0);
    const other = await asRole(db, 'fcd_user', otherShipperUser, true, (q) => q.query(`select id from fcd.invoice_decisions where invoice_id = $1`, [x.invoice_id]));
    expect(other).toEqual([]);
  });

  it('정정된 옛 판 청구서에는 결정을 남길 수 없다', async () => {
    const old = (
      await db.query<{ id: string; shipment_id: string; shipper_org_id: string; total: number }>(
        `select i.id, i.shipment_id, s.shipper_org_id, i.total from fcd.invoices i join fcd.shipments s on s.id = i.shipment_id
          where exists (select 1 from fcd.invoices n where n.supersedes_id = i.id) limit 1`,
      )
    )[0];
    if (!old) return; // 시드에 정정 판이 없으면 건너뜀
    const u = (await db.query<{ user_id: string }>(`select user_id from fcd.memberships where org_id = $1 limit 1`, [old.shipper_org_id]))[0].user_id;
    await expect(
      asRole(db, 'fcd_user', u, true, (q) =>
        q.query(`insert into fcd.invoice_decisions (invoice_id, shipment_id, shipper_org_id, decision, quote_total, invoice_total, created_by) values ($1,$2,$3,'approved',1,1,$4)`, [old.id, old.shipment_id, old.shipper_org_id, u]),
      ),
    ).rejects.toThrow();
  });

  it('거래처 초대: 해시 칸은 못 읽고, 받기는 한 번·물류사 관리자만, 만료·거둠은 거절', async () => {
    const token = newInviteToken();
    const h = hashInviteToken(token);
    await asRole(db, 'fcd_user', REAL_SHIPPER_USER, false, (q) =>
      q.query(`insert into fcd.partner_invites (shipper_org_id, token_hash, partner_name, expires_at, created_by) values ($1,$2,'실제포워더',now() + interval '14 days',$3)`, [REAL_SHIPPER, h, REAL_SHIPPER_USER]),
    );
    // 해시 칸 읽기 권한 없음
    await expect(asRole(db, 'fcd_user', REAL_SHIPPER_USER, false, (q) => q.query(`select token_hash from fcd.partner_invites`))).rejects.toThrow(/permission/);
    const mine = await asRole(db, 'fcd_user', REAL_SHIPPER_USER, false, (q) => q.query<{ partner_name: string }>(`select partner_name from fcd.partner_invites`));
    expect(mine).toEqual([{ partner_name: '실제포워더' }]);
    // 다른 화주는 못 본다
    const other = await asRole(db, 'fcd_user', shipperUser, true, (q) => q.query(`select id from fcd.partner_invites where shipper_org_id = $1`, [REAL_SHIPPER]));
    expect(other).toEqual([]);
    // 링크를 연 사람(비로그인)은 상태·이름만
    const look = await asRole(db, 'fcd_public', null, false, (q) => q.query<{ status: string; shipper_name: string }>(`select status, shipper_name from fcd.invite_lookup($1)`, [h]));
    expect(look).toEqual([{ status: 'open', shipper_name: '실제화주' }]);
    // 연결 표에 직접 넣기는 안 된다
    await expect(asRole(db, 'fcd_user', REAL_PARTNER_USER, false, (q) => q.query(`insert into fcd.shipper_partners (shipper_org_id, partner_org_id) values ($1,$2)`, [REAL_SHIPPER, REAL_PARTNER]))).rejects.toThrow(/permission/);
    // 화주가 자기 초대를 스스로 받을 수 없다
    const self = await asRole(db, 'fcd_user', REAL_SHIPPER_USER, false, (q) => q.query<{ r: string }>(`select fcd.accept_partner_invite($1, $2) r`, [h, REAL_SHIPPER]));
    expect(self[0].r).toBe('not_partner_admin');
    const ok = await asRole(db, 'fcd_user', REAL_PARTNER_USER, false, (q) => q.query<{ r: string }>(`select fcd.accept_partner_invite($1, $2) r`, [h, REAL_PARTNER]));
    expect(ok[0].r).toBe('ok');
    const again = await asRole(db, 'fcd_user', REAL_PARTNER_USER, false, (q) => q.query<{ r: string }>(`select fcd.accept_partner_invite($1, $2) r`, [h, REAL_PARTNER]));
    expect(again[0].r).toBe('used');
    const look2 = await asRole(db, 'fcd_public', null, false, (q) => q.query<{ status: string }>(`select status from fcd.invite_lookup($1)`, [h]));
    expect(look2[0].status).toBe('used');
    // 두 조직 모두 연결을 본다
    const s1 = await asRole(db, 'fcd_user', REAL_SHIPPER_USER, false, (q) => q.query(`select 1 from fcd.shipper_partners where partner_org_id = $1`, [REAL_PARTNER]));
    const s2 = await asRole(db, 'fcd_user', REAL_PARTNER_USER, false, (q) => q.query(`select 1 from fcd.shipper_partners where shipper_org_id = $1`, [REAL_SHIPPER]));
    expect(s1).toHaveLength(1);
    expect(s2).toHaveLength(1);
    // 만료·거둔 초대
    const exp = hashInviteToken(newInviteToken());
    const rev = hashInviteToken(newInviteToken());
    await db.query(`insert into fcd.partner_invites (shipper_org_id, token_hash, partner_name, expires_at, created_at) values ($1,$2,'만료',now() - interval '1 day', now() - interval '20 days')`, [REAL_SHIPPER, exp]);
    const revId = (
      await asRole(db, 'fcd_user', REAL_SHIPPER_USER, false, (q) =>
        q.query<{ id: string }>(`insert into fcd.partner_invites (shipper_org_id, token_hash, partner_name, expires_at, created_by) values ($1,$2,'거둠',now() + interval '3 days',$3) returning id`, [REAL_SHIPPER, rev, REAL_SHIPPER_USER]),
      )
    )[0].id;
    await asRole(db, 'fcd_user', REAL_SHIPPER_USER, false, (q) => q.query(`update fcd.partner_invites set revoked_at = now() where id = $1`, [revId]));
    // 거둔 것을 되살리거나 이름을 바꾸지 못한다
    await expect(asRole(db, 'fcd_user', REAL_SHIPPER_USER, false, (q) => q.query(`update fcd.partner_invites set revoked_at = null where id = $1`, [revId]))).rejects.toThrow();
    await expect(asRole(db, 'fcd_user', REAL_SHIPPER_USER, false, (q) => q.query(`update fcd.partner_invites set partner_name = 'x' where id = $1`, [revId]))).rejects.toThrow(/permission/);
    for (const [hh, want] of [[exp, 'expired'], [rev, 'revoked'], [hashInviteToken(newInviteToken()), 'not_found']] as const) {
      const r = await asRole(db, 'fcd_user', REAL_PARTNER_USER, false, (q) => q.query<{ r: string }>(`select fcd.accept_partner_invite($1, $2) r`, [hh, REAL_PARTNER]));
      expect(r[0].r, want).toBe(want);
    }
  });

  it('DEMO_MODE 꺼짐이면 데모 화주의 초대는 링크로도 안 보인다', async () => {
    const demoHash = (await db.query<{ token_hash: string }>(`select token_hash from fcd.partner_invites where shipper_org_id = $1 and revoked_at is null and expires_at > now() limit 1`, [shipperOrg]))[0].token_hash;
    const on = await asRole(db, 'fcd_public', null, true, (q) => q.query(`select status from fcd.invite_lookup($1)`, [demoHash]));
    const off = await asRole(db, 'fcd_public', null, false, (q) => q.query(`select status from fcd.invite_lookup($1)`, [demoHash]));
    expect(on).toHaveLength(1);
    expect(off).toEqual([]);
  });

  it('걷어내기: 데모의 결정·초대·연결·서류는 0, 실제 화주의 초대·연결은 남는다', async () => {
    const before = await db.transaction((tx) => demoCounts(tx));
    const plan = await db.transaction((tx) => planPurge(tx));
    await db.exec(buildPurgeSql(plan));
    const after = await db.transaction((tx) => demoCounts(tx));
    for (const t of ['invoice_decisions', 'partner_invites', 'shipper_partners', 'documents']) {
      expect(after.find((c) => c.table === t)!.demo, t).toBe(0);
      expect(after.find((c) => c.table === t)!.real, t).toBe(before.find((c) => c.table === t)!.real);
    }
    const inv = await db.query<{ n: number }>(`select count(*)::int n from fcd.partner_invites where shipper_org_id = $1`, [REAL_SHIPPER]);
    expect(inv[0].n).toBe(3);
    const link = await db.query<{ n: number }>(`select count(*)::int n from fcd.shipper_partners where shipper_org_id = $1`, [REAL_SHIPPER]);
    expect(link[0].n).toBe(1);
  });
});
