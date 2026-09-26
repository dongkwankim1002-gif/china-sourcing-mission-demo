import 'server-only';
/**
 * 쿠팡 WING 연동 조회·기록 — 모두 asUser(RLS) 안에서 부른다. 키 값은 여기서 다루지 않는다(암호문은 fcd.wing_key_blob 로만).
 */
import type { Queryable } from '../db';
import { parseWingSettings, type WingSettings } from '../wing/settings';
import { WING_EVENT_ACTION, type WingEventKind } from '../metrics';
import type { WingInbound } from '../wing/types';
import type { MatchReason } from '../wing/match';

export async function wingSettings(q: Queryable): Promise<WingSettings> {
  const rows = await q.query<{ key: string; value: unknown }>(`select key, value from fcd.v_current_settings where key like 'wing.%'`);
  return parseWingSettings(new Map(rows.map((r) => [r.key, r.value])));
}

export interface WingConnectionRow {
  id: string;
  version: number;
  method: 'self_key' | 'partner_solution';
  status: 'saved' | 'verified' | 'failed' | 'revoked';
  vendor_last4: string | null;
  access_last4: string | null;
  issued_on: string | null;
  has_key: boolean;
  created_at: string;
  who: string | null;
}

export async function currentConnection(q: Queryable, orgId: string): Promise<WingConnectionRow | null> {
  const r = await q.query<WingConnectionRow>(
    `select c.id, c.version, c.method, c.status, c.vendor_last4, c.access_last4, c.issued_on, c.has_key, c.created_at, p.name who
       from fcd.v_wing_connections_current c left join fcd.profiles p on p.id = c.created_by
      where c.org_id = $1`,
    [orgId],
  );
  return r[0] ?? null;
}

export interface InboundRow {
  id: string;
  source: 'mock' | 'file' | 'api';
  external_no: string;
  center_name: string | null;
  fc_code: string | null;
  planned_on: string | null;
  sku_count: number | null;
  units: number | null;
  boxes: number | null;
  status_raw: string | null;
  received_units: number | null;
  returned_units: number | null;
  version: number;
  created_at: string;
}

export async function listInbound(q: Queryable, orgId: string): Promise<InboundRow[]> {
  return q.query<InboundRow>(
    `select id, source, external_no, center_name, fc_code, planned_on, sku_count, units, boxes, status_raw, received_units, returned_units, version, created_at
       from fcd.v_wing_inbound_current where org_id = $1
      order by planned_on desc nulls last, external_no limit 300`,
    [orgId],
  );
}

export function rowToInbound(r: InboundRow): WingInbound {
  return {
    externalNo: r.external_no,
    centerName: r.center_name,
    fcCode: r.fc_code,
    plannedOn: r.planned_on,
    skuCount: r.sku_count,
    units: r.units,
    boxes: r.boxes,
    statusRaw: r.status_raw,
    receivedUnits: r.received_units,
    returnedUnits: r.returned_units,
  };
}

export interface MatchRow {
  id: string;
  external_no: string;
  shipment_id: string | null;
  action: 'confirmed' | 'unlinked';
  score: number | null;
  reason: MatchReason | null;
  created_at: string;
}

export async function currentMatches(q: Queryable, orgId: string): Promise<MatchRow[]> {
  return q.query<MatchRow>(
    `select id, external_no, shipment_id, action, score, reason, created_at from fcd.v_wing_matches_current where org_id = $1`,
    [orgId],
  );
}

export interface WingShipmentRow {
  id: string;
  shipment_no: string;
  title: string;
  fc_code: string;
  fc_name: string;
  eta_fc: string | null;
  units: number;
  cartons: number;
  stage: number;
  fc_returned_units: number;
  has_barcode: boolean;
}

