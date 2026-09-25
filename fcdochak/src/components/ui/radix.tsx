'use client';
/** Radix 기반 부품 — 우리 토큰으로 다시 입힘. */
import * as React from 'react';
import { Checkbox as C, Dialog as D, DropdownMenu as DM, Popover as P, Switch as S, Tabs as T, Tooltip as TT } from 'radix-ui';
import { Check, X } from 'lucide-react';
import { cn } from '@/lib/cn';

// 대화상자 ---------------------------------------------------------------
export const Dialog = D.Root;
export const DialogTrigger = D.Trigger;
export const DialogClose = D.Close;

export function DialogContent({
  title,
  description,
  children,
  className,
  wide,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  wide?: boolean;
}) {
  return (
    <D.Portal>
      <D.Overlay className="fixed inset-0 z-50 bg-ink/50" />
      <D.Content
        className={cn(
          'fixed inset-x-0 bottom-0 z-50 max-h-[92dvh] overflow-y-auto rounded-t-md border border-line bg-surface p-5 shadow-2',
          'sm:inset-auto sm:left-1/2 sm:top-1/2 sm:w-[min(92vw,520px)] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-md',
          wide && 'sm:w-[min(94vw,820px)]',
          className,
        )}
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <D.Title className="text-lg font-bold text-text">{title}</D.Title>
            {description ? <D.Description className="mt-1 text-sm text-muted">{description}</D.Description> : <D.Description className="sr-only">{String(title)}</D.Description>}
          </div>
          <D.Close className="grid size-8 place-items-center rounded-sm text-muted hover:bg-surface-2" aria-label="닫기">
            <X className="size-4" />
          </D.Close>
        </div>
        {children}
      </D.Content>
    </D.Portal>
  );
}

/** 옆에서 나오는 판 — 모바일 「더 보기」, 필터 */
export function SheetContent({
  title,
  side = 'right',
  children,
  className,
}: {
  title: React.ReactNode;
  side?: 'right' | 'left' | 'bottom';
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <D.Portal>
      <D.Overlay className="fixed inset-0 z-50 bg-ink/50" />
      <D.Content
        className={cn(
          'fixed z-50 flex flex-col overflow-y-auto bg-surface shadow-2',
          side === 'right' && 'inset-y-0 right-0 w-[min(88vw,380px)] border-l border-line',
          side === 'left' && 'inset-y-0 left-0 w-[min(88vw,320px)] border-r border-line',
          side === 'bottom' && 'inset-x-0 bottom-0 max-h-[85dvh] rounded-t-md border-t border-line pb-[env(safe-area-inset-bottom)]',
          className,
        )}
      >
        <div className="flex items-center justify-between border-b border-line-2 px-4 py-3">
          <D.Title className="text-md font-bold">{title}</D.Title>
          <D.Description className="sr-only">{String(title)}</D.Description>
          <D.Close className="grid size-9 place-items-center rounded-sm text-muted hover:bg-surface-2" aria-label="닫기">
            <X className="size-4" />
          </D.Close>
        </div>
        <div className="flex-1 p-4">{children}</div>
      </D.Content>
    </D.Portal>
  );
}

// 탭 -------------------------------------------------------------------
export const Tabs = T.Root;
export function TabsList({ className, ...p }: React.ComponentProps<typeof T.List>) {
  return (
    <T.List
      className={cn('no-scrollbar -mx-1 flex gap-1 overflow-x-auto border-b border-line px-1', className)}
      {...p}
    />
  );
}
export function TabsTrigger({ className, ...p }: React.ComponentProps<typeof T.Trigger>) {
  return (
    <T.Trigger
      className={cn(
        'relative -mb-px h-10 shrink-0 border-b-2 border-transparent px-3 text-sm font-semibold text-muted hover:text-text',
        'data-[state=active]:border-ink data-[state=active]:text-text dark:data-[state=active]:border-label',
        className,
      )}
      {...p}
    />
  );
}
export const TabsContent = ({ className, ...p }: React.ComponentProps<typeof T.Content>) => (
  <T.Content className={cn('pt-4 focus-visible:outline-none', className)} {...p} />
);

