/**
 * 제공자 고르기 — 흉내 제공자만 돌려준다. 공식 API 제공자(1688·알리바바·타오바오)는 준비 중 오류.
 * 스위치(sourcing.enabled)를 켜도 바뀌지 않는다 — 외부 호출은 따로 약관·계약·권한 확인과 별도 스위치가 필요하다(3단계).
 */
import { MockSourcingProvider } from './mock';
import { SourcingProviderUnavailable, type ProviderId, type SourcingProvider } from './types';

export function getSourcingProvider(id: ProviderId): SourcingProvider {
  if (id === 'mock') return new MockSourcingProvider();
  throw new SourcingProviderUnavailable(id);
}

export * from './types';
export { MockSourcingProvider, mockCandidates, MOCK_SEED } from './mock';
