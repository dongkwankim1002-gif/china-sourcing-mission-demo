import type { Metadata } from 'next';
import { getReference } from '@/lib/server/reference';
import { todayKst } from '@/lib/db';
import { PartnerJoin } from './form';

export const metadata: Metadata = {
  title: '물류사 입점 신청',
  description: '사업자 → 거점·운송 방식 → 취급 능력 → 첫 요금표. 입점비·게시비 없음. 한국어·中文 콘솔.',
};

export default async function Page() {
  const ref = await getReference();
  return (
    <div className="mx-auto max-w-4xl px-4 py-10">
      <h1 className="display text-[clamp(28px,4vw,40px)]">물류사 입점 신청 <span className="text-lg text-muted">物流商入驻</span></h1>
      <p className="mt-1 text-sm text-muted">네 단계입니다. 단계마다 이 기기에 저장됩니다. 운영자가 사업자 정보를 확인하면 「공식 등록」이 됩니다.</p>
      <PartnerJoin
        today={todayKst()}
        hubs={ref.hubs.map((h) => ({ code: h.code, name: `${h.name_ko} ${h.name_zh}` }))}
        ports={ref.ports.map((p) => ({ code: p.code, name: `${p.name_ko}항` }))}
        modes={ref.modes.map((m) => ({ code: m.code, name: m.name_ko }))}
        traits={ref.traits.map((t) => ({ code: t.code, name: t.name_ko, req: t.requirement_ko, needs: t.needs_capability }))}
      />
    </div>
  );
}
