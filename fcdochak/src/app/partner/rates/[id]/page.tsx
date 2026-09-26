import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';
import { asUser, todayKst } from '@/lib/db';
import { requireViewer } from '@/lib/server/viewer';
import { loadCards } from '@/lib/server/compare';
import { loadSettings } from '@/lib/server/settings';
import { getReference, nameOf } from '@/lib/server/reference';
import { STANDARD_CARGO } from '@/lib/server/public';
import { computeQuote } from '@/lib/money';
import { SEGMENT_LABEL_KO, SEGMENT_LABEL_ZH } from '@/lib/money/segments';
import { DetailHead } from '@/components/activity';
import { NineBar } from '@/components/nine-bar';
import { Chip, DefList, Panel, PanelHead } from '@/components/ui/core';
import { CardActions } from './actions';
import { dateKo, dateTimeKo, num, won } from '@/lib/format';
import { BASIS_LABEL, CERTAINTY_LABEL } from '@/lib/terms';

export const metadata = { title: '요금표' };

export default async function CardPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const v = await requireViewer('partner');
  const t = await getTranslations('p.rates');
  const zh = (await getLocale()) === 'zh';
  const today = todayKst();
  const [ref, d] = await Promise.all([
    getReference(),
    asUser(v, async (q) => {
      const c = (await q.query<{ id: string; org_id: string; card_no: string; version: number; origin_hub: string; port: string; mode: string; valid_from: string; valid_to: string; certainty: string; status: string; is_public_price: boolean; fuel_surcharge_separate: boolean; transit_days_min: number; transit_days_max: number; created_at: string; change_note: string | null; current: boolean }>(
        `select r.*, not exists (select 1 from fcd.rate_cards n where n.supersedes_id = r.id) current from fcd.rate_cards r where r.id = $1 and r.org_id = $2`,
        [id, v.org.id],
      ))[0];
      if (!c) return null;
      const history = await q.query<{ id: string; version: number; valid_from: string; valid_to: string; status: string; change_note: string | null; created_at: string }>(
        `select id, version, valid_from, valid_to, status, change_note, created_at from fcd.rate_cards where card_no = $1 and org_id = $2 order by version desc`,
        [c.card_no, v.org.id],
      );
      const { lines, tiers } = await loadCards(q, { hub: c.origin_hub, port: c.port, mode: c.mode, cardIds: [c.id] }).catch(() => ({ lines: new Map(), tiers: new Map() }));
      const s = await loadSettings(q);
      const raw = await q.query<{ segment: string; included: boolean; basis: string; unit_price: number; currency: string; min_charge: number | null; certainty: string }>(
        `select l.segment, l.included, l.basis, l.unit_price, l.currency, l.min_charge, l.certainty from fcd.rate_card_lines l join fcd.segments sg on sg.code = l.segment where l.rate_card_id = $1 order by sg.ord`,
        [id],
      );
      const tierRows = await q.query<{ min_qty: number; discount_bp: number }>(`select min_qty, discount_bp from fcd.rate_card_tiers where rate_card_id = $1 order by min_qty`, [id]);
      const quote = computeQuote(
        raw.map((l) => ({ segment: l.segment as never, included: l.included, basis: l.basis as never, unitPrice: l.unit_price, currency: l.currency as never, minCharge: l.min_charge, certainty: l.certainty as never })),
        STANDARD_CARGO,
        s.quoteParams,
        tierRows.map((x) => ({ segment: 'freight' as const, minQty: x.min_qty, discountBp: x.discount_bp })),
      );
      void lines;
      void tiers;
      return { c, history, raw, tierRows, quote };
    }),
  ]);
  if (!d) notFound();
  const { c, history, raw, tierRows, quote } = d;
  const names = zh ? SEGMENT_LABEL_ZH : SEGMENT_LABEL_KO;
  const state = c.status === 'withdrawn' ? 'withdrawn' : c.valid_to < today ? 'expired' : 'valid';
  return (
    <>
      <DetailHead
        eyebrow={<Link href="/partner/rates" className="hover:underline">{t('title')}</Link>}
        title={`${c.card_no} v${c.version}`}
        chips={<><Chip tone={state === 'valid' ? 'ok' : state === 'expired' ? 'stamp' : 'neutral'}>{t(state)}</Chip>{c.is_public_price ? <Chip tone="info">{t('public')}</Chip> : null}{!c.current ? <Chip tone="neutral">{zh ? '旧版' : '지난 판'}</Chip> : null}</>}
        sub={`${nameOf(ref, 'hub', c.origin_hub, zh)} → ${nameOf(ref, 'port', c.port, zh)} · ${nameOf(ref, 'mode', c.mode, zh)} · ${dateKo(c.valid_from, { dow: false })} ~ ${dateKo(c.valid_to, { dow: false })}`}
        actions={<CardActions id={c.id} today={today} validTo={c.valid_to} current={c.current} />}
      />
      <div className="grid gap-6 xl:grid-cols-[1fr_340px]">
        <div className="grid min-w-0 gap-6">
          <Panel>
            <PanelHead title={t('sample')} sub={`${STANDARD_CARGO.cbm} CBM · ${STANDARD_CARGO.kg} kg · ${STANDARD_CARGO.cartons} · ${STANDARD_CARGO.units}`} action={<b className="tnum">{won(quote.total)}</b>} />
            <div className="p-4"><NineBar segments={quote.segments} size="md" locale={zh ? 'zh' : 'ko'} /></div>
          </Panel>
          <Panel>
            <PanelHead title={t('lines')} />
            <div className="overflow-x-auto">
              <table className="w-full min-w-[600px] text-sm tnum">
                <tbody>
                  {raw.map((l, i) => (
                    <tr key={l.segment} className="border-t border-line-2 first:border-0">
                      <th scope="row" className="px-4 py-2 text-left font-semibold"><span className="mr-1.5 inline-block size-2 rounded-[1px]" style={{ background: `var(--seg-${i + 1})` }} />{names[l.segment as never]}</th>
                      <td className="px-2 py-2">{l.included ? <Chip tone="ok">{zh ? '包含' : '포함'}</Chip> : <Chip tone="neutral">{zh ? '不含' : '제외'}</Chip>}</td>
                      <td className="px-2 py-2 text-muted">{l.included ? BASIS_LABEL[l.basis] : ''}</td>
                      <td className="px-2 py-2 text-right">{l.included ? `${num(l.unit_price, 2)} ${l.currency}` : '—'}</td>
                      <td className="px-2 py-2 text-right text-muted">{l.included && l.min_charge ? `min ${num(l.min_charge, 2)}` : ''}</td>
                      <td className="px-4 py-2 text-right text-xs">{l.included ? CERTAINTY_LABEL[l.certainty] : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {tierRows.length ? <p className="border-t border-line-2 px-4 py-2 text-xs text-muted">{zh ? '国际运输阶梯折扣' : '국제운송 구간 할인표'}: {tierRows.map((x) => `${x.min_qty}+ → −${x.discount_bp / 100}%`).join(' · ')}</p> : null}
          </Panel>
        </div>
        <div className="grid content-start gap-6">
          <Panel className="p-4">
            <DefList items={[[zh ? '时效' : '기간', `${c.transit_days_min}~${c.transit_days_max}${zh ? '天' : '일'}`], [zh ? '燃油附加费' : '유류할증', c.fuel_surcharge_separate ? (zh ? '另计' : '별도') : zh ? '包含' : '포함'], [zh ? '提交' : '제공', dateTimeKo(c.created_at)], [zh ? '备注' : '바뀐 점', c.change_note ?? '—']]} />
          </Panel>
          <Panel>
            <PanelHead title={t('history')} />
            <ol>
              {history.map((h) => (
                <li key={h.id} className="border-b border-line-2 px-4 py-2.5 text-sm last:border-0">
                  <Link href={`/partner/rates/${h.id}`} className={h.id === c.id ? 'font-bold' : 'hover:underline'}>v{h.version}</Link>{' '}
                  <span className="text-xs text-muted tnum">{h.valid_from} ~ {h.valid_to}{h.status === 'withdrawn' ? ` · ${t('withdrawn')}` : ''}</span>
                  <p className="text-2xs text-muted">{h.change_note} · {dateTimeKo(h.created_at)}</p>
                </li>
              ))}
            </ol>
          </Panel>
        </div>
      </div>
    </>
  );
}
