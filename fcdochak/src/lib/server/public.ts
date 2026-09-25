import 'server-only';
/** 공개 마켓 조회 — 비로그인. 개별 업체 가격은 공개가 요금표만, 구간 시세는 집계 숫자만. */
import { asPublic, asSystem, todayKst, type Queryable } from '../db';
import { env } from '../env';
import { completeWithReference, computeQuote, type Cargo, type Segment } from '../money';
import { loadCards } from './compare';
import { loadSettings } from './settings';

/** 구간 시세의 기준 화물 — 화면에 그대로 적는다 */
export const STANDARD_CARGO: Cargo = { units: 1200, cartons: 40, kg: 650, cbm: 3, goodsValue: 24000, goodsCurrency: 'RMB' };

export interface MarketCounts {
  cards_today: number;
  requests_week: number;
  partners_listed: number;
  partners_official: number;
  delivered_30d: number;
  cards_active: number;
}

export async function marketCounts(): Promise<MarketCounts> {
  return asPublic(async (q) => (await q.query<MarketCounts>('select * from fcd.v_market_counts'))[0]);
}

export interface LaneStat {
  hub: string;
  port: string;
  mode: string;
  slug: string;
  hubName: string;
  hubNameZh: string;
  portName: string;
  modeName: string;
  cards: number;
  partners: number;
  median: number;
  min: number;
  q1: number;
  medianPerCbm: number;
  transitMin: number;
  transitMax: number;
  medianSegments: Record<Segment, number>;
  updatedAt: string | null;
}

export function laneSlug(hub: string, port: string, mode: string) {
  return `${hub}-${port}-${mode}`.toLowerCase();
}

function median(a: number[]) {
  if (a.length === 0) return 0;
  const s = [...a].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}
function quantile(a: number[], p: number) {
  if (a.length === 0) return 0;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1) + 0.5))];
}

/**
 * 구간 시세 — 모든 공식·인증 대기 업체의 현재 요금표로 기준 화물 총액을 계산해 중간값·최저·상위 25% 만 낸다.
 * 개별 업체 가격은 내보내지 않는다. 데모는 DEMO_MODE 에 따라 뺀다.
 */
export async function laneStats(): Promise<LaneStat[]> {
  const today = todayKst();
  return asSystem(async (q) => {
    const s = await loadSettings(q);
    const lanes = await q.query<{ hub: string; port: string; mode: string }>(
      `select distinct r.origin_hub hub, r.port, r.mode from fcd.v_rate_cards_current r join fcd.orgs o on o.id = r.org_id
        where o.status in ('official','pending_verification') and ($1 or not o.is_demo) and r.status = 'active' and r.valid_to >= $2::date`,
      [env.demoMode, today],
    );
    const ref = await q.query<{ code: string; name_ko: string; name_zh: string; kind: string }>(
      `select code, name_ko, name_zh, 'hub' kind from fcd.hubs union all select code, name_ko, name_zh, 'port' from fcd.ports
       union all select code, name_ko, name_zh, 'mode' from fcd.modes`,
    );
    const name = (kind: string, code: string) => ref.find((r) => r.kind === kind && r.code === code);
    const refQuote = computeQuote(s.referenceLines, STANDARD_CARGO, s.quoteParams);
    const reference = Object.fromEntries(refQuote.segments.map((x) => [x.segment, x.amount])) as Partial<Record<Segment, number>>;
    const out: LaneStat[] = [];
    for (const lane of lanes) {
      const { cards, lines, tiers } = await loadCards(q, { hub: lane.hub, port: lane.port, mode: lane.mode });
      const orgs = await q.query<{ id: string; ok: boolean }>(
        `select id, (status in ('official','pending_verification') and ($2 or not is_demo)) ok from fcd.orgs where id = any($1::uuid[])`,
        [[...new Set(cards.map((c) => c.org_id))], env.demoMode],
      );
      const okOrg = new Set(orgs.filter((o) => o.ok).map((o) => o.id));
      const totals: number[] = [];
      const segs: Record<string, number[]> = {};
      const partners = new Set<string>();
      let tmin = 99;
      let tmax = 0;
      let updated: string | null = null;
      for (const c of cards) {
        if (!okOrg.has(c.org_id) || c.status !== 'active' || c.valid_to < today) continue;
        const ls = lines.get(c.id) ?? [];
        if (!ls.some((l) => l.segment === 'freight' && l.included)) continue;
        const qr = completeWithReference(computeQuote(ls, STANDARD_CARGO, s.quoteParams, tiers.get(c.id) ?? []), reference, STANDARD_CARGO.units);
        totals.push(qr.total);
        for (const x of qr.segments) (segs[x.segment] ??= []).push(x.amount ?? 0);
        partners.add(c.org_id);
        tmin = Math.min(tmin, c.transit_days_min);
        tmax = Math.max(tmax, c.transit_days_max);
        if (!updated || c.created_at > updated) updated = c.created_at;
      }
      if (totals.length === 0) continue;
      const med = median(totals);
      out.push({
        ...lane,
        slug: laneSlug(lane.hub, lane.port, lane.mode),
        hubName: name('hub', lane.hub)?.name_ko ?? lane.hub,
        hubNameZh: name('hub', lane.hub)?.name_zh ?? lane.hub,
        portName: name('port', lane.port)?.name_ko ?? lane.port,
        modeName: name('mode', lane.mode)?.name_ko ?? lane.mode,
        cards: totals.length,
        partners: partners.size,
        median: med,
        min: Math.min(...totals),
        q1: quantile(totals, 0.25),
        medianPerCbm: Math.round(med / STANDARD_CARGO.cbm),
        transitMin: tmin,
        transitMax: tmax,
        medianSegments: Object.fromEntries(Object.entries(segs).map(([k, v]) => [k, median(v)])) as Record<Segment, number>,
        updatedAt: updated,
      });
    }
    const hubOrd = ['YIW', 'QDG', 'WEH', 'YNT', 'RZH', 'CAN', 'SZX'];
    const modeOrd = ['LCL', 'FERRY', 'FCL', 'AIR'];
    return out.sort(
      (a, b) => hubOrd.indexOf(a.hub) - hubOrd.indexOf(b.hub) || a.port.localeCompare(b.port) || modeOrd.indexOf(a.mode) - modeOrd.indexOf(b.mode),
    );
  });
}

