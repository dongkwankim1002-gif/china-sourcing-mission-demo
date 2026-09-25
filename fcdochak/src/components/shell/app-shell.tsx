'use client';
import * as React from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Bell, ChevronsLeft, ChevronsRight, LogOut, Menu as MenuIcon, Moon, Search, Sun, Monitor, Check, ChevronDown } from 'lucide-react';
import { BrandMark } from '@/components/brand-mark';
import { Dialog, DialogTrigger, Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger, SheetContent } from '@/components/ui/radix';
import { Kbd } from '@/components/ui/core';
import { cn } from '@/lib/cn';
import { logout, setLocale, switchOrg } from '@/app/actions/session';
import { CommandPalette } from './command-palette';
import { isActive, navFor, type AreaKey } from './nav';

export interface ShellViewer {
  name: string;
  email: string;
  unread: number;
  org: { id: string; name: string; kind: string; is_demo: boolean };
  orgs: { id: string; name: string; kind: string; is_demo: boolean }[];
}

const AREA_LABEL: Record<AreaKey, { ko: string; zh: string }> = {
  app: { ko: '화주 워크스페이스', zh: '货主工作台' },
  partner: { ko: '물류사 콘솔', zh: '物流商控制台' },
  admin: { ko: '운영 어드민', zh: '运营后台' },
};

