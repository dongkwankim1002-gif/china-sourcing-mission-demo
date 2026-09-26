/**
 * 기본 부품 — shadcn/ui 방식(소스를 들여와 우리 토큰으로 다시 입힘).
 * 버튼·입력·칩·패널·빈 상태·오류 상태·스켈레톤.
 */
import * as React from 'react';
import { Slot } from 'radix-ui';
import { cva, type VariantProps } from 'class-variance-authority';
import { AlertTriangle, Inbox } from 'lucide-react';
import { cn } from '@/lib/cn';

export const buttonVariants = cva(
  'inline-flex items-center justify-center gap-1.5 whitespace-nowrap font-semibold transition-colors disabled:pointer-events-none disabled:opacity-50 select-none [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        primary: 'bg-label text-on-label hover:bg-label-2 active:translate-y-px',
        secondary: 'bg-surface text-text border border-line hover:bg-surface-2',
        ghost: 'text-text hover:bg-surface-2',
        ink: 'bg-ink text-on-ink hover:bg-ink-2',
        danger: 'bg-surface text-stamp border border-stamp/60 hover:bg-stamp-bg',
        link: 'text-text underline underline-offset-4 decoration-line hover:decoration-text px-0',
        onInk: 'text-on-ink hover:bg-white/10',
      },
      size: {
        sm: 'h-8 px-3 text-sm rounded-sm',
        md: 'h-10 px-4 text-base rounded-sm',
        lg: 'h-12 px-5 text-md rounded-sm',
        icon: 'size-10 rounded-sm',
        iconSm: 'size-8 rounded-sm',
      },
    },
    defaultVariants: { variant: 'secondary', size: 'md' },
  },
);

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant, size, asChild, type, ...props },
  ref,
) {
  const Comp = asChild ? Slot.Root : 'button';
  return (
    <Comp
      ref={ref}
      type={asChild ? undefined : (type ?? 'button')}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  );
});

export const inputClass =
  'h-10 w-full min-w-0 rounded-sm border border-line bg-surface px-3 text-text placeholder:text-muted/70 tnum ' +
  'hover:border-muted/60 focus-visible:border-ink aria-[invalid=true]:border-stamp aria-[invalid=true]:bg-stamp-bg/40 disabled:opacity-60';

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, ...props },
  ref,
) {
  return <input ref={ref} className={cn(inputClass, className)} {...props} />;
});

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className, ...props }, ref) {
    return <textarea ref={ref} className={cn(inputClass, 'h-auto min-h-24 py-2 leading-6', className)} {...props} />;
  },
);

export const NativeSelect = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  function NativeSelect({ className, children, ...props }, ref) {
    return (
      <select
        ref={ref}
        className={cn(
          inputClass,
          'appearance-none bg-[length:16px] bg-[right_10px_center] bg-no-repeat pr-9',
          "bg-[url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%235b6878' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")]",
          className,
        )}
        {...props}
      >
        {children}
      </select>
    );
  },
);

