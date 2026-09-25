/**
 * 데모 시드 — 등록 업체와의 제휴 구조(v2 alliance). 본 시드가 넣은 데모 물류사 위에 덧붙인다.
 *   · 가람해운항공(예시): 제휴 중 — 요건 넷 확인함(보증보험은 20일 뒤 만료 → 30일 경고), 계약 판 v1 초안 → v2 서명함,
 *     지난달 정산 명세 v1 발행 → v2 세금계산서 번호 적음
 *   · 블루웨이브혼재(예시): 요건 확인 중 — 등록증 올림(확인 전), 보증보험 반려(금액 부족) 뒤 다시 올림, 사업자등록증 확인함
 * 데모 물류사 계정(한바다포워딩)은 비워 둔다 — 화면에서 직접 신청해 볼 수 있게.
 * 모두 is_demo 조직 아래라 걷어내기(조직 삭제) 한 번에 CASCADE 로 사라진다. 번호·증권번호는 「예시」다.
 * 멱등: 데모 조직 아래 제휴 기록이 하나라도 있으면 넣지 않는다.
 */
import type { Queryable } from '@/lib/db/driver';
import { settleAlliance, type Liability, type SettlementLineInput } from '@/lib/money/alliance';
import { ALLIANCE_SETTINGS, SETTINGS } from '../reference/data';

const DAY = 86_400_000;
const HOUR = 3_600_000;

