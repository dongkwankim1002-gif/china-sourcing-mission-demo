import Link from 'next/link';
import { Suspense } from 'react';
import { asUser } from '@/lib/db';
import { requireViewer } from '@/lib/server/viewer';
import { listRequests } from '@/lib/server/shipper';
import { getReference } from '@/lib/server/reference';
import { Button, PageTitle, Skeleton } from '@/components/ui/core';
import { ACTION } from '@/lib/terms';
import { RequestsTable } from './table';

export const metadata = { title: '견적 요청' };

export default async function RequestsPage() {
  const v = await requireViewer('app');
  const [rows, ref] = await Promise.all([asUser(v, (q) => listRequests(q, v.org.id)), getReference()]);
  return (
    <>
      <PageTitle title="견적 요청" sub="요청마다 업체들이 9구간 금액으로 응찰합니다. 마감 뒤 7일 안에 골라 예약으로 전환하세요." actions={<Button asChild variant="primary"><Link href="/app/requests/new">{ACTION.newRequest}</Link></Button>} />
      <Suspense fallback={<Skeleton className="h-96" />}>
        <RequestsTable rows={rows} hubs={Object.fromEntries(ref.hubs.map((h) => [h.code, h.name_ko]))} />
      </Suspense>
    </>
  );
}
