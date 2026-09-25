import 'server-only';
/** 물류사 콘솔 조회 — asUser(RLS). 화주 이름은 예약 뒤에만 보인다(orgs RLS). */
import { asSystem, type Queryable } from '../db';
import { env } from '../env';
import { computeQuote, exclusionReasons, type Cargo, type ExclusionReason, type QuoteResult } from '../money';
import { loadCards, loadTraitRules } from './compare';
import type { AppSettings } from './settings';
import { REQUEST_SELECT, type RequestRow } from './shipper';

export interface InboxItem extends RequestRow {
  my_bid_id: string | null;
  my_bid_total: number | null;
  my_bid_status: string | null;
  won: boolean | null;
  auto: { cardId: string; mode: string; quote: QuoteResult; transit: [number, number] } | null;
  blocked: ExclusionReason[];
}

export async function myOrgFacts(q: Queryable, orgId: string) {
  const [caps, hubs, modes] = await Promise.all([
    q.query<{ trait: string }>('select trait from fcd.org_capabilities where org_id = $1', [orgId]),
    q.query<{ hub: string }>('select hub from fcd.org_hubs where org_id = $1', [orgId]),
    q.query<{ mode: string }>('select mode from fcd.org_modes where org_id = $1', [orgId]),
  ]);
  return { caps: caps.map((c) => c.trait), hubs: hubs.map((h) => h.hub), modes: modes.map((m) => m.mode) };
}

/** 내 요금표로 이 요청의 자동 금액 — 같은 구간의 현재·유효 요금표 중 가장 싼 것 */
export async function autoQuote(q: Queryable, orgId: string, r: RequestRow, s: AppSettings, today: string) {
  const { cards, lines, tiers } = await loadCards(q, { hub: r.origin_hub, port: r.port, mode: r.mode });
  const cargo: Cargo = { units: r.units, cartons: r.cartons, kg: r.kg, cbm: r.cbm, goodsValue: r.goods_value, goodsCurrency: r.goods_currency as 'RMB' };
  const mine = cards.filter((c) => c.org_id === orgId && c.status === 'active' && c.valid_from <= today && c.valid_to >= today);
  let best: InboxItem['auto'] = null;
  for (const c of mine) {
    const ls = lines.get(c.id) ?? [];
    if (!ls.some((l) => l.included)) continue;
    const quote = computeQuote(ls, cargo, s.quoteParams, tiers.get(c.id) ?? []);
    if (!best || quote.total < best.quote.total) best = { cardId: c.id, mode: c.mode, quote, transit: [c.transit_days_min, c.transit_days_max] };
  }
  return best;
}

export async function inbox(q: Queryable, orgId: string, s: AppSettings, today: string, opts: { includeClosed?: boolean } = {}): Promise<InboxItem[]> {
  const rows = await q.query<RequestRow & { my_bid_id: string | null; my_bid_total: number | null; my_bid_status: string | null; won: boolean | null }>(
    `select r.*, b.id my_bid_id, b.total my_bid_total, b.status my_bid_status,
            (select bk.partner_org_id = $1 from fcd.bookings bk where bk.request_id = r.id) won
       from (${REQUEST_SELECT}) r
       left join lateral (select id, total, status from fcd.v_bids_current where request_id = r.id and org_id = $1 limit 1) b on true
      where ${opts.includeClosed ? 'true' : `r.display_status in ('waiting','bidding','closing_soon')`}
      order by r.bid_deadline asc limit 300`,
    [orgId],
  );
  const facts = await myOrgFacts(q, orgId);
  const { rules } = await loadTraitRules(q);
  const out: InboxItem[] = [];
  for (const r of rows) {
    const auto = await autoQuote(q, orgId, r, s, today);
    const blocked = exclusionReasons(
      { orgId, capabilities: facts.caps, mode: auto?.mode ?? r.mode ?? facts.modes[0] ?? 'LCL', validFrom: '0000-01-01', validTo: '9999-12-31', status: 'active' },
      r.traits,
      rules,
      today,
    );
    out.push({ ...r, auto, blocked });
  }
  return out;
}

