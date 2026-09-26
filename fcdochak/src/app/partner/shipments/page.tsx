import { Suspense } from 'react';
import { getTranslations } from 'next-intl/server';
import { asUser } from '@/lib/db';
import { requireViewer } from '@/lib/server/viewer';
import { listShipments } from '@/lib/server/shipper';
import { getReference } from '@/lib/server/reference';
import { ShipmentsTable } from '@/components/shipment/table';
import { PageTitle, Skeleton } from '@/components/ui/core';

export const metadata = { title: '예약·선적' };

export default async function PartnerShipments() {
  const v = await requireViewer('partner');
  const t = await getTranslations('p.ship');
  const [rows, ref] = await Promise.all([asUser(v, (q) => listShipments(q, 's.partner_org_id = $1', [v.org.id])), getReference()]);
  return (
    <>
      <PageTitle title={t('title')} sub={t('sub')} />
      <Suspense fallback={<Skeleton className="h-96" />}>
        <ShipmentsTable rows={rows} base="/partner" party="shipper" hubs={Object.fromEntries(ref.hubs.map((h) => [h.code, h.name_ko]))} />
      </Suspense>
    </>
  );
}
