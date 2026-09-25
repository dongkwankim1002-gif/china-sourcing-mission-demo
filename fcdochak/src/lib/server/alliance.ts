import 'server-only';
/**
 * 제휴 주선사 — 설정 읽기, 운영·물류사 화면 자료, 화주 카드의 계약 상대.
 * 권한은 RLS 가 가른다(운영 전부 · 물류사 자기 것). 화주는 표를 못 읽고 fcd.alliance_contract_party 만 부른다.
 * 계산은 src/lib/money/alliance 순수 함수, 체크리스트는 src/lib/alliance-check.
 */
import type { Queryable } from '../db';
import { readAllianceConfig, type AllianceConfig, type AllianceStatus, type TermsModel } from '../alliance-settings';
import type { CurrentReq } from '../alliance-check';
import type { Liability } from '../money/alliance';

export async function loadAllianceConfig(q: Queryable): Promise<AllianceConfig> {
  const rows = await q.query<{ key: string; value: unknown }>(`select key, value from fcd.v_current_settings where key = 'v2.alliance_enabled' or key like 'alliance.%'`);
  return readAllianceConfig(new Map(rows.map((r) => [r.key, r.value])));
}

export interface ContractParty {
  partnerName: string;
  regTail: string | null;
  termsNo: string;
  validUntil: string;
  /** 비교·응찰의 대표 업체와 같은 곳인가 */
  preferred: boolean;
}

/** 화주 확정가 카드의 계약 상대 — 스위치가 꺼져 있거나 조건을 채운 제휴사가 없으면 null(「제휴 주선사 확정 전」) */
export async function contractParty(q: Queryable, preferPartnerId: string | null | undefined): Promise<ContractParty | null> {
  const r = await q.query<{ partner_name: string; reg_tail: string | null; terms_no: string; valid_until: string; preferred: boolean }>(
    `select partner_name, reg_tail, terms_no, valid_until::text valid_until, preferred from fcd.alliance_contract_party($1::uuid)`,
    [preferPartnerId ?? null],
  );
  const x = r[0];
  return x ? { partnerName: x.partner_name, regTail: x.reg_tail, termsNo: x.terms_no, validUntil: x.valid_until, preferred: !!x.preferred } : null;
}

export interface AllianceRow {
  id: string;
  partner_org_id: string;
  status: AllianceStatus;
  registration_no: string | null;
  applied_note: string | null;
  status_note: string | null;
  decided_at: string | null;
  created_at: string;
  org_name: string;
  org_name_zh: string | null;
  org_status: string;
  is_demo: boolean;
  related_party_note: string | null;
}

export interface TermsRow {
  id: string;
  terms_no: string;
  version: number;
  supersedes_id: string | null;
  model: TermsModel;
  commission_bp: number;
  reserve_bp: number;
  liability: Liability;
  valid_from: string;
  valid_until: string;
  status: 'draft' | 'agreed' | 'ended';
  signed_on: string | null;
  note: string | null;
  created_at: string;
  current: boolean;
}

export interface SettlementRow {
  id: string;
  statement_no: string;
  version: number;
  terms_id: string;
  period_start: string;
  period_end: string;
  shipments: number;
  gross_firm: number;
  commission: number;
  commission_vat: number;
  reserve_in: number;
  platform_share: number;
  partner_share: number;
  seller_share: number;
  reserve_opening: number;
  reserve_drawn: number;
  reserve_shortfall: number;
  reserve_closing: number;
  net_payable: number;
  status: 'draft' | 'issued' | 'void';
  tax_invoice_no: string | null;
  note: string | null;
  lines: unknown;
  created_at: string;
  current: boolean;
}

export interface ReqHistoryRow extends CurrentReq {
  supersedes_id: string | null;
  created_by_name: string | null;
}

const ALLIANCE_COLS = `a.id, a.partner_org_id, a.status, a.registration_no, a.applied_note, a.status_note, a.decided_at, a.created_at,
  o.name org_name, o.name_zh org_name_zh, o.status org_status, o.is_demo, o.related_party_note`;
const REQ_COLS = `r.id, r.kind, r.version, r.status, r.ref_no, r.amount::float8 amount, r.valid_until::text valid_until, r.file_name, r.storage_path, r.note, r.created_at`;
const TERMS_COLS = `t.id, t.terms_no, t.version, t.supersedes_id, t.model, t.commission_bp, t.reserve_bp, t.liability, t.valid_from::text valid_from, t.valid_until::text valid_until,
  t.status, t.signed_on::text signed_on, t.note, t.created_at, not exists (select 1 from fcd.alliance_terms n where n.supersedes_id = t.id) as current`;
