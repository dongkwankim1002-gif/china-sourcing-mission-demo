'use client';
/**
 * WING 키 넣기 — 업체 코드·Access Key·Secret Key. 서버가 암호화해 보관하고 끝 4자리만 보인다.
 * 스위치(WING_ENABLED)가 꺼져 있으면 저장만 하고 「연동 준비 중」.
 */
import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { KeyRound, ShieldCheck, Trash2 } from 'lucide-react';
import { revokeWingKey, saveWingKey } from '@/app/actions/wing';
import { Button, Chip, Field, Input, NativeSelect, Panel, PanelHead, type Tone } from '@/components/ui/core';
import { dateKo } from '@/lib/format';
import { WING_ACTION, WING_METHOD_LABEL, WING_STATUS_LABEL } from '@/lib/terms';

export interface KeyView {
  method: 'self_key' | 'partner_solution';
  status: 'saved' | 'verified' | 'failed' | 'revoked';
  vendorLast4: string | null;
  accessLast4: string | null;
  issuedOn: string | null;
  expiresOn: string | null;
  expiry: 'unknown' | 'ok' | 'soon' | 'expired';
  version: number;
  savedAt: string;
  who: string | null;
}

const STATUS_TONE: Record<KeyView['status'], Tone> = { saved: 'caution', verified: 'ok', failed: 'stamp', revoked: 'neutral' };