export function AppShell({
  area,
  viewer,
  locale = 'ko',
  demo,
  children,
}: {
  area: AreaKey;
  viewer: ShellViewer;
  locale?: 'ko' | 'zh';
  demo: boolean;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const nav = navFor(area, locale);
  const [collapsed, setCollapsed] = React.useState(false);
  const [paletteOpen, setPaletteOpen] = React.useState(false);
  const zh = locale === 'zh';

  React.useEffect(() => {
    try {
      setCollapsed(localStorage.getItem('fcd-sidebar') === '1');
    } catch {}
  }, []);
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const toggle = () => {
    setCollapsed((c) => {
      try {
        localStorage.setItem('fcd-sidebar', c ? '0' : '1');
      } catch {}
      return !c;
    });
  };
  const notifHref = area === 'app' ? '/app/notifications' : area === 'partner' ? '/partner/notifications' : '/admin/queues';
  const tabs = nav.filter((n) => n.tab).slice(0, 4);
  const more = nav.filter((n) => !tabs.includes(n));

  return (
    <div className="flex min-h-[calc(100dvh_-_var(--banner-h))] flex-col" lang={zh ? 'zh-CN' : 'ko'}>
      {demo ? <DemoRibbon zh={zh} /> : null}
      <header className={cn('sticky z-40 bg-ink text-on-ink', demo ? 'top-[calc(1.75rem_+_var(--banner-h))]' : 'top-[var(--banner-h)]')}>
        <div className="flex h-14 items-center gap-2 px-3 md:px-4">
          <Link href={nav[0].href} className="flex shrink-0 items-center gap-2 rounded-sm pr-2">
            <BrandMark />
            <span className="hidden border-l border-white/15 pl-2 text-xs font-semibold text-on-ink-muted lg:inline">
              {zh ? AREA_LABEL[area].zh : AREA_LABEL[area].ko}
            </span>
          </Link>
          <OrgSwitcher viewer={viewer} zh={zh} />
          <div className="flex-1" />
          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            className="hidden h-9 w-72 items-center gap-2 rounded-sm border border-white/15 bg-white/5 px-3 text-sm text-on-ink-muted hover:bg-white/10 md:flex"
          >
            <Search className="size-4" aria-hidden />
            <span className="flex-1 text-left">{zh ? '搜索编号·公司·SKU' : '번호·업체·SKU 검색, 행동 실행'}</span>
            <Kbd>⌘K</Kbd>
          </button>
          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            className="grid size-10 place-items-center rounded-sm hover:bg-white/10 md:hidden"
            aria-label={zh ? '搜索' : '검색'}
          >
            <Search className="size-5" />
          </button>
          {area === 'partner' ? <LocaleToggle locale={locale} /> : null}
          <Link
            href={notifHref}
            className="relative grid size-10 place-items-center rounded-sm hover:bg-white/10"
            aria-label={`${zh ? '通知' : '알림'}${viewer.unread ? ` ${viewer.unread}${zh ? '条未读' : '건 안 읽음'}` : ''}`}
          >
            <Bell className="size-5" />
            {viewer.unread > 0 ? (
              <span className="absolute right-1 top-1 grid h-4 min-w-4 place-items-center rounded-[3px] bg-label px-1 text-2xs font-bold text-on-label tnum">
                {viewer.unread > 99 ? '99+' : viewer.unread}
              </span>
            ) : null}
          </Link>
          <AccountMenu viewer={viewer} zh={zh} />
        </div>
      </header>

      <div className="flex flex-1">
        <aside
          className={cn(
            'sticky hidden shrink-0 flex-col border-r border-line bg-surface md:flex',
            // 미리보기 띠(--banner-h)·예시 띠(1.75rem)·머리(3.5rem) 아래에 딱 맞게 — 화면 맨 위에서도 아래가 잘리지 않는다
            demo
              ? 'top-[calc(5.25rem_+_var(--banner-h))] h-[calc(100dvh_-_5.25rem_-_var(--banner-h))]'
              : 'top-[calc(3.5rem_+_var(--banner-h))] h-[calc(100dvh_-_3.5rem_-_var(--banner-h))]',
            collapsed ? 'w-16' : 'w-60',
          )}
          aria-label={zh ? '主菜单' : '주 메뉴'}
        >
          <nav className="flex-1 overflow-y-auto p-2">
            <ul className="flex flex-col gap-0.5">
              {nav.map((item) => {
                const active = isActive(pathname, item);
                const Icon = item.icon;
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      aria-current={active ? 'page' : undefined}
                      title={collapsed ? item.label : undefined}
                      className={cn(
                        'relative flex h-10 items-center gap-3 rounded-sm px-3 text-sm font-semibold text-muted hover:bg-surface-2 hover:text-text',
                        active && 'bg-ink text-on-ink hover:bg-ink hover:text-on-ink dark:bg-surface-2 dark:text-text',
                        collapsed && 'justify-center px-0',
                      )}
                    >
                      {active ? <span className="absolute inset-y-1.5 left-0 w-[3px] rounded-r-[2px] bg-label" aria-hidden /> : null}
                      <Icon className="size-[18px] shrink-0" aria-hidden />
                      <span className={cn(collapsed && 'sr-only')}>{item.label}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>
          <button
            type="button"
            onClick={toggle}
            className="flex h-11 items-center gap-2 border-t border-line-2 px-4 text-xs font-semibold text-muted hover:text-text"
            aria-label={collapsed ? (zh ? '展开菜单' : '메뉴 펼치기') : zh ? '收起菜单' : '메뉴 접기'}
          >
            {collapsed ? <ChevronsRight className="size-4" /> : <ChevronsLeft className="size-4" />}
            {collapsed ? null : zh ? '收起' : '접기'}
          </button>
        </aside>

        <main id="main" className="min-w-0 flex-1 px-4 pb-24 pt-5 md:px-6 md:pb-10 lg:px-8">
          <div className="mx-auto w-full max-w-[1320px]">{children}</div>
        </main>
      </div>

      <MobileTabs tabs={tabs} more={more} pathname={pathname} zh={zh} />
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} area={area} locale={locale} />
    </div>
  );
}

function DemoRibbon({ zh }: { zh: boolean }) {
  return (
    <div className="sticky top-[var(--banner-h)] z-50 flex h-7 items-center justify-center gap-2 bg-label text-xs font-bold text-on-label">
      <span className="rounded-[2px] bg-ink px-1.5 text-2xs text-label">{zh ? '示例' : '예시 데이터'}</span>
      {zh ? '这里的公司、价格和货件都是虚构的示例数据。' : '이 화면의 업체·요금·선적은 모두 가상의 예시입니다.'}
    </div>
  );
}

function OrgSwitcher({ viewer, zh }: { viewer: ShellViewer; zh: boolean }) {
  if (viewer.orgs.length <= 1) {
    return (
      <span className="hidden max-w-48 truncate rounded-sm px-2 text-sm font-semibold text-on-ink sm:inline" title={viewer.org.name}>
        {viewer.org.name}
      </span>
    );
  }
  return (
    <Menu>
      <MenuTrigger className="hidden h-9 max-w-56 items-center gap-1 rounded-sm px-2 text-sm font-semibold hover:bg-white/10 sm:flex">
        <span className="truncate">{viewer.org.name}</span>
        <ChevronDown className="size-4 shrink-0 opacity-70" />
      </MenuTrigger>
      <MenuContent align="start">
        <MenuLabel>{zh ? '切换组织' : '조직 전환'}</MenuLabel>
        {viewer.orgs.map((o) => (
          <form key={o.id} action={switchOrg}>
            <input type="hidden" name="org" value={o.id} />
            <MenuItem asChild>
              <button type="submit" className="w-full">
                {o.id === viewer.org.id ? <Check /> : <span className="size-4" />}
                {o.name}
              </button>
            </MenuItem>
          </form>
        ))}
      </MenuContent>
    </Menu>
  );
}

function LocaleToggle({ locale }: { locale: 'ko' | 'zh' }) {
  const router = useRouter();
  const [pending, start] = React.useTransition();
  return (
    <div className="hidden items-center rounded-sm border border-white/15 p-0.5 sm:flex" role="group" aria-label="언어 / 语言">
      {(['ko', 'zh'] as const).map((l) => (
        <button
          key={l}
          type="button"
          disabled={pending}
          aria-pressed={locale === l}
          onClick={() =>
            start(async () => {
              await setLocale(l);
              router.refresh();
            })
          }
          className={cn('h-7 rounded-[4px] px-2 text-xs font-bold', locale === l ? 'bg-label text-on-label' : 'text-on-ink-muted hover:text-on-ink')}
        >
          {l === 'ko' ? '한국어' : '中文'}
        </button>
      ))}
    </div>
  );
}

export function useTheme() {
  const [theme, setThemeState] = React.useState<'light' | 'dark' | 'system'>('system');
  React.useEffect(() => {
    try {
      const t = localStorage.getItem('fcd-theme');
      if (t === 'light' || t === 'dark') setThemeState(t);
    } catch {}
  }, []);
  const setTheme = (t: 'light' | 'dark' | 'system') => {
    setThemeState(t);
    try {
      if (t === 'system') {
        localStorage.removeItem('fcd-theme');
        delete document.documentElement.dataset.theme;
      } else {
        localStorage.setItem('fcd-theme', t);
        document.documentElement.dataset.theme = t;
      }
    } catch {}
  };
  return { theme, setTheme };
}

function AccountMenu({ viewer, zh }: { viewer: ShellViewer; zh: boolean }) {
  const { theme, setTheme } = useTheme();
  const initial = [...viewer.name][0] ?? '?';
  return (
    <Menu>
      <MenuTrigger
        className="grid size-10 place-items-center rounded-sm hover:bg-white/10"
        aria-label={zh ? '账户' : '계정'}
      >
        <span className="grid size-7 place-items-center rounded-[4px] bg-white/15 text-sm font-bold">{initial}</span>
      </MenuTrigger>
      <MenuContent>
        <div className="px-2 py-2">
          <div className="text-sm font-bold">{viewer.name}</div>
          <div className="truncate text-xs text-muted">{viewer.email}</div>
        </div>
        <MenuSeparator />
        <MenuLabel>{zh ? '主题' : '화면 밝기'}</MenuLabel>
        {(
          [
            ['light', zh ? '明亮' : '밝게', Sun],
            ['dark', zh ? '暗色' : '어둡게', Moon],
            ['system', zh ? '跟随系统' : '기기 설정 따르기', Monitor],
          ] as const
        ).map(([k, label, Icon]) => (
          <MenuItem key={k} onSelect={() => setTheme(k)}>
            <Icon />
            <span className="flex-1">{label}</span>
            {theme === k ? <Check className="!text-text" /> : null}
          </MenuItem>
        ))}
        <MenuSeparator />
        <form action={logout}>
          <MenuItem asChild>
            <button type="submit" className="w-full">
              <LogOut />
              {zh ? '退出登录' : '로그아웃'}
            </button>
          </MenuItem>
        </form>
      </MenuContent>
    </Menu>
  );
}

function MobileTabs({
  tabs,
  more,
  pathname,
  zh,
}: {
  tabs: ReturnType<typeof navFor>;
  more: ReturnType<typeof navFor>;
  pathname: string;
  zh: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  React.useEffect(() => setOpen(false), [pathname]);
  const moreActive = more.some((m) => isActive(pathname, m));
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] md:hidden"
      aria-label={zh ? '底部菜单' : '하단 메뉴'}
    >
      <ul className="grid grid-cols-5">
        {tabs.map((t) => {
          const active = isActive(pathname, t);
          const Icon = t.icon;
          return (
            <li key={t.href}>
              <Link
                href={t.href}
                aria-current={active ? 'page' : undefined}
                className={cn('relative flex h-14 flex-col items-center justify-center gap-0.5 text-2xs font-semibold text-muted', active && 'text-text')}
              >
                {active ? <span className="absolute inset-x-5 top-0 h-[3px] rounded-b-[2px] bg-label" aria-hidden /> : null}
                <Icon className="size-5" aria-hidden />
                {t.label}
              </Link>
            </li>
          );
        })}
        <li>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger
              className={cn('relative flex h-14 w-full flex-col items-center justify-center gap-0.5 text-2xs font-semibold text-muted', moreActive && 'text-text')}
            >
              {moreActive ? <span className="absolute inset-x-5 top-0 h-[3px] rounded-b-[2px] bg-label" aria-hidden /> : null}
              <MenuIcon className="size-5" aria-hidden />
              {zh ? '更多' : '더 보기'}
            </DialogTrigger>
            <SheetContent title={zh ? '更多' : '더 보기'} side="bottom">
              <ul className="grid grid-cols-3 gap-2">
                {more.map((m) => {
                  const Icon = m.icon;
                  return (
                    <li key={m.href}>
                      <Link
                        href={m.href}
                        className={cn(
                          'flex h-20 flex-col items-center justify-center gap-1.5 rounded-sm border border-line text-xs font-semibold',
                          isActive(pathname, m) ? 'border-ink bg-surface-2' : 'bg-surface',
                        )}
                      >
                        <Icon className="size-5 text-muted" aria-hidden />
                        {m.label}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </SheetContent>
          </Dialog>
        </li>
      </ul>
    </nav>
  );
}

