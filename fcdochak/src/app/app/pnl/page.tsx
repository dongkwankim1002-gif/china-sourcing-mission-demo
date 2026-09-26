import Link from 'next/link';
import { asUser, todayKst } from '@/lib/db';
import { requireViewer } from '@/lib/server/viewer';
import { listSkus } from '@/lib/server/shipper';
import { loadSettings } from '@/lib/server/settings';
import { compare, rankOffers, sortOffers } from '@/lib/server/compare';
import { SEGMENTS_TO_KR_PORT } from '@/lib/money/segments';
import { Button, EmptyState, PageTitle, Panel } from '@/components/ui/core';
import { PnlCalc } from './calc';

export const metadata = { title: '판매손익' };

export default async function PnlPage({ searchParams }: { searchParams: Promise<{ sku?: string; hub?: string; port?: string }> }) {
  const sp = await searchParams;
  const v = await requireViewer('app');
  const data = await asUser(v, async (q) => {
    const s = await loadSettings(q);
    const skus = await listSkus(q, v.org.id);
    const sku = skus.find((x) => x.id === sp.sku) ?? skus[0];
    let offer = null;
    if (sku) {
      const r = await compare(q, { hub: sp.hub ?? 'YIW', port: sp.port ?? 'ICN', mode: null, cargo: { units: sku.units, cartons: sku.cartons, kg: sku.kg, cbm: sku.cbm, goodsValue: sku.goods_value, goodsCurrency: sku.goods_currency as 'RMB' }, traits: sku.traits }, s, todayKst());
      // 특수관계 업체는 기본으로 순위에서 뺀다(비교 화면과 같다) — 그 밖에 없을 때만 넣는다
      const best = rankOffers(r.offers, { sort: 'recommend', includeRelated: false }).list[0] ?? sortOffers(r.offers, 'recommend')[0];
      if (best) offer = { partner: best.partner.name, total: best.quote.total, units: sku.units, toPort: best.quote.segments.filter((x) => SEGMENTS_TO_KR_PORT.includes(x.segment)).reduce((a, x) => a + (x.amount ?? 0), 0) };
    }
    return { s, skus, sku, offer };
  });
  return (
    <>
      <PageTitle title="판매손익" sub="쿠팡 판매가에서 개당 얼마가 남는지. 관세·부가세는 참고 추정입니다." actions={<Button asChild variant="secondary"><Link href="/app/skus">SKU 관리</Link></Button>} />
      {data.skus.length === 0 ? (
        <Panel className="mb-4"><EmptyState title="저장한 SKU 가 없습니다" body="SKU 를 저장하면 수량·물품가·관세 분류를 불러와 바로 계산합니다. 없어도 아래에서 직접 넣을 수 있습니다." action={<Button asChild variant="primary"><Link href="/app/skus?new=1">SKU 저장</Link></Button>} /></Panel>
      ) : null}
      <PnlCalc
        skus={data.skus.map((x) => ({ id: x.id, name: x.name, units: x.units, goods_value: x.goods_value, goods_currency: x.goods_currency as 'RMB', hs_category: x.hs_category, target_price: x.target_price }))}
        fx={data.s.fx}
        vatRateBp={data.s.vatRateBp}
        insuranceBp={data.s.insuranceBp}
        saleFeeBp={data.s.saleFeeBp}
        fulfillmentPerUnit={data.s.fulfillmentPerUnit}
        duty={data.s.dutyRates}
        offer={data.offer}
        initialSku={data.sku?.id ?? null}
      />
    </>
  );
}