// 풍선 -----------------------------------------------------------------
export const TooltipProvider = TT.Provider;
export function Tooltip({ content, children, side = 'top' }: { content: React.ReactNode; children: React.ReactNode; side?: 'top' | 'bottom' | 'left' | 'right' }) {
  return (
    <TT.Root delayDuration={150}>
      <TT.Trigger asChild>{children}</TT.Trigger>
      <TT.Portal>
        <TT.Content
          side={side}
          sideOffset={6}
          className="z-[60] max-w-72 rounded-sm border border-line bg-surface px-2.5 py-1.5 text-xs text-text shadow-2"
        >
          {content}
        </TT.Content>
      </TT.Portal>
    </TT.Root>
  );
}

// 펼침 메뉴 -------------------------------------------------------------
export const Menu = DM.Root;
export const MenuTrigger = DM.Trigger;
export function MenuContent({ className, align = 'end', ...p }: React.ComponentProps<typeof DM.Content>) {
  return (
    <DM.Portal>
      <DM.Content
        align={align}
        sideOffset={6}
        className={cn('z-50 min-w-48 rounded-sm border border-line bg-surface p-1 text-text shadow-2', className)}
        {...p}
      />
    </DM.Portal>
  );
}
export function MenuItem({ className, ...p }: React.ComponentProps<typeof DM.Item>) {
  return (
    <DM.Item
      className={cn(
        'flex h-9 cursor-pointer select-none items-center gap-2 rounded-xs px-2 text-sm outline-none data-[highlighted]:bg-surface-2 [&_svg]:size-4 [&_svg]:text-muted',
        className,
      )}
      {...p}
    />
  );
}
export const MenuSeparator = () => <DM.Separator className="my-1 h-px bg-line-2" />;
export const MenuLabel = ({ children }: { children: React.ReactNode }) => (
  <DM.Label className="px-2 py-1.5 text-2xs font-semibold text-muted">{children}</DM.Label>
);
export function MenuCheckbox({ className, children, ...p }: React.ComponentProps<typeof DM.CheckboxItem>) {
  return (
    <DM.CheckboxItem
      className={cn('flex h-9 cursor-pointer select-none items-center gap-2 rounded-xs px-2 text-sm outline-none data-[highlighted]:bg-surface-2', className)}
      {...p}
    >
      <span className="grid size-4 place-items-center rounded-xs border border-line">
        <DM.ItemIndicator>
          <Check className="size-3" />
        </DM.ItemIndicator>
      </span>
      {children}
    </DM.CheckboxItem>
  );
}

// 팝오버 ---------------------------------------------------------------
export const Popover = P.Root;
export const PopoverTrigger = P.Trigger;
export function PopoverContent({ className, ...p }: React.ComponentProps<typeof P.Content>) {
  return (
    <P.Portal>
      <P.Content sideOffset={6} className={cn('z-50 w-72 rounded-sm border border-line bg-surface p-3 shadow-2', className)} {...p} />
    </P.Portal>
  );
}

// 체크·스위치 ------------------------------------------------------------
export function Checkbox({ className, ...p }: React.ComponentProps<typeof C.Root>) {
  return (
    <C.Root
      className={cn(
        'grid size-5 shrink-0 place-items-center rounded-xs border border-muted/70 bg-surface data-[state=checked]:border-ink data-[state=checked]:bg-ink dark:data-[state=checked]:border-label dark:data-[state=checked]:bg-label',
        className,
      )}
      {...p}
    >
      <C.Indicator>
        <Check className="size-3.5 text-on-ink dark:text-on-label" strokeWidth={3} />
      </C.Indicator>
    </C.Root>
  );
}

export function Switch({ className, ...p }: React.ComponentProps<typeof S.Root>) {
  return (
    <S.Root
      className={cn(
        'relative inline-flex h-6 w-10 shrink-0 items-center rounded-xs border border-line bg-surface-2 transition-colors data-[state=checked]:border-ok data-[state=checked]:bg-ok',
        className,
      )}
      {...p}
    >
      <S.Thumb className="block size-4 translate-x-1 rounded-[2px] bg-surface shadow-1 ring-1 ring-line transition-transform data-[state=checked]:translate-x-5" />
    </S.Root>
  );
}
