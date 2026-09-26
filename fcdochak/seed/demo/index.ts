/**
 * 데모 시드 — 가상 기초값.
 *
 * · 모든 자료는 is_demo = true 조직 아래에만 있다. 조직을 지우면 CASCADE 로 전부 사라진다.
 * · 고정 시드 난수: 같은 날 돌리면 같은 결과. 날짜는 실행일 기준으로 옮겨 늘 최근이다.
 * · 멱등: 데모 조직이 이미 있으면 아무것도 하지 않는다(지우지도 덮지도 않는다).
 */
import type { Driver, Queryable } from '@/lib/db/driver';
import { hashPassword } from '@/lib/auth/password';
import {
  SEGMENTS,
  computeQuote,
  isFcReady,
  type Cargo,
  type Certainty,
  type QuoteParams,
  type RateLine,
  type RateTier,
  type Segment,
} from '@/lib/money';
import { FC_CENTERS, HUBS, MODES, REFERENCE_LINES, SETTINGS } from '../reference/data';
import { EXCEPTION_NOTES, RAW_STATUS_KO, RAW_STATUS_ZH, reviewText } from './text';
import { PARTNERS, PEOPLE_KO, PEOPLE_ZH, PRESETS, SHIPPERS, type PartnerDef, type PresetDef } from './orgs';
import { Rng } from './rng';
import { seedDemoInvoiceChecks } from './invoice-checks';
import { seedDemoEvents } from './events';
import { seedWorkspaceDemo } from './workspace';
import { seedWingDemo } from './wing'; // v2 2차 wing
import { seedAllianceDemo } from './alliance';
import { seedResearchDemo } from './research';
import { seedSalesDemo } from './sales'; // v2 3차 sales

export const DEMO_SEED = 0x0fcd0c4a;
export const DEMO_ACCOUNTS = {
  shipper: { email: 'demo-shipper@fcdochak.example', name: '김서윤', org: 'livingmoa' },
  partner: { email: 'demo-partner@fcdochak.example', name: '이도현', org: 'hanbada' },
  admin: { email: 'demo-admin@fcdochak.example', name: '박지아', org: 'platform' },
} as const;

export interface DemoSeedOptions {
  today: string;
  now?: number;
  password?: string | null;
  /** Supabase Auth 에 데모 계정을 만들 때(아이디를 그대로 씀) */
  createAuthUser?: (u: { id: string; email: string; password: string; name: string }) => Promise<void>;
  /** 로컬 비밀번호 해시를 fcd.local_credentials 에 넣을지(Supabase Auth 를 쓰면 false) */
  localCredentials?: boolean;
  log?: (m: string) => void;
}

const DAY = 86_400_000;
const HOUR = 3_600_000;
const SHANDONG = new Set(['QDG', 'WEH', 'YNT', 'RZH']);
const setting = <T>(k: string) => SETTINGS.find((s) => s.key === k)!.value as T;
const QP: QuoteParams = { fx: setting('fx'), ...setting<Omit<QuoteParams, 'fx'>>('quote_params') };

type Row = unknown[];
class Table {
  rows: Row[] = [];
  constructor(
    public name: string,
    public cols: string[],
  ) {}
  add(...r: Row) {
    this.rows.push(r);
  }
}

async function flush(q: Queryable, t: Table) {
  if (t.rows.length === 0) return;
  const names = t.cols.map((c) => c.split('::')[0]);
  const casts = t.cols.map((c) => (c.includes('::') ? '::' + c.split('::')[1] : ''));
  const per = Math.max(1, Math.floor(20000 / t.cols.length));
  for (let i = 0; i < t.rows.length; i += per) {
    const chunk = t.rows.slice(i, i + per);
    const params: unknown[] = [];
    const values = chunk
      .map((r) => {
        const ph = r.map((v, j) => {
          params.push(v);
          return `$${params.length}${casts[j]}`;
        });
        return `(${ph.join(',')})`;
      })
      .join(',');
    await q.query(`insert into fcd.${t.name} (${names.join(',')}) values ${values}`, params);
  }
}

const round = (n: number, d = 0) => Math.round(n * 10 ** d) / 10 ** d;
const pad = (n: number, w = 4) => String(n).padStart(w, '0');

