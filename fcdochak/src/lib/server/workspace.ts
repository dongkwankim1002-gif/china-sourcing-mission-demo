import 'server-only';
/** 셀러 공간 조회 — 타임라인·서류함·청구 결정·거래처. 모두 asUser(RLS) 안에서 부른다. */
import { asSystem, type Queryable } from '../db';
import { notifyMany } from './notify';

export interface WorkspaceSettings {
  inviteDays: number;
  billingFlagBp: number;
}

/** 요율·기준치는 설정 표에서(코드에 박지 않는다) */
export async function workspaceSettings(q: Queryable): Promise<WorkspaceSettings> {
  const rows = await q.query<{ key: string; value: unknown }>(
    `select key, value from fcd.v_current_settings where key in ('workspace.invite_days', 'workspace.billing_flag_bp')`,
  );
  const m = new Map(rows.map((r) => [r.key, Number(r.value)]));
  const get = (k: string) => {
    const v = m.get(k);
    if (v == null || !Number.isFinite(v)) throw new Error(`설정 ${k} 가 없습니다. 참조 시드를 올려 주세요.`);
    return v;
  };
  return { inviteDays: get('workspace.invite_days'), billingFlagBp: get('workspace.billing_flag_bp') };
}

export interface DecisionRow {
  id: string;
  invoice_id: string;
  decision: 'approved' | 'disputed';
  reason: string | null;
  quote_total: number;
  invoice_total: number;
  supersedes_id: string | null;
  created_at: string;
  who: string | null;
}

/** 한 선적의 결정 기록(최근 먼저) */
export async function shipmentDecisions(q: Queryable, shipmentId: string) {
  return q.query<DecisionRow>(
    `select d.id, d.invoice_id, d.decision, d.reason, d.quote_total, d.invoice_total, d.supersedes_id, d.created_at, p.name who
       from fcd.invoice_decisions d left join fcd.profiles p on p.id = d.created_by
      where d.shipment_id = $1 order by d.created_at desc`,
    [shipmentId],
  );
}

/** 현재 결정 = 그 청구서에서 새 판에 밀리지 않은 것 */
export function currentDecision(rows: DecisionRow[], invoiceId: string | null): DecisionRow | null {
  if (!invoiceId) return null;
  const mine = rows.filter((r) => r.invoice_id === invoiceId);
  return mine.find((r) => !mine.some((n) => n.supersedes_id === r.id)) ?? null;
}

/** 타임라인에 필요한 것 — 견적 올린 때·응찰 수·예약한 때 */
export async function shipmentTimelineFacts(q: Queryable, shipmentId: string) {
  const r = await q.query<{ request_at: string; bid_count: number; booked_at: string }>(
    `select r.created_at request_at,
            (select count(*) from fcd.v_bids_current bc where bc.request_id = r.id)::int bid_count,
            b.created_at booked_at
       from fcd.shipments s join fcd.bookings b on b.id = s.booking_id join fcd.quote_requests r on r.id = b.request_id
      where s.id = $1`,
    [shipmentId],
  );
  return r[0] ?? null;
}

export interface ShelfDocRow {
  id: string;
  kind: string;
  shelf: string;
  file_name: string;
  size_bytes: number | null;
  created_at: string;
  storage_path: string | null;
  org_name: string;
  shipment_id: string;
  shipment_no: string;
  title: string;
}

/** 서류함 전체 — 화주 조직의 모든 선적 서류 */
export async function shipperDocs(q: Queryable, orgId: string) {
  return q.query<ShelfDocRow>(
    `select d.id, d.kind, d.box shelf, d.file_name, d.size_bytes, d.created_at, d.storage_path, o.name org_name,
            s.id shipment_id, s.shipment_no, r.title
       from fcd.v_documents d
       join fcd.shipments s on s.id = d.shipment_id
       join fcd.bookings b on b.id = s.booking_id
       join fcd.quote_requests r on r.id = b.request_id
       join fcd.orgs o on o.id = d.org_id
      where s.shipper_org_id = $1
      order by d.created_at desc limit 1000`,
    [orgId],
  );
}

