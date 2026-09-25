'use client';
/** 거래처 초대 — 링크를 만들어 화면에 보여 주고 복사하게 한다(발송은 꺼져 있다). */
import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Copy, Link2 } from 'lucide-react';
import { createInvite, revokeInvite } from '@/app/actions/workspace';
import { Button, Field, Input, Panel, PanelHead, Textarea } from '@/components/ui/core';
import { dateTimeKo } from '@/lib/format';
import { ACTION } from '@/lib/terms';

export function InviteForm({ days }: { days: number }) {
  const router = useRouter();
  const [name, setName] = React.useState('');
  const [email, setEmail] = React.useState('');
  const [note, setNote] = React.useState('');
  const [err, setErr] = React.useState<string | null>(null);
  const [made, setMade] = React.useState<{ link: string; expiresAt: string; name: string } | null>(null);
  const [pending, start] = React.useTransition();
  const linkRef = React.useRef<HTMLInputElement>(null);

  const copy = async () => {
    if (!made) return;
    try {
      await navigator.clipboard.writeText(made.link);
      toast.success('링크를 복사했습니다', { description: '카톡·메일로 직접 보내 주세요.' });
    } catch {
      linkRef.current?.select();
      toast.message('링크를 골라 두었습니다 — 직접 복사해 주세요');
    }
  };

  return (
    <Panel>
      <PanelHead title="내 포워더 초대하기" sub={`링크를 받은 물류사가 입점하면 내 거래처로 연결됩니다 · 링크는 ${days}일 동안, 한 번만 쓸 수 있습니다`} />
      <form
        className="grid gap-4 p-4 md:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          setErr(null);
          start(async () => {
            const r = await createInvite({ partnerName: name, contactEmail: email, note });
            if (!r.ok || !r.data) return setErr(r.error ?? '만들지 못했습니다');
            setMade({ link: `${window.location.origin}/join/partner?invite=${encodeURIComponent(r.data.token)}`, expiresAt: r.data.expiresAt, name });
            setName('');
            setEmail('');
            setNote('');
            router.refresh();
          });
        }}
      >
        <Field label="물류사 이름" htmlFor="iv-name" required error={err ?? undefined}>
          <Input id="iv-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="예: 한결포워딩" />
        </Field>
        <Field label="담당자 이메일" htmlFor="iv-email" hint="기록용입니다. 메일은 보내지 않습니다">
          <Input id="iv-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={120} autoComplete="off" />
        </Field>
        <Field label="메모" htmlFor="iv-note" className="md:col-span-2">
          <Textarea id="iv-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={400} className="min-h-16" placeholder="예: 이우 LCL 담당 왕 과장님" />
        </Field>
        <div className="flex justify-end md:col-span-2">
          <Button type="submit" variant="primary" disabled={pending}>
            <Link2 aria-hidden /> {pending ? '만드는 중…' : ACTION.invitePartner}
          </Button>
        </div>
      </form>
      {made ? (
        <div className="grid gap-2 border-t border-line-2 p-4" data-testid="invite-link-box">
          <p className="text-sm font-semibold">{made.name} 초대 링크</p>
          <div className="flex flex-wrap gap-2">
            <Input ref={linkRef} readOnly value={made.link} aria-label="초대 링크" className="min-w-0 flex-1 basis-60 font-mono text-xs" onFocus={(e) => e.currentTarget.select()} data-testid="invite-link" />
            <Button onClick={copy}><Copy aria-hidden /> {ACTION.copyLink}</Button>
          </div>
          <p className="text-xs text-muted">
            이 링크는 지금 한 번만 보입니다(저장하지 않습니다). 발송 기능이 꺼져 있어 저희가 보내지 않습니다 — 복사해 직접 전해 주세요. {dateTimeKo(made.expiresAt)}까지 쓸 수 있습니다.
          </p>
        </div>
      ) : null}
    </Panel>
  );
}

export function RevokeButton({ id }: { id: string }) {
  const router = useRouter();
  const [pending, start] = React.useTransition();
  return (
    <Button
      size="sm"
      variant="ghost"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const r = await revokeInvite(id);
          if (!r.ok) return void toast.error(r.error ?? '거두지 못했습니다');
          toast.success('초대를 거뒀습니다 — 그 링크로는 더 들어올 수 없습니다');
          router.refresh();
        })
      }
    >
      {ACTION.revokeInvite}
    </Button>
  );
}
