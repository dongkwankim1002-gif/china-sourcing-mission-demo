'use client';
import * as React from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Pencil, X } from 'lucide-react';
import { CargoFields, cargoToParams, type CargoValue, type SkuOption } from '@/components/cargo-form';
import { Button } from '@/components/ui/core';

export function CompareEditor({
  initial,
  summary,
  hubs,
  fcs,
  traits,
  skus,
  startOpen,
}: {
  initial: CargoValue;
  summary: string;
  hubs: { code: string; name_ko: string }[];
  fcs: { code: string; name: string }[];
  traits: { code: string; name_ko: string }[];
  skus: SkuOption[];
  startOpen?: boolean;
}) {
  const [open, setOpen] = React.useState(!!startOpen);
  const [v, setV] = React.useState(initial);
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [pending, start] = React.useTransition();
  const apply = () => {
    const p = cargoToParams(v);
    for (const k of ['view', 'sort', 'conf', 'fcr', 'off']) {
      const x = sp.get(k);
      if (x) p.set(k, x);
    }
    start(() => router.push(`${pathname}?${p}`));
    setOpen(false);
  };
  return (
    <div className="rounded-md border border-line bg-surface">
      <div className="flex flex-wrap items-center gap-3 px-4 py-3">
        <p className="min-w-0 flex-1 text-sm">
          <span className="mr-2 text-xs font-semibold text-muted">화물</span>
          <span className="font-semibold">{summary}</span>
        </p>
        <Button size="sm" variant={open ? 'ghost' : 'secondary'} onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          {open ? <X aria-hidden /> : <Pencil aria-hidden />} {open ? '닫기' : '조건 바꾸기'}
        </Button>
      </div>
      {open ? (
        <form
          className="border-t border-line-2 p-4"
          onSubmit={(e) => {
            e.preventDefault();
            apply();
          }}
        >
          <CargoFields value={v} onChange={setV} hubs={hubs} fcs={fcs} traits={traits} skus={skus} />
          <div className="mt-4 flex justify-end">
            <Button type="submit" variant="primary" disabled={pending}>
              {pending ? '계산하는 중…' : '이 조건으로 비교'}
            </Button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
