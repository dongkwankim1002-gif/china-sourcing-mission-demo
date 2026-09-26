/**
 * 「지금 견적 요청」 링크(v2 3차 sales) — 권장 수량으로 SKU 의 박스·무게·부피·물품가를 비례해 늘려
 * 기존 견적 요청 화면(/app/requests/new)에 채워 넘긴다. 요청을 대신 올리지 않는다. 순수 함수.
 */
import { cargoToSearch } from '../cargo-params';

export interface SkuCargo {
  id: string;
  units: number;
  cartons: number;
  kg: number;
  cbm: number;
  goods: number;
  cur: 'RMB' | 'USD' | 'KRW';
  hub: string;
  port: string;
  mode: string | null;
  traits: string[];
}

const r = (n: number, d: number) => Math.round(n * 10 ** d) / 10 ** d;

export function scaledCargo(s: SkuCargo, units: number) {
  const u = Math.max(1, Math.round(units));
  const k = u / Math.max(1, s.units);
  return {
    units: u,
    cartons: Math.max(1, Math.ceil(s.cartons * k)),
    kg: Math.max(0.1, r(s.kg * k, 1)),
    cbm: Math.max(0.01, r(s.cbm * k, 2)),
    goods: Math.max(0, Math.round((s.goods * k) / 10) * 10),
  };
}

export function quoteRequestHref(s: SkuCargo, units: number): string {
  const c = scaledCargo(s, units > 0 ? units : s.units);
  const port = s.port === 'PTK' ? 'PTK' : 'ICN';
  const q = cargoToSearch({ hub: s.hub, port, mode: s.mode, units: c.units, cartons: c.cartons, kg: c.kg, cbm: c.cbm, goods: c.goods, cur: s.cur, traits: s.traits });
  return `/app/requests/new?sku=${encodeURIComponent(s.id)}&${q}`;
}
