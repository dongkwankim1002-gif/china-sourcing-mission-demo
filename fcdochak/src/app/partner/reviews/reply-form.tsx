'use client';
import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { replyToReview } from '@/app/actions/trust';
import { Button, Field, Textarea } from '@/components/ui/core';
import { dateKo } from '@/lib/format';
import { TRUST_ACTION } from '@/lib/terms';

export function ReplyForm({ reviewId, current, version, at, zh }: { reviewId: string; current: string | null; version: number | null; at: string | null; zh: boolean }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [body, setBody] = React.useState(current ?? '');
  const [err, setErr] = React.useState<string | null>(null);
  const [pending, start] = React.useTransition();
  const id = `reply-${reviewId}`;

  if (current && !open) {
    return (
      <div className="mt-3 border-l-2 border-ink/40 pl-3" data-testid="partner-reply">
        <p className="text-2xs font-semibold text-muted">
          {zh ? '公开回复' : '공개 답변'}
          {version ? ` · v${version}` : ''}
          {at ? ` · ${dateKo(at, { dow: false })}` : ''}
        </p>
        <p className="mt-0.5 text-sm">{current}</p>
        <Button type="button" size="sm" variant="secondary" className="mt-2" onClick={() => setOpen(true)}>
          {zh ? '修改回复' : TRUST_ACTION.editReply}
        </Button>
      </div>
    );
  }
  if (!current && !open) {
    return (
      <div className="mt-3">
        <Button type="button" size="sm" variant="secondary" onClick={() => setOpen(true)}>
          {zh ? '公开回复' : TRUST_ACTION.reply}
        </Button>
      </div>
    );
  }
  return (
    <form
      className="mt-3 grid gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        setErr(null);
        start(async () => {
          const r = await replyToReview({ reviewId, body });
          if (!r.ok) return setErr(r.error ?? (zh ? '未能保存' : '남기지 못했습니다'));
          toast.success(current ? (zh ? '已保存为新版本' : '답변을 새 판으로 고쳤습니다') : zh ? '已公开回复' : '공개 답변을 남겼습니다');
          setOpen(false);
          router.refresh();
        });
      }}
    >
      <Field
        label={zh ? '公开回复' : '공개 답변'}
        htmlFor={id}
        hint={zh ? '公司页面上公开显示。修改会保存为新版本。' : '회사 공개 페이지에 그대로 실립니다. 고치면 새 판으로 쌓이고 이전 판은 기록에 남습니다.'}
        error={err ?? undefined}
      >
        <Textarea id={id} value={body} onChange={(e) => setBody(e.target.value)} maxLength={600} />
      </Field>
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={() => { setOpen(false); setBody(current ?? ''); setErr(null); }}>
          {zh ? '取消' : '그만두기'}
        </Button>
        <Button type="submit" variant="primary" size="sm" disabled={pending}>
          {pending ? (zh ? '保存中…' : '남기는 중…') : current ? (zh ? '保存新版本' : '새 판으로 고치기') : zh ? '公开回复' : TRUST_ACTION.reply}
        </Button>
      </div>
    </form>
  );
}
