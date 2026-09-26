/**
 * 흉내 어댑터 — 데모·시험용. 관세청을 부르지 않는다. 결정적(FNV-1a 해시 기반, 브라우저·서버 공용).
 *   · 같은 번호 + 같은 입항 기준 시각이면 늘 같은 단계 기록을 만든다. 기준을 주지 않으면 「오늘」 기준 0~8일 전 입항(같은 날이면 같은 결과).
 *   · 지금(now) 이후의 기록은 내지 않는다 — 시간이 지나면 다음 단계가 「생긴다」(폴링 흉내).
 *   · 장치장 이름은 「예시 보세창고 A」처럼 예시로만. 처리구분 낱말은 가정(stages.ts 와 같은 낱말).
 *   · 번호 해시가 23 의 배수면 「조회 결과 없음」, M B/L 이고 7 의 배수면 「여러 건」.
 */
import { addBusinessDays, kstYmd, type HolidaySet } from '../tracker/calendar';
import type { CargoEvent, LookupResult, TrackQuery, TrackStage, UnipassAdapter } from './types';

export function fnv(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}
const r = (seed: string, salt: string) => fnv(`${seed}:${salt}`) / 0x1_0000_0000;
const HOUR = 3600_000;
const DAY = 86_400_000;

/** 흉내 처리구분 원문(가정) */
export const MOCK_RAW: Record<Exclude<TrackStage, 'domestic' | 'fc'>, string> = {
  manifest: '입항적하목록 제출',
  arrival: '입항보고 수리',
  unloading: '하선신고 수리',
  bonded_in: '반입신고',
  declared: '수입신고',
  cleared: '수입신고수리',
  released: '반출신고',
};

const kstAt = (ymd: string, hour: number) => Date.parse(`${ymd}T00:00:00+09:00`) + hour * HOUR;
/** ISO(UTC) → 관세청 모양(+09:00) */
export function toKstIso(t: number): string {
  const k = new Date(t + 9 * HOUR).toISOString().slice(0, 19);
  return `${k}+09:00`;
}

/**
 * 한 번호의 전체 흉내 단계(적하목록 → 반출). 입항 시각(arrivalMs)이 기준.
 * 수리까지 영업일: 0일 40% · 1일 35% · 2일 15% · 3~5일 10%(검사 지정 흉내).
 */
export function mockTimeline(seed: string, arrivalMs: number, holidays: HolidaySet): { stage: Exclude<TrackStage, 'domestic' | 'fc'>; at: number; shed: string }[] {
  const shed = `예시 보세창고 ${String.fromCharCode(65 + (fnv(seed) % 6))}`;
  const manifest = arrivalMs - (12 + Math.floor(r(seed, 'm') * 24)) * HOUR;
  const unloading = arrivalMs + (2 + Math.floor(r(seed, 'u') * 6)) * HOUR;
  const bonded = unloading + (2 + Math.floor(r(seed, 'b') * 8)) * HOUR;
  const d1 = addBusinessDays(kstYmd(bonded), r(seed, 'd') < 0.5 ? 0 : 1, holidays);
  const declared = Math.max(kstAt(d1, 10 + Math.floor(r(seed, 'dh') * 5)), bonded + HOUR);
  const x = r(seed, 'c');
  const k = x < 0.4 ? 0 : x < 0.75 ? 1 : x < 0.9 ? 2 : 3 + Math.floor(r(seed, 'ck') * 3);
  const d2 = addBusinessDays(kstYmd(declared), k, holidays);
  const cleared = Math.max(kstAt(d2, 11 + Math.floor(r(seed, 'chh') * 6)), declared + 2 * HOUR);
  const released = cleared + (1 + Math.floor(r(seed, 'r') * 20)) * HOUR;
  return [
    { stage: 'manifest', at: manifest, shed },
    { stage: 'arrival', at: arrivalMs, shed },
    { stage: 'unloading', at: unloading, shed },
    { stage: 'bonded_in', at: bonded, shed },
    { stage: 'declared', at: declared, shed },
    { stage: 'cleared', at: cleared, shed },
    { stage: 'released', at: released, shed },
  ];
}

export function querySeed(q: TrackQuery): string {
  return `${q.kind}:${q.number}:${q.year ?? ''}`;
}

/** 기준을 주지 않았을 때의 입항 시각 — 오늘(KST) 기준 0~8일 전 06~15시 */
export function defaultArrival(seed: string, nowMs: number): number {
  const today = kstYmd(nowMs);
  return kstAt(today, 6 + (fnv(seed) >>> 5) % 10) - ((fnv(seed) >>> 9) % 9) * DAY;
}

export interface MockAdapterOptions {
  now: () => number;
  holidays: HolidaySet;
  /** 번호별 입항 기준 시각(데모 시드가 만든 번호는 선적의 한국 도착 시각) — 없으면 defaultArrival */
  arrivalOf?: (q: TrackQuery) => number | null | undefined;
  /** 양륙항(없으면 해시로 인천/평택) */
  portOf?: (q: TrackQuery) => 'KRINC' | 'KRPTK' | null | undefined;
}

export class MockUnipassAdapter implements UnipassAdapter {
  readonly kind = 'mock' as const;
  constructor(private readonly o: MockAdapterOptions) {}

  async lookup(q: TrackQuery): Promise<LookupResult> {
    const seed = querySeed(q);
    const h = fnv(seed);
    if (h % 23 === 0) return { status: 'not_found', source: 'mock' };
    if (q.kind === 'mbl' && h % 7 === 0) {
      return { status: 'multiple', cargoNos: [0, 1].map((i) => `${String((q.year ?? 2026) % 100).padStart(2, '0')}EXMP${(h + i).toString(36).toUpperCase().padStart(8, '0')}0001`), source: 'mock' };
    }
    const now = this.o.now();
    const arrival = this.o.arrivalOf?.(q) ?? defaultArrival(seed, now);
    const all = mockTimeline(seed, arrival, this.o.holidays).filter((e) => e.at <= now);
    const events: CargoEvent[] = all.map((e) => ({ rawType: MOCK_RAW[e.stage], at: toKstIso(e.at), summary: e.shed }));
    const yy = String(new Date(arrival).getUTCFullYear() % 100).padStart(2, '0');
    const port = this.o.portOf?.(q) ?? (h % 3 === 0 ? 'KRPTK' : 'KRINC');
    return {
      status: 'found',
      source: 'mock',
      events,
      summary: {
        cargoNo: q.kind === 'cargo_no' ? q.number : `${yy}EXMP${h.toString(36).toUpperCase().padStart(8, '0')}0001`,
        mbl: q.kind === 'mbl' ? q.number : null,
        hbl: q.kind === 'hbl' ? q.number : null,
        status: events.length ? events[events.length - 1].rawType : '적하목록 대기(예시)',
        portCode: port,
        arrivalOn: arrival <= now ? kstYmd(arrival) : null,
        forwarder: null,
        packages: 1 + (h % 60),
      },
    };
  }
}

