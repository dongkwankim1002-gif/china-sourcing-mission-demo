import { Suspense } from 'react';
import { asUser } from '@/lib/db';
import { requireViewer } from '@/lib/server/viewer';
import { listSkus } from '@/lib/server/shipper';
import { getReference } from '@/lib/server/reference';
import { loadSettings } from '@/lib/server/settings';
import { PageTitle, Skeleton } from '@/components/ui/core';
import { SkusClient } from './client';

export const metadata = { title: '저장한 SKU' };

export default async function SkusPage() {
  const v = await requireViewer('app');
  const [{ rows, duty }, ref] = await Promise.all([asUser(v, async (q) => ({ rows: await listSkus(q, v.org.id), duty: (await loadSettings(q)).dutyRates })), getReference()]);
  return (
    <>
      <PageTitle title="저장한 SKU" sub="보관한 SKU 는 목록에서 빠질 뿐 지워지지 않습니다." />
      <Suspense fallback={<Skeleton className="h-96" />}>
        <SkusClient rows={rows} traits={ref.traits} duty={duty} />
      </Suspense>
    </>
  );
}
