'use client';
/** 물류사 제휴 — 신청과 요건 서류 올리기(한/中). 스위치가 꺼져 있으면 잠긴다. */
import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { applyAlliance, submitRequirement } from '@/app/actions/alliance';
import { Button, Field, Input, Textarea } from '@/components/ui/core';
import { REQUIREMENT_LABEL, type RequirementKind } from '@/lib/alliance-settings';

export function ApplyForm({ zh, locked, defaultNo }: { zh: boolean; locked: boolean; defaultNo: string | null }) {
  const router = useRouter();
  const [no, setNo] = React.useState(defaultNo ?? '');
  const [note, setNote] = React.useState('');
  const [pending, start] = React.useTransition();
  return (
    <form
      className="grid gap-3"
      data-testid="alliance-apply"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await applyAlliance({ registrationNo: no, note });
          if (!r.ok) return void toast.error(r.error ?? '');
          toast.success(zh ? '已提交合作申请' : '제휴를 신청했습니다');
          router.refresh();
        });
      }}
    >
      <Field label={zh ? '韩国国际物流代理业登记号码' : '국제물류주선업 등록번호'} htmlFor="ap-no" hint={zh ? '登记证上的号码' : '등록증에 적힌 번호'}>
        <Input id="ap-no" value={no} onChange={(e) => setNo(e.target.value)} disabled={locked} />
      </Field>
      <Field label={zh ? '备注(可选)' : '메모(선택)'} htmlFor="ap-note">
        <Textarea id="ap-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} disabled={locked} placeholder={zh ? '例: 主要航线·月货量' : '예: 주력 구간·월 물량'} />
      </Field>
      <div className="flex justify-end">
        <Button type="submit" variant="primary" disabled={locked || pending || no.trim().length < 4}>{zh ? '申请合作' : '제휴 신청하기'}</Button>
      </div>
    </form>
  );
}

export function RequirementUpload({ kind, zh, locked, again }: { kind: RequirementKind; zh: boolean; locked: boolean; again: boolean }) {
  const router = useRouter();
  const ref = React.useRef<HTMLFormElement>(null);
  const [pending, start] = React.useTransition();
  const lab = REQUIREMENT_LABEL[kind];
  const id = (s: string) => `rq-${kind}-${s}`;
  const needsFile = kind !== 'incident_history';
  return (
    <form
      ref={ref}
      className="grid gap-2 sm:grid-cols-2"
      data-testid={`alliance-upload-${kind}`}
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        fd.set('kind', kind);
        start(async () => {
          const r = await submitRequirement(fd);
          if (!r.ok) return void toast.error(r.error ?? '');
          toast.success(zh ? `已提交 ${lab.zh}` : `${lab.ko}을(를) 올렸습니다`);
          ref.current?.reset();
          router.refresh();
        });
      }}
    >
      {kind !== 'incident_history' ? (
        <Field label={zh ? '号码' : kind === 'registration_cert' ? '등록번호' : kind === 'biz_reg' ? '사업자등록번호' : '증권번호'} htmlFor={id('ref')}>
          <Input id={id('ref')} name="refNo" disabled={locked} />
        </Field>
      ) : null}
      {kind === 'guarantee_bond' ? (
        <Field label={zh ? '保险金额(韩元)' : '보험 금액(원)'} htmlFor={id('amt')}>
          <Input id={id('amt')} name="amount" inputMode="numeric" disabled={locked} placeholder="100,000,000" />
        </Field>
      ) : null}
      {kind !== 'biz_reg' ? (
        <Field label={zh ? '到期日' : kind === 'registration_cert' ? '등록기준 신고 기한' : kind === 'incident_history' ? '다음 제출 기한' : '보험 기간 끝'} htmlFor={id('until')}>
          <Input id={id('until')} name="validUntil" type="date" disabled={locked} />
        </Field>
      ) : null}
      {needsFile ? (
        <Field label={zh ? '文件(PDF·图片, 1MB 以内)' : '파일(PDF·사진, 1MB 이하)'} htmlFor={id('file')}>
          <Input id={id('file')} name="file" type="file" accept=".pdf,image/*" disabled={locked} className="h-auto py-1.5" />
        </Field>
      ) : null}
      <Field label={kind === 'incident_history' ? (zh ? '说明' : '설명') : zh ? '备注(可选)' : '메모(선택)'} htmlFor={id('note')} className="sm:col-span-2" hint={zh ? lab.hintZh : lab.hint}>
        <Textarea id={id('note')} name="note" rows={2} disabled={locked} />
      </Field>
      <div className="flex justify-end sm:col-span-2">
        <Button type="submit" size="sm" variant={again ? 'secondary' : 'ink'} disabled={locked || pending} aria-label={`${lab.ko} ${again ? '다시 올리기' : '올리기'}`}>
          {again ? (zh ? '重新提交(新版本)' : '다시 올리기(새 판)') : zh ? '提交' : '올리기'}
        </Button>
      </div>
    </form>
  );
}
