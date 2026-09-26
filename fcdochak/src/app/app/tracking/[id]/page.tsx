import Link from 'next/link';
import { notFound } from 'next/navigation';
import { asUser } from '@/lib/db';
import { requireViewer } from '@/lib/server/viewer';
import { loadTrackerConfig, trackById, trackView } from '@/lib/server/tracker';
import { getReference, nameOf } from '@/lib/server/reference';
import { DetailHead } from '@/components/activity';
import { TrackResultView } from '@/components/tracker/result';
import { TrackControls, TrackLinkForm } from '@/components/tracker/controls';
import { DemoChip } from '@/components/badges';
import { Chip, DefList, Panel, PanelHead } from '@/components/ui/core';
import { dateTimeKo } from '@/lib/format';
import { TRACK_KIND_LABEL } from '@/lib/unipass/validate';
import { env } from '@/lib/env';

export const metadata = { title: '통관 알림' };

export default async function TrackDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const v = await requireViewer('app');
  const [d, ref] = await Promise.all([
    asUser(v, async (q) => {
      const t = await trackById(q, id);
      if (!t || t.org_id !== v.org.id) return null;
      const cfg = await loadTrackerConfig(q);
      const { view, events } = await trackView(q, t, cfg);
      const ships = await q.query<{ id: string; shipment_no: string; port: string; mode: string }>(
        `select id, shipment_no, port, mode from fcd.shipments where shipper_org_id = $1 and (stage < 9 or id = $2) order by created_at desc limit 50`,
        [v.org.id, t.shipment_id],
      );
      const partners = await q.query<{ id: string; name: string; business_type: string | null }>(
        `select id, name, business_type from fcd.orgs where kind = 'partner' and status in ('public_info', 'pending_verification', 'official') order by name limit 200`,
      );
      return { t, view, events, cfg, ships, partners };
    }),
    getReference(),
  ]);
  if (!d) notFound();
  const { t, view, events } = d;
  const source = events.some((e) => e.source === 'unipass') ? 'unipass' : events.length ? 'mock' : null;
  return (
    <>
      <DetailHead
        eyebrow={<Link href="/app/tracking" className="hover:underline">통관 알림</Link>}
        title={t.label ?? t.number}
        chips={<>{t.is_demo ? <DemoChip /> : null}{t.last_error ? <Chip tone="caution">{t.last_error}</Chip> : null}</>}
        sub={`${TRACK_KIND_LABEL[t.kind]} ${t.number}${t.bl_year ? ` · ${t.bl_year}` : ''} · 마지막 조회 ${t.last_checked_at ? dateTimeKo(t.last_checked_at) : '아직 없음'}`}
        actions={<TrackControls id={t.id} watching={t.watching} />}
      />
      <div className="grid gap-6 xl:grid-cols-[1fr_340px]">
        <div className="min-w-0">
          <TrackResultView view={view} mock={source === 'mock' && !env.unipassEnabled} source={source} />
        </div>
        <div className="grid content-start gap-4">
          <Panel className="p-4">
            <DefList
              items={[
                ['항구', t.port ? `${nameOf(ref, 'port', t.port)}${t.port_raw ? ` (${t.port_raw})` : ''}` : t.port_raw ?? '—'],
                ['방식', t.mode ? nameOf(ref, 'mode', t.mode) : '모름'],
                ['선적', t.shipment_id ? <Link key="s" href={`/app/shipments/${t.shipment_id}`} className="underline">{t.shipment_no}</Link> : '잇지 않음'],
                ['물류사', t.partner_name ?? '—'],
                ['관세사', t.broker_name ?? '—'],
                ['관세청 상태', t.status_raw ?? '—'],
              ]}
            />
          </Panel>
          <Panel>
            <PanelHead title="선적·업체 잇기" sub="이은 번호의 실측이 물류사·관세사별 통계(표본 기준 이상일 때 공개)에 들어갑니다" />
            <div className="p-4">
              <TrackLinkForm
                id={t.id}
                initial={{ label: t.label ?? '', mode: t.mode ?? '', shipmentId: t.shipment_id ?? '', partnerId: t.partner_org_id ?? '', brokerId: t.broker_org_id ?? '' }}
                shipments={d.ships.map((s) => ({ id: s.id, label: `${s.shipment_no} · ${nameOf(ref, 'port', s.port)} · ${nameOf(ref, 'mode', s.mode)}` }))}
                partners={d.partners.filter((p) => p.business_type !== 'customs_broker').map((p) => ({ id: p.id, label: p.name }))}
                brokers={d.partners.filter((p) => p.business_type === 'customs_broker').map((p) => ({ id: p.id, label: p.name }))}
              />
            </div>
          </Panel>
          {!d.cfg.promiseOn ? (
            <p className="rounded-md border border-dashed border-line p-3 text-xs text-muted">
              「도착일 약속」(실측 「늦으면」 날짜를 넘기면 보상)은 준비 중입니다 — 지금은 예상일만 보여 드립니다.
            </p>
          ) : null}
        </div>
      </div>
    </>
  );
}