/** 짝 후보 선적 — FC 입고 전이거나 최근 60일 안에 만든 것 */
export async function wingShipments(q: Queryable, orgId: string): Promise<WingShipmentRow[]> {
  return q.query<WingShipmentRow>(
    `select s.id, s.shipment_no, r.title, s.fc_code, f.name fc_name, s.eta_fc, s.units, s.cartons, s.stage, s.fc_returned_units,
            exists (select 1 from fcd.v_documents d where d.shipment_id = s.id and d.box = 'coupang_barcode') has_barcode
       from fcd.shipments s
       join fcd.bookings b on b.id = s.booking_id
       join fcd.quote_requests r on r.id = b.request_id
       join fcd.fc_centers f on f.code = s.fc_code
      where s.shipper_org_id = $1 and (s.stage < 9 or s.created_at > now() - interval '60 days'
             or exists (select 1 from fcd.v_wing_matches_current m where m.shipment_id = s.id and m.action = 'confirmed'))
      order by s.created_at desc limit 300`,
    [orgId],
  );
}

export interface AccessLogRow {
  action: string;
  detail: Record<string, unknown> | null;
  created_at: string;
  who: string | null;
}

export async function accessLog(q: Queryable, orgId: string, limit = 12): Promise<AccessLogRow[]> {
  return q.query<AccessLogRow>(
    `select l.action, l.detail, l.created_at, p.name who
       from fcd.wing_access_log l left join fcd.profiles p on p.id = l.actor_id
      where l.org_id = $1 order by l.created_at desc limit $2`,
    [orgId, limit],
  );
}

/** WING 이벤트 = 접근 기록 한 줄. 행동과 같은 트랜잭션(q)에서 쓴다 — 기록 없이 행동만 남지 않게 */
export async function logWing(q: Queryable, e: { orgId: string; actorId: string; kind: WingEventKind | 'key_revoked' | 'api_called' | 'api_failed'; connectionId?: string | null; detail?: Record<string, unknown> | null }) {
  const action = e.kind in WING_EVENT_ACTION ? WING_EVENT_ACTION[e.kind as WingEventKind] : e.kind;
  await q.query(`insert into fcd.wing_access_log (org_id, connection_id, actor_id, action, detail) values ($1,$2,$3,$4,$5::jsonb)`, [
    e.orgId,
    e.connectionId ?? null,
    e.actorId,
    action,
    e.detail ? JSON.stringify(e.detail) : null,
  ]);
}

/** FC 참조(이름 → 코드 맞추기) — 쿠팡 FC 만 */
export async function coupangFcs(q: Queryable): Promise<{ code: string; name: string }[]> {
  return q.query<{ code: string; name: string }>(`select code, name from fcd.fc_centers where coalesce(kind, 'coupang_fc') = 'coupang_fc' order by code`);
}

export const ACCESS_ACTION_LABEL: Record<string, string> = {
  key_saved: '키 저장',
  key_revoked: '키 폐기',
  key_decrypted: '키 꺼냄(호출 준비)',
  api_blocked: '쿠팡 호출 막힘 — 연동 준비 중',
  api_called: '쿠팡 호출',
  api_failed: '쿠팡 호출 실패',
  imported: '입고 요청 가져오기',
  matched: '선적과 짝 확정',
  unlinked: '짝 풀기',
  barcode_filed: '바코드 PDF 를 서류함에',
};

export type { WingSettings };

export interface ShipmentInbound {
  external_no: string;
  fc_code: string | null;
  center_name: string | null;
  planned_on: string | null;
  units: number | null;
  boxes: number | null;
  status_raw: string | null;
  received_units: number | null;
  returned_units: number | null;
  source: 'mock' | 'file' | 'api';
}

/** 선적에 짝을 확정한 WING 입고 요청 — 화주·맡은 물류사·운영이 같은 번호를 본다(fcd.wing_inbound_for_shipment) */
export async function inboundForShipment(q: Queryable, shipmentId: string): Promise<ShipmentInbound | null> {
  const r = await q.query<ShipmentInbound>(
    `select external_no, fc_code, center_name, planned_on::text planned_on, units, boxes, status_raw, received_units, returned_units, source
       from fcd.wing_inbound_for_shipment($1::uuid)`,
    [shipmentId],
  );
  return r[0] ?? null;
}