export interface PublicPartner {
  id: string;
  name: string;
  name_zh: string | null;
  slug: string;
  status: string;
  business_type: string | null;
  logo_path: string | null;
  hq_city: string | null;
  related_party_note: string | null;
  is_demo: boolean;
  hubs: string[] | null;
  modes: string[] | null;
}

export async function listPartners(q?: Queryable): Promise<PublicPartner[]> {
  const run = (qq: Queryable) =>
    qq.query<PublicPartner>(
      `select o.id, o.name, o.name_zh, o.slug, o.status, o.business_type, o.logo_path, o.hq_city, o.related_party_note, o.is_demo,
              (select array_agg(hub order by hub) from fcd.org_hubs h where h.org_id = o.id) hubs,
              (select array_agg(mode order by mode) from fcd.org_modes m where m.org_id = o.id) modes
         from fcd.orgs o where o.kind = 'partner' order by (o.status = 'official') desc, o.name`,
    );
  return q ? run(q) : asPublic(run);
}

export interface PublicReview {
  id: string;
  rating: number;
  body: string;
  author_label: string;
  created_at: string;
  partner_name: string;
  partner_slug: string;
  on_time_ok: boolean;
  billing_ok: boolean;
}

export async function publicReviews(limit = 6, partnerId?: string): Promise<PublicReview[]> {
  return asPublic((q) =>
    q.query<PublicReview>(
      `select r.id, r.rating, r.body, r.author_label, r.created_at, o.name partner_name, o.slug partner_slug, r.on_time_ok, r.billing_ok
         from fcd.reviews r join fcd.orgs o on o.id = r.partner_org_id
        where ($2::uuid is null or r.partner_org_id = $2) and length(r.body) > 30
        order by r.created_at desc limit $1`,
      [limit, partnerId ?? null],
    ),
  );
}

export async function partnerBySlug(slug: string) {
  return asPublic(async (q) => {
    const p = (
      await q.query<
        PublicPartner & {
          address: string | null;
          phone: string | null;
          website: string | null;
          intro: string | null;
          license_no: string | null;
          cargo_insurance: string | null;
          public_source: string | null;
          public_checked_on: string | null;
          created_at: string;
        }
      >(
        `select o.id, o.name, o.name_zh, o.slug, o.status, o.business_type, o.logo_path, o.hq_city, o.related_party_note, o.is_demo,
                o.address, o.phone, o.website, o.intro, o.license_no, o.cargo_insurance, o.public_source, o.public_checked_on, o.created_at,
                (select array_agg(hub order by hub) from fcd.org_hubs h where h.org_id = o.id) hubs,
                (select array_agg(mode order by mode) from fcd.org_modes m where m.org_id = o.id) modes
           from fcd.orgs o where o.slug = $1 and o.kind = 'partner'`,
        [slug],
      )
    )[0];
    if (!p) return null;
    const caps = await q.query<{ trait: string; name_ko: string }>(
      `select c.trait, t.name_ko from fcd.org_capabilities c join fcd.cargo_traits t on t.code = c.trait where c.org_id = $1 order by t.ord`,
      [p.id],
    );
    const metrics = (await q.query<Record<string, number | null>>('select * from fcd.v_partner_metrics where org_id = $1', [p.id]))[0] ?? null;
    const grade = (
      await q.query<{ granted: boolean; created_at: string }>(
        `select granted, created_at from fcd.grade_records where org_id = $1 and grade = 'fc_ready' order by created_at desc limit 1`,
        [p.id],
      )
    )[0];
    const cards = await q.query<{ id: string; origin_hub: string; port: string; mode: string; valid_to: string; created_at: string; certainty: string }>(
      `select id, origin_hub, port, mode, valid_to, created_at, certainty from fcd.v_rate_cards_current
        where org_id = $1 and status = 'active' and valid_to >= (now() at time zone 'Asia/Seoul')::date order by origin_hub, port, mode`,
      [p.id],
    );
    return { partner: p, caps, metrics, fcReady: grade?.granted ?? false, gradeAt: grade?.created_at ?? null, publicCards: cards };
  });
}