export async function seedDemo(db: Driver, opts: DemoSeedOptions) {
  const log = opts.log ?? (() => {});
  const existing = await db.query<{ n: number }>('select count(*)::int as n from fcd.orgs where is_demo');
  if (existing[0].n > 0) {
    log(`데모 조직 ${existing[0].n}곳이 이미 있어 넣지 않았습니다.`);
    const ev = await db.transaction((q) => seedDemoEvents(q)); // v2 metrics — 이벤트가 없던 데모에만 채운다
    if (ev) log(`데모 이벤트 ${ev}줄을 기존 데모 자료에서 만들었습니다.`);
    const al = await db.transaction((q) => seedAllianceDemo(q, { now: opts.now ?? Date.now(), adminEmail: DEMO_ACCOUNTS.admin.email })); // v2 alliance — 제휴 기록이 없던 데모에만
    if (al) log(`데모 제휴 기록 ${al}줄을 넣었습니다.`);
    const rs = await db.transaction((q) => seedResearchDemo(q, { now: opts.now ?? Date.now() })); // v2 interview — 인터뷰 예시가 없던 데모에만
    if (rs) log(`데모 인터뷰 참여자 ${rs}명을 넣었습니다.`);
    const wg = await db.transaction((q) => seedWingDemo(q, { now: opts.now ?? Date.now(), today: opts.today, shipperEmail: DEMO_ACCOUNTS.shipper.email, onlyIfEmpty: true })); // v2 wing — 입고 요청이 없던 데모에만
    if (wg) log(`데모 WING 입고 요청 ${wg}건을 넣었습니다.`);
    const sl = await db.transaction((q) => seedSalesDemo(q, { now: opts.now ?? Date.now(), today: opts.today, shipperEmail: DEMO_ACCOUNTS.shipper.email, onlyIfEmpty: true })); // v2 3차 sales — 판매 기록이 없던 데모에만
    if (sl) log(`데모 판매 기록(하루 묶음 주문) ${sl}줄을 넣었습니다.`);
    return { inserted: false };
  }
  const rng = new Rng(DEMO_SEED);
  const now = opts.now ?? Date.now();
  const todayUtc = Date.UTC(+opts.today.slice(0, 4), +opts.today.slice(5, 7) - 1, +opts.today.slice(8, 10));
  const ymd = (offsetDays: number) => new Date(todayUtc + offsetDays * DAY).toISOString().slice(0, 10);
  const ts = (ms: number) => new Date(ms).toISOString();
  const kstYmd = (ms: number) => new Date(ms + 9 * HOUR).toISOString().slice(0, 10);
  const yymm = (ms: number) => new Date(ms + 9 * HOUR).toISOString().slice(2, 7).replace('-', '');
  const reviewCeil = Math.min(now - HOUR, todayUtc + 15 * HOUR - 1); // 오늘 KST 23:59:59.999 = todayUtc + 15h − 1ms

  // 표 --------------------------------------------------------------------
  const T = {
    orgs: new Table('orgs', ['id', 'kind', 'name', 'name_zh', 'slug', 'is_demo', 'status', 'business_type', 'biz_reg_no', 'license_no', 'cargo_insurance', 'related_party_note', 'logo_path', 'hq_city', 'address', 'phone', 'website', 'intro', 'public_source', 'public_checked_on::date', 'default_locale', 'created_at::timestamptz']),
    orgHubs: new Table('org_hubs', ['org_id', 'hub']),
    orgModes: new Table('org_modes', ['org_id', 'mode']),
    orgCaps: new Table('org_capabilities', ['org_id', 'trait']),
    profiles: new Table('profiles', ['id', 'home_org_id', 'email', 'name', 'locale', 'created_at::timestamptz']),
    members: new Table('memberships', ['user_id', 'org_id', 'role']),
    creds: new Table('local_credentials', ['user_id', 'password_hash']),
    cards: new Table('rate_cards', ['id', 'org_id', 'card_no', 'version', 'supersedes_id', 'origin_hub', 'port', 'mode', 'valid_from::date', 'valid_to::date', 'certainty', 'fuel_surcharge_separate', 'is_public_price', 'transit_days_min', 'transit_days_max', 'status', 'change_note', 'created_by', 'created_at::timestamptz']),
    lines: new Table('rate_card_lines', ['rate_card_id', 'segment', 'included', 'basis', 'unit_price', 'currency', 'min_charge', 'certainty']),
    tiers: new Table('rate_card_tiers', ['rate_card_id', 'segment', 'min_qty', 'discount_bp']),
    skus: new Table('skus', ['id', 'org_id', 'name', 'preset', 'hs_category', 'units', 'cartons', 'kg', 'cbm', 'goods_value', 'goods_currency', 'traits::text[]', 'target_price', 'created_by', 'created_at::timestamptz']),
    reqs: new Table('quote_requests', ['id', 'org_id', 'req_no', 'title', 'sku_id', 'units', 'cartons', 'kg', 'cbm', 'goods_value', 'goods_currency', 'hs_category', 'traits::text[]', 'origin_hub', 'port', 'mode', 'fc_code', 'ready_on::date', 'bid_deadline::timestamptz', 'status', 'note', 'created_by', 'created_at::timestamptz']),
    reqEvents: new Table('quote_request_events', ['request_id', 'kind', 'detail', 'actor_id', 'created_at::timestamptz']),
    bids: new Table('bids', ['id', 'request_id', 'org_id', 'bid_no', 'version', 'supersedes_id', 'rate_card_id', 'kind', 'mode', 'amounts::jsonb', 'certainties::jsonb', 'total', 'confirmed_total', 'transit_days_min', 'transit_days_max', 'valid_until::timestamptz', 'status', 'note', 'created_by', 'created_at::timestamptz']),
    bookings: new Table('bookings', ['id', 'booking_no', 'request_id', 'bid_id', 'shipper_org_id', 'partner_org_id', 'created_by', 'created_at::timestamptz']),
    ships: new Table('shipments', ['id', 'shipment_no', 'booking_id', 'shipper_org_id', 'partner_org_id', 'origin_hub', 'port', 'mode', 'fc_code', 'units', 'cartons', 'kg', 'cbm', 'stage', 'etd::date', 'eta_fc::date', 'delivered_at::timestamptz', 'fc_returned_units', 'created_at::timestamptz']),
    events: new Table('shipment_events', ['shipment_id', 'stage', 'raw_status', 'note', 'occurred_at::timestamptz', 'created_by', 'created_at::timestamptz']),
    exceptions: new Table('exceptions', ['shipment_id', 'kind', 'note', 'opened_at::timestamptz', 'resolved_at::timestamptz', 'resolution', 'created_by']),
    docs: new Table('documents', ['shipment_id', 'org_id', 'kind', 'file_name', 'size_bytes', 'created_by', 'created_at::timestamptz']),
    invoices: new Table('invoices', ['id', 'invoice_no', 'version', 'supersedes_id', 'shipment_id', 'partner_org_id', 'amounts::jsonb', 'total', 'note', 'issued_on::date', 'created_by', 'created_at::timestamptz']),
    reviews: new Table('reviews', ['shipment_id', 'shipper_org_id', 'partner_org_id', 'rating', 'on_time_ok', 'billing_ok', 'body', 'author_label', 'created_by', 'created_at::timestamptz']),
    notifs: new Table('notifications', ['user_id', 'org_id', 'kind', 'title', 'body', 'link', 'read_at::timestamptz', 'created_at::timestamptz']),
    verif: new Table('verification_requests', ['org_id', 'requester_name', 'requester_email', 'requester_phone', 'message', 'status', 'decided_at::timestamptz', 'decided_by', 'decision_note', 'created_at::timestamptz']),
    deletions: new Table('deletion_requests', ['org_id', 'requester_name', 'requester_email', 'reason', 'status', 'created_at::timestamptz']),
    grades: new Table('grade_records', ['org_id', 'grade', 'granted', 'basis::jsonb', 'note', 'created_by', 'created_at::timestamptz']),
    ads: new Table('ad_slots', ['org_id', 'lane_hub', 'lane_port', 'starts_on::date', 'ends_on::date', 'status', 'created_by', 'created_at::timestamptz']),
    audit: new Table('audit_log', ['actor_id', 'org_id', 'action', 'target', 'detail::jsonb', 'created_at::timestamptz']),
  };

  // 조직 ------------------------------------------------------------------
  const platformId = rng.uuid();
  T.orgs.add(platformId, 'platform', 'FC도착 운영(예시)', null, 'demo-platform', true, 'active', null, null, null, null, null, null, '서울', null, null, null, null, null, null, 'ko', ts(now - 200 * DAY));

  interface P extends PartnerDef {
    id: string;
    idx: number;
    people: { id: string; name: string; locale: 'ko' | 'zh' }[];
    delivered: number;
    units30: number;
    returned30: number;
  }
  const partners: P[] = PARTNERS.map((d, idx) => ({ ...d, id: rng.uuid(), idx, people: [], delivered: 0, units30: 0, returned30: 0 }));
  const byKey = new Map(partners.map((p) => [p.key, p]));
  for (const p of partners) {
    const publicOnly = p.status === 'public_info' || p.status === 'deletion_requested';
    T.orgs.add(
      p.id, 'partner', p.name, p.nameZh, p.key, true, p.status, p.type,
      `999-9${p.idx % 10}-${pad(10000 + p.idx * 37, 5)}`,
      publicOnly ? null : p.license ?? null,
      publicOnly ? null : p.insurance ?? null,
      p.related ?? null,
      p.uploadedLogo ? `/api/demo-logo/${p.key}` : null,
      p.city, p.address, p.phone,
      publicOnly ? null : p.website ?? null,
      publicOnly ? null : p.intro ?? null,
      publicOnly ? '회사 누리집 · 관세청 화물운송주선업자 공개 목록(가상 예시)' : null,
      publicOnly ? ymd(-rng.int(5, 40)) : null,
      p.locale,
      ts(now - rng.int(60, 400) * DAY),
    );
    for (const h of p.hubs) T.orgHubs.add(p.id, h);
    for (const m of p.modes) T.orgModes.add(p.id, m);
    for (const c of p.caps) T.orgCaps.add(p.id, c);
  }

  interface S {
    id: string;
    key: string;
    name: string;
    category: string;
    presets: string[];
    hubs: string[];
    weight: number;
    people: { id: string; name: string }[];
    skus: Sku[];
  }
  interface Sku {
    id: string;
    name: string;
    preset: PresetDef;
    units: number;
    cartons: number;
    kg: number;
    cbm: number;
    goods: number;
    price: number;
  }
  const shippers: S[] = SHIPPERS.map((d) => ({ ...d, id: rng.uuid(), people: [], skus: [] }));
  const shipperByKey = new Map(shippers.map((s) => [s.key, s]));
  shippers.forEach((s, i) => {
    T.orgs.add(s.id, 'shipper', s.name, null, `s-${s.key}`, true, 'active', null, `999-8${i % 10}-${pad(20000 + i * 53, 5)}`, null, null, null, null, rng.pick(['서울', '경기 성남', '경기 고양', '인천', '부산', '대구']), null, null, null, null, null, null, 'ko', ts(now - rng.int(100, 500) * DAY));
  });

  // 사람 ------------------------------------------------------------------
  let personSeq = 0;
  const addPerson = (orgId: string, name: string, email: string, role: string, locale: 'ko' | 'zh') => {
    const id = rng.uuid();
    T.profiles.add(id, orgId, email, name, locale, ts(now - rng.int(30, 300) * DAY));
    T.members.add(id, orgId, role);
    personSeq++;
    return id;
  };
  const demoIds = {
    admin: addPerson(platformId, DEMO_ACCOUNTS.admin.name, DEMO_ACCOUNTS.admin.email, 'platform_admin', 'ko'),
    shipper: '',
    partner: '',
  };
  let ki = 0;
  for (const s of shippers) {
    const n = s.key === 'livingmoa' ? 2 : rng.int(1, 2);
    for (let i = 0; i < n; i++) {
      if (s.key === 'livingmoa' && i === 0) {
        demoIds.shipper = addPerson(s.id, DEMO_ACCOUNTS.shipper.name, DEMO_ACCOUNTS.shipper.email, 'shipper_admin', 'ko');
        s.people.push({ id: demoIds.shipper, name: DEMO_ACCOUNTS.shipper.name });
        continue;
      }
      const name = PEOPLE_KO[(ki++ + 3) % PEOPLE_KO.length];
      s.people.push({ id: addPerson(s.id, name, `${s.key}.${i + 1}@demo.fcdochak.example`, i === 0 ? 'shipper_admin' : 'shipper_member', 'ko'), name });
    }
  }
  let zi = 0;
  for (const p of partners) {
    if (p.status === 'public_info' || p.status === 'deletion_requested') continue;
    const n = p.key === 'hanbada' ? 2 : rng.int(1, 2);
    for (let i = 0; i < n; i++) {
      if (p.key === 'hanbada' && i === 0) {
        demoIds.partner = addPerson(p.id, DEMO_ACCOUNTS.partner.name, DEMO_ACCOUNTS.partner.email, 'partner_admin', 'ko');
        p.people.push({ id: demoIds.partner, name: DEMO_ACCOUNTS.partner.name, locale: 'ko' });
        continue;
      }
      const zh = p.locale === 'zh';
      const name = zh ? PEOPLE_ZH[zi++ % PEOPLE_ZH.length] : PEOPLE_KO[(ki++ + 3) % PEOPLE_KO.length];
      p.people.push({ id: addPerson(p.id, name, `${p.key}.${i + 1}@demo.fcdochak.example`, i === 0 ? 'partner_admin' : 'partner_member', zh ? 'zh' : 'ko'), name, locale: zh ? 'zh' : 'ko' });
    }
  }

  // SKU -----------------------------------------------------------------
  for (const s of shippers) {
    const n = s.key === 'livingmoa' ? 6 : rng.int(3, 5);
    for (let i = 0; i < n; i++) {
      const preset = PRESETS.find((x) => x.key === s.presets[i % s.presets.length])!;
      const units = Math.round(rng.int(preset.units[0], preset.units[1]) / 50) * 50;
      const cartons = Math.max(1, Math.ceil(units / preset.perCarton));
      const kg = round(units * preset.unitKg * rng.range(0.92, 1.08), 1);
      const cbm = Math.max(0.3, round(units * preset.unitCbm * rng.range(0.92, 1.1), 2));
      const goods = Math.round((units * rng.range(preset.unitRmb[0], preset.unitRmb[1])) / 10) * 10;
      const price = Math.round(rng.int(preset.price[0], preset.price[1]) / 1000) * 1000 - 100;
      const name = preset.items[(i + s.name.length) % preset.items.length];
      const sku: Sku = { id: rng.uuid(), name, preset, units, cartons, kg, cbm, goods, price };
      s.skus.push(sku);
      T.skus.add(sku.id, s.id, name, preset.key, preset.hs, units, cartons, kg, cbm, goods, 'RMB', [...preset.traits], price, s.people[0].id, ts(now - rng.int(20, 200) * DAY));
    }
  }

  // 요금표 ----------------------------------------------------------------
  interface CardV {
    id: string;
    partner: P;
    hub: string;
    port: string;
    mode: string;
    from: number; // ms (UTC 자정)
    to: number;
    lines: RateLine[];
    tiers: RateTier[];
    transit: [number, number];
    status: 'active' | 'withdrawn';
    current: boolean;
    certainty: Certainty;
  }
  const cards: CardV[] = [];
  const freightTypes = new Set(['forwarder', 'consolidator', 'ferry_agent', 'air_forwarder']);
  const hubFactor: Record<string, number> = { YIW: 1.1, QDG: 0.95, WEH: 0.9, YNT: 0.92, RZH: 0.97, CAN: 1.2, SZX: 1.22 };

  function makeLines(p: P, mode: string, hub: string, drift: number): { lines: RateLine[]; tiers: RateTier[]; certainty: Certainty } {
    const k = p.price * drift * (hubFactor[hub] ?? 1);
    const cn = p.locale === 'zh';
    const cardCert: Certainty = rng.f() < p.certain ? 'confirmed' : rng.f() < 0.85 ? 'estimated' : 'extra_possible';
    const cert = (base: Certainty = cardCert): Certainty => (base === 'confirmed' && rng.f() > p.certain ? 'estimated' : base);
    const L: RateLine[] = [];
    const add = (segment: Segment, included: boolean, basis: RateLine['basis'], krw: number, min: number | null, c: Certainty, currency: 'KRW' | 'RMB' | 'USD' = 'KRW') => {
      const fx = QP.fx[currency];
      L.push({ segment, included, basis, unitPrice: round((krw * k) / fx, currency === 'KRW' ? 0 : 1), currency, minCharge: min == null ? null : round((min * k) / fx, currency === 'KRW' ? 0 : 1), certainty: c });
    };
    const cnCur = cn ? 'RMB' : 'KRW';
    const t = p.type;
    const tiers: RateTier[] = [];
    if (t === 'customs_broker') {
      add('broker', true, 'per_shipment', rng.int(30, 42) * 1000, null, 'confirmed');
      return { lines: L, tiers, certainty: 'confirmed' };
    }
    if (t === 'fulfillment_3pl') {
      add('kr_warehouse', true, 'per_carton', rng.int(1200, 1700), 30000, 'confirmed');
      add('fc_delivery', true, 'per_pallet', rng.int(38, 48) * 1000, 60000, cert('confirmed'));
      add('return_reserve', true, 'per_carton', rng.int(4, 8) * 100, 10000, 'estimated');
      return { lines: L, tiers, certainty: 'confirmed' };
    }
    const fullChain = t === 'forwarder';
    const cnSide = t !== 'ferry_agent' || rng.chance(0.3);
    add('pickup', cnSide, 'per_cbm', rng.int(8, 12) * 1000, 40000, cert(), cnCur);
    add('cn_warehouse', cnSide, 'per_carton', rng.int(900, 1400), 20000, cert(), cnCur);
    add('export_customs', true, 'per_shipment', rng.int(40, 60) * 1000, null, cert(), cnCur);
    if (mode === 'LCL') add('freight', true, 'per_rt', rng.int(70, 105) * 1000, 90000, cert());
    else if (mode === 'FERRY') {
      add('freight', true, 'per_cbm', rng.int(95, 135) * 1000, 110000, cert());
      tiers.push({ segment: 'freight', minQty: 3, discountBp: 500 }, { segment: 'freight', minQty: 5, discountBp: 1000 }, { segment: 'freight', minQty: 10, discountBp: rng.pick([1500, 1800, 2000]) });
    } else if (mode === 'FCL') add('freight', true, 'per_container', rng.int(1300, 1850) * 1000, null, cert(), cn ? 'USD' : 'KRW');
    else add('freight', true, 'per_chargeable_kg', rng.int(3200, 4600), 150000, cert());
    const portCert: Certainty = rng.chance(0.55) ? 'estimated' : cert();
    if (mode === 'FCL') add('port', true, 'per_container', rng.int(250, 320) * 1000, null, portCert);
    else add('port', true, 'per_rt', rng.int(30, 45) * 1000, 60000, portCert);
    add('broker', fullChain && rng.chance(0.55), 'per_shipment', rng.int(30, 40) * 1000, null, 'confirmed');
    add('kr_warehouse', fullChain || (t === 'consolidator' && rng.chance(0.6)), 'per_carton', rng.int(1200, 1800), 30000, cert());
    add('fc_delivery', fullChain || t === 'air_forwarder', 'per_pallet', rng.int(38, 52) * 1000, 60000, rng.chance(0.3) ? 'extra_possible' : cert());
    add('return_reserve', fullChain && rng.chance(0.5), 'per_carton', rng.int(4, 8) * 100, 10000, 'estimated');
    return { lines: L, tiers, certainty: cardCert };
  }

  for (const p of partners) {
    if (!(p.status === 'official' || p.status === 'pending_verification')) continue;
    const lanes: { hub: string; port: string; mode: string }[] = [];
    for (const hub of p.hubs)
      for (const port of p.ports)
        for (const mode of p.modes) {
          if (mode === 'FERRY' && !SHANDONG.has(hub)) continue;
          lanes.push({ hub, port, mode });
        }
    const maxLanes = freightTypes.has(p.type) ? (p.weight >= 11 ? 14 : p.weight >= 8 ? 8 : p.weight >= 4 ? 5 : 3) : 3;
    const chosen = rng.shuffle(lanes).slice(0, maxLanes);
    chosen.forEach((lane, li) => {
      const cardNo = `RC-${pad(p.idx + 1, 2)}${pad(li + 1, 2)}`;
      const versions = rng.int(3, 5);
      // 현재 판의 모양
      const r = rng.f();
      const shape = r < 0.1 ? 'expired' : r < 0.22 ? 'expiring' : r < 0.32 ? 'fresh' : r < 0.36 ? 'withdrawn' : 'normal';
      let curFrom: number;
      let curTo: number;
      if (shape === 'expired') {
        curTo = todayUtc - rng.int(1, 20) * DAY;
        curFrom = curTo - rng.int(30, 60) * DAY;
      } else if (shape === 'expiring') {
        curTo = todayUtc + rng.int(0, 10) * DAY;
        curFrom = curTo - rng.int(30, 60) * DAY;
      } else if (shape === 'fresh') {
        curFrom = todayUtc;
        curTo = curFrom + rng.int(45, 90) * DAY;
      } else {
        curFrom = todayUtc - rng.int(3, 28) * DAY;
        curTo = curFrom + rng.int(45, 90) * DAY;
      }
      const spans: [number, number][] = [[curFrom, curTo]];
      for (let v = 1; v < versions; v++) {
        const nextFrom = spans[0][0];
        const to = nextFrom - DAY;
        spans.unshift([to - rng.int(30, 55) * DAY, to]);
      }
      let prevId: string | null = null;
      const lineBase = makeLines(p, lane.mode, lane.hub, 1);
      spans.forEach(([from, to], vi) => {
        const isCurrent = vi === spans.length - 1;
        const drift = 1 + (vi - (spans.length - 1)) * rng.range(-0.03, 0.05);
        const { lines, tiers, certainty } = vi === spans.length - 1 ? lineBase : makeLines(p, lane.mode, lane.hub, drift);
        const id = rng.uuid();
        const status = isCurrent && shape === 'withdrawn' ? 'withdrawn' : 'active';
        const md = MODES.find((m) => m.code === lane.mode)!;
        const transit: [number, number] = [md.days_min + rng.int(0, 1), md.days_max + rng.int(0, 2)];
        const createdAt = shape === 'fresh' && isCurrent ? Math.max(Math.min(now - rng.int(1, 5) * HOUR, now), Math.floor(now / DAY) * DAY) /* 자정 직후에도 「오늘」 갱신분이 남게(UTC) */ : from - rng.int(1, 3) * DAY + rng.int(9, 18) * HOUR;
        cards.push({ id, partner: p, hub: lane.hub, port: lane.port, mode: lane.mode, from, to, lines, tiers, transit, status, current: isCurrent, certainty });
        T.cards.add(
          id, p.id, cardNo, vi + 1, prevId, lane.hub, lane.port, lane.mode, ymd((from - todayUtc) / DAY), ymd((to - todayUtc) / DAY),
          certainty, p.deviation > 0.05 || rng.chance(0.15), isCurrent ? rng.chance(0.65) : rng.chance(0.3),
          transit[0], transit[1], status,
          vi === 0 ? '첫 등록' : status === 'withdrawn' ? '선복 부족으로 거둠' : rng.pick(['유효기간 연장', '운임 조정', '항만 요금 반영', '환율 반영', '할인표 추가']),
          p.people[0]?.id ?? null, ts(createdAt),
        );
        for (const l of lines) T.lines.add(id, l.segment, l.included, l.basis, l.unitPrice, l.currency, l.minCharge ?? null, l.certainty);
        for (const tr of tiers) T.tiers.add(id, tr.segment, tr.minQty, tr.discountBp);
        prevId = id;
      });
    });
  }

  const freightCards = cards.filter((c) => freightTypes.has(c.partner.type));
  function cardsFor(hub: string, port: string, mode: string | null, at: number, traits: string[]) {
    return freightCards.filter(
      (c) =>
        c.hub === hub && c.port === port && (mode == null || c.mode === mode) && c.from <= at && c.to + DAY > at && c.status === 'active' &&
        traits.every((t) => {
          if (t === 'dg') return c.partner.caps.includes('dg') && c.mode !== 'AIR' && c.mode !== 'FERRY';
          if (t === 'battery') return c.partner.caps.includes('battery') && c.mode !== 'AIR';
          if (t === 'liquid') return c.partner.caps.includes('liquid');
          return true;
        }),
    );
  }

  // 요청·응찰·예약·선적 ------------------------------------------------------
  let reqSeq = 0;
  let bidSeq = 0;
  let bkSeq = 0;
  let shSeq = 0;
  let ivSeq = 0;
  const usedReview = new Set<string>();
  const fcWeights = FC_CENTERS.map((f) => (f.code === 'FC-ICH' || f.code === 'FC-DPG' ? 3 : f.code === 'FC-DGU' || f.code === 'FC-CWN' || f.code === 'FC-GWJ' ? 0.6 : 1.5));
  const notif: { user: string; org: string; kind: string; title: string; body: string; link: string; at: number }[] = [];

  interface ReqCtx {
    id: string;
    no: string;
    shipper: S;
    sku: Sku;
    cargo: Cargo;
    traits: string[];
    hub: string;
    port: string;
    mode: string | null;
    fc: string;
    created: number;
    deadline: number;
  }

  function newRequest(shipper: S, created: number, deadlineH: number, opt: { hub?: string; mode?: string | null } = {}): ReqCtx | null {
    for (let tries = 0; tries < 12; tries++) {
      const sku = rng.pick(shipper.skus);
      const hub = opt.hub ?? rng.pick(shipper.hubs);
      const port = SHANDONG.has(hub) ? rng.pick(['PTK', 'ICN', 'ICN']) : 'ICN';
      const scale = rng.range(0.6, 1.6);
      const units = Math.max(50, Math.round((sku.units * scale) / 50) * 50);
      const cargo: Cargo = {
        units,
        cartons: Math.max(1, Math.ceil(units / sku.preset.perCarton)),
        kg: round(sku.kg * (units / sku.units), 1),
        cbm: Math.max(0.3, round(sku.cbm * (units / sku.units), 2)),
        goodsValue: Math.round((sku.goods * (units / sku.units)) / 10) * 10,
        goodsCurrency: 'RMB',
      };
      const traits = [...sku.preset.traits];
      const mode = opt.mode !== undefined ? opt.mode : rng.chance(0.35) ? null : rng.pick(SHANDONG.has(hub) ? ['LCL', 'FERRY', 'FERRY', 'LCL'] : ['LCL', 'LCL', 'FCL', 'AIR']);
      const effMode = mode === 'FCL' && cargo.cbm < 12 ? 'LCL' : mode;
      const cand = cardsFor(hub, port, effMode, created, traits);
      if (cand.length === 0 && tries < 11) continue;
      const fc = rng.weighted(FC_CENTERS, fcWeights).code;
      reqSeq++;
      return { id: rng.uuid(), no: `RQ-${yymm(created)}-${pad(reqSeq)}`, shipper, sku, cargo, traits, hub, port, mode: effMode, fc, created, deadline: created + deadlineH * HOUR };
    }
    return null;
  }

  function writeRequest(r: ReqCtx, status: 'open' | 'selected' | 'cancelled', note: string | null = null) {
    const hubName = HUBS.find((h) => h.code === r.hub)!.name_ko;
    const portName = r.port === 'ICN' ? '인천' : '평택';
    T.reqs.add(
      r.id, r.shipper.id, r.no, `${r.sku.name} ${r.cargo.units.toLocaleString('en-US')}개 · ${hubName}→${portName}`, r.sku.id,
      r.cargo.units, r.cargo.cartons, r.cargo.kg, r.cargo.cbm, r.cargo.goodsValue, 'RMB', r.sku.preset.hs, r.traits,
      r.hub, r.port, r.mode, r.fc, ymd(Math.round((r.created - todayUtc) / DAY) + rng.int(3, 10)), ts(r.deadline), status, note,
      r.shipper.people[0].id, ts(r.created),
    );
    T.reqEvents.add(r.id, 'created', '견적 요청을 올렸습니다', r.shipper.people[0].id, ts(r.created));
  }

  interface BidCtx {
    id: string;
    card: CardV;
    amounts: Record<string, number | null>;
    total: number;
    confirmed: number;
    created: number;
  }

  function makeBids(r: ReqCtx, n: number, latest: number, prefer?: P): BidCtx[] {
    let cand = cardsFor(r.hub, r.port, r.mode, r.created, r.traits);
    const seen = new Set<string>();
    cand = rng.shuffle(cand).filter((c) => (seen.has(c.partner.id) ? false : (seen.add(c.partner.id), true)));
    if (prefer) {
      const i = cand.findIndex((c) => c.partner.id === prefer.id);
      if (i > 0) cand.unshift(...cand.splice(i, 1));
    }
    const out: BidCtx[] = [];
    for (const card of cand.slice(0, n)) {
      const q = computeQuote(card.lines, r.cargo, QP, card.tiers);
      const adjusted = rng.chance(0.4);
      const amounts: Record<string, number | null> = {};
      const certs: Record<string, string | null> = {};
      let total = 0;
      let confirmed = 0;
      for (const s of q.segments) {
        let a = s.amount;
        if (a != null && adjusted && s.segment === 'freight') a = Math.round((a * rng.range(0.9, 1.02)) / 100) * 100;
        amounts[s.segment] = a;
        certs[s.segment] = s.certainty;
        if (a != null) {
          total += a;
          if (s.certainty === 'confirmed') confirmed += a;
        }
      }
      const respH = Math.min(Math.exp(rng.normal(Math.log(7), 0.8)), 40);
      const created = Math.min(r.created + respH * HOUR, latest - 10 * 60_000);
      if (created <= r.created) continue;
      bidSeq++;
      const id = rng.uuid();
      const person = card.partner.people[0]?.id ?? null;
      T.bids.add(
        id, r.id, card.partner.id, `BD-${yymm(created)}-${pad(bidSeq, 5)}`, 1, null, card.id, adjusted ? 'adjusted' : 'auto', card.mode,
        JSON.stringify(amounts), JSON.stringify(certs), total, confirmed, card.transit[0], card.transit[1], ts(r.deadline + 7 * DAY),
        'submitted', adjusted ? rng.pick(['물량 보고 운임 조정했습니다.', '다음 항차 선복 확보 기준입니다.', 'FC 예약까지 포함한 금액입니다.']) : null,
        person, ts(created),
      );
      T.reqEvents.add(r.id, 'bid', `${card.partner.name} 응찰`, person, ts(created));
      out.push({ id, card, amounts, total, confirmed, created });
      if (r.shipper.key === 'livingmoa' || rng.chance(0.15)) {
        notif.push({ user: r.shipper.people[0].id, org: r.shipper.id, kind: 'bid_arrived', title: `응찰 도착 — ${r.no}`, body: `${card.partner.name}: ${total.toLocaleString('ko-KR')}원`, link: `/app/requests/${r.id}`, at: created });
      }
    }
    return out;
  }

  /** 같은 조건(빈 구간을 참고치로 채운 합계)으로 견주고, 거래가 많은 곳이 더 자주 뽑히게 */
  function choose(bids: BidCtx[], r: ReqCtx): BidCtx {
    const ref = computeQuote(REFERENCE_LINES, r.cargo, QP);
    const full = bids.map((b) => b.total + ref.segments.reduce((sum, s) => sum + (b.amounts[s.segment] == null ? s.amount ?? 0 : 0), 0));
    const min = Math.min(...full);
    const w = bids.map((b, i) => Math.exp(-(full[i] / min - 1) * 3) * b.card.partner.weight ** 2 * b.card.partner.onTime ** 2);
    return rng.weighted(bids, w);
  }

  const TRANSIT_TOTAL: Record<string, [number, number]> = { LCL: [15, 21], FERRY: [8, 12], FCL: [16, 23], AIR: [5, 8] };

  function book(r: ReqCtx, bid: BidCtx, at: number, targetStage: number | null) {
    bkSeq++;
    const bookingId = rng.uuid();
    const person = r.shipper.people[0].id;
    T.bookings.add(bookingId, `BK-${yymm(at)}-${pad(bkSeq)}`, r.id, bid.id, r.shipper.id, bid.card.partner.id, person, ts(at));
    T.reqEvents.add(r.id, 'selected', `${bid.card.partner.name} 선택 · 예약 전환`, person, ts(at));
    const p = bid.card.partner;
    const [tmin, tmax] = TRANSIT_TOTAL[bid.card.mode];
    const planned = rng.int(tmin, tmax);
    const eta = at + planned * DAY;
    const late = rng.f() > p.onTime ? rng.int(1, 4) : 0;
    const deliveredMs = late ? eta + late * DAY : eta - rng.int(0, 20) * HOUR;
    let stage: number;
    let delivered: number | null = null;
    if (targetStage == null) {
      if (deliveredMs <= now - 2 * HOUR) {
        stage = 9;
        delivered = deliveredMs;
      } else stage = Math.max(1, Math.min(8, Math.floor(((now - at) / (deliveredMs - at)) * 9)));
    } else {
      stage = targetStage;
      if (stage === 9) delivered = Math.min(deliveredMs, now - rng.int(3, 200) * HOUR);
    }
    const end = delivered ?? now;
    const stageTimes: number[] = [];
    for (let s = 1; s <= stage; s++) {
      const frac = (s - 1) / 8;
      stageTimes[s] = s === 9 && delivered ? delivered : at + frac * ((delivered ?? Math.max(end, at + (stage - 1) * 0.9 * DAY)) - at);
      if (targetStage != null && s === stage && !delivered) stageTimes[s] = Math.min(stageTimes[s], now - rng.int(1, 20) * HOUR);
    }
    const returned = stage === 9 && rng.chance(0.12) ? Math.max(1, Math.round(((r.cargo.units * p.returnRate) / 0.12) * rng.range(0.5, 1.5))) : 0;
    if (stage === 9 && delivered && delivered > now - 30 * DAY) {
      p.units30 += r.cargo.units;
      p.returned30 += Math.min(returned, r.cargo.units);
    }
    shSeq++;
    const shipId = rng.uuid();
    const etd = at + Math.round(planned * 0.3) * DAY;
    T.ships.add(
      shipId, `SH-${yymm(at)}-${pad(shSeq)}`, bookingId, r.shipper.id, p.id, r.hub, r.port, bid.card.mode, r.fc,
      r.cargo.units, r.cargo.cartons, r.cargo.kg, r.cargo.cbm, stage, ymd(Math.floor((etd - todayUtc) / DAY)),
      kstYmd(eta), delivered ? ts(delivered) : null, Math.min(returned, r.cargo.units), ts(at),
    );
    const raw = p.locale === 'zh' ? RAW_STATUS_ZH : RAW_STATUS_KO;
    const partnerPerson = p.people[0]?.id ?? null;
    for (let s = 1; s <= stage; s++) {
      const t = Math.min(stageTimes[s], now - 30 * 60_000);
      T.events.add(shipId, s, raw[s], s === 9 && returned > 0 ? `회송 ${returned}개` : null, ts(t), s === 1 ? person : partnerPerson, ts(t));
    }
    if (stage >= 4) T.docs.add(shipId, p.id, 'commercial_invoice', `CI_${r.no}.pdf`, rng.int(80, 400) * 1000, partnerPerson, ts(stageTimes[4]));
    if (stage >= 4) T.docs.add(shipId, p.id, 'packing_list', `PL_${r.no}.xlsx`, rng.int(20, 90) * 1000, partnerPerson, ts(stageTimes[4]));
    if (stage >= 5) T.docs.add(shipId, p.id, 'bl', `BL_${r.no}.pdf`, rng.int(60, 200) * 1000, partnerPerson, ts(stageTimes[5]));
    if (stage >= 7) T.docs.add(shipId, p.id, 'import_declaration', `수입신고필증_${r.no}.pdf`, rng.int(60, 200) * 1000, partnerPerson, ts(stageTimes[7]));
    return { shipId, stage, delivered, eta, returned, p, stageTimes, bookingId, at };
  }

  function invoice(ship: ReturnType<typeof book>, bid: BidCtx, forceDev?: number) {
    const p = ship.p;
    const dev = forceDev ?? Math.max(-0.02, rng.normal(p.deviation, Math.max(0.004, Math.abs(p.deviation) * 0.35)));
    const amounts: Record<string, number | null> = { ...bid.amounts };
    const delta = Math.round((bid.total * dev) / 100) * 100;
    const target = amounts.port != null ? 'port' : 'freight';
    if (amounts.fc_delivery != null && rng.chance(0.5)) {
      const half = Math.round(delta / 2 / 100) * 100;
      amounts.fc_delivery = Math.max(0, (amounts.fc_delivery as number) + half);
      amounts[target] = Math.max(0, (amounts[target] as number) + delta - half);
    } else amounts[target] = Math.max(0, (amounts[target] as number) + delta);
    const total = SEGMENTS.reduce((s, k) => s + ((amounts[k] as number | null) ?? 0), 0);
    ivSeq++;
    const issued = (ship.delivered ?? now) + rng.int(0, 3) * DAY;
    const issuedAt = Math.min(issued, now - HOUR);
    const no = `IV-${yymm(issuedAt)}-${pad(ivSeq)}`;
    const person = p.people[0]?.id ?? null;
    let prev: string | null = null;
    if (rng.chance(0.06)) {
      // 정정 전 판 — 더 비쌌다가 정정
      const v1 = rng.uuid();
      const a1 = { ...amounts, port: ((amounts.port as number) ?? 0) + 30000 };
      const t1 = total + 30000;
      T.invoices.add(v1, no, 1, null, ship.shipId, p.id, JSON.stringify(a1), t1, '첫 발행', ymd(Math.floor((issuedAt - todayUtc) / DAY)), person, ts(issuedAt - 6 * HOUR));
      prev = v1;
    }
    T.invoices.add(rng.uuid(), no, prev ? 2 : 1, prev, ship.shipId, p.id, JSON.stringify(amounts), total, prev ? '항만 작업비 중복 청구 정정' : null, ymd(Math.floor((issuedAt - todayUtc) / DAY)), person, ts(issuedAt));
    return { total, dev: (total - bid.total) / bid.total, at: issuedAt, no };
  }

  function review(ship: ReturnType<typeof book>, r: ReqCtx, dev: number, at: number) {
    at = Math.min(at, reviewCeil); // 후기는 오늘(KST) 이후 날짜가 되지 않게 — 지금보다 한 시간 앞, 오늘 KST 끝을 넘지 않게
    const p = ship.p;
    const late = ship.delivered != null && ship.delivered > ship.eta + DAY;
    let score = 5 - (late ? 1.2 : 0) - Math.abs(dev) * 14 - (ship.returned > 0 ? 1 : 0) + rng.normal(0, 0.5);
    score = Math.max(1, Math.min(5, Math.round(score)));
    const body = reviewText(rng, score, r.sku.name, usedReview);
    const hubName = HUBS.find((h) => h.code === r.hub)!.name_ko;
    T.reviews.add(ship.shipId, r.shipper.id, p.id, score, !late, Math.abs(dev) < 0.03, body, `${r.shipper.category} 셀러 · ${hubName}→${r.port === 'ICN' ? '인천' : '평택'}`, r.shipper.people[0].id, ts(at));
  }

  // 과거 — 120일 전 ~ 31일 전 ------------------------------------------------
  const DOW = [0.35, 1.25, 1.2, 1.1, 1.05, 0.95, 0.5]; // 일~토
  const shipperWeights = shippers.map((s) => s.weight);
  for (let d = 120; d >= 31; d--) {
    const dayMs = todayUtc - d * DAY;
    const dow = new Date(dayMs + 9 * HOUR).getUTCDay();
    const n = Math.max(0, Math.round(9.5 * DOW[dow] * (1 + (120 - d) / 300) + rng.normal(0, 1.2)));
    for (let i = 0; i < n; i++) {
      const s = rng.weighted(shippers, shipperWeights);
      const created = dayMs + rng.int(0, 10) * HOUR + rng.int(0, 59) * 60_000; // KST 9시~19시
      const r = newRequest(s, created, rng.int(48, 96));
      if (!r) continue;
      const roll = rng.f();
      if (roll < 0.06) {
        writeRequest(r, 'cancelled', rng.pick(['상품 출고 일정이 밀렸습니다.', '다른 경로로 보냈습니다.', '수량이 바뀌어 새로 올립니다.']));
        T.reqEvents.add(r.id, 'cancelled', '요청을 취소했습니다', r.shipper.people[0].id, ts(r.created + rng.int(2, 30) * HOUR));
        continue;
      }
      const bids = makeBids(r, rng.int(2, 6), r.deadline);
      if (bids.length === 0 || roll < 0.2) {
        writeRequest(r, 'open');
        continue; // 만료(응찰 없음 / 비교만 하고 선택 안 함)
      }
      writeRequest(r, 'selected');
      const chosen = choose(bids, r);
      const at = r.deadline + rng.int(1, 30) * HOUR;
      const ship = book(r, chosen, at, null);
      if (ship.stage === 9) chosen.card.partner.delivered++;
      if (ship.stage === 9 || ship.stage >= 8) {
        const inv = invoice(ship, chosen);
        if (ship.stage === 9 && rng.chance(0.55)) review(ship, r, inv.dev, inv.at + rng.int(1, 5) * DAY);
        if (Math.abs(inv.dev) > 0.07 && rng.chance(0.5)) {
          T.exceptions.add(ship.shipId, 'billing_deviation', EXCEPTION_NOTES.billing_deviation[0], ts(inv.at + DAY), ts(inv.at + 4 * DAY), '근거 자료 받고 확인', r.shipper.people[0].id);
        }
      }
      if (ship.returned > 0) {
        T.exceptions.add(ship.shipId, 'fc_rejected', rng.pick(EXCEPTION_NOTES.fc_rejected), ts((ship.delivered ?? now) - 6 * HOUR), ts((ship.delivered ?? now) + 2 * DAY), '라벨 재작업 후 재입고', ship.p.people[0]?.id ?? null);
      }
    }
  }

  // 지금 도는 선적 52건 — 단계 분포를 맞춘다 --------------------------------------
  const stagePlan = [1, 1, 2, 2, ...Array(6).fill(3), ...Array(6).fill(4), ...Array(7).fill(5), ...Array(6).fill(6), ...Array(6).fill(7), ...Array(6).fill(8), ...Array(11).fill(9)];
  const hanbada = byKey.get('hanbada')!;
  const livingmoa = shipperByKey.get('livingmoa')!;
  const exceptionPlan: Record<number, string> = {};
  const current: { ship: ReturnType<typeof book>; r: ReqCtx; bid: BidCtx }[] = [];
  stagePlan.forEach((stage, i) => {
    const shipper = i % 3 === 0 ? livingmoa : rng.weighted(shippers, shipperWeights);
    const elapsed = stage === 9 ? rng.range(9, 24) : 0.8 + stage * rng.range(1.0, 1.8);
    const bookedAt = now - elapsed * DAY;
    const created = bookedAt - rng.range(2.5, 4.5) * DAY;
    const wantHanbada = i % 3 === 1;
    const r = newRequest(shipper, created, rng.int(48, 72), wantHanbada ? { hub: rng.pick(['YIW', 'QDG', 'WEH']) } : {});
    if (!r) return;
    const bids = makeBids(r, rng.int(3, 6), r.deadline, wantHanbada ? hanbada : undefined);
    if (bids.length === 0) return;
    writeRequest(r, 'selected');
    const chosen = wantHanbada && bids.find((b) => b.card.partner.id === hanbada.id) ? bids.find((b) => b.card.partner.id === hanbada.id)! : choose(bids, r);
    const ship = book(r, chosen, Math.min(bookedAt, now - 2 * HOUR), stage);
    if (stage === 9) chosen.card.partner.delivered++;
    current.push({ ship, r, bid: chosen });
  });
  // 예외 다섯 가지를 꼭 넣는다
  const pickShip = (pred: (c: (typeof current)[number]) => boolean) => current.find((c) => pred(c) && !exceptionPlan[current.indexOf(c)]);
  const exMap: [string, (c: (typeof current)[number]) => boolean][] = [
    ['customs_hold', (c) => c.ship.stage === 7],
    ['inspection', (c) => c.ship.stage === 6],
    ['fc_rejected', (c) => c.ship.stage === 8],
    ['ferry_cancelled', (c) => c.ship.stage === 5 && c.bid.card.mode === 'FERRY'],
    ['billing_deviation', (c) => c.ship.stage === 9],
  ];
  for (const [kind, pred] of exMap) {
    const c = pickShip(pred) ?? pickShip((x) => x.ship.stage >= 5);
    if (!c) continue;
    exceptionPlan[current.indexOf(c)] = kind;
  }
  current.forEach((c, i) => {
    const kind = exceptionPlan[i];
    let dev: number | undefined;
    if (kind) {
      const opened = Math.min((c.ship.stageTimes[c.ship.stage] ?? now) + 2 * HOUR, now - HOUR);
      const note = rng.pick(EXCEPTION_NOTES[kind]);
      const resolved = kind === 'ferry_cancelled' && rng.chance(0.5) ? ts(opened + DAY) : null;
      T.exceptions.add(c.ship.shipId, kind, note, ts(opened), resolved, resolved ? '대체 항차 확정' : null, c.ship.p.people[0]?.id ?? null);
      const users = [c.r.shipper.people[0].id, ...(c.ship.p.people[0] ? [c.ship.p.people[0].id] : [])];
      for (const u of users) notif.push({ user: u, org: u === users[0] ? c.r.shipper.id : c.ship.p.id, kind: 'exception', title: `예외 발생 — ${c.r.no}`, body: note, link: u === users[0] ? `/app/shipments/${c.ship.shipId}` : `/partner/shipments/${c.ship.shipId}`, at: opened });
      if (kind === 'billing_deviation') dev = 0.09;
    }
    if (c.ship.stage === 9 || (c.ship.stage === 8 && rng.chance(0.4))) {
      if (c.ship.stage === 9 && i % 4 === 3 && kind !== 'billing_deviation') return; // 청구 대기
      const inv = invoice(c.ship, c.bid, dev);
      notif.push({ user: c.r.shipper.people[0].id, org: c.r.shipper.id, kind: 'invoice_arrived', title: `청구서 도착 — ${inv.no}`, body: `${c.ship.p.name} · ${inv.total.toLocaleString('ko-KR')}원 (응찰 대비 ${(inv.dev * 100).toFixed(1)}%)`, link: `/app/shipments/${c.ship.shipId}`, at: inv.at });
      if (c.ship.stage === 9 && i % 2 === 0) review(c.ship, c.r, inv.dev, Math.min(inv.at + DAY, now - HOUR));
    }
    if (c.ship.stage >= 2) {
      notif.push({ user: c.r.shipper.people[0].id, org: c.r.shipper.id, kind: 'status', title: `상태 갱신 — ${c.r.no}`, body: `${c.ship.stage}단계로 넘어갔습니다`, link: `/app/shipments/${c.ship.shipId}`, at: c.ship.stageTimes[c.ship.stage] ?? now });
    }
    if (c.ship.p.people[0]) notif.push({ user: c.ship.p.people[0].id, org: c.ship.p.id, kind: 'booking', title: `예약 확정 — ${c.r.no}`, body: `${c.r.shipper.name} · ${c.r.cargo.cbm} CBM`, link: `/partner/shipments/${c.ship.shipId}`, at: c.ship.at });
  });

  // 최근 견적 요청 40건 — 화면 상태가 고루 나오게 ----------------------------------
  const plan: [string, number][] = [
    ['waiting', 5], ['bidding', 8], ['closing_soon', 5], ['comparable', 7], ['selected', 8], ['expired', 4], ['cancelled', 3],
  ];
  let pi = 0;
  for (const [state, count] of plan) {
    for (let k = 0; k < count; k++, pi++) {
      const shipper = pi % 3 === 0 ? livingmoa : rng.weighted(shippers, shipperWeights);
      const hanbadaLane = pi % 4 === 1 ? { hub: rng.pick(['YIW', 'QDG', 'WEH', 'CAN']) } : {};
      let created: number;
      let deadlineH: number;
      switch (state) {
        case 'waiting': created = now - rng.range(2, 10) * HOUR; deadlineH = rng.range(40, 70) + (now - created) / HOUR; break;
        case 'bidding': created = now - rng.range(14, 30) * HOUR; deadlineH = (now - created) / HOUR + rng.range(28, 60); break;
        case 'closing_soon': created = now - rng.range(40, 60) * HOUR; deadlineH = (now - created) / HOUR + rng.range(2, 20); break;
        case 'comparable': created = now - rng.range(4, 6) * DAY; deadlineH = (now - created) / HOUR - rng.range(20, 60); break;
        case 'selected': created = now - rng.range(4.5, 7) * DAY; deadlineH = rng.range(48, 60); break;
        case 'expired': created = now - rng.range(9, 16) * DAY; deadlineH = rng.range(48, 72); break;
        default: created = now - rng.range(1, 6) * DAY; deadlineH = rng.range(48, 72);
      }
      const r = newRequest(shipper, created, deadlineH, hanbadaLane);
      if (!r) continue;
      if (state === 'cancelled') {
        writeRequest(r, 'cancelled', '출고일이 밀려 다음 달로 미룹니다.');
        T.reqEvents.add(r.id, 'cancelled', '요청을 취소했습니다', r.shipper.people[0].id, ts(Math.min(r.created + 6 * HOUR, now)));
        continue;
      }
      const nb = state === 'waiting' ? 0 : state === 'expired' ? (k < 2 ? 0 : rng.int(2, 4)) : state === 'comparable' ? rng.int(3, 6) : rng.int(1, 4);
      const bids = nb > 0 ? makeBids(r, nb, Math.min(r.deadline, now), pi % 4 === 1 ? hanbada : undefined) : [];
      if (state === 'selected' && bids.length > 0) {
        writeRequest(r, 'selected');
        const chosen = choose(bids, r);
        const ship = book(r, chosen, Math.min(r.deadline + rng.int(1, 12) * HOUR, now - HOUR), k < 4 ? 1 : 2);
        if (ship.p.people[0]) notif.push({ user: ship.p.people[0].id, org: ship.p.id, kind: 'booking', title: `예약 확정 — ${r.no}`, body: `${r.shipper.name} · ${r.cargo.cbm} CBM`, link: `/partner/shipments/${ship.shipId}`, at: ship.at });
        continue;
      }
      writeRequest(r, 'open');
      if (state === 'closing_soon') {
        notif.push({ user: r.shipper.people[0].id, org: r.shipper.id, kind: 'deadline_soon', title: `마감 임박 — ${r.no}`, body: `응찰 ${bids.length}건 · 마감까지 ${Math.max(1, Math.round((r.deadline - now) / HOUR))}시간`, link: `/app/requests/${r.id}`, at: r.deadline - 24 * HOUR });
      }
      if ((state === 'waiting' || state === 'bidding' || state === 'closing_soon') && hanbada.hubs.includes(r.hub)) {
        notif.push({ user: demoIds.partner, org: hanbada.id, kind: state === 'closing_soon' ? 'deadline_soon' : 'system', title: state === 'closing_soon' ? `응찰 마감 임박 — ${r.no}` : `새 견적 요청 — ${r.no}`, body: `${HUBS.find((h) => h.code === r.hub)!.name_ko}→${r.port === 'ICN' ? '인천' : '평택'} · ${r.cargo.cbm} CBM`, link: `/partner/inbox/${r.id}`, at: state === 'closing_soon' ? r.deadline - 24 * HOUR : r.created + HOUR });
      }
    }
  }

  // 알림 200건 --------------------------------------------------------------
  notif.sort((a, b) => b.at - a.at);
  const demoFirst = [
    ...notif.filter((n) => n.user === demoIds.shipper || n.user === demoIds.partner),
    ...notif.filter((n) => n.user !== demoIds.shipper && n.user !== demoIds.partner),
  ].slice(0, 200);
  demoFirst.forEach((n, i) => {
    const at = Math.min(n.at, now - 60_000);
    T.notifs.add(n.user, n.org, n.kind, n.title, n.body, n.link, i % 5 < 2 && now - at < 2 * DAY ? null : rng.chance(0.75) ? ts(at + rng.int(1, 20) * HOUR) : null, ts(at));
  });
  for (let i = demoFirst.length; i < 200; i++) {
    T.notifs.add(demoIds.admin, platformId, 'system', `처리 대기 — ${['인증 요청', '게시 삭제 요청', '등급 재평가'][i % 3]}`, '운영 큐를 확인해 주세요.', '/admin/queues', null, ts(now - i * 3 * HOUR));
  }

  // 운영 기록 --------------------------------------------------------------
  const fcRule = setting<{ minFcInbound: number; maxReturnRate30d: number }>('fc_ready_rule');
  // 판정 근거는 방금 만든 선적 기록에서 센다(v_partner_metrics 와 같은 정의).
  for (const p of partners) {
    if (p.status !== 'official' || !freightTypes.has(p.type)) continue;
    const rate30 = p.units30 > 0 ? Math.round((p.returned30 / p.units30) * 10000) / 10000 : null;
    const ok = isFcReady(p.delivered, rate30, fcRule);
    T.grades.add(p.id, 'fc_ready', ok, JSON.stringify({ fcInbound: p.delivered, returnRate30d: rate30, rule: fcRule }), ok ? '기준 충족' : '기준 미달', demoIds.admin, ts(now - rng.int(1, 6) * DAY));
    T.audit.add(demoIds.admin, p.id, ok ? 'grade.granted' : 'grade.denied', `grade:fc_ready`, JSON.stringify({ fcInbound: p.delivered }), ts(now - rng.int(1, 6) * DAY));
  }
  const lanlan = byKey.get('lanlan')!;
  T.grades.add(lanlan.id, 'fc_ready', true, JSON.stringify({ fcInbound: 64, returnRate30d: 0.031 }), '기준 충족(지난 분기)', demoIds.admin, ts(now - 70 * DAY));

  for (const p of partners.filter((x) => x.status === 'pending_verification')) {
    T.verif.add(p.id, p.people[0]?.name ?? '담당자', `${p.key}.admin@demo.fcdochak.example`, p.phone, '사업자등록증·주선업 등록증 첨부합니다.', 'pending', null, null, null, ts(now - rng.int(1, 9) * DAY));
  }
  const approved = byKey.get('bluewave')!;
  T.verif.add(approved.id, '홍채원', 'bluewave.admin@demo.fcdochak.example', approved.phone, '담당자 인증 요청', 'approved', ts(now - 80 * DAY), demoIds.admin, '서류 확인 완료', ts(now - 82 * DAY));
  const pubInfo = partners.filter((x) => x.status === 'public_info');
  T.verif.add(pubInfo[0].id, '서진우', `${pubInfo[0].key}.contact@demo.fcdochak.example`, null, '저희 회사 담당자입니다. 요금표를 올리고 싶습니다.', 'pending', null, null, null, ts(now - 2 * DAY));
  for (const p of partners.filter((x) => x.status === 'deletion_requested')) {
    T.deletions.add(p.id, '대표자', `${p.key}.ceo@demo.fcdochak.example`, '폐업 예정이라 게시를 내려 주세요.', 'pending', ts(now - rng.int(1, 5) * DAY));
  }
  T.ads.add(hanbada.id, 'YIW', 'ICN', ymd(-10), ymd(20), 'active', demoIds.admin, ts(now - 11 * DAY));
  T.ads.add(byKey.get('yuelan')!.id, 'CAN', 'ICN', ymd(-5), ymd(25), 'active', demoIds.admin, ts(now - 6 * DAY));
  T.ads.add(byKey.get('koreasea')!.id, 'QDG', 'ICN', ymd(-60), ymd(-30), 'ended', demoIds.admin, ts(now - 61 * DAY));
  T.audit.add(demoIds.admin, approved.id, 'verification.approved', 'org:bluewave', JSON.stringify({ note: '서류 확인 완료' }), ts(now - 80 * DAY));
  T.audit.add(demoIds.admin, hanbada.id, 'ad.created', 'lane:YIW-ICN', JSON.stringify({ days: 30 }), ts(now - 11 * DAY));
  T.audit.add(demoIds.admin, byKey.get('nuri')!.id, 'related_party.disclosed', 'org:nuri', JSON.stringify({ note: PARTNERS.find((p) => p.key === 'nuri')!.related }), ts(now - 40 * DAY));

  // v2 trust — 회송·입고 반려·분실(미도착)로 끝난 선적과 그 후기, 업체 공개 답변 -------------------
  // 앞 자료의 난수 순서를 흔들지 않게 따로 된 난수를 쓴다(요청·응찰·선적 번호만 이어서 매긴다).
  // 회송(9단계 + 회송 수량)으로 끝난 선적의 후기는 위에서 이미 생긴다 — outcome 을 비워 두면 읽을 때 선적 기록으로 채운다.
  {
    const tr = new Rng(DEMO_SEED ^ 0x7e57);
    const trustReviews = new Table('reviews', ['id', 'shipment_id', 'shipper_org_id', 'partner_org_id', 'rating', 'on_time_ok', 'billing_ok', 'body', 'author_label', 'created_by', 'created_at::timestamptz', 'outcome']);
    const replies = new Table('review_replies', ['id', 'review_id', 'partner_org_id', 'version', 'supersedes_id', 'body', 'created_by', 'created_at::timestamptz']);
    const LOST_TEXT = [
      '출항했다는 연락 뒤로 FC 도착 예정일이 한참 지났는데 화물 위치를 아무도 모릅니다. 분실 신고 절차만 안내받았습니다.',
      '도착 예정일에서 3주가 지나도록 입고가 안 됐습니다. 중간 창고에서 박스가 사라졌다고 하는데 보상 기준 안내가 늦었습니다.',
    ];
    const REJECT_TEXT = [
      'FC 에서 바코드 라벨 위치 때문에 반려됐습니다. 재작업 비용을 누가 낼지 정리가 안 돼 입고가 일주일 넘게 늦어지고 있습니다.',
      '박스 중량 초과로 입고 반려가 났습니다. 출고 전 계근을 해 달라고 부탁했는데 확인이 안 됐던 것 같습니다.',
    ];
    const REPLY_TEXT: Record<string, string[]> = {
      lost: [
        '불편을 드려 죄송합니다. 중간 창고 CCTV 와 인수 기록을 확인하고 있으며, 적하보험 청구 서류는 담당자가 오늘 안에 보내 드리겠습니다.',
        '현지 창고 출고 기록까지는 확인됐고 이후 구간을 운송사와 함께 추적 중입니다. 결과와 보상 절차를 이번 주 안에 문서로 드리겠습니다.',
      ],
      fc_rejected: [
        '반려 원인은 저희 재포장 조의 라벨 위치 실수였습니다. 재작업 비용은 저희가 부담하고 재입고 예약을 잡았습니다.',
        '출고 전 계근 기록을 다시 보니 두 박스가 기준을 넘었습니다. 나눠 담는 비용은 받지 않고 재입고까지 맡겠습니다.',
      ],
    };
    const REPLY_V2 = '재입고 예약이 확정됐습니다(내일 오전). 재작업·재입고 비용은 청구서에서 빼고 새 판으로 다시 보내 드렸습니다.';
    const plan: { kind: 'lost' | 'fc_rejected'; stage: number; ago: number; hanbada: boolean; shipper: S; review: boolean }[] = [
      { kind: 'lost', stage: 6, ago: 46, hanbada: true, shipper: tr.weighted(shippers, shipperWeights), review: true },
      { kind: 'fc_rejected', stage: 8, ago: 27, hanbada: true, shipper: tr.weighted(shippers, shipperWeights), review: true },
      { kind: 'lost', stage: 5, ago: 52, hanbada: false, shipper: tr.weighted(shippers, shipperWeights), review: true },
      { kind: 'fc_rejected', stage: 8, ago: 25, hanbada: false, shipper: tr.weighted(shippers, shipperWeights), review: true },
      // 데모 화주가 직접 평가해 볼 수 있게 — 평가를 남기지 않은 분실·미도착 선적
      { kind: 'lost', stage: 6, ago: 44, hanbada: true, shipper: livingmoa, review: false },
    ];
    const used: Record<string, number> = {};
    for (const it of plan) {
      const bookedAt = now - it.ago * DAY;
      const r = newRequest(it.shipper, bookedAt - 3 * DAY, 60, { hub: it.hanbada ? tr.pick(['YIW', 'QDG']) : undefined, mode: 'LCL' });
      if (!r) continue;
      const bids = makeBids(r, 3, r.deadline, it.hanbada ? hanbada : undefined);
      if (bids.length === 0) continue;
      writeRequest(r, 'selected');
      const chosen = (it.hanbada && bids.find((b) => b.card.partner.id === hanbada.id)) || choose(bids, r);
      const ship = book(r, chosen, Math.min(r.deadline + 6 * HOUR, bookedAt), it.stage);
      const partnerPerson = ship.p.people[0]?.id ?? null;
      if (it.kind === 'fc_rejected') {
        const opened = Math.min((ship.stageTimes[ship.stage] ?? now) + 2 * HOUR, now - 2 * DAY);
        T.exceptions.add(ship.shipId, 'fc_rejected', tr.pick(EXCEPTION_NOTES.fc_rejected), ts(opened), null, null, partnerPerson);
      }
      if (!it.review) continue;
      const at = Math.min(now - tr.int(30, 60) * HOUR, reviewCeil);
      const reviewId = tr.uuid();
      const hubName = HUBS.find((h) => h.code === r.hub)!.name_ko;
      const texts = it.kind === 'lost' ? LOST_TEXT : REJECT_TEXT;
      const body = texts[(used[it.kind] = (used[it.kind] ?? -1) + 1) % texts.length];
      trustReviews.add(reviewId, ship.shipId, r.shipper.id, ship.p.id, it.kind === 'lost' ? 1 : 2, false, true, body, `${r.shipper.category} 셀러 · ${hubName}→${r.port === 'ICN' ? '인천' : '평택'}`, r.shipper.people[0].id, ts(at), it.kind);
      // 업체 공개 답변 — 한바다는 반려 건 답변을 한 번 고쳤다(새 판)
      const v1 = tr.uuid();
      const v1At = Math.min(at + 5 * HOUR, now - 12 * HOUR);
      replies.add(v1, reviewId, ship.p.id, 1, null, REPLY_TEXT[it.kind][used[it.kind] % REPLY_TEXT[it.kind].length], partnerPerson, ts(v1At));
      if (it.hanbada && it.kind === 'fc_rejected') {
        replies.add(tr.uuid(), reviewId, ship.p.id, 2, v1, REPLY_V2, partnerPerson, ts(Math.min(v1At + 8 * HOUR, now - 2 * HOUR)));
      }
    }
    Object.assign(T, { trustReviews, replies });
  }

  // 계정 자격 --------------------------------------------------------------
  const pw = opts.password ?? null;
  if (pw && opts.localCredentials !== false) {
    const h = await hashPassword(pw);
    for (const id of [demoIds.shipper, demoIds.partner, demoIds.admin]) T.creds.add(id, h);
  }

  // 쓰기 ------------------------------------------------------------------
  await db.transaction(async (q) => {
    for (const t of Object.values(T)) await flush(q, t);
  });
  // v2 셀러 공간(서류함 칸·청구 결정·거래처 초대) — 위 자료 위에 덧붙인다
  await db.transaction((q) => seedWorkspaceDemo(q, { now, shipperEmail: DEMO_ACCOUNTS.shipper.email }));
  // v2 2차 wing — 흉내 어댑터로 만든 입고 요청(예시)·짝 확정 셋
  await db.transaction((q) => seedWingDemo(q, { now, today: opts.today, shipperEmail: DEMO_ACCOUNTS.shipper.email }));
  const demoEvents = await db.transaction((q) => seedDemoEvents(q)); // v2 metrics — 방금 넣은 자료에서 이벤트
  await db.transaction((q) => seedAllianceDemo(q, { now, adminEmail: DEMO_ACCOUNTS.admin.email })); // v2 alliance — 예시 제휴 두 곳
  await db.transaction((q) => seedResearchDemo(q, { now })); // v2 interview — 예시 인터뷰·물량 단가·점검 퍼널
  await db.transaction((q) => seedSalesDemo(q, { now, today: opts.today, shipperEmail: DEMO_ACCOUNTS.shipper.email })); // v2 3차 sales — 180일 예시 판매 기록
  if (pw && opts.createAuthUser) {
    for (const [k, id] of Object.entries(demoIds)) {
      const a = DEMO_ACCOUNTS[k as keyof typeof DEMO_ACCOUNTS];
      await opts.createAuthUser({ id, email: a.email, password: pw, name: a.name });
    }
  }
  // v2 check — 데모 화주가 보관한 청구서 점검(방금 넣은 요금표로 계산)
  await seedDemoInvoiceChecks(db, { today: opts.today, now });
  const counts = Object.fromEntries(Object.values(T).map((t) => [t.name, t.rows.length]));
  log(`데모 시드를 넣었습니다: ${JSON.stringify({ ...counts, events: demoEvents })}`);
  return { inserted: true, counts, demoIds };
}
