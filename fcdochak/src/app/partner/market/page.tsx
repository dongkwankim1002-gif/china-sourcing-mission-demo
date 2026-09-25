import { getLocale, getTranslations } from 'next-intl/server';
import { asUser, todayKst } from '@/lib/db';
import { requireViewer } from '@/lib/server/viewer';
import { marketData, myCards } from '@/lib/server/partner';
import { laneStats, STANDARD_CARGO } from '@/lib/server/public';
import { loadCards } from '@/lib/server/compare';
import { loadSettings } from '@/lib/server/settings';
import { getReference, nameOf } from '@/lib/server/reference';
import { completeWithReference, computeQuote, type Segment } from '@/lib/money';
import { PeriodPicker } from '@/components/period-picker';
import { EmptyState, PageTitle, Panel, PanelHead } from '@/components/ui/core';
import { cn } from '@/lib/cn';
import { pct, wonShort } from '@/lib/format';

export const metadata = { title: '시장 데이터' };

export default async function Market({ searchParams }: { searchParams: Promise<{ p?: string }> }) {
  const sp = await searchParams;
  const days = [30, 90].includes(Number(sp.p)) ? Number(sp.p) : 30;
  const v = await requireViewer('partner');
  const t = await getTranslations('p.mkt');
  const zh = (await getLocale()) === 'zh';
  const today = todayKst();
  const [ref, mk, lanes, mine] = await Promise.all([
    getReference(),
    marketData(v.org.id, days),
    laneStats(),
    asUser(v, async (q) => {
      const s = await loadSettings(q);
      const cards = (await myCards(q, v.org.id)).filter((c) => c.status === 'active' && c.valid_to >= today);
      const refQ = computeQuote(s.referenceLines, STANDARD_CARGO, s.quoteParams);
      const reference = Object.fromEntries(refQ.segments.map((x) => [x.segment, x.amount])) as Partial<Record<Segment, number>>;
      const out: { lane: string; slug: string; total: number }[] = [];
      for (const c of cards) {
        const { lines, tiers } = await loadCards(q, { hub: c.origin_hub, port: c.port, mode: c.mode, cardIds: [c.id] });
        const ls = lines.get(c.id) ?? [];
        if (!ls.some((l) => l.segment === 'freight' && l.included)) continue;
        const r = completeWithReference(computeQuote(ls, STANDARD_CARGO, s.quoteParams, tiers.get(c.id) ?? []), reference, STANDARD_CARGO.units);
        out.push({ lane: `${nameOf(ref, 'hub', c.origin_hub, zh)}→${nameOf(ref, 'port', c.port, zh)} · ${nameOf(ref, 'mode', c.mode, zh)}`, slug: `${c.origin_hub}-${c.port}-${c.mode}`.toLowerCase(), total: r.total });
      }
      return out;
    }),
  ]);
  const maxN = Math.max(1, ...mk.lanes.map((l) => l.n));
  const bandOrder = ['최저', '+5% 안', '+10% 안', '+10% 넘음'];
  const bandZh: Record<string, string> = { 최저: '最低价', '+5% 안': '+5%以内', '+10% 안': '+10%以内', '+10% 넘음': '超过+10%' };
  return (
    <>
      <PageTitle title={t('title')} sub={t('sub')} actions={<PeriodPicker value={days} options={[30, 90]} />} />
      <div className="grid gap-6 xl:grid-cols-2">
        <Panel>
          <PanelHead title={t('requests')} sub={`${days}${zh ? '天' : '일'}`} />
          {mk.lanes.length ? (
            <ul className="p-4">
              {mk.lanes.map((l) => (
                <li key={l.hub + l.port} className="grid grid-cols-[120px_1fr_70px] items-center gap-3 py-1.5 text-sm">
                  <span className="truncate font-semibold">{nameOf(ref, 'hub', l.hub, zh)}→{nameOf(ref, 'port', l.port, zh)}</span>
                  <span className="h-3 rounded-r-[3px] bg-[var(--chart-1)]" style={{ width: `${(l.n / maxN) * 100}%` }} aria-hidden />
                  <span className="text-right tnum">{l.n} <span className={cn('text-2xs', l.n >= l.prev ? 'text-ok' : 'text-stamp')}>{l.prev ? `${l.n >= l.prev ? '▲' : '▼'}${Math.abs(Math.round(((l.n - l.prev) / l.prev) * 100))}%` : ''}</span></span>
                </li>
              ))}
            </ul>
          ) : <EmptyState title="—" />}
        </Panel>
        <Panel>
          <PanelHead title={t('winrate')} sub={t('band')} />
          <table className="w-full text-sm tnum">
            <tbody>
              {bandOrder.map((b) => {
                const r = mk.bands.find((x) => x.band === b);
                const rate = r && r.total ? r.won / r.total : null;
                return (
                  <tr key={b} className="border-t border-line-2 first:border-0">
                    <th scope="row" className="px-4 py-2.5 text-left font-semibold">{zh ? bandZh[b] : b}</th>
                    <td className="px-4 py-2.5 text-muted">{r ? `${r.won}/${r.total}` : '0/0'}</td>
                    <td className="w-1/2 px-4 py-2.5"><span className="block h-3 rounded-r-[3px] bg-[var(--chart-1)]" style={{ width: `${(rate ?? 0) * 100}%` }} aria-hidden /></td>
                    <td className="px-4 py-2.5 text-right font-bold">{pct(rate, 0)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Panel>
        <Panel className="xl:col-span-2">
          <PanelHead title={t('price')} sub={`${STANDARD_CARGO.cbm} CBM · ${STANDARD_CARGO.kg} kg`} />
          {mine.length ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-sm tnum">
                <tbody>
                  {mine.map((m, i) => {
                    const l = lanes.find((x) => x.slug === m.slug);
                    const diff = l ? (m.total - l.median) / l.median : null;
                    return (
                      <tr key={i} className="border-t border-line-2 first:border-0">
                        <th scope="row" className="px-4 py-2.5 text-left font-semibold">{m.lane}</th>
                        <td className="px-4 py-2.5 text-right">{wonShort(m.total)}</td>
                        <td className="px-4 py-2.5 text-right text-muted">{l ? wonShort(l.median) : '—'}</td>
                        <td className={cn('px-4 py-2.5 text-right font-bold', diff == null ? '' : diff > 0.05 ? 'text-stamp' : diff < -0.05 ? 'text-ok' : 'text-muted')}>{pct(diff, 1, true)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : <EmptyState title="—" />}
        </Panel>
      </div>
    </>
  );
}
