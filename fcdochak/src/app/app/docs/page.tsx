import Link from 'next/link';
import { asUser } from '@/lib/db';
import { requireViewer } from '@/lib/server/viewer';
import { shipperDocs, shipperShipmentChoices } from '@/lib/server/workspace';
import { DocUploader, ShelfList } from '@/components/shipment/docs';
import { Button, EmptyState, PageTitle, Panel, PanelHead } from '@/components/ui/core';
import { StageChip } from '@/components/badges';
import { SHELF_LABEL, missingShelves } from '@/lib/workspace/shelves';

export const metadata = { title: '서류함' };

export default async function DocsPage() {
  const v = await requireViewer('app');
  const [docs, ships] = await asUser(v, (q) => Promise.all([shipperDocs(q, v.org.id), shipperShipmentChoices(q, v.org.id)]));
  const byShip = new Map<string, typeof docs>();
  for (const d of docs) byShip.set(d.shipment_id, [...(byShip.get(d.shipment_id) ?? []), d]);
  const active = ships.filter((s) => s.stage < 9);
  const gaps = active.map((s) => ({ s, missing: missingShelves(byShip.get(s.id) ?? []) })).filter((g) => g.missing.length);

  return (
    <>
      <PageTitle title="서류함" sub="선적마다 오간 서류를 칸별로 모았습니다 — 인보이스 · 패킹리스트 · 쿠팡 바코드 PDF · B/L · 기타." />
      {ships.length === 0 ? (
        <Panel>
          <EmptyState title="아직 선적이 없습니다" body="예약으로 전환한 선적이 생기면 그 선적의 서류를 여기서 주고받습니다." action={<Button asChild variant="primary"><Link href="/app/requests">견적 요청 보기</Link></Button>} />
        </Panel>
      ) : (
        <div className="grid gap-6 xl:grid-cols-[1fr_340px]">
          <div className="grid min-w-0 content-start gap-4">
            <DocUploader shipments={ships.map((s) => ({ id: s.id, label: `${s.shipment_no} · ${s.title}` }))} defaultShelf="coupang_barcode" />
            <ShelfList docs={docs} showShipment max={12} />
          </div>
          <Panel className="content-start self-start" aria-labelledby="gaps-h">
            <PanelHead id="gaps-h" title="진행 선적의 빠진 서류" sub="쿠팡 입고에 늘 필요한 인보이스·패킹리스트·쿠팡 바코드 PDF 기준" />
            {gaps.length ? (
              <ul className="divide-y divide-line-2" data-testid="docs-gaps">
                {gaps.slice(0, 30).map(({ s, missing }) => (
                  <li key={s.id} className="grid gap-1 px-4 py-2.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link href={`/app/shipments/${s.id}?tab=docs`} className="text-sm font-semibold hover:underline">{s.shipment_no}</Link>
                      <StageChip stage={s.stage} />
                    </div>
                    <p className="truncate text-xs text-muted" title={s.title}>{s.title}</p>
                    <p className="text-xs text-caution">없음: {missing.map((m) => SHELF_LABEL[m]).join(' · ')}</p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-4 py-4 text-sm text-muted">진행 중인 선적에 빠진 서류가 없습니다.</p>
            )}
          </Panel>
        </div>
      )}
    </>
  );
}
