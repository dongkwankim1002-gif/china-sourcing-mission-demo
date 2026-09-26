/**
 * v2 alliance — 제휴 주선사 정산 순수 함수와 새 표(제휴·요건·계약 판·정산 명세)의 권한, 화주 카드의 계약 상대.
 * 화면 흐름은 e2e/v2-alliance.spec.ts. 숫자 예시는 docs/alliance-plan.md 8장과 같다.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
import type { Driver } from '@/lib/db/driver';
import { seedDemo } from '@seed/demo';
import { buildPurgeSql, planPurge } from '@seed/demo/purge';
import { ALLIANCE_SETTINGS, SETTINGS } from '@seed/reference/data';
import { demoCounts, DEMO_TABLES } from '@/lib/server/demo-status';
import {
  allocateIncident,
  allocateOverrun,
  expiryState,
  linesToInput,
  registrationTail,
  reserveAccrual,
  reserveLedger,
  settleAlliance,
  simulateAlliance,
  splitCommission,
  validateTerms,
  vatOf,
  type AllianceTermsInput,
  type Liability,
} from '@/lib/money';
import { ALLIANCE_SETTING_SCHEMAS, readAllianceConfig, termsModelOk, type AllianceRules } from '@/lib/alliance-settings';
import { checklist, type CurrentReq } from '@/lib/alliance-check';
import { parseSettlementLines } from '@/lib/alliance-lines';
import { asRole, hazardDb, todayKst } from './helpers';

const LIAB: Liability = { overrun: { platformBp: 5000, capBp: 300 }, return: { platformBp: 0, capBp: 0 }, loss: { platformBp: 0, capBp: 0 }, delay: { platformBp: 0, capBp: 0 } };
const TERMS: AllianceTermsInput = { commissionBp: 300, reserveBp: 3000, liability: LIAB };

describe('수수료 나누기', () => {
  it('기준 = 확정가 − 관세사 보수, 사사오입', () => {
    expect(splitCommission(2_200_000, 150_000, 300)).toEqual({ base: 2_050_000, commission: 61_500, partnerGross: 2_138_500 });
    expect(splitCommission(1_000_005, 0, 300).commission).toBe(30_000); // 30000.15 → 30000
    expect(splitCommission(1_000_017, 0, 300).commission).toBe(30_001); // 30000.51 → 30001
    expect(splitCommission(500, 500, 300)).toMatchObject({ base: 0, commission: 0 });
  });
  it('범위를 벗어나면 받지 않는다', () => {
    expect(() => splitCommission(100, 200, 300)).toThrow();
    expect(() => splitCommission(100, 0, 3001)).toThrow();
    expect(() => splitCommission(1.5, 0, 300)).toThrow();
    expect(() => splitCommission(-1, 0, 300)).toThrow();
  });
  it('부가세는 원 미만 버림', () => {
    expect(vatOf(61_505, 1000)).toBe(6_150);
    expect(vatOf(0, 1000)).toBe(0);
  });
});

describe('사건 부담 배분 — 귀책·비율·상한', () => {
  it('셀러 귀책 100% · 주선사 귀책 100%', () => {
    expect(allocateIncident(100_000, 'seller', LIAB.overrun, 2_000_000)).toEqual({ amount: 100_000, seller: 100_000, partner: 0, platform: 0, capped: false });
    expect(allocateIncident(100_000, 'partner', LIAB.overrun, 2_000_000)).toEqual({ amount: 100_000, seller: 0, partner: 100_000, platform: 0, capped: false });
  });
  it('외부 요인 — 플랫폼 50%, 상한(확정가 3%)을 넘으면 나머지는 주선사', () => {
    expect(allocateIncident(100_000, 'external', LIAB.overrun, 2_000_000)).toEqual({ amount: 100_000, seller: 0, partner: 50_000, platform: 50_000, capped: false });
    const big = allocateIncident(200_000, 'external', LIAB.overrun, 2_000_000); // 50% = 100,000 > 상한 60,000
    expect(big).toEqual({ amount: 200_000, seller: 0, partner: 140_000, platform: 60_000, capped: true });
    expect(big.partner + big.platform + big.seller).toBe(big.amount);
    expect(allocateIncident(120_000, 'external', LIAB.overrun, 2_000_000).capped).toBe(false); // 60,000 = 상한 그대로
  });
  it('초과비용 = max(0, 실제 − 확정가)', () => {
    expect(allocateOverrun(2_000_000, 1_900_000, 'external', LIAB.overrun).amount).toBe(0);
    expect(allocateOverrun(2_000_000, 2_050_000, 'external', LIAB.overrun)).toMatchObject({ amount: 50_000, platform: 25_000, partner: 25_000 });
  });
  it('회송·분실·지연은 첫 판에서 플랫폼 0%', () => {
    for (const k of ['return', 'loss', 'delay'] as const) expect(allocateIncident(80_000, 'external', LIAB[k], 2_000_000).platform).toBe(0);
  });
});

describe('준비금 적립·소진', () => {
  it('적립 = 프리미엄 × 적립률', () => {
    expect(reserveAccrual(100_000, 3000)).toBe(30_000);
    expect(reserveAccrual(33_333, 3000)).toBe(10_000); // 9999.9 → 10000
  });
  it('잔액보다 큰 소진은 부족분으로 — 잔액은 음수가 되지 않는다', () => {
    const l = reserveLedger(10_000, [{ kind: 'draw', amount: 4_000 }, { kind: 'accrue', amount: 1_000 }, { kind: 'draw', amount: 10_000 }]);
    expect(l).toMatchObject({ opening: 10_000, accrued: 1_000, drawn: 7_000 + 4_000, shortfall: 3_000, closing: 0 });
    expect(l.lines.map((x) => x.balance)).toEqual([6_000, 7_000, 0]);
    expect(() => reserveLedger(-1, [])).toThrow();
  });
});

describe('정산 합계', () => {
  const lines = [
    { ref: 'SH-1', firmPrice: 2_000_000, premium: 80_000, brokerFee: 120_000, actualCost: 2_150_000, overrunFault: 'external' as const },
    { ref: 'SH-2', firmPrice: 1_500_000, premium: 50_000, brokerFee: 100_000, actualCost: 1_400_000, overrunFault: 'external' as const, incidents: [{ kind: 'return' as const, amount: 80_000, fault: 'partner' as const }] },
    { ref: 'SH-3', firmPrice: 1_000_000, premium: 40_000, brokerFee: 60_000, actualCost: 1_050_000, overrunFault: 'seller' as const },
  ];
  it('수수료 + 부가세 + 준비금 적립 − 플랫폼 부담 = 주선사가 낼 돈', () => {
    const r = settleAlliance(lines, TERMS, 1000, 5_000);
    expect(r.count).toBe(3);
    expect(r.commissionBase).toBe(1_880_000 + 1_400_000 + 940_000);
    expect(r.commission).toBe(56_400 + 42_000 + 28_200);
    expect(r.commissionVat).toBe(12_660);
    expect(r.reserveIn).toBe(24_000 + 15_000 + 12_000);
    // SH-1 초과 150,000 외부 → 플랫폼 min(75,000, 60,000) = 60,000 · 주선사 90,000
    expect(r.lines[0].overrun).toMatchObject({ platform: 60_000, partner: 90_000, capped: true });
    // SH-2 회송 80,000 주선사 귀책 · SH-3 초과 50,000 셀러 귀책
    expect(r.platformShare).toBe(60_000);
    expect(r.partnerShare).toBe(90_000 + 80_000);
    expect(r.sellerShare).toBe(50_000);
    expect(r.overrunTotal).toBe(200_000);
    expect(r.reserveOpening).toBe(5_000);
    expect(r.reserveDrawn).toBe(56_000);
    expect(r.reserveShortfall).toBe(4_000);
    expect(r.reserveClosing).toBe(0);
    expect(r.netPayable).toBe(126_600 + 12_660 + 51_000 - 60_000);
  });
  it('플랫폼 부담이 크면 음수(플랫폼이 낸다)', () => {
    const r = settleAlliance([{ ref: 'X', firmPrice: 1_000_000, premium: 0, brokerFee: 0, actualCost: 2_000_000, overrunFault: 'external' }], { ...TERMS, liability: { ...LIAB, overrun: { platformBp: 10000, capBp: 10000 } } }, 1000);
    expect(r.platformShare).toBe(1_000_000);
    expect(r.netPayable).toBe(30_000 + 3_000 - 1_000_000);
    expect(r.reserveShortfall).toBe(1_000_000);
  });
  it('저장한 줄에서 입력을 되살리면 같은 합계', () => {
    const r = settleAlliance(lines, TERMS, 1000, 5_000);
    const again = settleAlliance(linesToInput(JSON.parse(JSON.stringify(r.lines))), TERMS, 1000, 5_000);
    expect(again).toEqual(r);
  });
  it('잘못된 줄·요율은 받지 않는다', () => {
    expect(() => settleAlliance([{ ...lines[0], premium: 3_000_000 }], TERMS, 1000)).toThrow();
    expect(() => settleAlliance([{ ...lines[0], ref: ' ' }], TERMS, 1000)).toThrow();
    expect(() => validateTerms({ ...TERMS, commissionBp: 5000 })).toThrow();
    expect(() => validateTerms({ ...TERMS, liability: { ...LIAB, loss: undefined as never } })).toThrow();
  });
});

describe('수익 시뮬레이션 — 기획 문서 8장 숫자', () => {
  it('월 200건 · 확정가 220만 원 · 수수료 3% · 적립 30% · 외부 초과 8% × 12만 원', () => {
    const r = simulateAlliance({ shipments: 200, firmPrice: 2_200_000, premium: 100_000, brokerFee: 150_000, overrunRateBp: 800, overrunAmount: 120_000 }, TERMS, 1000);
    expect(r).toEqual({
      overrunShipments: 16,
      commission: 12_300_000,
      commissionVat: 1_230_000,
      reserveIn: 6_000_000,
      overrunTotal: 1_920_000,
      platformShare: 960_000,
      partnerShare: 960_000,
      reserveNet: 5_040_000,
      netPayable: 18_570_000,
      commissionBase: 410_000_000,
    });
  });
  it('민감도 — 외부 초과 30% × 25만 원이면 플랫폼 몫은 건당 상한 66,000원', () => {
    const r = simulateAlliance({ shipments: 200, firmPrice: 2_200_000, premium: 100_000, brokerFee: 150_000, overrunRateBp: 3000, overrunAmount: 250_000 }, TERMS, 1000);
    expect(r.platformShare).toBe(66_000 * 60);
    expect(r.platformShare).toBeLessThan(r.reserveIn);
  });
});

describe('등록번호 끝자리·만료', () => {
  it('숫자·글자만 세어 끝 4자리', () => {
    expect(registrationTail('국제물류주선업 제2016-인천-0218호')).toBe('0218');
    expect(registrationTail('AB-12')).toBe('AB12');
    expect(registrationTail('')).toBeNull();
    expect(registrationTail(null)).toBeNull();
  });
  it('만료 30일 경고', () => {
    expect(expiryState(null, '2026-09-26', 30)).toBe('none');
    expect(expiryState('2026-10-26', '2026-09-26', 30)).toBe('soon');
    expect(expiryState('2026-10-27', '2026-09-26', 30)).toBe('ok');
    expect(expiryState('2026-09-25', '2026-09-26', 30)).toBe('expired');
    expect(expiryState('2026-09-26', '2026-09-26', 30)).toBe('soon');
    expect(() => expiryState('9/26', '2026-09-26', 30)).toThrow();
  });
});

describe('체크리스트', () => {
  const rules: AllianceRules = { expiryWarnDays: 30, minBondAmount: 100_000_000, requiredKinds: ['registration_cert', 'guarantee_bond', 'biz_reg', 'incident_history'] };
  const req = (kind: CurrentReq['kind'], status: CurrentReq['status'], extra: Partial<CurrentReq> = {}): CurrentReq => ({ id: kind, kind, version: 2, status, ref_no: 'X-0001', amount: null, valid_until: null, file_name: null, note: null, created_at: '', ...extra });
  it('필수 넷이 확인함이면 준비됨, 보증 금액 부족·만료는 아님', () => {
    const base = [req('registration_cert', 'verified'), req('guarantee_bond', 'verified', { amount: 100_000_000, valid_until: '2026-10-10' }), req('biz_reg', 'verified'), req('incident_history', 'verified')];
    const ok = checklist(base, rules, '2026-09-26');
    expect(ok.ready).toBe(true);
    expect(ok.soon.map((i) => i.kind)).toEqual(['guarantee_bond']);
    expect(ok.items.find((i) => i.kind === 'cargo_insurance')).toMatchObject({ required: false, state: 'missing' });
    const low = checklist(base.map((r) => (r.kind === 'guarantee_bond' ? { ...r, amount: 50_000_000 } : r)), rules, '2026-09-26');
    expect(low.ready).toBe(false);
    expect(low.items.find((i) => i.kind === 'guarantee_bond')!.state).toBe('bond_low');
    expect(checklist(base, rules, '2026-10-11').items.find((i) => i.kind === 'guarantee_bond')!.state).toBe('expired');
    expect(checklist(base.slice(1), rules, '2026-09-26').ready).toBe(false);
  });
});

describe('정산 줄 붙여넣기', () => {
  it('탭·쉼표, 머리줄, 귀책 낱말, 사건 칸', () => {
    const r = parseSettlementLines('참조\t확정가\t프리미엄\t관세사 보수\t실제 원가\nSH-1\t2,000,000\t80,000\t120,000\t2,150,000\t외부\t80000\t주선사\nSH-2,1500000,50000,100000,1400000,셀러');
    expect(r.errors).toEqual([]);
    expect(r.lines).toEqual([
      { ref: 'SH-1', firmPrice: 2_000_000, premium: 80_000, brokerFee: 120_000, actualCost: 2_150_000, overrunFault: 'external', incidents: [{ kind: 'return', amount: 80_000, fault: 'partner' }] },
      { ref: 'SH-2', firmPrice: 1_500_000, premium: 50_000, brokerFee: 100_000, actualCost: 1_400_000, overrunFault: 'seller', incidents: [] },
    ]);
  });
  it('잘못된 줄은 줄 번호와 함께', () => {
    const r = parseSettlementLines('SH-1,100,10\nSH-2,abc,1,1,1\nSH-3,100,200,0,100\nSH-4,100,1,1,1,모름');
    expect(r.lines).toEqual([]);
    expect(r.errors.map((e) => e.slice(0, 6))).toEqual(['1번째 줄:', '2번째 줄:', '3번째 줄:', '4번째 줄:']);
  });
});

describe('설정', () => {
  it('시드 값이 규칙을 통과하고 스위치는 꺼짐', () => {
    for (const s of ALLIANCE_SETTINGS) expect(ALLIANCE_SETTING_SCHEMAS[s.key].safeParse(s.value).success, s.key).toBe(true);
    for (const s of ALLIANCE_SETTINGS) expect(SETTINGS.some((x) => x.key === s.key), s.key).toBe(true);
    const c = readAllianceConfig(new Map(ALLIANCE_SETTINGS.map((s) => [s.key, s.value])));
    expect(c.on).toBe(false);
    expect(c.rules?.minBondAmount).toBe(100_000_000);
    expect(readAllianceConfig(new Map([['v2.alliance_enabled', 'true']])).on).toBe(false); // 정확히 true 만
    expect(readAllianceConfig(new Map()).rules).toBeNull();
  });
  it('영업 대리(②)는 준비금·플랫폼 부담 0', () => {
    expect(termsModelOk('sales_agency', 0, { ...LIAB, overrun: { platformBp: 0, capBp: 0 } })).toBe(true);
    expect(termsModelOk('sales_agency', 3000, LIAB)).toBe(false);
    expect(termsModelOk('partner_contract', 3000, LIAB)).toBe(true);
  });
});

// DB -----------------------------------------------------------------------------

let db: Driver;
let ids: { shipper: string; partner: string; admin: string };
let partnerOrg: string;
let garam: { org: string; alliance: string; user: string };
let blue: { org: string; alliance: string };
const enable = async (on: boolean) => db.query(`insert into fcd.settings (key, value, note) values ('v2.alliance_enabled', $1::jsonb, 'test')`, [JSON.stringify(on)]);
const party = (prefer: string | null, user = ids.shipper) =>
  asRole(db, 'fcd_user', user, true, (q) => q.query<{ partner_name: string; reg_tail: string | null; terms_no: string; preferred: boolean }>(`select * from fcd.alliance_contract_party($1::uuid)`, [prefer]));

beforeAll(async () => {
  db = await hazardDb();
  const r = await seedDemo(db, { today: todayKst(), password: 'test-only-password' });
  ids = r.demoIds!;
  partnerOrg = (await db.query<{ org_id: string }>(`select org_id from fcd.memberships where user_id = $1`, [ids.partner]))[0].org_id;
  const g = (await db.query<{ org: string; alliance: string; user: string }>(
    `select o.id org, a.id alliance, (select user_id from fcd.memberships m where m.org_id = o.id limit 1) "user" from fcd.orgs o join fcd.alliance_partners a on a.partner_org_id = o.id where o.slug = 'garam'`,
  ))[0];
  garam = g;
  blue = (await db.query<{ org: string; alliance: string }>(`select o.id org, a.id alliance from fcd.orgs o join fcd.alliance_partners a on a.partner_org_id = o.id where o.slug = 'bluewave'`))[0];
});
afterAll(async () => {
  await db.close();
});

describe('데모 자료', () => {
  it('예시 제휴 두 곳 — 데모 조직 안에서만, 데모 물류사 계정은 비워 둔다', async () => {
    const rows = await db.query<{ slug: string; status: string; is_demo: boolean }>(`select o.slug, a.status, o.is_demo from fcd.alliance_partners a join fcd.orgs o on o.id = a.partner_org_id order by o.slug`);
    expect(rows).toEqual([{ slug: 'bluewave', status: 'reviewing', is_demo: true }, { slug: 'garam', status: 'active', is_demo: true }]);
    expect((await db.query(`select 1 from fcd.alliance_partners where partner_org_id = $1`, [partnerOrg])).length).toBe(0);
    const t = await db.query<{ version: number; status: string }>(`select version, status from fcd.alliance_terms where alliance_id = $1 order by version`, [garam.alliance]);
    expect(t).toEqual([{ version: 1, status: 'draft' }, { version: 2, status: 'agreed' }]);
    const s = await db.query<{ version: number; tax_invoice_no: string | null; net_payable: number; commission: number; commission_vat: number; reserve_in: number; platform_share: number }>(
      `select version, tax_invoice_no, net_payable::float8 net_payable, commission::float8 commission, commission_vat::float8 commission_vat, reserve_in::float8 reserve_in, platform_share::float8 platform_share from fcd.alliance_settlements where alliance_id = $1 order by version`,
      [garam.alliance],
    );
    expect(s.map((x) => x.version)).toEqual([1, 2]);
    expect(s[1].tax_invoice_no).toMatch(/^예시-/);
    expect(s[1].net_payable).toBe(s[1].commission + s[1].commission_vat + s[1].reserve_in - s[1].platform_share);
  });
  it('두 번 넣어도 늘지 않는다', async () => {
    const before = await db.query<{ n: number }>(`select count(*)::int n from fcd.alliance_requirements`);
    await seedDemo(db, { today: todayKst() });
    expect((await db.query<{ n: number }>(`select count(*)::int n from fcd.alliance_requirements`))[0].n).toBe(before[0].n);
  });
});

describe('권한 — 표', () => {
  it('UPDATE·DELETE 권한: 요건·계약 판·정산 명세는 없고, 제휴 기록은 상태 칸만', async () => {
    for (const t of ['alliance_requirements', 'alliance_terms', 'alliance_settlements']) {
      const r = await db.query<{ u: boolean; d: boolean }>(`select has_table_privilege('fcd_user', 'fcd.${t}', 'UPDATE') u, has_table_privilege('fcd_user', 'fcd.${t}', 'DELETE') d`);
      expect(r[0], t).toEqual({ u: false, d: false });
    }
    const c = await db.query<{ col: string }>(`select column_name col from information_schema.column_privileges where table_schema = 'fcd' and table_name = 'alliance_partners' and grantee = 'fcd_user' and privilege_type = 'UPDATE' order by 1`);
    expect(c.map((x) => x.col)).toEqual(['decided_at', 'decided_by', 'status', 'status_note']);
    const pub = await db.query<{ n: number }>(`select count(*)::int n from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'fcd' and c.relname like 'alliance_%' and has_table_privilege('fcd_public', c.oid, 'SELECT')`);
    expect(pub[0].n).toBe(0);
  });
  it('화주는 제휴 표를 한 줄도 못 읽는다', async () => {
    const n = await asRole(db, 'fcd_user', ids.shipper, true, async (q) => {
      const out: number[] = [];
      for (const t of ['alliance_partners', 'alliance_requirements', 'alliance_terms', 'alliance_settlements', 'v_alliance_terms_current']) out.push((await q.query(`select * from fcd.${t}`)).length);
      return out;
    });
    expect(n).toEqual([0, 0, 0, 0, 0]);
  });
  it('물류사는 자기 것만 — 남의 제휴·명세는 안 보인다', async () => {
    const own = await asRole(db, 'fcd_user', garam.user, true, (q) => q.query<{ partner_org_id: string }>(`select partner_org_id from fcd.alliance_partners`));
    expect(own.map((x) => x.partner_org_id)).toEqual([garam.org]);
    const other = await asRole(db, 'fcd_user', ids.partner, true, (q) => q.query(`select * from fcd.alliance_settlements`));
    expect(other.length).toBe(0);
    const admin = await asRole(db, 'fcd_user', ids.admin, true, (q) => q.query(`select * from fcd.alliance_partners`));
    expect(admin.length).toBe(2);
  });
  it('물류사는 자기 이름으로 신청만, 남의 이름·「제휴 중」으로는 못 넣는다', async () => {
    await expect(asRole(db, 'fcd_user', ids.partner, true, (q) => q.query(`insert into fcd.alliance_partners (partner_org_id, status, applied_by) values ($1, 'active', $2)`, [partnerOrg, ids.partner]))).rejects.toThrow();
    await expect(asRole(db, 'fcd_user', ids.partner, true, (q) => q.query(`insert into fcd.alliance_partners (partner_org_id, status, applied_by) values ($1, 'applied', $2)`, [blue.org, ids.partner]))).rejects.toThrow();
    await expect(asRole(db, 'fcd_user', ids.partner, true, (q) => q.query(`update fcd.alliance_partners set status = 'active', decided_by = $1 where partner_org_id = $2`, [ids.partner, blue.org]))).resolves.toEqual([]); // 안 보이고 바뀌지 않는다
    expect((await db.query<{ status: string }>(`select status from fcd.alliance_partners where id = $1`, [blue.alliance]))[0].status).toBe('reviewing');
  });
  it('물류사는 요건을 「올림」으로만, 계약 판·명세는 못 쓴다', async () => {
    const cur = (await db.query<{ id: string }>(`select id from fcd.v_alliance_requirements_current where alliance_id = $1 and kind = 'biz_reg'`, [garam.alliance]))[0];
    await expect(asRole(db, 'fcd_user', garam.user, true, (q) => q.query(`insert into fcd.alliance_requirements (alliance_id, partner_org_id, kind, version, supersedes_id, status, created_by) values ($1,$2,'biz_reg',3,$3,'verified',$4)`, [garam.alliance, garam.org, cur.id, garam.user]))).rejects.toThrow();
    await expect(asRole(db, 'fcd_user', garam.user, true, (q) => q.query(`insert into fcd.alliance_terms (alliance_id, partner_org_id, terms_no, model, commission_bp, reserve_bp, liability, valid_from, valid_until, status, created_by) values ($1,$2,'AT-X','partner_contract',0,0,'{}'::jsonb,current_date,current_date,'draft',$3)`, [garam.alliance, garam.org, garam.user]))).rejects.toThrow();
  });
  it('새 판은 현재 판만 잇는다 — 옛 판을 한 번 더 잇거나 첫 판을 둘 만들 수 없다', async () => {
    const old = (await db.query<{ id: string }>(`select id from fcd.alliance_requirements where alliance_id = $1 and kind = 'biz_reg' and version = 1`, [garam.alliance]))[0];
    await expect(asRole(db, 'fcd_user', ids.admin, true, (q) => q.query(`insert into fcd.alliance_requirements (alliance_id, partner_org_id, kind, version, supersedes_id, status, created_by) values ($1,$2,'biz_reg',9,$3,'verified',$4)`, [garam.alliance, garam.org, old.id, ids.admin]))).rejects.toThrow();
    await expect(asRole(db, 'fcd_user', ids.admin, true, (q) => q.query(`insert into fcd.alliance_requirements (alliance_id, partner_org_id, kind, status, created_by) values ($1,$2,'biz_reg','verified',$3)`, [garam.alliance, garam.org, ids.admin]))).rejects.toThrow();
    // 다른 물류사의 제휴 id 로 끼워 넣기
    await expect(asRole(db, 'fcd_user', ids.admin, true, (q) => q.query(`insert into fcd.alliance_requirements (alliance_id, partner_org_id, kind, status, created_by) values ($1,$2,'cargo_insurance','verified',$3)`, [blue.alliance, garam.org, ids.admin]))).rejects.toThrow();
  });
  it('명세 합계가 맞지 않으면 넣을 수 없다(check)', async () => {
    const t = (await db.query<{ id: string }>(`select id from fcd.v_alliance_terms_current where alliance_id = $1`, [garam.alliance]))[0];
    await expect(
      asRole(db, 'fcd_user', ids.admin, true, (q) =>
        q.query(
          `insert into fcd.alliance_settlements (alliance_id, partner_org_id, terms_id, statement_no, period_start, period_end, lines, shipments, gross_firm, commission, commission_vat, reserve_in, platform_share, partner_share, seller_share, reserve_opening, reserve_drawn, reserve_shortfall, reserve_closing, net_payable, status, created_by)
           values ($1,$2,$3,'AS-T-1',current_date,current_date,'[]'::jsonb,0,0,100,10,0,0,0,0,0,0,0,0,999,'draft',$4)`,
          [garam.alliance, garam.org, t.id, ids.admin],
        ),
      ),
    ).rejects.toThrow();
  });
});

describe('화주 카드의 계약 상대', () => {
  it('스위치가 꺼져 있으면 없다(「제휴 주선사 확정 전」)', async () => {
    expect(await party(null)).toEqual([]);
  });
  it('켜면 요건·계약 판을 갖춘 가람해운항공만 — 이름과 등록번호 끝 4자리', async () => {
    await enable(true);
    try {
      const r = await party(blue.org); // 블루웨이브는 요건 확인 중이라 고른 업체여도 아님
      expect(r).toEqual([expect.objectContaining({ partner_name: '가람해운항공', reg_tail: '0218', terms_no: 'AT-DEMO-0001', preferred: false })]);
      expect(Object.keys(r[0]).sort()).toEqual(['partner_name', 'preferred', 'reg_tail', 'terms_no', 'valid_until']);
      expect((await party(garam.org))[0].preferred).toBe(true);
      // TS 체크리스트도 같은 판정
      const { checklist: ck } = await import('@/lib/alliance-check');
      const rules = ALLIANCE_SETTINGS.find((s) => s.key === 'alliance.rules')!.value as AllianceRules;
      const cur = (a: string) => db.query<CurrentReq>(`select id, kind, version, status, ref_no, amount::float8 amount, valid_until::text valid_until, file_name, note, created_at from fcd.v_alliance_requirements_current where alliance_id = $1`, [a]);
      expect(ck(await cur(garam.alliance), rules, todayKst()).ready).toBe(true);
      expect(ck(await cur(blue.alliance), rules, todayKst()).ready).toBe(false);
      // DEMO_MODE 꺼짐이면 데모 제휴사는 나오지 않는다
      const off = await asRole(db, 'fcd_user', ids.shipper, false, (q) => q.query(`select * from fcd.alliance_contract_party(null)`));
      expect(off).toEqual([]);
      // 보증보험이 만료되면 빠진다
      const bond = (await db.query<{ id: string }>(`select id from fcd.v_alliance_requirements_current where alliance_id = $1 and kind = 'guarantee_bond'`, [garam.alliance]))[0];
      await asRole(db, 'fcd_user', ids.admin, true, (q) =>
        q.query(`insert into fcd.alliance_requirements (alliance_id, partner_org_id, kind, version, supersedes_id, status, amount, valid_until, created_by) values ($1,$2,'guarantee_bond',3,$3,'verified',100000000,current_date - 1,$4)`, [garam.alliance, garam.org, bond.id, ids.admin]),
      );
      expect(await party(null)).toEqual([]);
    } finally {
      await enable(false);
    }
  });
});

describe('v2 2차 고침 — 같은 규칙·새 판·관리자만', () => {
  it('fcd.alliance_ready — 보증보험이 만료된 가람·요건 확인 중인 블루웨이브 모두 「제휴 중」 불가', async () => {
    const r = await asRole(db, 'fcd_user', ids.admin, true, (q) => q.query<{ g: boolean; b: boolean }>(`select fcd.alliance_ready($1) g, fcd.alliance_ready($2) b`, [garam.alliance, blue.alliance]));
    expect(r[0]).toEqual({ g: false, b: false });
  });
  it('정산 명세의 새 판은 앞 판과 같은 계약 판이어야 한다(요율이 바뀐 뒤 조용히 다시 셈하지 않게)', async () => {
    const st = (await db.query<{ id: string; statement_no: string; version: number; terms_id: string }>(`select id, statement_no, version, terms_id from fcd.v_alliance_settlements_current where alliance_id = $1 limit 1`, [garam.alliance]))[0];
    // 다른 계약 번호의 새 판(운영자) — 요율이 다르다
    const other = (
      await asRole(db, 'fcd_user', ids.admin, true, (q) =>
        q.query<{ id: string }>(
          `insert into fcd.alliance_terms (alliance_id, partner_org_id, terms_no, model, commission_bp, reserve_bp, liability, valid_from, valid_until, status, signed_on, created_by)
           values ($1,$2,'AT-TEST-OTHER','partner_contract',900,2000,'{}'::jsonb,current_date,current_date + 30,'agreed',current_date,$3) returning id`,
          [garam.alliance, garam.org, ids.admin],
        ),
      )
    )[0].id;
    const ins = (terms: string, ver: number) =>
      asRole(db, 'fcd_user', ids.admin, true, (q) =>
        q.query(
          `insert into fcd.alliance_settlements (alliance_id, partner_org_id, terms_id, statement_no, version, supersedes_id, period_start, period_end, lines, shipments, gross_firm, commission, commission_vat, reserve_in, platform_share, partner_share, seller_share, reserve_opening, reserve_drawn, reserve_shortfall, reserve_closing, net_payable, status, created_by)
           values ($1,$2,$3,$4,$5,$6,current_date,current_date,'[]'::jsonb,0,0,0,0,0,0,0,0,0,0,0,0,0,'void',$7)`,
          [garam.alliance, garam.org, terms, st.statement_no, ver, st.id, ids.admin],
        ),
      );
    await expect(ins(other, st.version + 1)).rejects.toThrow();
    await expect(ins(st.terms_id, st.version + 1)).resolves.toBeDefined();
  });
  it('제휴 신청·요건 올리기는 물류사 관리자만 — 일반 구성원은 막힌다', async () => {
    const m = (
      await db.query<{ user_id: string; org_id: string }>(
        `select m.user_id, m.org_id from fcd.memberships m join fcd.orgs o on o.id = m.org_id
          where o.kind = 'partner' and o.is_demo and m.role = 'partner_member'
            and not exists (select 1 from fcd.alliance_partners a where a.partner_org_id = o.id) limit 1`,
      )
    )[0];
    expect(m).toBeTruthy();
    await expect(asRole(db, 'fcd_user', m.user_id, true, (q) => q.query(`insert into fcd.alliance_partners (partner_org_id, status, applied_by) values ($1, 'applied', $2)`, [m.org_id, m.user_id]))).rejects.toThrow();
    const gm = (await db.query<{ user_id: string }>(`select user_id from fcd.memberships where org_id = $1 and role = 'partner_member' limit 1`, [garam.org]))[0];
    if (gm) {
      await expect(
        asRole(db, 'fcd_user', gm.user_id, true, (q) => q.query(`insert into fcd.alliance_requirements (alliance_id, partner_org_id, kind, status, created_by) values ($1,$2,'cargo_insurance','submitted',$3)`, [garam.alliance, garam.org, gm.user_id])),
      ).rejects.toThrow();
    }
  });
});

describe('데모 걷어내기 — 새 표도 함께', () => {
  it('DEMO_TABLES 에 네 표가 있고, 걷어내면 데모 건수가 0', async () => {
    const names = ['alliance_partners', 'alliance_requirements', 'alliance_terms', 'alliance_settlements'];
    expect(DEMO_TABLES.map((t) => t.table)).toEqual(expect.arrayContaining(names));
    const before = await db.transaction((tx) => demoCounts(tx));
    for (const t of names) expect(before.find((c) => c.table === t)!.demo, t).toBeGreaterThan(0);
    const plan = await db.transaction((tx) => planPurge(tx));
    await db.exec(buildPurgeSql(plan));
    const after = await db.transaction((tx) => demoCounts(tx));
    for (const t of names) expect(after.find((c) => c.table === t)!.demo, t).toBe(0);
  });
});
