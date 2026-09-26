'use client';
import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { addDutyRate, addSetting } from '@/app/actions/admin';
import { Button, Field, Input, Textarea } from '@/components/ui/core';
import { NumberField } from '@/components/number-field';
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/radix';

export function SettingEditor({ k, value }: { k: string; value: unknown }) {
  const router = useRouter();
  const [raw, setRaw] = React.useState(JSON.stringify(value, null, 2));
  const [note, setNote] = React.useState('');
  const [open, setOpen] = React.useState(false);
  const [pending, start] = React.useTransition();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm" variant="secondary">새 판 만들기</Button></DialogTrigger>
      <DialogContent title={`${k} — 새 판`} description="지금 값은 그대로 남고, 새 판이 현재값이 됩니다. 감사 기록에 남습니다." wide>
        <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); start(async () => { const r = await addSetting(k, raw, note); if (!r.ok) return void toast.error(r.error ?? ''); toast.success('새 판을 만들었습니다'); setOpen(false); router.refresh(); }); }}>
          <Field label="값" htmlFor={`se-${k}`}><Textarea id={`se-${k}`} value={raw} onChange={(e) => setRaw(e.target.value)} className="min-h-40 font-mono text-xs" spellCheck={false} /></Field>
          <Field label="바꾸는 이유" htmlFor={`sn-${k}`}><Input id={`sn-${k}`} value={note} onChange={(e) => setNote(e.target.value)} placeholder="예: 9월 넷째 주 고시환율 반영" /></Field>
          <div className="flex justify-end"><Button type="submit" variant="primary" disabled={pending}>새 판 저장</Button></div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function DutyEditor({ category, name, rateBp }: { category: string; name: string; rateBp: number }) {
  const router = useRouter();
  const [rate, setRate] = React.useState<number | null>(rateBp / 100);
  const [note, setNote] = React.useState('');
  const [pending, start] = React.useTransition();
  return (
    <form className="flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); start(async () => { const r = await addDutyRate(category, name, Math.round((rate ?? 0) * 100), note); if (!r.ok) return void toast.error(r.error ?? ''); toast.success(`${name} 새 판`); setNote(''); router.refresh(); }); }}>
      <NumberField ariaLabel={`${name} 관세율`} value={rate} onValueChange={setRate} unit="%" decimals={2} className="w-28" inputClassName="h-8" />
      <Input aria-label="이유" value={note} onChange={(e) => setNote(e.target.value)} placeholder="이유" className="h-8 w-40" />
      <Button type="submit" size="sm" variant="secondary" disabled={pending || (rate ?? 0) * 100 === rateBp}>새 판</Button>
    </form>
  );
}
