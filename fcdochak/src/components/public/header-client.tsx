'use client';
import * as React from 'react';
import Link from 'next/link';
import { Menu as MenuIcon, ChevronDown, Package, Truck, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/core';
import { Dialog, DialogTrigger, Menu, MenuContent, MenuItem, MenuLabel, MenuTrigger, SheetContent } from '@/components/ui/radix';
import { demoLogin } from '@/app/actions/session';
import { ACTION } from '@/lib/terms';

function useMe() {
  const [me, setMe] = React.useState<{ name: string; home: string } | null | undefined>(undefined);
  React.useEffect(() => {
    let alive = true;
    fetch('/api/me')
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => alive && setMe(j))
      .catch(() => alive && setMe(null));
    return () => {
      alive = false;
    };
  }, []);
  return me;
}

export function DemoMenu({ variant = 'primary', label = ACTION.demo, align = 'end' }: { variant?: 'primary' | 'secondary' | 'onInk'; label?: string; align?: 'start' | 'end' }) {
  const items = [
    { as: 'shipper', label: '화주로 둘러보기', sub: '비교 · 견적 요청 · 선적 추적', icon: Package },
    { as: 'partner', label: '물류사로 둘러보기', sub: '견적 수신함 · 요금표 · 한/中', icon: Truck },
    { as: 'admin', label: '운영자로 둘러보기', sub: '대시보드 · 인증 큐 · 설정', icon: ShieldCheck },
  ];
  // 폼은 메뉴 밖에 둔다. 메뉴 안에 두면 항목을 누르는 순간 메뉴가 닫히며 폼이 먼저 문서에서 빠져
  // 브라우저가 제출을 취소한다(「form is not connected」 — 요청이 서버에 가지 않았다).
  // 항목의 onSelect 가 메뉴 밖에 늘 붙어 있는 폼을 제출한다.
  const forms = React.useRef<Record<string, HTMLFormElement | null>>({});
  return (
    <>
      {items.map((it) => (
        <form
          key={it.as}
          ref={(el) => {
            forms.current[it.as] = el;
          }}
          action={demoLogin}
          hidden
          data-demo-form={it.as}
        >
          <input type="hidden" name="as" value={it.as} />
        </form>
      ))}
      <DemoMenuInner items={items} variant={variant} label={label} align={align} onPick={(as) => forms.current[as]?.requestSubmit()} />
    </>
  );
}

function DemoMenuInner({
  items,
  variant,
  label,
  align,
  onPick,
}: {
  items: { as: string; label: string; sub: string; icon: typeof Package }[];
  variant: 'primary' | 'secondary' | 'onInk';
  label: string;
  align: 'start' | 'end';
  onPick: (as: string) => void;
}) {
  return (
    <Menu>
      <MenuTrigger asChild>
        <Button variant={variant === 'onInk' ? 'primary' : variant} size="sm" className="gap-1">
          {label}
          <ChevronDown aria-hidden />
        </Button>
      </MenuTrigger>
      <MenuContent align={align} className="w-64">
        <MenuLabel>예시 계정으로 바로 들어갑니다</MenuLabel>
        {items.map((it) => (
          <MenuItem key={it.as} className="h-auto w-full py-2 text-left" onSelect={() => onPick(it.as)}>
            <it.icon aria-hidden />
            <span className="flex flex-col">
              <span className="font-semibold">{it.label}</span>
              <span className="text-2xs text-muted">{it.sub}</span>
            </span>
          </MenuItem>
        ))}
      </MenuContent>
    </Menu>
  );
}

export function AccountSlot({ demo }: { demo: boolean }) {
  const me = useMe();
  if (me) {
    return (
      <Button asChild variant="primary" size="sm" className="hidden sm:inline-flex">
        <Link href={me.home}>내 작업공간</Link>
      </Button>
    );
  }
  return (
    <div className="hidden items-center gap-2 sm:flex">
      <Button asChild variant="onInk" size="sm">
        <Link href="/login">{ACTION.login}</Link>
      </Button>
      {demo ? <DemoMenu variant="onInk" /> : (
        <Button asChild variant="primary" size="sm">
          <Link href="/join/shipper">{ACTION.joinShipper}</Link>
        </Button>
      )}
    </div>
  );
}

export function MobileNav({ items, demo }: { items: { href: string; label: string }[]; demo: boolean }) {
  const [open, setOpen] = React.useState(false);
  const me = useMe();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger className="grid size-10 place-items-center rounded-sm hover:bg-white/10 md:hidden" aria-label="메뉴 열기">
        <MenuIcon className="size-5" />
      </DialogTrigger>
      <SheetContent title="메뉴" side="right">
        <ul className="flex flex-col">
          {items.map((n) => (
            <li key={n.href}>
              <Link href={n.href} onClick={() => setOpen(false)} className="flex h-12 items-center border-b border-line-2 text-md font-semibold">
                {n.label}
              </Link>
            </li>
          ))}
        </ul>
        <div className="mt-6 flex flex-col gap-2">
          {me ? (
            <Button asChild variant="primary" size="lg">
              <Link href={me.home}>내 작업공간</Link>
            </Button>
          ) : (
            <>
              <Button asChild variant="secondary" size="lg">
                <Link href="/login">{ACTION.login}</Link>
              </Button>
              <Button asChild variant="primary" size="lg">
                <Link href="/join/shipper">{ACTION.joinShipper}</Link>
              </Button>
              {demo ? (
                <div className="mt-2">
                  <DemoMenu variant="secondary" align="start" />
                </div>
              ) : null}
            </>
          )}
        </div>
      </SheetContent>
    </Dialog>
  );
}
