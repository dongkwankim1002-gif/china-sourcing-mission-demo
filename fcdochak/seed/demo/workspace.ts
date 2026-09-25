/**
 * 데모 시드 — 셀러 공간(v2 workspace). 본 시드가 넣은 데모 선적·청구서 위에 덧붙인다.
 *   · 쿠팡 바코드 PDF 서류(진행 선적 일부는 일부러 비워 「빠진 서류」가 보이게)
 *   · 청구 승인/이의(최근 3일 청구서는 결정 전으로 남긴다)
 *   · 리빙모아(데모 화주)의 거래처 초대 넷(기다림·만료·거둠·가입함) + 초대로 연결된 거래처
 *   (알림은 더하지 않는다 — 데모 알림은 200건으로 맞춰 둔 기준이 있다)
 * 모두 is_demo 조직 아래라 걷어내기(조직 삭제) 한 번에 CASCADE 로 사라진다.
 * 결정은 id 의 해시로 가른다 — 같은 시드면 같은 결과.
 */
import { createHash } from 'node:crypto';
import type { Queryable } from '@/lib/db/driver';

const DAY = 86_400_000;
const HOUR = 3_600_000;

export async function seedWorkspaceDemo(q: Queryable, opts: { now: number; shipperEmail: string }) {
  const now = opts.now;
  const ts = (ms: number) => new Date(ms).toISOString();

  // ① 쿠팡 바코드 PDF — 3단계(중국 창고 입고)를 지난 데모 선적의 약 70%
  await q.query(
    `insert into fcd.documents (shipment_id, org_id, kind, shelf, file_name, size_bytes, created_by, created_at)
     select s.id, s.shipper_org_id, 'other', 'coupang_barcode', '쿠팡바코드_' || s.shipment_no || '.pdf',
            40000 + abs(hashtext(s.id::text)) % 160000,
            (select m.user_id from fcd.memberships m where m.org_id = s.shipper_org_id order by m.user_id limit 1),
            coalesce((select min(e.occurred_at) from fcd.shipment_events e where e.shipment_id = s.id and e.stage = 3), s.created_at)
       from fcd.shipments s join fcd.orgs o on o.id = s.shipper_org_id
      where o.is_demo and s.stage >= 3 and abs(hashtext(s.id::text || ':barcode')) % 10 < 7`,
  );

  // ② 청구 승인/이의 — 3일보다 오래된 현재 판 청구서. 편차 5% 이상이면 대개 이의, 나머지는 대개 승인.
  const cut = ts(now - 3 * DAY);
  await q.query(
    `insert into fcd.invoice_decisions (invoice_id, shipment_id, shipper_org_id, decision, reason, quote_total, invoice_total, created_by, created_at)
     select i.id, s.id, s.shipper_org_id,
            case when (i.total - bd.total)::float8 / nullif(bd.total, 0) >= 0.05 and abs(hashtext(i.id::text)) % 3 <> 0 then 'disputed' else 'approved' end,
            case when (i.total - bd.total)::float8 / nullif(bd.total, 0) >= 0.05 and abs(hashtext(i.id::text)) % 3 <> 0
                 then '항만·FC 운송 비용이 응찰보다 많습니다. 추가된 근거 자료를 보내 주세요.' end,
            bd.total, i.total,
            (select m.user_id from fcd.memberships m where m.org_id = s.shipper_org_id order by m.user_id limit 1),
            least(i.created_at + ((1 + abs(hashtext(i.id::text)) % 40) * interval '1 hour'), $2::timestamptz)
       from fcd.v_invoices_current i
       join fcd.shipments s on s.id = i.shipment_id
       join fcd.orgs o on o.id = s.shipper_org_id
       join fcd.bookings b on b.id = s.booking_id
       join fcd.bids bd on bd.id = b.bid_id
      where o.is_demo and i.created_at < $1::timestamptz
        and ((i.total - bd.total)::float8 / nullif(bd.total, 0) >= 0.05 or abs(hashtext(i.id::text)) % 10 < 8)`,
    [cut, ts(now - HOUR)],
  );
  // 이의 뒤 근거를 받고 승인으로 바꾼 기록(새 판) — 20일보다 오래된 이의의 절반
  await q.query(
    `insert into fcd.invoice_decisions (invoice_id, shipment_id, shipper_org_id, decision, reason, quote_total, invoice_total, supersedes_id, created_by, created_at)
     select d.invoice_id, d.shipment_id, d.shipper_org_id, 'approved', null, d.quote_total, d.invoice_total, d.id, d.created_by, d.created_at + interval '2 days'
       from fcd.invoice_decisions d
      where d.decision = 'disputed' and d.created_at < $1::timestamptz and abs(hashtext(d.id::text)) % 2 = 0`,
    [ts(now - 20 * DAY)],
  );

  // ③ 거래처 초대 — 데모 화주 계정의 조직
  const me = (
    await q.query<{ user_id: string; org_id: string }>(
      `select p.id user_id, p.home_org_id org_id from fcd.profiles p join fcd.orgs o on o.id = p.home_org_id where lower(p.email) = $1 and o.is_demo`,
      [opts.shipperEmail.toLowerCase()],
    )
  )[0];
  if (!me) return;
  const partner = (
    await q.query<{ id: string; name: string }>(
      `select id, name from fcd.orgs where is_demo and kind = 'partner' and status = 'pending_verification' order by name limit 1`,
    )
  )[0];
  // 토큰은 버린다(해시만 남긴다) — 데모 링크는 누구도 열 수 없다
  const hash = (s: string) => createHash('sha256').update(`fcd-demo-invite:${s}`).digest('hex');
  const invites: { key: string; name: string; email: string | null; note: string | null; created: number; expires: number; revoked: number | null }[] = [
    { key: 'open', name: '한결포워딩(예시)', email: 'wang@hangyeol.example', note: '이우 LCL 담당 왕 과장님', created: now - 4 * DAY, expires: now + 10 * DAY, revoked: null },
    { key: 'expired', name: '동방해운(예시)', email: null, note: null, created: now - 30 * DAY, expires: now - 16 * DAY, revoked: null },
    { key: 'revoked', name: '청도익스프레스(예시)', email: null, note: '이름을 잘못 적어 다시 보냄', created: now - 20 * DAY, expires: now - 6 * DAY, revoked: now - 19 * DAY },
  ];
  if (partner) invites.push({ key: 'used', name: partner.name, email: null, note: '평택 창고 같이 쓰는 곳', created: now - 12 * DAY, expires: now + 2 * DAY, revoked: null });
  for (const iv of invites) {
    const r = await q.query<{ id: string }>(
      `insert into fcd.partner_invites (shipper_org_id, token_hash, partner_name, contact_email, note, expires_at, revoked_at, created_by, created_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id`,
      [me.org_id, hash(`${me.org_id}:${iv.key}`), iv.name, iv.email, iv.note, ts(iv.expires), iv.revoked ? ts(iv.revoked) : null, me.user_id, ts(iv.created)],
    );
    if (iv.key === 'used' && partner) {
      const partnerUser = (await q.query<{ user_id: string }>(`select user_id from fcd.memberships where org_id = $1 order by user_id limit 1`, [partner.id]))[0];
      await q.query(`insert into fcd.shipper_partners (shipper_org_id, partner_org_id, invite_id, created_by, created_at) values ($1,$2,$3,$4,$5) on conflict do nothing`, [
        me.org_id,
        partner.id,
        r[0].id,
        partnerUser?.user_id ?? null,
        ts(now - 11 * DAY),
      ]);
    }
  }
}
