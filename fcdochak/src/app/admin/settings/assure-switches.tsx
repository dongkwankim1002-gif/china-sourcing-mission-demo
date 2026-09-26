'use client';
import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { addSetting } from '@/app/actions/admin';
import { Button, Chip, Field, Input } from '@/components/ui/core';
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/radix';
import { ASSURE_HUMAN_TODO, ASSURE_KIND_LABEL, ASSURE_SWITCH_KEY, type AssureKind } from '@/lib/assure-settings';

/** v2 시범 스위치 — 켜고 끄는 것도 설정 새 판(감사 기록). 켜도 실제 계약·결제는 없다. */
export function AssureSwitch({ kind, on, versions }: { kind: AssureKind; on: boolean; versions: number }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [note, setNote] = React.useState('');
  const [pending, start] = React.useTransition();
  const key = ASSURE_SWITCH_KEY[kind];
  const label = ASSURE_KIND_LABEL[kind];
  const verb = on ? '끄기' : '켜기';
  return (
    <li className="grid gap-2 bg-surface px-4 py-3 sm:grid-cols-[1fr_auto] sm:items-center" data-testid={`assure-switch-${kind}`}>
      <div className="min-w-0">
        <p className="flex flex-wrap items-center gap-2 text-sm font-bold">
          {label} 시범 <Chip tone={on ? 'label' : 'neutral'}>{on ? '켜짐' : '꺼짐'}</Chip>
        </p>
        <p className="font-mono text-2xs text-muted">{key} · 판 {versions}개</p>
        <p className="mt-0.5 text-xs text-muted">사람이 정할 일: {ASSURE_HUMAN_TODO[kind]}</p>
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button size="sm" variant={on ? 'secondary' : 'ink'} aria-label={`${label} 시범 ${verb}`}>{verb}</Button>
        </DialogTrigger>
        <DialogContent
          title={`${label} 시범 ${verb}`}
          description={on ? '끄면 화주 화면에 참고 숫자와 관심 등록만 남습니다.' : '켜도 실제 계약·결제는 없습니다. 화면에 「사람이 정할 일」 안내가 함께 보입니다.'}
        >
          <form
            className="grid gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              start(async () => {
                const r = await addSetting(key, JSON.stringify(!on), note);
                if (!r.ok) return void toast.error(r.error ?? '');
                toast.success(`${label} 시범을 ${on ? '껐습니다' : '켰습니다'}(새 판)`);
                setOpen(false);
                setNote('');
                router.refresh();
              });
            }}
          >
            {!on ? <p className="rounded-sm bg-caution-bg p-3 text-sm text-caution">사람이 정할 일: {ASSURE_HUMAN_TODO[kind]}. 정해지기 전에는 시범 기록까지만 합니다.</p> : null}
            <Field label="바꾸는 이유" htmlFor={`as-${kind}`}>
              <Input id={`as-${kind}`} value={note} onChange={(e) => setNote(e.target.value)} placeholder="예: 내부 시범 화면 점검" />
            </Field>
            <div className="flex justify-end">
              <Button type="submit" variant="primary" disabled={pending}>{verb} — 새 판 저장</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </li>
  );
}