export async function partnerDashboard(q: Queryable, orgId: string, s: AppSettings, today: string) {
  const items = await inbox(q, orgId, s, today);
  const counts = (
    await q.query<{ won_month: number; won_sum: number; active: number; expiring: number; won_prev: number }>(
      `select
        (select count(*) from fcd.bookings where partner_org_id = $1 and date_trunc('month', created_at at time zone 'Asia/Seoul') = date_trunc('month', now() at time zone 'Asia/Seoul'))::int won_month,
        (select count(*) from fcd.bookings where partner_org_id = $1 and date_trunc('month', created_at at time zone 'Asia/Seoul') = date_trunc('month', now() at time zone 'Asia/Seoul') - interval '1 month')::int won_prev,
        (select coalesce(sum(bd.total), 0) from fcd.bookings b join fcd.bids bd on bd.id = b.bid_id where b.partner_org_id = $1 and date_trunc('month', b.created_at at time zone 'Asia/Seoul') = date_trunc('month', now() at time zone 'Asia/Seoul'))::bigint won_sum,
        (select count(*) from fcd.shipments where partner_org_id = $1 and stage < 9)::int active,
        (select count(*) from fcd.v_rate_cards_current where org_id = $1 and status = 'active' and valid_to between $2::date and $2::date + $3::int)::int expiring`,
      [orgId, today, s.expiringDays],
    )
  )[0];
  const expiring = await q.query<{ id: string; card_no: string; version: number; origin_hub: string; port: string; mode: string; valid_to: string }>(
    `select id, card_no, version, origin_hub, port, mode, valid_to from fcd.v_rate_cards_current
      where org_id = $1 and status = 'active' and valid_to between $2::date - 5 and $2::date + $3::int order by valid_to limit 8`,
    [orgId, today, s.expiringDays],
  );
  const metrics = (await q.query<Record<string, number | null>>('select * from fcd.v_partner_metrics where org_id = $1', [orgId]))[0] ?? null;
  const daily = await q.query<{ d: string; v: number }>(
    `select to_char(b.created_at at time zone 'Asia/Seoul', 'YYYY-MM-DD') d, count(*)::int v from fcd.bookings b
      where b.partner_org_id = $1 and b.created_at > now() - interval '30 days' group by 1`,
    [orgId],
  );
  return { items, counts, expiring, metrics, daily };
}

export interface CardRow {
  id: string;
  card_no: string;
  version: number;
  origin_hub: string;
  port: string;
  mode: string;
  valid_from: string;
  valid_to: string;
  certainty: string;
  is_public_price: boolean;
  fuel_surcharge_separate: boolean;
  transit_days_min: number;
  transit_days_max: number;
  status: string;
  created_at: string;
  change_note: string | null;
  included: string[] | null;
}

export async function myCards(q: Queryable, orgId: string) {
  return q.query<CardRow>(
    `select r.id, r.card_no, r.version, r.origin_hub, r.port, r.mode, r.valid_from, r.valid_to, r.certainty, r.is_public_price, r.fuel_surcharge_separate,
            r.transit_days_min, r.transit_days_max, r.status, r.created_at, r.change_note,
            (select array_agg(l.segment) from fcd.rate_card_lines l where l.rate_card_id = r.id and l.included) included
       from fcd.v_rate_cards_current r where r.org_id = $1 order by r.valid_to desc`,
    [orgId],
  );
}

/** 시장 데이터 — 집계만. 개별 화주·경쟁 업체는 내보내지 않는다. 데모는 DEMO_MODE 에 따라. */
export async function marketData(orgId: string, days: number) {
  return asSystem(async (q) => {
    const lanes = await q.query<{ hub: string; port: string; n: number; prev: number }>(
      `select r.origin_hub hub, r.port,
              count(*) filter (where r.created_at > now() - ($2::int * interval '1 day'))::int n,
              count(*) filter (where r.created_at <= now() - ($2::int * interval '1 day') and r.created_at > now() - ($2::int * 2 * interval '1 day'))::int prev
         from fcd.quote_requests r join fcd.orgs o on o.id = r.org_id
        where ($3 or not o.is_demo) and r.origin_hub in (select hub from fcd.org_hubs where org_id = $1)
        group by 1, 2 order by n desc`,
      [orgId, days, env.demoMode],
    );
    const bands = await q.query<{ band: string; total: number; won: number }>(
      `with mine as (
         select b.request_id, b.total, (select min(x.total) from fcd.bids x where x.request_id = b.request_id and not exists (select 1 from fcd.bids n where n.supersedes_id = x.id)) min_total,
                exists (select 1 from fcd.bookings bk where bk.bid_id = b.id) won
           from fcd.bids b where b.org_id = $1 and not exists (select 1 from fcd.bids n where n.supersedes_id = b.id) and b.created_at > now() - ($2::int * interval '1 day')
       )
       select case when total <= min_total then '최저' when total <= min_total * 1.05 then '+5% 안' when total <= min_total * 1.10 then '+10% 안' else '+10% 넘음' end band,
              count(*)::int total, count(*) filter (where won)::int won
         from mine group by 1`,
      [orgId, days],
    );
    return { lanes, bands };
  });
}
