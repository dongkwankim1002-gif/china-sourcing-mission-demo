'use client';
/** 초대 링크로 들어온 물류사 — 누가 불렀는지 알리고, 이미 계정이 있으면 지금 조직으로 받게 한다. */
import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { AlertTriangle, Handshake } from 'lucide-react';
import { acceptInvite } from '@/app/actions/workspace';
import { Button } from '@/components/ui/core';
import { dateTimeKo } from '@/lib/format';
import { ACTION } from '@/lib/terms';

export interface InviteInfo {
  token: string;
  status: 'open' | 'used' | 'expired' | 'revoked' | 'not_found';
  shipperName: string | null;
  partnerName: string | null;
  expiresAt: string | null;
}

const CLOSED: Record<Exclude<InviteInfo['status'], 'open'>, string> = {
  used: '이미 쓰인 초대 링크입니다. 그래도 아래에서 입점 신청은 할 수 있습니다(거래처 연결 없이).',
  expired: '기한이 지난 초대 링크입니다. 보낸 화주에게 새 링크를 부탁하세요. 아래 입점 신청은 그대로 할 수 있습니다.',
  revoked: '화주가 거둔 초대 링크입니다. 아래 입점 신청은 그대로 할 수 있습니다.',
  not_found: '초대 링크를 찾을 수 없습니다. 주소가 잘렸는지 확인해 주세요.',
};

export function InviteBanner({ invite }: { invite: InviteInfo }) {
  if (invite.status === 'open') {
    return (
      <div className="mt-4 flex items-start gap-3 rounded-md border border-ok/40 bg-ok-bg p-4" data-testid="invite-banner" role="status">
        <Handshake className="mt-0.5 size-5 shrink-0 text-ok" aria-hidden />
        <div className="min-w-0 text-sm">
          <p className="font-bold">「{invite.shipperName}」이(가) {invite.partnerName ? `${invite.partnerName}을(를) ` : ''}거래처로 초대했습니다</p>
          <p className="mt-0.5 text-muted">
            입점 신청을 마치면 이 화주의 거래처로 바로 연결됩니다. 邀请您入驻，完成后自动成为该货主的合作物流商。
            {invite.expiresAt ? ` · ${dateTimeKo(invite.expiresAt)}까지` : ''}
          </p>
        </div>
      </div>
    );
  }
  return (
    <div className="mt-4 flex items-start gap-3 rounded-md border border-caution/40 bg-caution-bg p-4 text-sm" data-testid="invite-banner" role="status">
      <AlertTriangle className="mt-0.5 size-5 shrink-0 text-caution" aria-hidden />
      <p className="min-w-0">{CLOSED[invite.status]}</p>
    </div>
  );
}

export function AcceptInvite({ token, orgName, shipperName }: { token: string; orgName: string; shipperName: string }) {
  const router = useRouter();
  const [pending, start] = React.useTransition();
  return (
    <div className="mt-3 flex flex-wrap items-center gap-3 rounded-md border border-line bg-surface p-4" data-testid="invite-accept">
      <p className="min-w-0 flex-1 basis-60 text-sm">
        이미 「{orgName}」 계정으로 들어와 있습니다. 새로 신청하지 않고 이 조직을 「{shipperName}」의 거래처로 연결할 수 있습니다.
      </p>
      <Button
        variant="primary"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await acceptInvite(token);
            if (!r.ok || !r.data) return void toast.error(r.error ?? '연결하지 못했습니다');
            toast.success('거래처로 연결했습니다');
            router.push(r.data.redirect);
          })
        }
      >
        {pending ? '연결하는 중…' : ACTION.acceptInvite}
      </Button>
    </div>
  );
}
