'use client';
/** 단계형 폼 — 진행 표시 + 단계마다 이 기기에 저장(새로 고쳐도 이어서). */
import * as React from 'react';
import { Check } from 'lucide-react';
import { cn } from '@/lib/cn';

export function Steps({ steps, current, onJump }: { steps: string[]; current: number; onJump?: (i: number) => void }) {
  return (
    <ol className="flex gap-1" aria-label="진행">
      {steps.map((s, i) => {
        const done = i < current;
        const cur = i === current;
        return (
          <li key={s} className="min-w-0 flex-1">
            <button
              type="button"
              disabled={!done || !onJump}
              onClick={() => onJump?.(i)}
              aria-current={cur ? 'step' : undefined}
              className="group w-full text-left disabled:cursor-default"
            >
              <span className={cn('block h-1.5 rounded-[2px]', done ? 'bg-ok' : cur ? 'bg-label' : 'bg-line')} />
              <span className={cn('mt-2 flex items-center gap-1 text-xs font-semibold', cur ? 'text-text' : 'text-muted')}>
                {done ? <Check className="size-3.5 text-ok" aria-hidden /> : <span className="tnum">{i + 1}</span>}
                <span className="truncate">{s}</span>
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

/** localStorage 에 단계별 초안 저장. 비밀번호는 저장하지 않는다. */
export function useDraft<T extends object>(key: string, initial: T, omit: (keyof T)[] = []) {
  const [value, setValue] = React.useState<T>(initial);
  const [step, setStep] = React.useState(0);
  const [restored, setRestored] = React.useState(false);
  React.useEffect(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw) {
        const j = JSON.parse(raw) as { v: Partial<T>; s: number };
        setValue((cur) => ({ ...cur, ...j.v }));
        setStep(j.s ?? 0);
        setRestored(true);
      }
    } catch {}
  }, [key]);
  const save = React.useCallback(
    (v: T, s: number) => {
      try {
        const copy = { ...v } as Record<string, unknown>;
        for (const k of omit) delete copy[k as string];
        localStorage.setItem(key, JSON.stringify({ v: copy, s }));
      } catch {}
    },
    [key, omit],
  );
  const clear = React.useCallback(() => {
    try {
      localStorage.removeItem(key);
    } catch {}
  }, [key]);
  return { value, setValue, step, setStep, save, clear, restored };
}
