'use client';
/** 판매 상품 ↔ 저장한 SKU 잇기(v2 3차 고침) — 새 판으로 쌓는다(linkSalesProductSku) */
import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Link2 } from 'lucide-react';
import { linkSalesProductSku } from '@/app/actions/sales';
import { Button, NativeSelect } from '@/components/ui/core';
import { SALES_PRODUCT_ACTION } from '@/lib/terms';

export function SkuLinkForm({ ext, productName, skus }: { ext: string; productName: string; skus: { id: string; name: string }[] }) {
  const router = useRouter();
  const [sku, setSku] = React.useState('');
  const [pending, start] = React.useTransition();
  if (!skus.length) return <span className="text-2xs text-muted">SKU 를 먼저 저장하면 이을 수 있습니다</span>;
  const id = `sku-link-${ext}`;
  return (
    <form
      className="flex items-center justify-end gap-1.5"
      data-testid="sales-sku-link"
      onSubmit={(e) => {
        e.preventDefault();
        if (!sku) return;
        start(async () => {
          const r = await linkSalesProductSku({ ext, skuId: sku });
          if (!r.ok) return void toast.error(r.error ?? 'SKU 를 잇지 못했습니다');
          toast.success(`${productName} — SKU 를 이었습니다(새 판)`);
          router.refresh();
        });
      }}
    >
      <label htmlFor={id} className="sr-only">
        {productName} 에 이을 SKU
      </label>
      <NativeSelect id={id} value={sku} onChange={(e) => setSku(e.target.value)} className="h-8 max-w-[150px] text-xs">
        <option value="">SKU 고르기</option>
        {skus.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </NativeSelect>
      <Button type="submit" size="sm" variant="secondary" disabled={!sku || pending}>
        <Link2 aria-hidden /> {SALES_PRODUCT_ACTION.linkSku}
      </Button>
    </form>
  );
}