export async function seedAllianceDemo(q: Queryable, opts: { now: number; adminEmail: string }): Promise<number> {
  const has = await q.query<{ n: number }>(`select count(*)::int n from fcd.alliance_partners a join fcd.orgs o on o.id = a.partner_org_id where o.is_demo`);
  if (has[0].n > 0) return 0;
  const orgs = await q.query<{ id: string; slug: string; license_no: string | null; biz_reg_no: string | null; user_id: string | null }>(
    `select o.id, o.slug, o.license_no, o.biz_reg_no,
            (select m.user_id from fcd.memberships m where m.org_id = o.id order by m.user_id limit 1) user_id
       from fcd.orgs o where o.is_demo and o.kind = 'partner' and o.slug in ('garam', 'bluewave')`,
  );
  const admin = (await q.query<{ id: string }>(`select id from fcd.profiles where email = $1`, [opts.adminEmail]))[0]?.id;
  const garam = orgs.find((o) => o.slug === 'garam');
  const blue = orgs.find((o) => o.slug === 'bluewave');
  if (!garam || !blue || !admin) return 0;

  const now = opts.now;
  const ts = (ms: number) => new Date(ms).toISOString();
  const ymd = (ms: number) => new Date(ms + 9 * HOUR).toISOString().slice(0, 10);
  const by = (o: typeof garam) => o.user_id ?? admin;
  let n = 0;

  const ins = async (sql: string, params: unknown[]) => {
    const r = await q.query<{ id: string }>(sql, params);
    n++;
    return r[0].id;
  };
  const partner = (o: typeof garam, status: string, reg: string | null, at: number) =>
    ins(
      `insert into fcd.alliance_partners (partner_org_id, status, registration_no, applied_note, applied_by, status_note, decided_at, decided_by, created_at)
       values ($1,$2,$3,$4,$5,$6,$7::timestamptz,$8,$9::timestamptz) returning id`,
      [o.id, status, reg, '확정가 시범 제휴를 신청합니다(예시).', by(o), status === 'active' ? '요건 넷 확인, 계약 v2 서명(예시)' : '요건 확인 중(예시)', ts(at + 20 * DAY), admin, ts(at)],
    );
  const req = (a: string, o: typeof garam, r: { kind: string; status: string; ref?: string | null; amount?: number | null; until?: string | null; file?: string | null; note?: string | null; sup?: string | null; ver?: number; who: string; at: number }) =>
    ins(
      `insert into fcd.alliance_requirements (alliance_id, partner_org_id, kind, version, supersedes_id, status, ref_no, amount, valid_until, file_name, size_bytes, note, created_by, created_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9::date,$10,$11,$12,$13,$14::timestamptz) returning id`,
      [a, o.id, r.kind, r.ver ?? 1, r.sup ?? null, r.status, r.ref ?? null, r.amount ?? null, r.until ?? null, r.file ?? null, r.file ? 180_000 : null, r.note ?? null, r.who, ts(r.at)],
    );
  // 올림 → 확인함 두 판
  const verified = async (a: string, o: typeof garam, kind: string, v: { ref?: string | null; amount?: number | null; until?: string | null; file?: string | null; note?: string | null }, at: number) => {
    const first = await req(a, o, { kind, status: 'submitted', ...v, who: by(o), at });
    await req(a, o, { kind, status: 'verified', ...v, note: `${v.note ? v.note + ' · ' : ''}운영 확인(예시)`, sup: first, ver: 2, who: admin, at: at + 2 * DAY });
  };

  // ① 가람해운항공 — 제휴 중 ------------------------------------------------------
  const g0 = now - 70 * DAY;
  const ga = await partner(garam, 'active', garam.license_no, g0);
  await verified(ga, garam, 'registration_cert', { ref: garam.license_no, until: ymd(now + 400 * DAY), file: '등록증_예시.pdf', note: '등록기준 신고 기한까지' }, g0 + DAY);
  await verified(ga, garam, 'guarantee_bond', { ref: '예시-보증증권-0001', amount: 100_000_000, until: ymd(now + 20 * DAY), file: '보증보험증권_예시.pdf' }, g0 + DAY);
  await verified(ga, garam, 'biz_reg', { ref: garam.biz_reg_no, file: '사업자등록증_예시.pdf' }, g0 + DAY);
  await verified(ga, garam, 'incident_history', { until: ymd(now + 300 * DAY), note: '최근 12개월 분실 0건 · FC 회송 3건(라벨 2·포장 1) · 분쟁 0건(예시)' }, g0 + 2 * DAY);

  const d = ALLIANCE_SETTINGS.find((s) => s.key === 'alliance.default_terms')!.value as { model: string; commissionBp: number; reserveBp: number; liability: Liability };
  const t1 = await ins(
    `insert into fcd.alliance_terms (alliance_id, partner_org_id, terms_no, version, model, commission_bp, reserve_bp, liability, valid_from, valid_until, status, note, created_by, created_at)
     values ($1,$2,'AT-DEMO-0001',1,$3,$4,$5,$6::jsonb,$7::date,$8::date,'draft',$9,$10,$11::timestamptz) returning id`,
    [ga, garam.id, d.model, 350, d.reserveBp, JSON.stringify(d.liability), ymd(now - 50 * DAY), ymd(now + 315 * DAY), '첫 초안 — 수수료 3.5%(예시)', admin, ts(now - 55 * DAY)],
  );
  const signed = ymd(now - 45 * DAY);
  const t2 = await ins(
    `insert into fcd.alliance_terms (alliance_id, partner_org_id, terms_no, version, supersedes_id, model, commission_bp, reserve_bp, liability, valid_from, valid_until, status, signed_on, note, created_by, created_at)
     values ($1,$2,'AT-DEMO-0001',2,$3,$4,$5,$6,$7::jsonb,$8::date,$9::date,'agreed',$8::date,$10,$11,$12::timestamptz) returning id`,
    [ga, garam.id, t1, d.model, d.commissionBp, d.reserveBp, JSON.stringify(d.liability), signed, ymd(now + 320 * DAY), '협의 끝에 수수료 3%로 서명(예시)', admin, ts(now - 45 * DAY)],
  );

  // 지난달 정산 — 그 달에 FC 입고된 가람해운항공 데모 선적(최대 8건)으로 만든다
  const kstNow = new Date(now + 9 * HOUR);
  const start = new Date(Date.UTC(kstNow.getUTCFullYear(), kstNow.getUTCMonth() - 1, 1)).toISOString().slice(0, 10);
  const end = new Date(Date.UTC(kstNow.getUTCFullYear(), kstNow.getUTCMonth(), 0)).toISOString().slice(0, 10);
  const ships = await q.query<{ shipment_no: string; bid_total: number; invoice_total: number | null; returned: number }>(
    `select s.shipment_no, bd.total::float8 bid_total, (select i.total::float8 from fcd.v_invoices_current i where i.shipment_id = s.id limit 1) invoice_total, s.fc_returned_units returned
       from fcd.shipments s join fcd.bookings b on b.id = s.booking_id join fcd.bids bd on bd.id = b.bid_id
      where s.partner_org_id = $1 and s.delivered_at is not null
        and (s.delivered_at at time zone 'Asia/Seoul')::date between $2::date and $3::date
      order by s.delivered_at limit 8`,
    [garam.id, start, end],
  );
  const up = (x: number, to = 1000) => Math.ceil(x / to) * to;
  const lines: SettlementLineInput[] = (ships.length ? ships : [{ shipment_no: '예시-선적-1', bid_total: 2_100_000, invoice_total: 2_180_000, returned: 0 }, { shipment_no: '예시-선적-2', bid_total: 1_650_000, invoice_total: 1_600_000, returned: 12 }]).map((s) => {
    const firm = up(s.bid_total * 1.04);
    return {
      ref: s.shipment_no,
      firmPrice: firm,
      premium: firm - Math.round(s.bid_total),
      brokerFee: Math.min(firm, up(firm * 0.06)),
      actualCost: Math.round(s.invoice_total ?? s.bid_total),
      overrunFault: 'external' as const,
      incidents: s.returned > 0 ? [{ kind: 'return' as const, amount: 80_000, fault: 'partner' as const }] : [],
    };
  });
  const vatBp = SETTINGS.find((s) => s.key === 'vat_rate_bp')!.value as number;
  const r = settleAlliance(lines, { commissionBp: d.commissionBp, reserveBp: d.reserveBp, liability: d.liability }, vatBp, 0);
  const yymm = start.slice(2, 4) + start.slice(5, 7);
  const stmt = (ver: number, sup: string | null, tax: string | null, note: string, at: number) =>
    ins(
      `insert into fcd.alliance_settlements (alliance_id, partner_org_id, terms_id, statement_no, version, supersedes_id, period_start, period_end, lines, shipments,
         gross_firm, commission, commission_vat, reserve_in, platform_share, partner_share, seller_share, reserve_opening, reserve_drawn, reserve_shortfall, reserve_closing, net_payable,
         status, tax_invoice_no, note, created_by, created_at)
       values ($1,$2,$3,$4,$5,$6,$7::date,$8::date,$9::jsonb,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,'issued',$23,$24,$25,$26::timestamptz) returning id`,
      [ga, garam.id, t2, `AS-${yymm}-DEMO`, ver, sup, start, end, JSON.stringify(r.lines), r.count, r.grossFirm, r.commission, r.commissionVat, r.reserveIn, r.platformShare, r.partnerShare, r.sellerShare, r.reserveOpening, r.reserveDrawn, r.reserveShortfall, r.reserveClosing, r.netPayable, tax, note, admin, ts(at)],
    );
  const s1 = await stmt(1, null, null, '월 정산 명세 발행(예시)', Math.min(now - HOUR, Date.parse(`${end}T00:00:00Z`) + 4 * DAY));
  await stmt(2, s1, '예시-세금계산서-0001', '세금계산서 발행 번호를 적은 새 판(예시)', Math.min(now - HOUR / 2, Date.parse(`${end}T00:00:00Z`) + 9 * DAY));

  // ② 블루웨이브혼재 — 요건 확인 중 -------------------------------------------------
  const b0 = now - 12 * DAY;
  const ba = await partner(blue, 'reviewing', blue.license_no, b0);
  await req(ba, blue, { kind: 'registration_cert', status: 'submitted', ref: blue.license_no, until: ymd(now + 600 * DAY), file: '등록증_예시.pdf', who: by(blue), at: b0 + DAY });
  const bond1 = await req(ba, blue, { kind: 'guarantee_bond', status: 'submitted', ref: '예시-보증증권-0002', amount: 50_000_000, until: ymd(now + 200 * DAY), file: '보증보험증권_예시.pdf', who: by(blue), at: b0 + DAY });
  const bond2 = await req(ba, blue, { kind: 'guarantee_bond', status: 'rejected', ref: '예시-보증증권-0002', amount: 50_000_000, until: ymd(now + 200 * DAY), note: '보험 금액이 기준(1억 원)보다 적습니다(예시)', sup: bond1, ver: 2, who: admin, at: b0 + 3 * DAY });
  await req(ba, blue, { kind: 'guarantee_bond', status: 'submitted', ref: '예시-보증증권-0003', amount: 100_000_000, until: ymd(now + 360 * DAY), file: '보증보험증권_증액_예시.pdf', sup: bond2, ver: 3, who: by(blue), at: b0 + 6 * DAY });
  await verified(ba, blue, 'biz_reg', { ref: blue.biz_reg_no, file: '사업자등록증_예시.pdf' }, b0 + DAY);
  return n;
}