const STMT_COLS = `s.id, s.statement_no, s.version, s.terms_id, s.period_start::text period_start, s.period_end::text period_end, s.shipments,
  s.gross_firm::float8 gross_firm, s.commission::float8 commission, s.commission_vat::float8 commission_vat, s.reserve_in::float8 reserve_in,
  s.platform_share::float8 platform_share, s.partner_share::float8 partner_share, s.seller_share::float8 seller_share,
  s.reserve_opening::float8 reserve_opening, s.reserve_drawn::float8 reserve_drawn, s.reserve_shortfall::float8 reserve_shortfall,
  s.reserve_closing::float8 reserve_closing, s.net_payable::float8 net_payable, s.status, s.tax_invoice_no, s.note, s.lines, s.created_at,
  not exists (select 1 from fcd.alliance_settlements n where n.supersedes_id = s.id) as current`;

export async function allianceList(q: Queryable): Promise<(AllianceRow & { reqs: CurrentReq[]; terms: TermsRow | null; lastStatement: SettlementRow | null })[]> {
  const rows = await q.query<AllianceRow>(`select ${ALLIANCE_COLS} from fcd.alliance_partners a join fcd.orgs o on o.id = a.partner_org_id order by
    case a.status when 'active' then 0 when 'reviewing' then 1 when 'applied' then 2 when 'candidate' then 3 when 'suspended' then 4 else 5 end, a.created_at desc`);
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const [reqs, terms, stmts] = await Promise.all([
    q.query<CurrentReq & { alliance_id: string }>(`select r.alliance_id, ${REQ_COLS} from fcd.v_alliance_requirements_current r where r.alliance_id = any($1::uuid[])`, [ids]),
    q.query<TermsRow & { alliance_id: string }>(`select t.alliance_id, ${TERMS_COLS} from fcd.alliance_terms t where t.alliance_id = any($1::uuid[]) and not exists (select 1 from fcd.alliance_terms n where n.supersedes_id = t.id) order by t.created_at desc`, [ids]),
    q.query<SettlementRow & { alliance_id: string }>(`select s.alliance_id, ${STMT_COLS} from fcd.alliance_settlements s where s.alliance_id = any($1::uuid[]) and not exists (select 1 from fcd.alliance_settlements n where n.supersedes_id = s.id) order by s.period_end desc, s.created_at desc`, [ids]),
  ]);
  return rows.map((a) => ({
    ...a,
    reqs: reqs.filter((r) => r.alliance_id === a.id),
    terms: terms.find((t) => t.alliance_id === a.id) ?? null,
    lastStatement: stmts.find((s) => s.alliance_id === a.id) ?? null,
  }));
}

export interface AllianceDetail {
  a: AllianceRow;
  reqs: CurrentReq[];
  history: ReqHistoryRow[];
  terms: TermsRow[];
  settlements: SettlementRow[];
}

async function detailBy(q: Queryable, where: string, param: string): Promise<AllianceDetail | null> {
  const a = (await q.query<AllianceRow>(`select ${ALLIANCE_COLS} from fcd.alliance_partners a join fcd.orgs o on o.id = a.partner_org_id where ${where}`, [param]))[0];
  if (!a) return null;
  const [reqs, history, terms, settlements] = await Promise.all([
    q.query<CurrentReq>(`select ${REQ_COLS} from fcd.v_alliance_requirements_current r where r.alliance_id = $1`, [a.id]),
    q.query<ReqHistoryRow>(
      `select ${REQ_COLS}, r.supersedes_id, p.name created_by_name from fcd.alliance_requirements r left join fcd.profiles p on p.id = r.created_by
        where r.alliance_id = $1 order by r.created_at desc limit 60`,
      [a.id],
    ),
    q.query<TermsRow>(`select ${TERMS_COLS} from fcd.alliance_terms t where t.alliance_id = $1 order by t.created_at desc limit 30`, [a.id]),
    q.query<SettlementRow>(`select ${STMT_COLS} from fcd.alliance_settlements s where s.alliance_id = $1 order by s.period_end desc, s.created_at desc limit 30`, [a.id]),
  ]);
  return { a, reqs, history, terms, settlements };
}

export const allianceDetail = (q: Queryable, allianceId: string) => detailBy(q, 'a.id = $1', allianceId);
export const partnerAlliance = (q: Queryable, orgId: string) => detailBy(q, 'a.partner_org_id = $1', orgId);

/** 후보로 올릴 수 있는 물류사(아직 제휴 기록이 없는 곳) — 운영 화면 */
export async function candidateOrgs(q: Queryable) {
  return q.query<{ id: string; name: string; license_no: string | null; status: string; is_demo: boolean }>(
    `select o.id, o.name, o.license_no, o.status, o.is_demo from fcd.orgs o
      where o.kind = 'partner' and o.status in ('official', 'pending_verification')
        and not exists (select 1 from fcd.alliance_partners a where a.partner_org_id = o.id)
      order by o.name limit 200`,
  );
}
