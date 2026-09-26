import type { Queryable } from '@/lib/db/driver';
import { CARGO_TRAITS, DUTY_RATES, FC_CENTERS, HUBS, MODES, PORTS, SEGMENT_ROWS, SETTINGS } from './data';
import { DESTINATIONS, METRICS_SETTINGS } from './data';

/** 플랫폼 운영 조직 — 본게임 조직. 데모가 아니다. */
export const PLATFORM_ORG_ID = '00000000-0000-4000-8000-000000000001';

/**
 * 멱등 — 참조표는 upsert, 설정·관세율은 그 키가 한 번도 없을 때만 첫 판을 넣는다
 * (운영자가 쌓은 판을 덮지 않는다).
 */
export async function seedReference(q: Queryable) {
  for (const h of HUBS) {
    await q.query(
      `insert into fcd.hubs (code,name_ko,name_zh,province_ko,lat,lng,stage,ord) values ($1,$2,$3,$4,$5,$6,$7,$8)
       on conflict (code) do update set name_ko=excluded.name_ko, name_zh=excluded.name_zh, province_ko=excluded.province_ko,
         lat=excluded.lat, lng=excluded.lng, stage=excluded.stage, ord=excluded.ord`,
      [h.code, h.name_ko, h.name_zh, h.province_ko, h.lat, h.lng, h.stage, h.ord],
    );
  }
  for (const p of PORTS) {
    await q.query(
      `insert into fcd.ports (code,name_ko,name_zh,lat,lng,ord) values ($1,$2,$3,$4,$5,$6)
       on conflict (code) do update set name_ko=excluded.name_ko, name_zh=excluded.name_zh, lat=excluded.lat, lng=excluded.lng, ord=excluded.ord`,
      [p.code, p.name_ko, p.name_zh, p.lat, p.lng, p.ord],
    );
  }
  for (const m of MODES) {
    await q.query(
      `insert into fcd.modes (code,name_ko,name_zh,days_min,days_max,ord) values ($1,$2,$3,$4,$5,$6)
       on conflict (code) do update set name_ko=excluded.name_ko, name_zh=excluded.name_zh, days_min=excluded.days_min, days_max=excluded.days_max, ord=excluded.ord`,
      [m.code, m.name_ko, m.name_zh, m.days_min, m.days_max, m.ord],
    );
  }
  for (const f of FC_CENTERS) {
    await q.query(
      `insert into fcd.fc_centers (code,name,region,km_incheon,km_pyeongtaek) values ($1,$2,$3,$4,$5)
       on conflict (code) do update set name=excluded.name, region=excluded.region, km_incheon=excluded.km_incheon, km_pyeongtaek=excluded.km_pyeongtaek`,
      [f.code, f.name, f.region, f.km_incheon, f.km_pyeongtaek],
    );
  }
  for (const s of SEGMENT_ROWS) {
    await q.query(
      `insert into fcd.segments (code,ord,name_ko,name_zh,description_ko) values ($1,$2,$3,$4,$5)
       on conflict (code) do update set ord=excluded.ord, name_ko=excluded.name_ko, name_zh=excluded.name_zh, description_ko=excluded.description_ko`,
      [s.code, s.ord, s.name_ko, s.name_zh, s.description_ko],
    );
  }
  for (const t of CARGO_TRAITS) {
    await q.query(
      `insert into fcd.cargo_traits (code,ord,name_ko,name_zh,verdict_ko,requirement_ko,needs_capability,blocked_modes)
       values ($1,$2,$3,$4,$5,$6,$7,$8::text[])
       on conflict (code) do update set ord=excluded.ord, name_ko=excluded.name_ko, name_zh=excluded.name_zh, verdict_ko=excluded.verdict_ko,
         requirement_ko=excluded.requirement_ko, needs_capability=excluded.needs_capability, blocked_modes=excluded.blocked_modes`,
      [t.code, t.ord, t.name_ko, t.name_zh, t.verdict_ko, t.requirement_ko, t.needs_capability, [...t.blocked_modes]],
    );
  }
  for (const s of SETTINGS) {
    await q.query(
      `insert into fcd.settings (key, value, note)
       select $1, $2::jsonb, $3 where not exists (select 1 from fcd.settings where key = $1)`,
      [s.key, JSON.stringify(s.value), s.note],
    );
  }
  for (const d of DUTY_RATES) {
    await q.query(
      `insert into fcd.duty_rates (category, name_ko, rate_bp, note)
       select $1, $2, $3, '첫 판(기본세율 기준, 참고)' where not exists (select 1 from fcd.duty_rates where category = $1)`,
      [d.category, d.name_ko, d.rate_bp],
    );
  }
  await q.query(
    `insert into fcd.orgs (id, kind, name, slug, is_demo, status)
     values ($1, 'platform', 'FC도착 운영', 'platform', false, 'active')
     on conflict (id) do nothing`,
    [PLATFORM_ORG_ID],
  );
  await seedDestinations(q);
}

/** v2 metrics — 쿠팡 FC 밖 목적지(예시 3PL·쇼핑몰 창고)와 그 설정. 멱등. */
export async function seedDestinations(q: Queryable) {
  for (const d of DESTINATIONS) {
    await q.query(
      `insert into fcd.fc_centers (code,name,region,km_incheon,km_pyeongtaek,kind,is_example,ord) values ($1,$2,$3,$4,$5,$6,true,$7)
       on conflict (code) do update set name=excluded.name, region=excluded.region, km_incheon=excluded.km_incheon,
         km_pyeongtaek=excluded.km_pyeongtaek, kind=excluded.kind, is_example=true, ord=excluded.ord`,
      [d.code, d.name, d.region, d.km_incheon, d.km_pyeongtaek, d.kind, d.ord],
    );
  }
  for (const s of METRICS_SETTINGS) {
    await q.query(
      `insert into fcd.settings (key, value, note)
       select $1, $2::jsonb, $3 where not exists (select 1 from fcd.settings where key = $1)`,
      [s.key, JSON.stringify(s.value), s.note],
    );
  }
}