/** 올릴 때 고를 선적 목록 */
export async function shipperShipmentChoices(q: Queryable, orgId: string) {
  return q.query<{ id: string; shipment_no: string; title: string; stage: number }>(
    `select s.id, s.shipment_no, r.title, s.stage
       from fcd.shipments s join fcd.bookings b on b.id = s.booking_id join fcd.quote_requests r on r.id = b.request_id
      where s.shipper_org_id = $1 order by s.stage < 9 desc, s.created_at desc limit 300`,
    [orgId],
  );
}

export interface InviteRow {
  id: string;
  partner_name: string;
  contact_email: string | null;
  note: string | null;
  expires_at: string;
  revoked_at: string | null;
  created_at: string;
  who: string | null;
  accepted_org: string | null;
  accepted_at: string | null;
}

export async function listInvites(q: Queryable, orgId: string) {
  return q.query<InviteRow>(
    `select i.id, i.partner_name, i.contact_email, i.note, i.expires_at, i.revoked_at, i.created_at, p.name who,
            po.name accepted_org, sp.created_at accepted_at
       from fcd.partner_invites i
       left join fcd.profiles p on p.id = i.created_by
       left join fcd.shipper_partners sp on sp.invite_id = i.id
       left join fcd.orgs po on po.id = sp.partner_org_id
      where i.shipper_org_id = $1 order by i.created_at desc limit 200`,
    [orgId],
  );
}

export interface ClientPartnerRow {
  id: string;
  name: string;
  slug: string | null;
  status: string;
  business_type: string | null;
  via_invite: boolean;
  linked_at: string | null;
  shipments: number;
  last_shipment_at: string | null;
}

/** 내 거래처 — 초대로 연결한 곳 + 예약으로 거래한 곳 */
export async function listClientPartners(q: Queryable, orgId: string) {
  return q.query<ClientPartnerRow>(
    `with ids as (
       select partner_org_id id from fcd.shipper_partners where shipper_org_id = $1
       union
       select partner_org_id from fcd.bookings where shipper_org_id = $1
     )
     select o.id, o.name, o.slug, o.status, o.business_type,
            exists (select 1 from fcd.shipper_partners sp where sp.shipper_org_id = $1 and sp.partner_org_id = o.id) via_invite,
            (select sp.created_at from fcd.shipper_partners sp where sp.shipper_org_id = $1 and sp.partner_org_id = o.id) linked_at,
            (select count(*) from fcd.shipments s where s.shipper_org_id = $1 and s.partner_org_id = o.id)::int shipments,
            (select max(s.created_at) from fcd.shipments s where s.shipper_org_id = $1 and s.partner_org_id = o.id) last_shipment_at
       from ids join fcd.orgs o on o.id = ids.id
      order by via_invite desc, shipments desc, o.name`,
    [orgId],
  );
}

/** 청구 결정을 기다리는 청구서 수(화주) */
export async function pendingDecisions(q: Queryable, orgId: string) {
  const r = await q.query<{ n: number }>(
    `select count(*)::int n from fcd.v_invoices_current i join fcd.shipments s on s.id = i.shipment_id
      where s.shipper_org_id = $1 and not exists (select 1 from fcd.invoice_decisions d where d.invoice_id = i.id)`,
    [orgId],
  );
  return r[0]?.n ?? 0;
}

/** 초대 링크로 연결되면 초대한 화주 조직에 앱 안 알림(밖으로는 OUTBOUND_ENABLED 뒤) */
export async function notifyInviteAccepted(tokenHash: string, partnerName: string) {
  const s = await asSystem((q) => q.query<{ shipper_org_id: string }>(`select shipper_org_id from fcd.partner_invites where token_hash = $1`, [tokenHash]));
  if (!s[0]) return;
  await notifyMany([{ orgId: s[0].shipper_org_id, kind: 'system', title: `거래처 연결 — ${partnerName}`, body: '보낸 초대 링크로 들어와 내 거래처로 연결됐습니다.', link: '/app/partners' }]);
}
