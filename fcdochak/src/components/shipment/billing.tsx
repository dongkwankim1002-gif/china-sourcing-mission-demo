import { NineBar, type BarSegment } from '@/components/nine-bar';
import { SEGMENTS, SEGMENT_LABEL_KO, SEGMENT_LABEL_ZH, type Segment } from '@/lib/money/segments';
import { cn } from '@/lib/cn';
import { num, pct, won } from '@/lib/format';

/** 청구 대조 — 응찰 막대 위에 청구 막대, 늘어난 구간은 도장 빨강 점과 차액 */
export function BillingCompare({
  bid,
  invoice,
  zh,
}: {
  bid: { amounts: Record<string, number | null>; certainties: Record<string, string | null>; total: number };
  invoice: { amounts: Record<string, number | null>; total: number; invoice_no: string; version: number };
  zh?: boolean;
}) {
  const names = zh ? SEGMENT_LABEL_ZH : SEGMENT_LABEL_KO;
  const bidSegs: BarSegment[] = SEGMENTS.map((s) => ({ segment: s, amount: bid.amounts[s] ?? null, certainty: (bid.certainties[s] as BarSegment['certainty']) ?? 'confirmed' }));
  const invSegs: BarSegment[] = SEGMENTS.map((s) => {
    const a = invoice.amounts[s] ?? null;
    const b = bid.amounts[s] ?? null;
    return { segment: s, amount: a, certainty: 'confirmed', delta: a != null && b != null ? a - b : a != null ? a : null };
  });
  const max = Math.max(bid.total, invoice.total, 1);
  const dev = (invoice.total - bid.total) / Math.max(bid.total, 1);
  return (
    <div className="grid gap-4">
      <div className="grid gap-3 rounded-md border border-line bg-surface p-4">
        <div className="grid grid-cols-[64px_1fr_120px] items-center gap-3">
          <span className="text-xs font-semibold text-muted">{zh ? '报价' : '응찰'}</span>
          <NineBar segments={bidSegs} size="md" scaleMax={max} />
          <span className="text-right text-sm font-bold tnum">{won(bid.total)}</span>
        </div>
        <div className="grid grid-cols-[64px_1fr_120px] items-center gap-3">
          <span className="text-xs font-semibold text-muted">{zh ? '账单' : '청구'}</span>
          <NineBar segments={invSegs} size="md" scaleMax={max} />
          <span className="text-right text-sm font-bold tnum">{won(invoice.total)}</span>
        </div>
        <p className={cn('text-sm font-semibold', Math.abs(dev) >= 0.03 ? 'text-stamp' : 'text-ok')}>
          {zh ? '账单偏差' : '청구 편차'} {pct(dev, 1, true)} ({invoice.total >= bid.total ? '+' : '−'}{won(Math.abs(invoice.total - bid.total))}) · {invoice.invoice_no}{invoice.version > 1 ? ` v${invoice.version}` : ''}
        </p>
      </div>
      <div className="overflow-x-auto rounded-md border border-line bg-surface">
        <table className="w-full min-w-[520px] text-sm tnum">
          <thead className="bg-surface-2 text-xs text-muted">
            <tr>
              <th scope="col" className="px-3 py-2 text-left font-semibold">{zh ? '区段' : '구간'}</th>
              <th scope="col" className="px-3 py-2 text-right font-semibold">{zh ? '报价' : '응찰'}</th>
              <th scope="col" className="px-3 py-2 text-right font-semibold">{zh ? '账单' : '청구'}</th>
              <th scope="col" className="px-3 py-2 text-right font-semibold">{zh ? '差额' : '차액'}</th>
            </tr>
          </thead>
          <tbody>
            {SEGMENTS.map((s: Segment, i) => {
              const b = bid.amounts[s] ?? null;
              const a = invoice.amounts[s] ?? null;
              const d = (a ?? 0) - (b ?? 0);
              return (
                <tr key={s} className="border-t border-line-2">
                  <th scope="row" className="px-3 py-2 text-left font-semibold">
                    <span className="mr-1.5 inline-block size-2 rounded-[1px]" style={{ background: `var(--seg-${i + 1})` }} />
                    {names[s]}
                  </th>
                  <td className="px-3 py-2 text-right">{b == null ? '—' : num(b)}</td>
                  <td className="px-3 py-2 text-right">{a == null ? '—' : num(a)}</td>
                  <td className={cn('px-3 py-2 text-right font-semibold', d > 0 ? 'text-stamp' : d < 0 ? 'text-ok' : 'text-muted')}>{d === 0 ? '0' : `${d > 0 ? '+' : '−'}${num(Math.abs(d))}`}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
