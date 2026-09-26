import type { Metadata } from 'next';
import { getReference } from '@/lib/server/reference';
import { ShipperJoin } from './form';

export const metadata: Metadata = { title: '화주로 시작하기', description: '가입하면 9구간 상세 비교, 견적 요청, 판매손익, 선적 추적을 쓸 수 있습니다.' };

export default async function Page() {
  const ref = await getReference();
  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      <h1 className="display text-[clamp(28px,4vw,40px)]">화주로 시작하기</h1>
      <p className="mt-1 text-sm text-muted">세 단계, 1분이면 끝납니다. 적은 내용은 이 기기에 단계마다 저장돼 창을 닫아도 이어서 할 수 있습니다.</p>
      <ShipperJoin hubs={ref.hubs.map((h) => ({ code: h.code, name: h.name_ko }))} />
    </div>
  );
}
