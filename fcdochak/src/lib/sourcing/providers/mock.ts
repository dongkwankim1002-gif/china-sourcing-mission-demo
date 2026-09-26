/**
 * 흉내 제공자 — 데모·시험·운영 교육용. 밖을 부르지 않는다.
 * 같은 조건이면 늘 같은 가짜 후보를 만든다(FNV-1a 해시 기반 결정적 난수, 브라우저·서버 공용).
 * 이름은 「예시 공장 A」「예시 무역상 C」 — 실제 회사가 아니다. 인증은 「주장」만(확인 안 됨), KC 는 넣지 않는다.
 */
import type { ProviderCandidate, SearchOptions, SourcingProvider, SourcingQuery } from './types';

export const MOCK_SEED = 'fcd-sourcing-mock-v1';

function fnv(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}
/** 0 이상 1 미만 */
export function mockRand(seed: string, i: number, salt: string): number {
  return fnv(`${seed}|${i}|${salt}`) / 0x1_0000_0000;
}

const HUBS: { code: string; region: string }[] = [
  { code: 'YIW', region: '저장성 이우' },
  { code: 'CAN', region: '광둥성 광저우' },
  { code: 'SZX', region: '광둥성 선전' },
  { code: 'QDG', region: '산둥성 청도' },
];
const VARIANT = ['같은 규격', '개선형', '대용량', '가벼운 소재', '색상 추가'];
const LETTERS = 'ABCDEFGHIJ';

const r2 = (n: number) => Math.round(n * 100) / 100;

export function mockCandidates(q: SourcingQuery, opts: SearchOptions, seed = MOCK_SEED): ProviderCandidate[] {
  const key = `${seed}|${q.productName.trim()}|${q.category}|${q.hub ?? ''}`;
  const n = Math.max(0, Math.min(10, Math.floor(opts.limit)));
  // 단가 크기 — 목표 판매가가 있으면 기대 매입가(원) ÷ 환율, 없으면 10 RMB 근처
  const base = q.targetPrice && q.targetPrice > 0 && opts.fxRmb > 0 ? (q.targetPrice * opts.targetCostShareBp) / 10000 / opts.fxRmb : 10;
  const unitKg = opts.unitKg && opts.unitKg > 0 ? opts.unitKg : 0.35;
  const unitCbm = opts.unitCbm && opts.unitCbm > 0 ? opts.unitCbm : 0.0025;
  const out: ProviderCandidate[] = [];
  for (let i = 0; i < n; i++) {
    const r = (salt: string) => mockRand(key, i, salt);
    const trader = r('kind') < 0.3;
    const hub = q.hub && r('hub') < 0.5 ? (HUBS.find((h) => h.code === q.hub) ?? HUBS[0]) : HUBS[Math.floor(r('hub2') * HUBS.length)];
    const factor = 0.7 + r('price') * 0.7; // 기대 매입가의 70~140%
    const p1 = Math.max(0.5, r2(base * factor * (trader ? 1.08 : 1)));
    const moq = [100, 200, 300, 500, 1000][Math.floor(r('moq') * 5)];
    const leadMin = 7 + Math.floor(r('lead') * 14);
    out.push({
      label: `예시 ${trader ? '무역상' : '공장'} ${LETTERS[i]}`,
      supplierKind: trader ? 'trader' : 'factory',
      hub: hub.code,
      region: hub.region,
      productTitle: `${q.productName.trim()} ${VARIANT[Math.floor(r('var') * VARIANT.length)]}(예시)`,
      category: r('cat') < 0.85 ? q.category : 'general',
      rating: Math.round((3.6 + r('rating') * 1.3) * 10) / 10,
      yearsActive: 2 + Math.floor(r('years') * 14),
      certsClaimed: q.needsCert ? (r('cert') < 0.5 ? ['CCC'] : ['CE']) : [],
      source: 'mock',
      sourceUrl: null,
      quote: {
        currency: 'RMB',
        tiers: [
          { minQty: moq, unitPrice: p1 },
          { minQty: moq * 3, unitPrice: r2(p1 * 0.94) },
          { minQty: moq * 10, unitPrice: r2(p1 * 0.88) },
        ],
        moq,
        leadDaysMin: leadMin,
        leadDaysMax: leadMin + 5 + Math.floor(r('lead2') * 10),
        sampleFee: r2(Math.max(20, p1 * 3 + r('sample') * 60)),
        sampleDays: 3 + Math.floor(r('sdays') * 7),
        unitKg: Math.round(unitKg * (0.9 + r('kg') * 0.25) * 1000) / 1000,
        unitCbm: Math.round(unitCbm * (0.9 + r('cbm') * 0.25) * 100000) / 100000,
        unitsPerCarton: [20, 30, 40, 50, 60][Math.floor(r('carton') * 5)],
      },
    });
  }
  return out;
}

export class MockSourcingProvider implements SourcingProvider {
  readonly id = 'mock' as const;
  readonly label = '흉내 제공자(예시 후보)';
  readonly external = false;
  constructor(private readonly seed = MOCK_SEED) {}
  async search(q: SourcingQuery, opts: SearchOptions) {
    return mockCandidates(q, opts, this.seed);
  }
}
