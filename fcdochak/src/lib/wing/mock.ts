/**
 * 흉내 어댑터 — 데모·시험용. 쿠팡을 부르지 않는다.
 * 같은 시드·같은 선적 힌트면 늘 같은 가짜 입고 요청을 만든다(sha-256 기반 결정적 난수).
 * 입고 요청 번호는 「EX-RG-」로 시작해 실제 번호와 헷갈리지 않는다.
 */
import { createHash } from 'node:crypto';
import type { WingAdapter, WingInbound } from './types';
import type { FcRef } from './import';

export interface MockShipmentHint {
  id: string;
  fcCode: string;
  etaFc: string | null;
  units: number;
  cartons: number;
  stage: number;
  returnedUnits: number;
}

export interface MockOptions {
  seed: string;
  fcs: readonly FcRef[];
  /** 짝이 맞을 만한 입고 요청을 만들 선적들(앞에서부터 최대 maxAligned) */
  hints?: readonly MockShipmentHint[];
  maxAligned?: number;
  /** 어떤 선적과도 안 맞는 입고 요청 수 */
  strays?: number;
  /** 힌트에 날짜가 없을 때 쓰는 오늘(YYYY-MM-DD) */
  today: string;
}

function rand(seed: string, i: number, salt: string): number {
  const h = createHash('sha256').update(`${seed}:${i}:${salt}`).digest();
  return h.readUInt32BE(0) / 0x1_0000_0000;
}
const int = (r: number, lo: number, hi: number) => lo + Math.floor(r * (hi - lo + 1));

function addDays(ymd: string, n: number): string {
  return new Date(Date.parse(`${ymd}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

const STATUS_OPEN = ['입고 요청', '입고 예정'];
const STATUS_DONE = '입고 완료';

export function mockInbounds(o: MockOptions): WingInbound[] {
  const out: WingInbound[] = [];
  const fcName = (code: string) => o.fcs.find((f) => f.code === code)?.name ?? null;
  const center = (code: string) => {
    const n = fcName(code);
    return n ? `${n.replace(/\s*FC$/i, '')}${int(rand(o.seed, code.length, code), 1, 3)}센터(예시)` : null;
  };
  const hints = (o.hints ?? []).slice(0, o.maxAligned ?? 8);
  hints.forEach((s, i) => {
    const r = (salt: string) => rand(o.seed, i, salt);
    const done = s.stage >= 9;
    const units = Math.max(1, s.units - (r('u') < 0.6 ? 0 : int(r('du'), 1, Math.max(1, Math.floor(s.units * 0.05)))));
    const returned = done ? (s.returnedUnits > 0 ? s.returnedUnits : r('ret') < 0.3 ? int(r('rn'), 1, Math.max(1, Math.floor(units * 0.04))) : 0) : null;
    out.push({
      externalNo: `EX-RG-${String(int(r('no'), 10_000_000, 99_999_999))}`,
      centerName: center(s.fcCode),
      fcCode: s.fcCode,
      plannedOn: addDays(s.etaFc ?? o.today, int(r('d'), -2, 2)),
      skuCount: int(r('sku'), 1, 6),
      units,
      boxes: s.cartons,
      statusRaw: done ? STATUS_DONE : STATUS_OPEN[int(r('st'), 0, 1)],
      receivedUnits: done ? units - (returned ?? 0) : null,
      returnedUnits: returned,
    });
  });
  const codes = o.fcs.map((f) => f.code);
  for (let k = 0; k < (o.strays ?? 2); k++) {
    const r = (salt: string) => rand(o.seed, 1000 + k, salt);
    const code = codes.length ? codes[int(r('fc'), 0, codes.length - 1)] : null;
    out.push({
      externalNo: `EX-RG-${String(int(r('no'), 10_000_000, 99_999_999))}`,
      centerName: code ? center(code) : null,
      fcCode: code,
      plannedOn: addDays(o.today, int(r('d'), 20, 40)),
      skuCount: int(r('sku'), 1, 4),
      units: int(r('u'), 50, 400) * 10,
      boxes: int(r('b'), 5, 60),
      statusRaw: STATUS_OPEN[0],
      receivedUnits: null,
      returnedUnits: null,
    });
  }
  // 번호가 겹치면(아주 드묾) 뒤엣것을 뺀다
  const seen = new Set<string>();
  return out.filter((x) => (seen.has(x.externalNo) ? false : (seen.add(x.externalNo), true)));
}

export class WingMockAdapter implements WingAdapter {
  readonly kind = 'mock' as const;
  constructor(private readonly o: MockOptions) {}
  async listInboundRequests(range: { from: string; to: string }): Promise<WingInbound[]> {
    return mockInbounds(this.o).filter((x) => !x.plannedOn || (x.plannedOn >= range.from && x.plannedOn <= range.to));
  }
}
