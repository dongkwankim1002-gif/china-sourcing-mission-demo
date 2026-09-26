'use client';
import * as React from 'react';
import { CheckCircle2, ShieldCheck, Trash2 } from 'lucide-react';
import { requestDeletion, requestVerification, type FormState } from '@/app/actions/public';
import { Button, Field, Input, Textarea } from '@/components/ui/core';
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/radix';
import { ACTION } from '@/lib/terms';

function Done({ text }: { text: string }) {
  return (
    <p role="status" className="flex items-start gap-2 rounded-sm border border-ok/40 bg-ok-bg p-3 text-sm text-ok">
      <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden /> {text}
    </p>
  );
}

export function ListingActions({ orgId, orgName }: { orgId: string; orgName: string }) {
  const [vState, vAction, vPending] = React.useActionState<FormState, FormData>(requestVerification, {});
  const [dState, dAction, dPending] = React.useActionState<FormState, FormData>(requestDeletion, {});
  return (
    <div className="flex flex-wrap gap-2">
      <Dialog>
        <DialogTrigger asChild>
          <Button variant="primary">
            <ShieldCheck aria-hidden /> {ACTION.verifyContact}
          </Button>
        </DialogTrigger>
        <DialogContent title={ACTION.verifyContact} description={`${orgName}의 담당자라면 인증 후 직접 정보를 고치고 요금표를 올릴 수 있습니다. 운영자가 사업자 정보를 확인한 뒤 연락드립니다.`}>
          {vState.ok ? (
            <Done text="접수했습니다. 영업일 기준 이틀 안에 회사 이메일로 확인 연락을 드립니다." />
          ) : (
            <form action={vAction} className="grid gap-3">
              <input type="hidden" name="orgId" value={orgId} />
              <Field label="이름" htmlFor="v-name" required>
                <Input id="v-name" name="name" defaultValue={vState.fields?.name} autoComplete="name" required />
              </Field>
              <Field label="회사 이메일" htmlFor="v-email" required hint="회사 도메인 메일이면 확인이 빠릅니다">
                <Input id="v-email" name="email" type="email" defaultValue={vState.fields?.email} autoComplete="email" required />
              </Field>
              <Field label="전화" htmlFor="v-phone">
                <Input id="v-phone" name="phone" defaultValue={vState.fields?.phone} autoComplete="tel" />
              </Field>
              <Field label="전할 말" htmlFor="v-msg">
                <Textarea id="v-msg" name="message" defaultValue={vState.fields?.message} />
              </Field>
              {vState.error ? <p role="alert" className="text-sm text-stamp">{vState.error}</p> : null}
              <Button type="submit" variant="primary" disabled={vPending}>
                {vPending ? '보내는 중…' : '인증 요청 보내기'}
              </Button>
            </form>
          )}
        </DialogContent>
      </Dialog>
      <Dialog>
        <DialogTrigger asChild>
          <Button variant="secondary">
            <Trash2 aria-hidden /> {ACTION.requestDeletion}
          </Button>
        </DialogTrigger>
        <DialogContent title={ACTION.requestDeletion} description="공개정보 기준으로 실린 페이지를 내려 달라는 요청입니다. 접수 즉시 공개 목록에서 가리고, 확인 뒤 지웁니다.">
          {dState.ok ? (
            <Done text="접수했습니다. 확인 뒤 페이지를 내리고 결과를 이메일로 알려 드립니다." />
          ) : (
            <form action={dAction} className="grid gap-3">
              <input type="hidden" name="orgId" value={orgId} />
              <Field label="이름" htmlFor="d-name" required>
                <Input id="d-name" name="name" defaultValue={dState.fields?.name} required />
              </Field>
              <Field label="이메일" htmlFor="d-email" required>
                <Input id="d-email" name="email" type="email" defaultValue={dState.fields?.email} required />
              </Field>
              <Field label="사유" htmlFor="d-reason" required>
                <Textarea id="d-reason" name="reason" defaultValue={dState.fields?.reason} required />
              </Field>
              {dState.error ? <p role="alert" className="text-sm text-stamp">{dState.error}</p> : null}
              <Button type="submit" variant="danger" disabled={dPending}>
                {dPending ? '보내는 중…' : '삭제 요청 보내기'}
              </Button>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
