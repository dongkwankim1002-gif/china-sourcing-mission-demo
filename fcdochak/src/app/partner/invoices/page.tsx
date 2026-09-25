import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { asUser } from '@/lib/db';
import { requireViewer } from '@/lib/server/viewer';
import { EmptyState, PageTitle, Panel } from '@/components/ui/core';
import { cn } from '@/lib/cn';
import { dateKo, num, pct } from '@/lib/format';

export const metadata = { title: '청구서' };

export default async function Invoices() {
  const v = await requireViewer('partner');
  const t = await getTranslations('p.inv');
  const rows = await asUser(v, (q) =>
    q.query<{ id: string; invoice_no: string; version: number; total: number; issued_on: string; shipment_id: string; shipment_no: string; shipper: string | null; bid_total: number }>(
      `select i.id, i.invoice_no, i.version, i.total, i.issued_on, s.id shipment_id, s.shipment_no, o.name shipper, bd.total bid_total
         from fcd.v_invoices_current i join fcd.shipments s on s.id = i.shipment_id join fcd.bookings b on b.id = s.booking_id join fcd.bids bd on bd.id = b.bid_id
         left join fcd.orgs o on o.id = s.shipper_org_id
        where i.partner_org_id = $1 order by i.issued_on desc limit 300`,
      [v.org.id],
    ),
  );
  return (
    <>
      <PageTitle title={t('title')} sub={t('sub')} />
      <Panel className="overflow-hidden">
        {rows.length ? (
          <div className="max-h-[75vh] overflow-auto">
            <table className="w-full min-w-[640px] text-sm tnum">
              <thead className="sticky top-0 bg-surface-2 text-xs text-muted">
                <tr>{['#', 'SH', '', 'Bid', 'Invoice', 'Δ', '📅'].map((h, i) => <th key={i} scope="col" className={cn('px-3 py-2 font-semibold', i >= 3 && i <= 5 ? 'text-right' : 'text-left')}>{h}</th>)}</tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const dev = (r.total - r.bid_total) / r.bid_total;
                  return (
                    <tr key={r.id} className="border-t border-line-2 hover:bg-surface-2">
                      <td className="px-3 py-2 font-semibold">{r.invoice_no}{r.version > 1 ? ` v${r.version}` : ''}</td>
                      <td className="px-3 py-2"><Link href={`/partner/shipments/${r.shipment_id}?tab=invoice`} className="hover:underline">{r.shipment_no}</Link></td>
                      <td className="max-w-40 truncate px-3 py-2 text-muted">{r.shipper}</td>
                      <td className="px-3 py-2 text-right">{num(r.bid_total)}</td>
                      <td className="px-3 py-2 text-right font-semibold">{num(r.total)}</td>
                      <td className={cn('px-3 py-2 text-right font-semibold', Math.abs(dev) >= 0.05 ? 'text-stamp' : Math.abs(dev) >= 0.02 ? 'text-caution' : 'text-ok')}>{pct(dev, 1, true)}</td>
                      <td className="px-3 py-2 text-muted">{dateKo(r.issued_on, { dow: false })}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState title="—" body={t('sub')} />
        )}
      </Panel>
    </>
  );
}
