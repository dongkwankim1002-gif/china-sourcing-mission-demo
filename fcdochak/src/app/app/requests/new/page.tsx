import { asUser, todayKst } from '@/lib/db';
import { requireViewer } from '@/lib/server/viewer';
import { getReference } from '@/lib/server/reference';
import { listSkus } from '@/lib/server/shipper';
import { loadSettings } from '@/lib/server/settings';
import { parseCargoQuery } from '@/lib/cargo-params';
import { PageTitle } from '@/components/ui/core';
import { NewRequestForm } from './form';

export const metadata = { title: '견적 요청 올리기' };

export default async function NewRequest({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const v = await requireViewer('app');
  const [ref, { skus, duty }] = await Promise.all([
    getReference(),
    asUser(v, async (q) => ({ skus: await listSkus(q, v.org.id), duty: (await loadSettings(q)).dutyRates })),
  ]);
  const cq = parseCargoQuery(sp);
  const sku = sp.sku ? skus.find((s) => s.id === sp.sku) : null;
  return (
    <>
      <PageTitle eyebrow="견적 요청" title="견적 요청 올리기" sub="올리면 이 구간을 맡는 업체들이 9구간 금액으로 응찰합니다. 운송계약은 고른 업체와 직접 맺습니다." />
      <NewRequestForm
        initial={{ hub: cq.hub, port: cq.port, mode: cq.mode ?? 'ANY', units: cq.units, cartons: cq.cartons, kg: cq.kg, cbm: cq.cbm, goods: cq.goods, cur: cq.cur, fc: cq.fc, traits: cq.traits, skuId: sku?.id ?? null }}
        hubs={ref.hubs}
        fcs={ref.fcs}
        traits={ref.traits}
        skus={skus}
        duty={duty}
        today={todayKst()}
      />
    </>
  );
}
