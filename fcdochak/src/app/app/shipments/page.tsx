import Link from 'next/link';
import { Suspense } from 'react';
import { asUser } from '@/lib/db';
import { requireViewer } from '@/lib/server/viewer';
import { listShipments } from '@/lib/server/shipper';
import { getReference } from '@/lib/server/reference';
import { ShipmentsTable } from '@/components/shipment/table';
import { Button, EmptyState, PageTitle, Skeleton } from '@/components/ui/core';

export const metadata = { title: '선적' };

export default async function Shipments() {
  const v = await requireViewer('app');
  const [rows, ref] = await Promise.all([asUser(v, (q) => listShipments(q, 's.shipper_org_id = $1', [v.org.id])), getReference()]);
  return (
    <>
      <PageTitle title="선적" sub="표준 9단계로 봅니다. 업체가 쓰는 원래 상태값도 함께 남습니다." />
      <Suspense fallback={<Skeleton className="h-96" />}>
        <ShipmentsTable
          rows={rows}
          base="/app"
          party="partner"
          hubs={Object.fromEntries(ref.hubs.map((h) => [h.code, h.name_ko]))}
          empty={<EmptyState title="아직 선적이 없습니다" body="견적 요청에서 응찰을 골라 예약으로 전환하면 여기서 FC 입고까지 따라갑니다." action={<Button asChild variant="primary"><Link href="/app/requests">견적 요청 보기</Link></Button>} />}
        />
      </Suspense>
    </>
  );
}
