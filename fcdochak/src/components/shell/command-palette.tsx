'use client';
import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Command } from 'cmdk';
import { Dialog as D } from 'radix-ui';
import { ArrowRight, FileText, Package, Plus, Search, Ship, Building2, Upload, Loader } from 'lucide-react';
import { ACTION } from '@/lib/terms';
import { navFor, type AreaKey } from './nav';

interface Hit {
  kind: 'request' | 'shipment' | 'partner' | 'sku';
  id: string;
  title: string;
  sub: string;
  href: string;
}

const KIND_ICON = { request: FileText, shipment: Ship, partner: Building2, sku: Package } as const;
const KIND_LABEL = { request: '견적 요청', shipment: '선적', partner: '업체', sku: 'SKU' } as const;

export function CommandPalette({
  open,
  onOpenChange,
  area,
  locale,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  area: AreaKey;
  locale: 'ko' | 'zh';
}) {
  const router = useRouter();
  const [q, setQ] = React.useState('');
  const [hits, setHits] = React.useState<Hit[]>([]);
  const [loading, setLoading] = React.useState(false);
  const zh = locale === 'zh';

  React.useEffect(() => {
    if (!open) {
      setQ('');
      setHits([]);
    }
  }, [open]);

  React.useEffect(() => {
    if (q.trim().length < 1) {
      setHits([]);
      return;
    }
    const ctl = new AbortController();
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/search?area=${area}&q=${encodeURIComponent(q.trim())}`, { signal: ctl.signal });
        if (r.ok) setHits((await r.json()).hits as Hit[]);
      } catch {}
      setLoading(false);
    }, 140);
    return () => {
      clearTimeout(t);
      ctl.abort();
    };
  }, [q, area]);

  const go = (href: string) => {
    onOpenChange(false);
    router.push(href);
  };

  const actions =
    area === 'app'
      ? [
          { label: ACTION.newRequest, href: '/app/requests/new', icon: Plus },
          { label: ACTION.compare, href: '/app/compare', icon: ArrowRight },
          { label: ACTION.saveSku, href: '/app/skus?new=1', icon: Package },
        ]
      : area === 'partner'
        ? [
            { label: zh ? '添加运价表' : ACTION.addRateCard, href: '/partner/rates/new', icon: Plus },
            { label: zh ? 'Excel 上传运价表' : ACTION.uploadRateCards, href: '/partner/rates/upload', icon: Upload },
            { label: zh ? '询价收件箱' : '견적 수신함 열기', href: '/partner/inbox', icon: FileText },
          ]
        : [
            { label: '처리 대기 열기', href: '/admin/queues', icon: ArrowRight },
            { label: '설정 새 판 만들기', href: '/admin/settings', icon: Plus },
          ];

  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-[70] bg-ink/50" />
        <D.Content className="fixed inset-x-3 top-[12vh] z-[70] mx-auto max-w-xl overflow-hidden rounded-md border border-line bg-surface shadow-2">
          <D.Title className="sr-only">{zh ? '命令面板' : '명령 팔레트'}</D.Title>
          <D.Description className="sr-only">{zh ? '搜索或执行操作' : '번호·업체·SKU 로 이동하거나 행동을 실행합니다'}</D.Description>
          <Command shouldFilter={false} label={zh ? '命令面板' : '명령 팔레트'} className="flex flex-col">
            <div className="flex items-center gap-2 border-b border-line px-3">
              {loading ? <Loader className="size-4 animate-spin text-muted" aria-hidden /> : <Search className="size-4 text-muted" aria-hidden />}
              <Command.Input
                value={q}
                onValueChange={setQ}
                placeholder={zh ? '询价编号、货件编号、公司名…' : 'RQ-…, SH-…, 업체 이름, SKU 이름'}
                className="h-12 flex-1 bg-transparent text-md outline-none placeholder:text-muted"
              />
            </div>
            <Command.List className="max-h-[60vh] overflow-y-auto p-2">
              <Command.Empty className="px-3 py-6 text-center text-sm text-muted">
                {q ? (zh ? '没有结果' : '찾는 것이 없습니다. 번호 앞부분(RQ-2609)만 넣어 보세요.') : null}
              </Command.Empty>
              {hits.length > 0 ? (
                <Command.Group heading={zh ? '结果' : '찾은 것'} className="text-2xs font-semibold text-muted [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5">
                  {hits.map((h) => {
                    const Icon = KIND_ICON[h.kind];
                    return (
                      <Command.Item
                        key={h.kind + h.id}
                        value={h.kind + h.id}
                        onSelect={() => go(h.href)}
                        className="flex h-12 cursor-pointer items-center gap-3 rounded-sm px-2 text-sm text-text data-[selected=true]:bg-surface-2"
                      >
                        <Icon className="size-4 text-muted" aria-hidden />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-semibold">{h.title}</span>
                          <span className="block truncate text-xs text-muted">{h.sub}</span>
                        </span>
                        <span className="text-2xs text-muted">{KIND_LABEL[h.kind]}</span>
                      </Command.Item>
                    );
                  })}
                </Command.Group>
              ) : null}
              <Command.Group heading={zh ? '操作' : '행동'} className="text-2xs font-semibold text-muted [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5">
                {actions.map((a) => (
                  <Command.Item
                    key={a.href}
                    value={a.label}
                    onSelect={() => go(a.href)}
                    className="flex h-10 cursor-pointer items-center gap-3 rounded-sm px-2 text-sm text-text data-[selected=true]:bg-surface-2"
                  >
                    <a.icon className="size-4 text-muted" aria-hidden />
                    {a.label}
                  </Command.Item>
                ))}
              </Command.Group>
              <Command.Group heading={zh ? '页面' : '이동'} className="text-2xs font-semibold text-muted [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5">
                {navFor(area, locale).map((n) => (
                  <Command.Item
                    key={n.href}
                    value={'nav' + n.href}
                    onSelect={() => go(n.href)}
                    className="flex h-10 cursor-pointer items-center gap-3 rounded-sm px-2 text-sm text-text data-[selected=true]:bg-surface-2"
                  >
                    <n.icon className="size-4 text-muted" aria-hidden />
                    {n.label}
                  </Command.Item>
                ))}
              </Command.Group>
            </Command.List>
          </Command>
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}
