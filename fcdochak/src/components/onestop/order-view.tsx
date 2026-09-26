/**
 * 원스톱 주문 한 건 — 화주 화면(/onestop/orders/[id])과 운영 화면(/admin/onestop/[id])이 같은 몸통을 쓴다.
 * 서버에서만 그린다(자료는 서버가 읽어 넘긴다).
 */
import Link from 'next/link';
import { FolderOpen, Ship } from 'lucide-react';
import { OnestopTimeline } from './timeline';
import { PriceCard, snapToView } from './parts';
import { Chip, DefList, Panel, PanelHead } from '@/components/ui/core';
import { dateTimeKo, num, won } from '@/lib/format';
import { ONESTOP_INSPECTION_LABEL, STAGES } from '@/lib/terms';
import type { EventRow, OrderRow, VersionRow } from '@/lib/server/onestop';

export function OrderBody({
  o,
  events,
  versions,
  hubName,
  fcName,
  categoryName,
  area,
}: {
  o: OrderRow;
  events: EventRow[];
  versions: VersionRow[];
  hubName: string;
  fcName: string;
  categoryName: string;
  area: 'app' | 'admin';
}) {
  return (
    <div className="grid gap-6">
      <Panel aria-labelledby="tl-h">
        <PanelHead id="tl-h" title="진행" sub={o.shownFromShipment ? `이은 선적 ${o.shipment_no} 의 기록을 따라갑니다` : '단계는 운영이 확인할 때마다 쌓입니다'} />
        <div className="p-4">
          <OnestopTimeline receivedAt={o.received_at} events={events} shown={o.shown} fromShipment={o.shownFromShipment} shipmentNo={o.shipment_no} />
        </div>
        {o.shipment_id ? (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line-2 px-4 py-3 text-sm" data-testid="onestop-shipment">
            <span className="flex items-center gap-1.5">
              <Ship aria-hidden className="size-4 text-muted" />
              이은 선적 <b className="tnum">{o.shipment_no}</b> · {o.shipment_stage}. {STAGES[o.shipment_stage ?? 0]}
            </span>
            {area === 'app' ? (
              <>
                <Link href={`/app/shipments/${o.shipment_id}`} className="font-semibold underline underline-offset-4">
                  선적 화면
                </Link>
                <Link href={`/app/shipments/${o.shipment_id}?tab=docs`} className="flex items-center gap-1 font-semibold underline underline-offset-4">
                  <FolderOpen aria-hidden className="size-4" />
                  서류함
                </Link>
              </>
            ) : null}
          </div>
        ) : null}
      </Panel>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <Panel aria-labelledby="od-h" className="self-start">
          <PanelHead id="od-h" title="맡긴 것" sub={`${o.order_no} · ${o.version}판${o.measured ? ' · 중국 창고 실측' : ''}`} />
          <div className="p-4">
            <DefList
              items={[
                ['상품', <span key="p" className="break-words">{o.product_name}</span>],
                ['분류', categoryName],
                ['사입처', o.source_url ? <a key="u" href={o.source_url} rel="noreferrer nofollow" target="_blank" className="break-all underline underline-offset-4">{o.source_url}</a> : '—'],
                ['수량 · 박스', <span key="q" className="tnum">{num(o.units)}개 · {num(o.cartons)}박스</span>],
                ['부피 · 무게', <span key="c" className="tnum">{num(o.cbm, 2)} CBM · {num(o.kg, 1)} kg</span>],
                ['개당 매입가', o.unit_price ? <span key="up" className="tnum">{num(o.unit_price, 2)} {o.currency}</span> : '—'],
                ['길', `${hubName} · ${o.mode === 'FERRY' ? '카페리 혼적' : 'LCL 혼적'} → ${o.port === 'PTK' ? '평택' : '인천'} → ${fcName}`],
                ['맡길 일', [o.purchase ? '사입 대행' : null, o.barcode ? '바코드 부착' : null, ONESTOP_INSPECTION_LABEL[o.inspection]].filter(Boolean).join(' · ')],
                ['남긴 말', o.note ?? '—'],
              ]}
            />
            {o.preview ? (
              <p className="mt-3">
                <Chip tone="caution">접수 기록만 · 대행 계약 전</Chip>
              </p>
            ) : null}
          </div>
        </Panel>
        <div className="min-w-0 self-start">
          <PriceCard v={snapToView(o.quote)} testId="onestop-order-price" />
          <p className="mt-2 text-2xs text-muted">접수 때 서버가 그때 요금표·구간 시세로 셈한 값입니다. 실측으로 새 판이 생기면 다시 셉니다.</p>
        </div>
      </div>

      {versions.length > 1 ? (
        <Panel aria-labelledby="ver-h">
          <PanelHead id="ver-h" title={`판 ${versions.length}개`} sub="앞 판은 고치지 않고 그대로 남습니다" />
          <ul className="divide-y divide-line-2 text-sm" data-testid="onestop-versions">
            {versions.map((x) => (
              <li key={x.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 py-2">
                <span className="min-w-0">
                  <b>{x.version}판</b>
                  {x.measured ? ' · 실측' : ''}
                  {x.shipment_no ? ` · 선적 ${x.shipment_no}` : ''} · <span className="text-muted">{x.change_note ?? '첫 접수'}</span>
                </span>
                <span className="text-xs text-muted tnum">
                  {num(x.cbm, 2)} CBM · {won(x.total_krw)} · {dateTimeKo(x.created_at)}
                  {x.by_name ? ` · ${x.by_name}` : ''}
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}
    </div>
  );
}
