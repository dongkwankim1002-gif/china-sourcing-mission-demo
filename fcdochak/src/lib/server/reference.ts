import 'server-only';
import { cache } from 'react';
import { asPublic, type Queryable } from '../db';
import type { DestinationKind } from '../money/destination';

export interface Reference {
  hubs: { code: string; name_ko: string; name_zh: string; province_ko: string; stage: number }[];
  ports: { code: string; name_ko: string; name_zh: string }[];
  modes: { code: string; name_ko: string; name_zh: string; days_min: number; days_max: number }[];
  /** 목적지 — 쿠팡 FC 가 앞, 그 뒤로 예시 3PL·쇼핑몰 창고(kind 로 가름, 0011) */
  fcs: { code: string; name: string; region: string; km_incheon: number; km_pyeongtaek: number; kind: DestinationKind; is_example: boolean }[];
  traits: { code: string; name_ko: string; name_zh: string; verdict_ko: string; requirement_ko: string; needs_capability: boolean; blocked_modes: string[] }[];
  segments: { code: string; ord: number; name_ko: string; name_zh: string; description_ko: string }[];
}

export async function loadReference(q: Queryable): Promise<Reference> {
  const [hubs, ports, modes, fcs, traits, segments] = await Promise.all([
    q.query<Reference['hubs'][number]>('select code, name_ko, name_zh, province_ko, stage from fcd.hubs order by ord'),
    q.query<Reference['ports'][number]>('select code, name_ko, name_zh from fcd.ports order by ord'),
    q.query<Reference['modes'][number]>('select code, name_ko, name_zh, days_min, days_max from fcd.modes order by ord'),
    q.query<Reference['fcs'][number]>(`select code, name, region, km_incheon, km_pyeongtaek, kind, is_example from fcd.fc_centers
        order by case kind when 'coupang_fc' then 0 when '3pl' then 1 else 2 end, ord, km_incheon`),
    q.query<Reference['traits'][number]>('select code, name_ko, name_zh, verdict_ko, requirement_ko, needs_capability, blocked_modes from fcd.cargo_traits order by ord'),
    q.query<Reference['segments'][number]>('select code, ord, name_ko, name_zh, description_ko from fcd.segments order by ord'),
  ]);
  return { hubs, ports, modes, fcs, traits, segments };
}

export const getReference = cache(() => asPublic(loadReference));

export function nameOf(ref: Reference, kind: 'hub' | 'port' | 'mode', code: string | null | undefined, zh = false): string {
  if (!code) return zh ? '不限' : '상관없음';
  const list = kind === 'hub' ? ref.hubs : kind === 'port' ? ref.ports : ref.modes;
  const r = list.find((x) => x.code === code);
  return r ? (zh ? r.name_zh : r.name_ko) : code;
}
