import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';
import { Lock } from 'lucide-react';
import { asUser, todayKst } from '@/lib/db';
import { requireViewer } from '@/lib/server/viewer';
import { loadSettings } from '@/lib/server/settings';
import { autoQuote, myOrgFacts } from '@/lib/server/partner';
import { REQUEST_SELECT, type RequestRow } from '@/lib/server/shipper';
import { loadTraitRules } from '@/lib/server/compare';
import { getReference, nameOf } from '@/lib/server/reference';
import { exclusionReasons, reasonText } from '@/lib/money';
import { DetailHead } from '@/components/activity';
import { Deadline, RequestStatusChip } from '@/components/badges';
import { Button, Chip, DefList, EmptyState, Panel } from '@/components/ui/core';
import { BidForm } from './bid-form';
import { dateKo, dateTimeKo, num } from '@/lib/format';

export const metadata = { title: '견적 요청' };

export default async function InboxDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const v = await requireViewer('partner');
  const t = await getTranslations('p');
  const locale = (await getLocale()) as 'ko' | 'zh';
  const zh = locale === 'zh';
  const today = todayKst();
  const [ref, d] = await Promise.all([
    getReference(),
    asUser(v, async (q) => {
      const r = (await q.query<RequestRow>(`${REQUEST_SELECT} where id = $1`, [id]))[0];
      if (!r) return null;
      const s = await loadSettings(q);
      const [auto, facts, rules, mine, won] = await Promise.all([
        autoQuote(q, v.org.id, r, s, today),
        myOrgFacts(q, v.org.id),
        loadTraitRules(q),
        q.query<{ total: number; status: string; amounts: Record<string, number | null> }>(`select total, status, amounts from fcd.v_bids_current where request_id = $1 and org_id = $2`, [id, v.org.id]),
        q.query<{ partner_org_id: string; shipment_id: string | null }>(`select b.partner_org_id, (select s.id from fcd.shipments s where s.booking_id = b.id) shipment_id from fcd.bookings b where b.request_id = $1`, [id]),
      ]);
      return { r, auto, facts, rules, mine: mine[0] ?? null, won: won[0] ?? null };
    }),
  ]);
  if (!d) notFound();
  const { r, auto, facts, rules, mine, won } = d;
  const blocked = exclusionReasons({ orgId: v.org.id, capabilities: facts.caps, mode: auto?.mode ?? r.mode ?? 'LCL', validFrom: '0000-01-01', validTo: '9999-12-31', status: 'active' }, r.traits, rules.rules, today);
  const open = ['waiting', 'bidding', 'closing_soon'].includes(r.display_status);
  const traitRows = ref.traits.filter((x) => r.traits.includes(x.code));
  return (
    <>
      <DetailHead
        eyebrow={<Link href="/partner/inbox" className="hover:underline">{t('inbox.title')}</Link>}
        title={r.req_no}
        chips={<><RequestStatusChip status={r.display_status} />{open ? <Deadline at={r.bid_deadline} /> : null}{won ? <Chip tone={won.partner_org_id === v.org.id ? 'ok' : 'neutral'}>{won.partner_org_id === v.org.id ? t('inbox.status.won') : t('inbox.status.lost')}</Chip> : null}</>}
        sub={`${nameOf(ref, 'hub', r.origin_hub, zh)} → ${nameOf(ref, 'port', r.port, zh)} · ${t('inbox.shipperHidden')}`}
        actions={won?.partner_org_id === v.org.id && won.shipment_id ? <Button asChild variant="primary"><Link href={`/partner/shipments/${won.shipment_id}`}>{t('ship.title')}</Link></Button> : null}
      />
      <div className="grid gap-6 xl:grid-cols-[1fr_340px]">
        <div className="min-w-0">
          {blocked.length ? (
            <div className="mb-4 flex items-start gap-3 rounded-md border border-stamp/40 bg-stamp-bg p-4 text-sm">
              <Lock className="mt-0.5 size-4 text-stamp" aria-hidden />
              <div>
                <p className="font-bold text-stamp">{t('inbox.blocked')}</p>
                <ul className="mt-1 list-disc pl-4">{blocked.map((b, i) => <li key={i}>{reasonText(b)}</li>)}</ul>
                <p className="mt-2 text-xs text-muted">{zh ? '请在公司资料中登记承运能力后再报价。' : '회사 프로필에서 취급 능력을 등록하면 응찰할 수 있습니다.'}</p>
              </div>
            </div>
          ) : null}
          {auto ? (
            <BidForm requestId={r.id} auto={{ segments: auto.quote.segments, total: auto.quote.total }} mine={mine} locale={locale} canBid={open && blocked.length === 0} />
          ) : (
            <Panel>
              <EmptyState title={t('inbox.noCard')} body={zh ? '添加该线路的运价表后，会自动计算报价金额。' : '이 구간 요금표를 추가하면 자동 금액이 계산됩니다.'} action={<Button asChild variant="primary"><Link href={`/partner/rates/new?hub=${r.origin_hub}&port=${r.port}&mode=${r.mode ?? 'LCL'}`}>{t('rates.add')}</Link></Button>} />
            </Panel>
          )}
        </div>
        <Panel className="self-start p-4">
          <DefList
            items={[
              [t('inbox.lane'), `${nameOf(ref, 'hub', r.origin_hub, zh)} → ${nameOf(ref, 'port', r.port, zh)} → ${ref.fcs.find((f) => f.code === r.fc_code)?.name}`],
              [zh ? '方式' : '방식', r.mode ? nameOf(ref, 'mode', r.mode, zh) : zh ? '不限' : '상관없음'],
              [t('inbox.cargo'), `${num(r.units)}${zh ? '件' : '개'} · ${r.cartons}${zh ? '箱' : '박스'} · ${num(r.kg, 1)} kg · ${num(r.cbm, 2)} CBM`],
              [zh ? '货值' : '물품가', `${num(r.goods_value)} ${r.goods_currency}`],
              [zh ? '货物特性' : '특성', traitRows.map((x) => (zh ? x.name_zh : x.name_ko)).join(' · ') || (zh ? '普通' : '일반')],
              [zh ? '备货日' : '출고 준비', dateKo(r.ready_on)],
              [t('inbox.deadline'), dateTimeKo(r.bid_deadline)],
              [zh ? '备注' : '요청 메모', r.note ?? '—'],
            ]}
          />
          {traitRows.length ? (
            <ul className="mt-4 grid gap-1.5 border-t border-line-2 pt-3 text-xs">
              {traitRows.map((x) => <li key={x.code}><b>{zh ? x.name_zh : x.name_ko}</b> — {x.requirement_ko}</li>)}
            </ul>
          ) : null}
        </Panel>
      </div>
    </>
  );
}
