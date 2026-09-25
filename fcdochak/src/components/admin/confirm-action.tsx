'use client';
/** 운영 행동 버튼 — 메모를 받아 서버 행동을 부른다. 서버 행동은 서버 컴포넌트에서 bind 해서 넘긴다. */
import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button, Field, Textarea } from '@/components/ui/core';
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/radix';

export function ConfirmAction({
  label,
  title,
  description,
  variant = 'secondary',
  needNote = false,
  notePlaceholder,
  action,
  done,
}: {
  label: string;
  title?: string;
  description?: string;
  variant?: 'primary' | 'secondary' | 'danger';
  needNote?: boolean;
  notePlaceholder?: string;
  action: (note: string) => Promise<{ ok: boolean; error?: string; n?: number }>;
  done?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [note, setNote] = React.useState('');
  const [pending, start] = React.useTransition();
  const run = () =>
    start(async () => {
      const r = await action(note);
      if (!r.ok) return void toast.error(r.error ?? '처리하지 못했습니다');
      toast.success(done ?? `${label} — 처리했습니다${r.n != null ? ` (${r.n}건)` : ''}`);
      setOpen(false);
      setNote('');
      router.refresh();
    });
  if (!needNote && !title) {
    return (
      <Button size="sm" variant={variant} disabled={pending} onClick={run}>
        {label}
      </Button>
    );
  }
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant={variant}>{label}</Button>
      </DialogTrigger>
      <DialogContent title={title ?? label} description={description}>
        <div className="grid gap-3">
          {needNote ? (
            <Field label="메모(감사 기록에 남습니다)" htmlFor="ca-note">
              <Textarea id="ca-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder={notePlaceholder} />
            </Field>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>그만두기</Button>
            <Button variant={variant === 'danger' ? 'danger' : 'primary'} disabled={pending} onClick={run}>{label}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
