import { asUser } from '@/lib/db';
import { requireViewer } from '@/lib/server/viewer';
import { loadSettings } from '@/lib/server/settings';
import { commissionAmount, commissionBase } from '@/lib/money';
import { DemoChip } from '@/components/badges';
import { PageTitle, Panel, PanelHead } from '@/components/ui/core';
import { dateKo, dateTimeKo, num, won, wonShort } from '@/lib/format';

export const metadata = { title: '수수료 기준' };

export default async function Commission() {
  const v = await requireViewer('admin');
  const d = await asUser(v, async (q) => {
    const s = await loadSettings(q);
    const history = await q.query<{ value: number; note: string | null; created_at: string }>(`select value, note, created_at from fcd.settings where key = 'commission_rate_bp' order by created_at desc`);
    const rows = await q.query<{ booking_no: string; created_at: string; amounts: Record<string, number | null>; total: number; shipper: string; partner: string; is_demo: boolean }>(
      `select b.booking_no, b.created_at, bd.amounts, bd.total, sh.name shipper, p.name partner, sh.is_demo
         from fcd.bookings b join fcd.bids bd on bd.id = b.bid_id join fcd.orgs sh on sh.id = b.shipper_org_id join fcd.orgs p on p.id = b.partner_org_id
        where b.created_at > now() - interval '30 days' order by b.created_at desc limit 200`,
    );
    return { s, history, rows };
  });
  const rate = d.s.commissionRateBp;
  const sumBase = d.rows.reduce((t, r) => t + commissionBase(r.amounts), 0);
  const sumBroker = d.rows.reduce((t, r) => t + (r.amounts.broker ?? 0), 0);
  const sumComm = d.rows.reduce((t, r) => t + commissionAmount(r.amounts, rate), 0);
  return (
    <>
      <PageTitle title="수수료 기준" sub="성사 수수료 기준 = 물류비 합계 − 관세사 보수. 관세·부가세는 물류비가 아니라 들어오지 않습니다(관세사법 제3조 제2·3항). 1차에는 대금을 받지 않고 기준 매출만 셉니다." />
      <section className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          ['현재 요율', `${(rate / 100).toFixed(2)}%`],
          ['30일 물류비 합계', wonShort(sumBase + sumBroker)],
          ['뺀 관세사 보수', wonShort(sumBroker)],
          ['30일 수수료 기준 매출', wonShort(sumComm)],
        ].map(([k, val]) => (
          <div key={k} className="rounded-md border border-line bg-surface p-4"><p className="text-xs font-semibold text-muted">{k}</p><p className="display mt-1 text-2xl tnum">{val}</p></div>
        ))}
      </section>
      <div className="grid gap-6 xl:grid-cols-[1fr_340px]">
        <Panel>
          <PanelHead title="최근 30일 예약별" sub="계산은 lib/money/commission.ts — 시험으로 고정" />
          <div className="max-h-[70vh] overflow-auto">
            <table className="w-full min-w-[720px] text-sm tnum">
              <thead className="sticky top-0 bg-surface-2 text-xs text-muted">
                <tr>{['예약', '화주 → 물류사', '물류비', '관세사', '기준', '수수료'].map((h, i) => <th key={h} scope="col" className={`px-3 py-2 font-semibold ${i >= 2 ? 'text-right' : 'text-left'}`}>{h}</th>)}</tr>
              </thead>
              <tbody>
                {d.rows.map((r) => (
                  <tr key={r.booking_no} className="border-t border-line-2">
                    <td className="whitespace-nowrap px-3 py-2"><span className="font-semibold">{r.booking_no}</span><span className="block text-2xs text-muted">{dateKo(r.created_at, { dow: false })}</span></td>
                    <td className="px-3 py-2 text-xs"><span className="flex items-center gap-1">{r.shipper} → {r.partner}{r.is_demo ? <DemoChip /> : null}</span></td>
                    <td className="px-3 py-2 text-right">{num(r.total)}</td>
                    <td className="px-3 py-2 text-right text-muted">{r.amounts.broker == null ? '—' : `−${num(r.amounts.broker)}`}</td>
                    <td className="px-3 py-2 text-right">{num(commissionBase(r.amounts))}</td>
                    <td className="px-3 py-2 text-right font-bold">{num(commissionAmount(r.amounts, rate))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
        <Panel className="self-start">
          <PanelHead title="요율 판 기록" sub="바꾸려면 설정에서 새 판을 만드세요" />
          <ul>{d.history.map((h, i) => <li key={i} className="border-b border-line-2 px-4 py-2.5 text-sm last:border-0"><b className="tnum">{(Number(h.value) / 100).toFixed(2)}%</b> <span className="text-xs text-muted">{dateTimeKo(h.created_at)}</span><p className="text-xs text-muted">{h.note}</p></li>)}</ul>
          <p className="border-t border-line-2 px-4 py-3 text-2xs text-muted">예: 물류비 {won(1_000_000)} 중 관세사 {won(33_000)} → 기준 {won(967_000)} × {(rate / 100).toFixed(2)}% = {won(commissionAmount({ freight: 967_000, broker: 33_000 }, rate))}</p>
        </Panel>
      </div>
    </>
  );
}