export function Field({
  label,
  htmlFor,
  hint,
  error,
  required,
  children,
  className,
}: {
  label: React.ReactNode;
  htmlFor?: string;
  hint?: React.ReactNode;
  error?: React.ReactNode;
  required?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  const hintId = htmlFor ? `${htmlFor}-hint` : undefined;
  return (
    <div className={cn('flex min-w-0 flex-col gap-1.5', className)}>
      <label htmlFor={htmlFor} className="text-sm font-semibold text-text">
        {label}
        {required ? <span className="ml-0.5 text-stamp" aria-hidden>*</span> : null}
      </label>
      {children}
      {error ? (
        <p id={hintId} role="alert" className="flex items-start gap-1 text-xs text-stamp">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          {error}
        </p>
      ) : hint ? (
        <p id={hintId} className="text-xs text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export type Tone = 'neutral' | 'info' | 'ok' | 'stamp' | 'caution' | 'label' | 'ink';

const toneClass: Record<Tone, string> = {
  neutral: 'bg-surface-2 text-muted border-line before:bg-muted/50',
  info: 'bg-surface text-text border-line before:bg-[var(--seg-4)]',
  ok: 'bg-ok-bg text-ok border-ok/30 before:bg-ok',
  stamp: 'bg-stamp-bg text-stamp border-stamp/30 before:bg-stamp',
  caution: 'bg-caution-bg text-caution border-caution/30 before:bg-caution',
  label: 'bg-label/20 text-text border-label/60 before:bg-label',
  ink: 'bg-ink text-on-ink border-ink before:bg-label',
};

/** 라벨 조각 칩 — 2px 모서리, 왼쪽 3px 색 띠. 색만으로 뜻을 싣지 않도록 늘 글자가 있다. */
export function Chip({
  tone = 'neutral',
  children,
  className,
  icon,
  title,
}: {
  tone?: Tone;
  children: React.ReactNode;
  className?: string;
  icon?: React.ReactNode;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={cn(
        'relative inline-flex h-6 shrink-0 items-center gap-1 overflow-hidden rounded-xs border pl-2.5 pr-2 text-xs font-semibold whitespace-nowrap',
        "before:absolute before:inset-y-0 before:left-0 before:w-[3px] before:content-['']",
        '[&_svg]:size-3.5',
        toneClass[tone],
        className,
      )}
    >
      {icon}
      {children}
    </span>
  );
}

export function Panel({
  className,
  children,
  as: As = 'section',
  ...rest
}: React.HTMLAttributes<HTMLElement> & { as?: 'section' | 'div' | 'article' | 'aside' }) {
  return (
    <As className={cn('min-w-0 rounded-md border border-line bg-surface', className)} {...rest}>
      {children}
    </As>
  );
}

export function PanelHead({
  title,
  sub,
  action,
  className,
  id,
}: {
  title: React.ReactNode;
  sub?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <div className={cn('flex flex-wrap items-start justify-between gap-2 border-b border-line-2 px-4 py-3', className)}>
      <div className="min-w-0">
        <h2 id={id} className="text-base font-bold text-text">
          {title}
        </h2>
        {sub ? <p className="text-xs text-muted">{sub}</p> : null}
      </div>
      {action ? <div className="flex shrink-0 items-center gap-2">{action}</div> : null}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('skeleton h-4', className)} aria-hidden />;
}

export function EmptyState({
  title,
  body,
  action,
  icon,
  className,
}: {
  title: React.ReactNode;
  body?: React.ReactNode;
  action?: React.ReactNode;
  icon?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col items-center gap-3 px-6 py-12 text-center', className)}>
      <div className="grid size-12 place-items-center rounded-sm border border-dashed border-line text-muted [&_svg]:size-5">
        {icon ?? <Inbox aria-hidden />}
      </div>
      <div className="max-w-sm">
        <p className="text-md font-bold text-text">{title}</p>
        {body ? <p className="mt-1 text-sm text-muted">{body}</p> : null}
      </div>
      {action ? <div className="mt-1 flex flex-wrap justify-center gap-2">{action}</div> : null}
    </div>
  );
}

/** 오류 — 무엇이 · 왜 · 어떻게 하면 되는지 */
export function ErrorState({
  what,
  why,
  how,
  action,
  className,
}: {
  what: React.ReactNode;
  why?: React.ReactNode;
  how?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div role="alert" className={cn('rounded-md border border-stamp/40 bg-stamp-bg/50 p-4', className)}>
      <p className="flex items-center gap-2 font-bold text-stamp">
        <AlertTriangle className="size-4" aria-hidden />
        {what}
      </p>
      {why ? <p className="mt-1 text-sm text-text">{why}</p> : null}
      {how ? <p className="mt-1 text-sm text-muted">{how}</p> : null}
      {action ? <div className="mt-3 flex gap-2">{action}</div> : null}
    </div>
  );
}

export function PageTitle({
  title,
  sub,
  actions,
  eyebrow,
}: {
  title: React.ReactNode;
  sub?: React.ReactNode;
  actions?: React.ReactNode;
  eyebrow?: React.ReactNode;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        {eyebrow ? <div className="mb-1 text-xs font-semibold text-muted">{eyebrow}</div> : null}
        <h1 className="text-xl font-bold tracking-tight text-text">{title}</h1>
        {sub ? <p className="mt-0.5 text-sm text-muted">{sub}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded-xs border border-line bg-surface-2 px-1 text-2xs font-semibold text-muted">
      {children}
    </kbd>
  );
}

export function DefList({ items, className }: { items: [React.ReactNode, React.ReactNode][]; className?: string }) {
  return (
    <dl className={cn('grid grid-cols-[minmax(84px,auto)_1fr] gap-x-4 gap-y-2 text-sm', className)}>
      {items.map(([k, v], i) => (
        <React.Fragment key={i}>
          <dt className="text-muted">{k}</dt>
          <dd className="min-w-0 break-words text-text">{v}</dd>
        </React.Fragment>
      ))}
    </dl>
  );
}
