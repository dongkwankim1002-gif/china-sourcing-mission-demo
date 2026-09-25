import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { asUser, todayKst } from '@/lib/db';
import { requireViewer } from '@/lib/server/viewer';
import { requestDetail } from '@/lib/server/shipper';
import { loadPartnerFacts } from '@/lib/server/compare';
import { loadSettings } from '@/lib/server/settings';
import { getReference, nameOf } from '@/lib/server/reference';
import { computeQuote, isFcReady, SEGMENTS, type Segment } from '@/lib/money';
import { ActivityLog, DetailHead } from '@/components/activity';
import { UrlTabs } from '@/components/url-tabs';
import { NineBar, NineBarLegend, NineTable, type BarSegment } from '@/components/nine-bar';
import { LetterMark } from '@/components/brand-mark';
import { Deadline, FcReadyChip, PartnerStatusChip, RelatedChip, RequestStatusChip, Won } from '@/components/badges';
import { Button, Chip, DefList, EmptyState, Panel } from '@/components/ui/core';
import { CancelRequestButton, SelectBidButton } from './select-button';
import { dateKo, dateTimeKo, num, pct, won } from '@/lib/format';

export const metadata = { title: '견적 요청' };

export default async function RequestDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const v = await requireViewer('app');
  const ref = await getReference();
  const data = await asUser(v, async (q) => {
    const d = await requestDetail(q, id);
    if (!d || d.r.org_id !== v.org.id) return null;
    const s = await loadSettings(q);
    const facts = await loadPartnerFacts(q, [...new Set(d.bids.map((b) => b.org_id))], todayKst());
    return { ...d, s, facts };
  });
  if (!data) notFound();
  const { r, bids, events, booking, s, facts } = data;
  const cargo = { units: r.units, cartons: r.cartons, kg: r.kg, cbm: r.cbm, goodsValue: r.goods_value, goodsCurrency: r.goods_currency as 'RMB' };
  const refQ = computeQuote(s.referenceLines, cargo, s.quoteParams);
  const reference = Object.fromEntries(refQ.segments.map((x) => [x.segment, x.amount ?? 0])) as Record<Segment, number>;
  const live = bids.filter((b) => b.status === 'submitted');
  const withFull = live
    .map((b) => {
      const segs: BarSegment[] = SEGMENTS.map((sg) => {
        const a = b.amounts[sg];
        return a == null
          ? { segment: sg, amount: reference[sg], certainty: 'estimated' as const, filled: true }
          : { segment: sg, amount: a, certainty: (b.certainties[sg] as BarSegment['certainty']) ?? 'confirmed' };
      });
      const full = segs.reduce((t, x) => t + (x.amount ?? 0), 0);
      return { b, segs, full };
    })
    .sort((a, b) => a.full - b.full);
  const scaleMax = Math.max(1, ...withFull.map((x) => x.full));
  const canSelect = r.status === 'open' && ['bidding', 'closing_soon', 'comparable'].includes(r.display_status);
  const traitRows = ref.traits.filter((t) => r.traits.includes(t.code));

  const bidsTab = withFull.length ? (
    <div className="grid gap-2">
      {withFull.map(({ b, segs, full }, i) => {
        const m = facts.metrics.get(b.org_id);
        const fc = (facts.grades.get(b.org_id) ?? false) && isFcReady(m?.shipments_done ?? 0, m?.return_rate_30d ?? null, s.fcReadyRule);
        const chosen = booking?.bid_id === b.id;
        return (
          <article key={b.id} className={`rounded-md border bg-surface p-4 ${chosen ? 'border-ok' : 'border-line'}`}>
            <div className="grid gap-3 lg:grid-cols-[240px_1fr_220px] lg:items-center">
              <div className="flex items-start gap-3">
                <span className="w-4 pt-1 text-center text-xs font-bold text-muted tnum">{i + 1}</span>
                <LetterMark name={b.partner_name} logo={b.logo_path} size={36} />
                <div className="min-w-0">
                  <Link href={`/p/${b.partner_slug}`} className="block truncate text-sm font-bold hover:underline">{b.partner_name}</Link>
                  <div className="mt-1 flex flex-wrap gap-1">
                    <PartnerStatusChip status={b.partner_status} />
                    {fc ? <FcReadyChip /> : null}
                    {b.related_party_note ? <RelatedChip note={b.related_party_note} /> : null}
                    {chosen ? <Chip tone="ok">선택함</Chip> : null}
                  </div>
                </div>
              </div>
              <div className="min-w-0">
                <NineBar segments={segs} size="md" scaleMax={scaleMax} label={`${b.partner_name} 응찰 9구간`} />
                <p className="mt-2 text-2xs text-muted">
                  {nameOf(ref, 'mode', b.mode)} · {b.transit_days_min}~{b.transit_days_max}일 · {b.kind === 'auto' ? '요금표 그대로(자동)' : '조정 응찰'} · 확정 {pct(b.confirmed_total / Math.max(full, 1), 0)} · 응찰 {dateTimeKo(b.created_at)} · {dateKo(b.valid_until, { dow: false })}까지 유효 · {b.bid_no}
                  {b.version > 1 ? ` v${b.version}` : ''}
                </p>
                {b.note ? <p className="mt-1 text-xs">“{b.note}”</p> : null}
              </div>
              <div className="flex items-end justify-between gap-2 lg:flex-col lg:items-end">
                <div className="lg:text-right">
                  <Won v={full} className="block text-lg font-bold" />
                  <span className="block text-2xs text-muted tnum">응찰 {won(b.total)} + 참고치 {won(full - b.total)}</span>
                  <span className="block text-xs text-muted tnum">개당 {num(Math.round(full / r.units))}원</span>
                </div>
                {canSelect ? <SelectBidButton requestId={r.id} bidId={b.id} partner={b.partner_name} total={b.total} /> : null}
              </div>
            </div>
          </article>
        );
      })}
      <NineBarLegend className="mt-1" />
    </div>
  ) : (
    <Panel>
      <EmptyState
        title={r.display_status === 'waiting' ? '아직 응찰이 없습니다' : '응찰이 없습니다'}
        body={r.display_status === 'waiting' ? '이 구간을 맡는 업체들에게 알렸습니다. 첫 응찰이 오면 알림으로 알려 드립니다.' : '마감까지 응찰이 오지 않았습니다. 조건(방식·마감)을 바꿔 다시 올려 보세요.'}
        action={<Button asChild variant="secondary"><Link href={`/app/compare?hub=${r.origin_hub}&port=${r.port}&units=${r.units}&cartons=${r.cartons}&kg=${r.kg}&cbm=${r.cbm}&goods=${r.goods_value}&cur=${r.goods_currency}&mode=${r.mode ?? 'ANY'}`}>요금표로 비교해 보기</Link></Button>}
      />
    </Panel>
  );

  return (
    <>
      <DetailHead
        eyebrow={<Link href="/app/requests" className="hover:underline">견적 요청</Link>}
        title={r.req_no}
        chips={<><RequestStatusChip status={r.display_status} />{r.status === 'open' ? <Deadline at={r.bid_deadline} /> : null}</>}
        sub={r.title}
        actions={
          <>
            {booking?.shipment_id ? <Button asChild variant="primary"><Link href={`/app/shipments/${booking.shipment_id}`}>선적 보기</Link></Button> : null}
            {r.status === 'open' && r.display_status !== 'expired' ? <CancelRequestButton id={r.id} /> : null}
          </>
        }
      />
      <div className="grid gap-6 xl:grid-cols-[1fr_320px]">
        <div className="min-w-0">
          <Suspense>
            <UrlTabs
              tabs={[
                { value: 'bids', label: `응찰 비교 (${live.length})`, content: bidsTab },
                {
                  value: 'cargo',
                  label: '화물',
                  content: (
                    <Panel className="p-4">
                      <DefList
                        items={[
                          ['구간', `${nameOf(ref, 'hub', r.origin_hub)} → ${nameOf(ref, 'port', r.port)}항 → ${ref.fcs.find((f) => f.code === r.fc_code)?.name ?? r.fc_code}`],
                          ['운송 방식', r.mode ? nameOf(ref, 'mode', r.mode) : '상관없음'],
                          ['수량 · 박스', `${num(r.units)}개 · ${num(r.cartons)}박스`],
                          ['무게 · 부피', `${num(r.kg, 1)} kg · ${num(r.cbm, 2)} CBM`],
                          ['물품가', `${num(r.goods_value)} ${r.goods_currency}`],
                          ['화물 특성', traitRows.map((t) => t.name_ko).join(' · ') || '일반'],
                          ['출고 준비일', dateKo(r.ready_on)],
                          ['응찰 마감', dateTimeKo(r.bid_deadline)],
                          ['전할 말', r.note ?? '—'],
                        ]}
                      />
                    </Panel>
                  ),
                },
                {
                  value: 'verdict',
                  label: '사전 판정',
                  content: traitRows.length ? (
                    <ul className="grid gap-2">
                      {traitRows.map((t) => (
                        <li key={t.code} className="rounded-md border border-caution/40 bg-caution-bg p-4 text-sm">
                          <b>{t.name_ko}</b> — {t.verdict_ko}
                          <p className="mt-1 text-xs text-muted">{t.requirement_ko}</p>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <Panel><EmptyState title="따로 챙길 것이 없습니다" body="일반 화물로 판정했습니다. 수입신고 때 원산지 표시만 확인하세요." /></Panel>
                  ),
                },
                {
                  value: 'table',
                  label: '9구간 표',
                  content: withFull.length ? (
                    <div className="grid gap-4">
                      {withFull.map(({ b, segs }) => (
                        <Panel key={b.id} className="p-4">
                          <p className="mb-2 text-sm font-bold">{b.partner_name}</p>
                          <NineTable segments={segs} />
                        </Panel>
                      ))}
                    </div>
                  ) : (
                    <Panel><EmptyState title="응찰이 오면 여기서 구간별로 견줍니다" /></Panel>
                  ),
                },
              ]}
            />
          </Suspense>
        </div>
        <ActivityLog
          items={events.map((e) => ({
            at: e.created_at,
            text: e.detail ?? e.kind,
            who: e.who,
            tone: e.kind === 'selected' ? 'ok' : e.kind === 'cancelled' ? 'stamp' : undefined,
          }))}
        />
      </div>
    </>
  );
}
