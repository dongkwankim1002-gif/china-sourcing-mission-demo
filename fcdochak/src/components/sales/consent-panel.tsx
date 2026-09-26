'use client';
/**
 * 「읽는 것 · 하지 않는 것」 동의(v2 3차 sales) — 화주 관리자만 누른다. 동의 기록은 쌓기만(fcd.wing_consents).
 * 동의해야 「WING 키」 칸이 열리고, 서버도 동의 없이 키를 받지 않는다.
 */
import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Ban, BookOpenCheck, Eye } from 'lucide-react';
import { recordWingConsent } from '@/app/actions/sales';
import { Button, Chip, Panel, PanelHead } from '@/components/ui/core';
import { SALES_CONSENT } from '@/lib/sales/consent';
import { SALES_ACTION } from '@/lib/terms';
import { dateKo } from '@/lib/format';

export function ConsentPanel({ consented, at, who, canManage }: { consented: boolean; at: string | null; who: string | null; canManage: boolean }) {
  const router = useRouter();
  const [pending, start] = React.useTransition();
  return (
    <Panel aria-labelledby="wc-h" data-testid="wing-consent">
      <PanelHead
        id="wc-h"
        title="읽는 것 · 하지 않는 것"
        sub={`동의 문구 ${SALES_CONSENT.version}`}
        action={consented ? <Chip tone="ok">동의함</Chip> : <Chip tone="caution">동의 전</Chip>}
      />
      <div className="grid gap-3 p-4 text-sm">
        <div>
          <p className="mb-1 flex items-center gap-1.5 text-xs font-bold text-ok">
            <Eye className="size-3.5" aria-hidden /> 읽는 것
          </p>
          <ul className="grid gap-1" data-testid="consent-reads">
            {SALES_CONSENT.reads.map((r) => (
              <li key={r.key} className="text-xs">
                <b>{r.label}</b> <span className="text-muted">— {r.why}</span>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <p className="mb-1 flex items-center gap-1.5 text-xs font-bold text-stamp">
            <Ban className="size-3.5" aria-hidden /> 하지 않는 것(쓰기)
          </p>
          <ul className="grid gap-0.5 text-xs" data-testid="consent-not-do">
            {SALES_CONSENT.notDo.map((x) => (
              <li key={x}>· {x}</li>
            ))}
          </ul>
        </div>
        <ul className="grid gap-0.5 text-2xs text-muted">
          {SALES_CONSENT.notes.map((x) => (
            <li key={x}>{x}</li>
          ))}
        </ul>
        {consented ? (
          <p className="text-xs text-muted" role="status">
            {at ? `${dateKo(at, { dow: false })} ` : ''}
            {who ? `${who} 님이 ` : ''}동의했습니다.
          </p>
        ) : canManage ? (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-2xs text-muted">법률 검토 전 초안입니다. 문구가 바뀌면 다시 동의를 받습니다.</p>
            <Button
              variant="primary"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const r = await recordWingConsent();
                  if (r.ok) {
                    toast.success('동의를 남겼습니다 — 이제 키를 넣을 수 있습니다');
                    router.refresh();
                  } else toast.error(r.error ?? '동의를 남기지 못했습니다');
                })
              }
            >
              <BookOpenCheck aria-hidden /> {SALES_ACTION.agree}
            </Button>
          </div>
        ) : (
          <p className="text-xs text-muted">동의는 조직 관리자만 할 수 있습니다.</p>
        )}
      </div>
    </Panel>
  );
}