export function WingKeyPanel({ current, canStore, enabled, today, warnDays, canManage }: { current: KeyView | null; canStore: boolean; enabled: boolean; today: string; warnDays: number; canManage: boolean }) {
  const router = useRouter();
  const [method, setMethod] = React.useState<KeyView['method']>('self_key');
  const [vendorId, setVendorId] = React.useState('');
  const [accessKey, setAccessKey] = React.useState('');
  const [secretKey, setSecretKey] = React.useState('');
  const [issuedOn, setIssuedOn] = React.useState('');
  const [err, setErr] = React.useState<string | null>(null);
  const [pending, start] = React.useTransition();
  const live = current && current.status !== 'revoked';

  return (
    <Panel aria-labelledby="wk-h">
      <PanelHead
        id="wk-h"
        title="WING 키"
        sub="넣은 키는 암호화해 보관하고 끝 4자리만 보입니다. 운영자도 키를 볼 수 없습니다."
        action={current ? <Chip tone={STATUS_TONE[current.status]}>{WING_STATUS_LABEL[current.status]}</Chip> : null}
      />
      {live ? (
        <div className="grid gap-2 border-b border-line-2 px-4 py-3 text-sm" data-testid="wing-key-current">
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <ShieldCheck className="size-4 text-ok" aria-hidden />
            <span>업체 코드 <b className="font-mono tnum">••••{current.vendorLast4}</b></span>
            <span>Access Key <b className="font-mono tnum">••••{current.accessLast4}</b></span>
            <span className="text-muted">Secret Key 는 끝자리도 남기지 않습니다</span>
          </p>
          <p className="text-xs text-muted">
            {WING_METHOD_LABEL[current.method]} · {current.version}번째 판 · {dateKo(current.savedAt, { dow: false })} 저장{current.who ? ` · ${current.who}` : ''}
            {current.expiresOn ? ` · ${dateKo(current.expiresOn, { dow: false })} 만료 예정` : ' · 발급일을 적지 않아 만료일을 모릅니다'}
          </p>
          {current.expiry === 'soon' || current.expiry === 'expired' ? (
            <p className="text-xs font-semibold text-caution" role="status">
              {current.expiry === 'expired' ? '키 유효기간이 지났습니다' : '키가 곧 만료됩니다'} — WING 에서 키를 지우고 다시 발급받아 새로 넣어 주세요.
            </p>
          ) : null}
          {current.status === 'failed' ? (
            <p className="text-xs font-semibold text-stamp" role="status" data-testid="wing-key-failed">
              쿠팡이 이 키를 받지 않았습니다 — 만료됐거나 권한이 아직 열리지 않았을 수 있습니다(발급 뒤 최대 24시간). 키를 다시 넣어 주세요.
            </p>
          ) : null}
          {!enabled ? <p className="text-xs text-caution">연동 준비 중 — 쿠팡 호출이 아직 꺼져 있어 저장만 해 두었습니다. 켜지면 이 키로 읽기만 합니다.</p> : null}
          {canManage ? (<div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-muted">폐기하면 새 판으로 「폐기함」이 쌓이고 더는 이 키를 꺼내지 않습니다. WING 에서도 키를 지워 주세요.</p>
            <Button
              size="sm"
              variant="danger"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  if (!window.confirm('이 키를 폐기할까요? WING 에서도 키를 지워 주세요.')) return;
                  const r = await revokeWingKey();
                  if (r.ok) {
                    toast.success('키를 폐기했습니다');
                    router.refresh();
                  } else toast.error(r.error ?? '폐기하지 못했습니다');
                })
              }
            >
              <Trash2 aria-hidden /> {WING_ACTION.revokeKey}
            </Button>
          </div>) : null}
        </div>
      ) : null}
      {!canManage ? (
        <p className="px-4 py-3 text-sm text-muted" role="status" data-testid="wing-key-admin-only">
          WING 키는 조직 관리자만 넣고 거둘 수 있습니다. 파일 올리기와 짝 맞추기는 누구나 됩니다.
        </p>
      ) : !canStore ? (
        <p className="px-4 py-3 text-sm text-caution" role="status" data-testid="wing-key-unavailable">
          운영자가 암호화 키를 설정하기 전까지 키를 받지 않습니다. 그동안은 WING 에서 내려받은 파일을 올려 쓰세요.
        </p>
      ) : (
        <form
          className="grid gap-3 p-4"
          autoComplete="off"
          onSubmit={(e) => {
            e.preventDefault();
            setErr(null);
            start(async () => {
              const r = await saveWingKey({ method, vendorId, accessKey, secretKey, issuedOn: issuedOn || null });
              if (!r.ok) return setErr(r.error ?? '저장하지 못했습니다');
              setAccessKey('');
              setSecretKey('');
              setVendorId('');
              toast.success(r.data?.enabled ? '키를 저장했습니다' : '키를 저장했습니다 — 연동 준비 중', { description: '끝 4자리만 보입니다' });
              router.refresh();
            });
          }}
        >
          <Field label="연동 방식" htmlFor="wk-method" hint="WING 키 발급 때 고른 방식">
            <NativeSelect id="wk-method" value={method} onChange={(e) => setMethod(e.target.value as KeyView['method'])}>
              <option value="self_key">{WING_METHOD_LABEL.self_key}</option>
              <option value="partner_solution">{WING_METHOD_LABEL.partner_solution}</option>
            </NativeSelect>
          </Field>
          <Field label="업체 코드" htmlFor="wk-vendor" required hint="WING 키 발급 화면의 「업체코드」(예: A로 시작하는 영문·숫자)">
            <Input id="wk-vendor" value={vendorId} onChange={(e) => setVendorId(e.target.value)} maxLength={20} spellCheck={false} />
          </Field>
          <Field label="Access Key" htmlFor="wk-access" required>
            <Input id="wk-access" type="password" value={accessKey} onChange={(e) => setAccessKey(e.target.value)} maxLength={128} spellCheck={false} autoComplete="off" />
          </Field>
          <Field label="Secret Key" htmlFor="wk-secret" required hint="화면에 다시 보이지 않습니다">
            <Input id="wk-secret" type="password" value={secretKey} onChange={(e) => setSecretKey(e.target.value)} maxLength={128} spellCheck={false} autoComplete="off" />
          </Field>
          <Field label="발급일" htmlFor="wk-issued" hint={`적으면 만료 ${warnDays}일 전부터 이 화면에 표시합니다(메일·문자는 보내지 않음)`}>
            <Input id="wk-issued" type="date" value={issuedOn} max={today} onChange={(e) => setIssuedOn(e.target.value)} />
          </Field>
          {err ? (
            <p role="alert" className="text-sm text-stamp">
              {err}
            </p>
          ) : null}
          <div className="flex justify-end">
            <Button type="submit" variant={live ? 'secondary' : 'primary'} disabled={pending}>
              <KeyRound aria-hidden /> {pending ? '저장하는 중…' : live ? '새 키로 바꾸기' : WING_ACTION.saveKey}
            </Button>
          </div>
        </form>
      )}
    </Panel>
  );
}
