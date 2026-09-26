import type { Queryable } from '../db';

/** 표별 데모 건수 — 모든 표가 조직에 매달려 있으므로 조직의 is_demo 로 가른다 */
export const DEMO_TABLES: { table: string; sql: string }[] = [
  { table: 'orgs', sql: `select count(*) filter (where is_demo)::int demo, count(*) filter (where not is_demo)::int real from fcd.orgs` },
  { table: 'profiles', sql: `select count(*) filter (where o.is_demo)::int demo, count(*) filter (where not o.is_demo)::int real from fcd.profiles x join fcd.orgs o on o.id = x.home_org_id` },
  { table: 'memberships', sql: `select count(*) filter (where o.is_demo)::int demo, count(*) filter (where not o.is_demo)::int real from fcd.memberships x join fcd.orgs o on o.id = x.org_id` },
  { table: 'rate_cards', sql: `select count(*) filter (where o.is_demo)::int demo, count(*) filter (where not o.is_demo)::int real from fcd.rate_cards x join fcd.orgs o on o.id = x.org_id` },
  { table: 'rate_card_lines', sql: `select count(*) filter (where o.is_demo)::int demo, count(*) filter (where not o.is_demo)::int real from fcd.rate_card_lines l join fcd.rate_cards x on x.id = l.rate_card_id join fcd.orgs o on o.id = x.org_id` },
  { table: 'skus', sql: `select count(*) filter (where o.is_demo)::int demo, count(*) filter (where not o.is_demo)::int real from fcd.skus x join fcd.orgs o on o.id = x.org_id` },
  { table: 'quote_requests', sql: `select count(*) filter (where o.is_demo)::int demo, count(*) filter (where not o.is_demo)::int real from fcd.quote_requests x join fcd.orgs o on o.id = x.org_id` },
  { table: 'bids', sql: `select count(*) filter (where o.is_demo)::int demo, count(*) filter (where not o.is_demo)::int real from fcd.bids x join fcd.orgs o on o.id = x.org_id` },
  { table: 'bookings', sql: `select count(*) filter (where o.is_demo)::int demo, count(*) filter (where not o.is_demo)::int real from fcd.bookings x join fcd.orgs o on o.id = x.shipper_org_id` },
  { table: 'shipments', sql: `select count(*) filter (where o.is_demo)::int demo, count(*) filter (where not o.is_demo)::int real from fcd.shipments x join fcd.orgs o on o.id = x.shipper_org_id` },
  { table: 'shipment_events', sql: `select count(*) filter (where o.is_demo)::int demo, count(*) filter (where not o.is_demo)::int real from fcd.shipment_events e join fcd.shipments x on x.id = e.shipment_id join fcd.orgs o on o.id = x.shipper_org_id` },
  { table: 'exceptions', sql: `select count(*) filter (where o.is_demo)::int demo, count(*) filter (where not o.is_demo)::int real from fcd.exceptions e join fcd.shipments x on x.id = e.shipment_id join fcd.orgs o on o.id = x.shipper_org_id` },
  { table: 'invoices', sql: `select count(*) filter (where o.is_demo)::int demo, count(*) filter (where not o.is_demo)::int real from fcd.invoices x join fcd.orgs o on o.id = x.partner_org_id` },
  { table: 'reviews', sql: `select count(*) filter (where o.is_demo)::int demo, count(*) filter (where not o.is_demo)::int real from fcd.reviews x join fcd.orgs o on o.id = x.shipper_org_id` },
  { table: 'notifications', sql: `select count(*) filter (where o.is_demo)::int demo, count(*) filter (where not o.is_demo)::int real from fcd.notifications x join fcd.orgs o on o.id = x.org_id` },
  { table: 'grade_records', sql: `select count(*) filter (where o.is_demo)::int demo, count(*) filter (where not o.is_demo)::int real from fcd.grade_records x join fcd.orgs o on o.id = x.org_id` },
  { table: 'ad_slots', sql: `select count(*) filter (where o.is_demo)::int demo, count(*) filter (where not o.is_demo)::int real from fcd.ad_slots x join fcd.orgs o on o.id = x.org_id` },
  { table: 'verification_requests', sql: `select count(*) filter (where o.is_demo)::int demo, count(*) filter (where not o.is_demo)::int real from fcd.verification_requests x join fcd.orgs o on o.id = x.org_id` },
  { table: 'review_replies', sql: `select count(*) filter (where o.is_demo)::int demo, count(*) filter (where not o.is_demo)::int real from fcd.review_replies x join fcd.orgs o on o.id = x.partner_org_id` },
  { table: 'events', sql: `select count(*) filter (where o.is_demo)::int demo, count(*) filter (where not o.is_demo)::int real from fcd.events x join fcd.orgs o on o.id = x.org_id` },
  { table: 'audit_log', sql: `select count(*) filter (where o.is_demo)::int demo, count(*) filter (where o.is_demo is not true)::int real from fcd.audit_log x left join fcd.orgs o on o.id = x.org_id` },
  { table: 'invoice_checks', sql: `select count(*) filter (where o.is_demo)::int demo, count(*) filter (where not o.is_demo)::int real from fcd.invoice_checks x join fcd.orgs o on o.id = x.org_id` },
  { table: 'assure_interests', sql: `select count(*) filter (where o.is_demo)::int demo, count(*) filter (where not o.is_demo)::int real from fcd.assure_interests x join fcd.orgs o on o.id = x.org_id` },
  { table: 'firm_price_quotes', sql: `select count(*) filter (where o.is_demo)::int demo, count(*) filter (where not o.is_demo)::int real from fcd.firm_price_quotes x join fcd.orgs o on o.id = x.org_id` },
  { table: 'documents', sql: `select count(*) filter (where o.is_demo)::int demo, count(*) filter (where not o.is_demo)::int real from fcd.documents x join fcd.orgs o on o.id = x.org_id` },
  { table: 'invoice_decisions', sql: `select count(*) filter (where o.is_demo)::int demo, count(*) filter (where not o.is_demo)::int real from fcd.invoice_decisions x join fcd.orgs o on o.id = x.shipper_org_id` },
  { table: 'partner_invites', sql: `select count(*) filter (where o.is_demo)::int demo, count(*) filter (where not o.is_demo)::int real from fcd.partner_invites x join fcd.orgs o on o.id = x.shipper_org_id` },
  { table: 'shipper_partners', sql: `select count(*) filter (where o.is_demo or p.is_demo)::int demo, count(*) filter (where not o.is_demo and not p.is_demo)::int real from fcd.shipper_partners x join fcd.orgs o on o.id = x.shipper_org_id join fcd.orgs p on p.id = x.partner_org_id` },
  { table: 'wing_connections', sql: `select count(*) filter (where o.is_demo)::int demo, count(*) filter (where not o.is_demo)::int real from fcd.wing_connections x join fcd.orgs o on o.id = x.org_id` },
  { table: 'wing_inbound_requests', sql: `select count(*) filter (where o.is_demo)::int demo, count(*) filter (where not o.is_demo)::int real from fcd.wing_inbound_requests x join fcd.orgs o on o.id = x.org_id` },
  { table: 'wing_matches', sql: `select count(*) filter (where o.is_demo)::int demo, count(*) filter (where not o.is_demo)::int real from fcd.wing_matches x join fcd.orgs o on o.id = x.org_id` },
  { table: 'wing_access_log', sql: `select count(*) filter (where o.is_demo)::int demo, count(*) filter (where not o.is_demo)::int real from fcd.wing_access_log x join fcd.orgs o on o.id = x.org_id` },
  // v2 alliance
  { table: 'alliance_partners', sql: `select count(*) filter (where o.is_demo)::int demo, count(*) filter (where not o.is_demo)::int real from fcd.alliance_partners x join fcd.orgs o on o.id = x.partner_org_id` },
  { table: 'alliance_requirements', sql: `select count(*) filter (where o.is_demo)::int demo, count(*) filter (where not o.is_demo)::int real from fcd.alliance_requirements x join fcd.orgs o on o.id = x.partner_org_id` },
  { table: 'alliance_terms', sql: `select count(*) filter (where o.is_demo)::int demo, count(*) filter (where not o.is_demo)::int real from fcd.alliance_terms x join fcd.orgs o on o.id = x.partner_org_id` },
  { table: 'alliance_settlements', sql: `select count(*) filter (where o.is_demo)::int demo, count(*) filter (where not o.is_demo)::int real from fcd.alliance_settlements x join fcd.orgs o on o.id = x.partner_org_id` },
  { table: 'research_participants', sql: `select count(*) filter (where o.is_demo)::int demo, count(*) filter (where not o.is_demo)::int real from fcd.research_participants x join fcd.orgs o on o.id = x.org_id` },
  { table: 'research_consents', sql: `select count(*) filter (where o.is_demo)::int demo, count(*) filter (where not o.is_demo)::int real from fcd.research_consents x join fcd.orgs o on o.id = x.org_id` },
  { table: 'research_invites', sql: `select count(*) filter (where o.is_demo)::int demo, count(*) filter (where not o.is_demo)::int real from fcd.research_invites x join fcd.orgs o on o.id = x.org_id` },
  { table: 'research_responses', sql: `select count(*) filter (where o.is_demo)::int demo, count(*) filter (where not o.is_demo)::int real from fcd.research_responses x join fcd.orgs o on o.id = x.org_id` },
  { table: 'research_vendor_quotes', sql: `select count(*) filter (where o.is_demo)::int demo, count(*) filter (where not o.is_demo)::int real from fcd.research_vendor_quotes x join fcd.orgs o on o.id = x.org_id` },
  { table: 'check_funnel_events', sql: `select count(*) filter (where o.is_demo)::int demo, count(*) filter (where o.is_demo is not true)::int real from fcd.check_funnel_events x left join fcd.orgs o on o.id = x.org_id` },
  // v2 3차 sourcing
  { table: 'sourcing_requests', sql: `select count(*) filter (where o.is_demo)::int demo, count(*) filter (where not o.is_demo)::int real from fcd.sourcing_requests x join fcd.orgs o on o.id = x.org_id` },
  { table: 'sourcing_request_events', sql: `select count(*) filter (where o.is_demo)::int demo, count(*) filter (where not o.is_demo)::int real from fcd.sourcing_request_events x join fcd.orgs o on o.id = x.org_id` },
  { table: 'sourcing_candidates', sql: `select count(*) filter (where o.is_demo)::int demo, count(*) filter (where not o.is_demo)::int real from fcd.sourcing_candidates x join fcd.orgs o on o.id = x.org_id` },
  { table: 'candidate_quotes', sql: `select count(*) filter (where o.is_demo)::int demo, count(*) filter (where not o.is_demo)::int real from fcd.candidate_quotes x join fcd.orgs o on o.id = x.org_id` },
  { table: 'sourcing_sample_interests', sql: `select count(*) filter (where o.is_demo)::int demo, count(*) filter (where not o.is_demo)::int real from fcd.sourcing_sample_interests x join fcd.orgs o on o.id = x.org_id` },
];

export async function demoCounts(q: Queryable) {
  const out: { table: string; demo: number; real: number }[] = [];
  for (const t of DEMO_TABLES) {
    const r = (await q.query<{ demo: number; real: number }>(t.sql))[0];
    out.push({ table: t.table, demo: r.demo, real: r.real });
  }
  return out;
}
