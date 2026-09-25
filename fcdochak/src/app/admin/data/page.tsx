import { Suspense } from 'react';
import { asUser } from '@/lib/db';
import { requireViewer } from '@/lib/server/viewer';
import { PageTitle, Panel, PanelHead, Skeleton } from '@/components/ui/core';
import { OrgTable, type OrgRow } from './table';
import { num } from '@/lib/format';

export const metadata = { title: '업체·자료' };

const LAYERS: [string, string, string][] = [
  ['참조', 'hubs,ports,modes,fc_centers,segments,cargo_traits', '본게임에 남는 기준 자료'],
  ['설정', 'settings,duty_rates', '새 판으로만 쌓임'],
  ['조직·사람', 'orgs,profiles,memberships', '데모는 is_demo 조직 아래'],
  ['거래', 'rate_cards,quote_requests,bids,bookings,shipments,invoices', '고치지 않고 새 판'],
  ['기록', 'shipment_events,exceptions,documents,reviews,notifications', '조직에 CASCADE'],
  ['운영', 'verification_requests,deletion_requests,grade_records,ad_slots,audit_log', '운영자만'],
];

export default async function Data() {
  const v = await requireViewer('admin');
  const { rows, counts } = await asUser(v, async (q) => {
    const rows = await q.query<OrgRow>(
      `select o.id, o.name, o.kind, o.status, o.business_type, o.slug, o.is_demo, o.related_party_note, o.created_at,
              (select count(*) from fcd.memberships m where m.org_id = o.id)::int members,
              (select count(*) from fcd.rate_cards r where r.org_id = o.id)::int cards,
              (select count(*) from fcd.quote_requests r where r.org_id = o.id)::int requests,
              (select count(*) from fcd.shipments s where s.shipper_org_id = o.id or s.partner_org_id = o.id)::int shipments
         from fcd.orgs o order by o.kind, o.name`,
    );
    const tables = LAYERS.flatMap(([, t]) => t.split(','));
    const counts: Record<string, number> = {};
    for (const t of tables) counts[t] = (await q.query<{ n: number }>(`select count(*)::int n from fcd.${t}`))[0].n;
    return { rows, counts };
  });
  return (
    <>
      <PageTitle title="업체·자료" sub="데이터 층별 건수와 모든 조직. 운영자는 예시 데이터도 보며, 「예시」 표시가 붙습니다." />
      <div className="mb-6 grid gap-3 md:grid-cols-3">
        {LAYERS.map(([name, t, note]) => (
          <Panel key={name}>
            <PanelHead title={name} sub={note} />
            <ul className="grid grid-cols-2 gap-x-4 gap-y-1 p-4 text-xs tnum">
              {t.split(',').map((x) => (
                <li key={x} className="flex justify-between"><span className="text-muted">{x}</span><b>{num(counts[x])}</b></li>
              ))}
            </ul>
          </Panel>
        ))}
      </div>
      <Suspense fallback={<Skeleton className="h-96" />}>
        <OrgTable rows={rows} />
      </Suspense>
    </>
  );
}
