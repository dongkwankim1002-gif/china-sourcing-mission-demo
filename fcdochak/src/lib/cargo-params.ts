/** 화물 입력 ↔ URL — 계산·비교·요청이 같은 모양을 쓴다. 필터·정렬도 URL 에 실려 링크로 공유된다. */
import { z } from 'zod';
import type { Cargo } from './money';

export const CargoQuery = z.object({
  hub: z.string().regex(/^[A-Z]{3}$/).default('YIW'),
  port: z.enum(['ICN', 'PTK']).default('ICN'),
  mode: z
    .enum(['LCL', 'FERRY', 'FCL', 'AIR', 'ANY'])
    .default('ANY')
    .transform((m) => (m === 'ANY' ? null : m)),
  units: z.coerce.number().int().min(1).max(10_000_000).default(1200),
  cartons: z.coerce.number().int().min(1).max(100_000).default(40),
  kg: z.coerce.number().min(0.1).max(1_000_000).default(820),
  cbm: z.coerce.number().min(0.01).max(10_000).default(3.6),
  goods: z.coerce.number().min(0).max(1_000_000_000).default(36000),
  cur: z.enum(['RMB', 'USD', 'KRW']).default('RMB'),
  traits: z
    .string()
    .default('')
    .transform((s) => s.split(',').map((x) => x.trim()).filter((x) => /^[a-z_]{2,20}$/.test(x))),
  fc: z.string().regex(/^FC-[A-Z]{3}$/).default('FC-ICH'),
});
export type CargoQueryT = z.infer<typeof CargoQuery>;

export function parseCargoQuery(sp: URLSearchParams | Record<string, string | string[] | undefined>): CargoQueryT {
  const obj: Record<string, string> = {};
  if (sp instanceof URLSearchParams) sp.forEach((v, k) => (obj[k] = v));
  else for (const [k, v] of Object.entries(sp)) if (typeof v === 'string') obj[k] = v;
  const r = CargoQuery.safeParse(obj);
  return r.success ? r.data : CargoQuery.parse({});
}

export function toCargo(q: CargoQueryT): Cargo {
  return { units: q.units, cartons: q.cartons, kg: q.kg, cbm: q.cbm, goodsValue: q.goods, goodsCurrency: q.cur };
}

export function cargoToSearch(q: Partial<Omit<CargoQueryT, 'mode' | 'traits'>> & { mode?: string | null; traits?: string[] }): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) {
    if (v == null) continue;
    if (k === 'traits') {
      if ((v as string[]).length) p.set('traits', (v as string[]).join(','));
    } else p.set(k, String(v));
  }
  if (!q.mode) p.set('mode', 'ANY');
  return p.toString();
}
