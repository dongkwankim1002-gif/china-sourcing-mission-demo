/**
 * v2 검토 뒤 고침 — 0012 권한 조이기, 관심 등록 동시 요청, 어드민 설정 규칙이 시드 값과 맞는지.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Driver } from '@/lib/db/driver';
import { seedDemo } from '@seed/demo';
import { METRICS_SETTINGS, SETTINGS } from '@seed/reference/data';
import { V2_SETTING_SCHEMAS } from '@/lib/v2-setting-schemas';
import { num, won } from '@/lib/format';
import { asRole, hazardDb, todayKst } from './helpers';

describe('어드민 설정 규칙 — v2 키가 모두 있고, 시드 값이 규칙을 통과한다', () => {
  it('v2 키마다 규칙', () => {
    const all = [...SETTINGS, ...METRICS_SETTINGS];
    for (const key of ['tools.coupang_fee_basis', 'tools.trait_extra_costs', 'tools.arrival_rule', 'invoice_check_rule', 'workspace.invite_days', 'workspace.billing_flag_bp', 'destination_leg']) {
      const schema = V2_SETTING_SCHEMAS[key];
      expect(schema, key).toBeDefined();
      const seeded = all.find((s) => s.key === key);
      expect(seeded, key).toBeDefined();
      const r = schema.safeParse(seeded!.value);
      expect(r.success, `${key}: ${r.success ? '' : r.error.issues[0].message}`).toBe(true);
    }
    expect(V2_SETTING_SCHEMAS['workspace.invite_days'].safeParse(91).success).toBe(false);
    expect(V2_SETTING_SCHEMAS['destination_leg'].safeParse({ perPalletBase: 1, perPalletPerKm: 1.5, minCharge: 0 }).success).toBe(false);
  });
});

describe('숫자 표기 — 음수 0 은 부호 없이', () => {
  it('-0 · 반올림해 0 이 되는 음수', () => {
    expect(num(-0)).toBe('0');
    expect(num(-0.3)).toBe('0');
    expect(num(-0.04, 1)).toBe('0');
    expect(num(-1)).toBe('-1');
    expect(won(-0)).toBe('0원');
    expect(won(-0.2)).toBe('0원');
  });
});

let db: Driver;
let ids: { shipper: string; partner: string; admin: string };
let shipperOrg: string;
let partnerOrg: string;
let other: { user: string; org: string };

beforeAll(async () => {
  db = await hazardDb();
  const r = await seedDemo(db, { today: todayKst(), password: 'test-only-password' });
  ids = r.demoIds!;
  shipperOrg = (await db.query<{ org_id: string }>(`select org_id from fcd.memberships where user_id = $1`, [ids.shipper]))[0].org_id;
  partnerOrg = (await db.query<{ org_id: string }>(`select org_id from fcd.memberships where user_id = $1`, [ids.partner]))[0].org_id;
  const o = await db.query<{ user_id: string; org_id: string }>(
    `select m.user_id, m.org_id from fcd.memberships m join fcd.orgs o on o.id = m.org_id where o.kind = 'shipper' and m.org_id <> $1 limit 1`,
    [shipperOrg],
  );
  other = { user: o[0].user_id, org: o[0].org_id };
});
afterAll(async () => {
  await db.close();
});

describe('0012 — 끝(outcome)·후기 함수는 볼 수 있는 것만', () => {
  it('남의 선적 끝은 null, 내 선적은 값', async () => {
    const s = (await db.query<{ id: string }>(`select id from fcd.shipments where shipper_org_id = $1 and stage = 9 limit 1`, [shipperOrg]))[0];
    const mine = await asRole(db, 'fcd_user', ids.shipper, true, (q) => q.query<{ o: string | null }>(`select fcd.shipment_outcome($1::uuid) o`, [s.id]));
    expect(mine[0].o).not.toBeNull();
    const theirs = await asRole(db, 'fcd_user', other.user, true, (q) => q.query<{ o: string | null }>(`select fcd.shipment_outcome($1::uuid) o`, [s.id]));
    expect(theirs[0].o).toBeNull();
    const anon = await asRole(db, 'fcd_public', null, true, (q) => q.query<{ o: string | null }>(`select fcd.shipment_outcome($1::uuid) o`, [s.id]));
    expect(anon[0].o).toBeNull();
  });

  it('공개 후기는 끝·업체를 읽고, 숨은 후기(데모 꺼짐)는 null', async () => {
    const r = (await db.query<{ id: string; partner_org_id: string }>(`select id, partner_org_id from fcd.reviews where published limit 1`))[0];
    const on = await asRole(db, 'fcd_public', null, true, (q) => q.query<{ o: string | null; p: string | null }>(`select fcd.review_outcome($1::uuid) o, fcd.review_partner($1::uuid) p`, [r.id]));
    expect(on[0].o).not.toBeNull();
    expect(on[0].p).toBe(r.partner_org_id);
    const off = await asRole(db, 'fcd_public', null, false, (q) => q.query<{ o: string | null; p: string | null }>(`select fcd.review_outcome($1::uuid) o, fcd.review_partner($1::uuid) p`, [r.id]));
    expect(off[0]).toEqual({ o: null, p: null });
  });

  it('속 함수(shipment_outcome_raw)는 누구도 부르지 못한다', async () => {
    const s = (await db.query<{ id: string }>(`select id from fcd.shipments limit 1`))[0];
    for (const role of ['fcd_user', 'fcd_public'] as const) {
      await expect(asRole(db, role, role === 'fcd_user' ? ids.shipper : null, true, (q) => q.query(`select fcd.shipment_outcome_raw($1::uuid)`, [s.id]))).rejects.toThrow(/permission/);
    }
  });
});

describe('0012 — 신뢰 자료는 목록에 오른 업체만', () => {
  it('심사·삭제 요청 상태 업체는 비로그인에게 안 나오고, 그 조직 사람·운영자는 본다', async () => {
    const p = (await db.query<{ id: string }>(`select id from fcd.orgs where is_demo and kind = 'partner' and status = 'official' and id <> $1 limit 1`, [partnerOrg]))[0];
    const call = (role: 'fcd_user' | 'fcd_public', user: string | null) =>
      asRole(db, role, user, true, (q) => q.query<{ org_id: string }>(`select org_id from fcd.partner_trust_facts($1::uuid[], 30)`, [[p.id, partnerOrg]]));
    expect((await call('fcd_public', null)).map((x) => x.org_id).sort()).toEqual([p.id, partnerOrg].sort());
    await db.query(`update fcd.orgs set status = 'deletion_requested' where id = $1`, [partnerOrg]); // 시험 DB 에서만
    try {
      expect((await call('fcd_public', null)).map((x) => x.org_id)).toEqual([p.id]);
      expect((await call('fcd_user', ids.partner)).map((x) => x.org_id).sort()).toEqual([p.id, partnerOrg].sort());
      expect((await call('fcd_user', ids.admin)).map((x) => x.org_id).sort()).toEqual([p.id, partnerOrg].sort());
    } finally {
      await db.query(`update fcd.orgs set status = 'official' where id = $1`, [partnerOrg]);
    }
  });
});

describe('0012 — 이벤트 쓰기는 볼 수 있는 대상에만', () => {
  it('남의 선적·다른 셀러로는 못 쓰고, 가입은 자기 조직만', async () => {
    const mine = (await db.query<{ id: string; shipper_org_id: string }>(`select id, shipper_org_id from fcd.shipments where partner_org_id = $1 limit 1`, [partnerOrg]))[0];
    const notMine = (await db.query<{ id: string; shipper_org_id: string }>(`select id, shipper_org_id from fcd.shipments where partner_org_id <> $1 limit 1`, [partnerOrg]))[0];
    const ins = (u: string, org: string, seller: string | null, kind: string, tk: string | null, target: string | null) =>
      asRole(db, 'fcd_user', u, true, (q) =>
        q.query(`insert into fcd.events (org_id, seller_org_id, actor_id, kind, target_kind, target_id) values ($1,$2,$3,$4,$5,$6)`, [org, seller, u, kind, tk, target]),
      );
    // 된다: 내 선적, 그 선적의 셀러
    await ins(ids.partner, partnerOrg, mine.shipper_org_id, 'fc_inbound', 'shipment', mine.id);
    // 안 된다: 남의 선적
    await expect(ins(ids.partner, partnerOrg, null, 'fc_inbound', 'shipment', notMine.id)).rejects.toThrow();
    // 안 된다: 내 선적인데 셀러를 다른 곳으로
    const otherSeller = (await db.query<{ shipper_org_id: string }>(`select shipper_org_id from fcd.bookings where partner_org_id = $1 and shipper_org_id <> $2 limit 1`, [partnerOrg, mine.shipper_org_id]))[0];
    if (otherSeller) await expect(ins(ids.partner, partnerOrg, otherSeller.shipper_org_id, 'fc_inbound', 'shipment', mine.id)).rejects.toThrow();
    // 가입은 자기 조직만
    await ins(ids.shipper, shipperOrg, shipperOrg, 'signed_up', 'org', shipperOrg);
    await expect(ins(ids.shipper, shipperOrg, shipperOrg, 'signed_up', 'org', other.org)).rejects.toThrow();
    await expect(ins(ids.shipper, shipperOrg, shipperOrg, 'signed_up', null, null)).rejects.toThrow();
    // 대상 없는 줄은 대상 id 도 없어야
    await expect(ins(ids.shipper, shipperOrg, shipperOrg, 'quote_requested', null, notMine.id)).rejects.toThrow();
  });
});

describe('관심 등록 — 같은 사람·종류가 겹쳐 와도 오류 없이 한 줄', () => {
  it('on conflict do nothing 이 RLS 아래에서 돈다', async () => {
    const sql = `insert into fcd.assure_interests (org_id, user_id, kind, source, detail) values ($1,$2,'consolidation','compare','{}'::jsonb)
                 on conflict (user_id, kind) do nothing returning id`;
    const a = await asRole(db, 'fcd_user', other.user, true, (q) => q.query<{ id: string }>(sql, [other.org, other.user]));
    const b = await asRole(db, 'fcd_user', other.user, true, (q) => q.query<{ id: string }>(sql, [other.org, other.user]));
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(0);
  });
});
