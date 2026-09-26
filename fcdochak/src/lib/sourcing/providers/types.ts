/**
 * 공급처 제공자 인터페이스(docs/sourcing-plan.md 4절). 지금 구현은 흉내 제공자 하나뿐이다 — 밖을 부르지 않는다.
 * 1688·알리바바·타오바오 공식 API 제공자는 약관·계약·권한 확인 뒤(3단계)에 이 모양으로 더한다.
 */
import type { PriceTier } from '../../money/sourcing';

export const PROVIDER_IDS = ['mock', '1688', 'alibaba', 'taobao'] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];

export interface SourcingQuery {
  productName: string;
  keywords: readonly string[];
  category: string;
  /** 목표 판매가(원) — 흉내 제공자가 단가 크기를 맞추는 데만 쓴다 */
  targetPrice: number | null;
  hub: string | null;
  qty: number;
  needsCert: boolean;
}

export interface ProviderQuote {
  currency: 'RMB' | 'USD';
  tiers: PriceTier[];
  moq: number;
  leadDaysMin: number;
  leadDaysMax: number;
  sampleFee: number | null;
  sampleDays: number | null;
  unitKg: number;
  unitCbm: number;
  unitsPerCarton: number;
}

export interface ProviderCandidate {
  label: string;
  supplierKind: 'factory' | 'trader' | 'unknown';
  hub: string | null;
  region: string | null;
  productTitle: string;
  category: string | null;
  rating: number | null;
  yearsActive: number | null;
  certsClaimed: string[];
  source: 'mock' | 'api';
  sourceUrl: string | null;
  quote: ProviderQuote;
}

export interface SearchOptions {
  limit: number;
  /** 1 RMB = N 원 — 목표 판매가를 단가로 옮길 때 */
  fxRmb: number;
  /** 기대 매입가 비율(bp) — 설정 sourcing.rules.targetCostShareBp */
  targetCostShareBp: number;
  /** 개당 무게·부피 힌트(저장한 SKU 에서) */
  unitKg?: number | null;
  unitCbm?: number | null;
}

export interface SourcingProvider {
  readonly id: ProviderId;
  readonly label: string;
  /** 밖을 부르는가 — 흉내 제공자는 false */
  readonly external: boolean;
  search(q: SourcingQuery, opts: SearchOptions): Promise<ProviderCandidate[]>;
}

export class SourcingProviderUnavailable extends Error {
  constructor(public readonly provider: ProviderId) {
    super(`${provider} 제공자는 준비 중입니다 — 약관·계약·API 권한 확인 전에는 부르지 않습니다(docs/sourcing-plan.md 4절)`);
    this.name = 'SourcingProviderUnavailable';
  }
}
