'use client';
import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { updateOrg, updateProfile } from '@/app/actions/common';
import { Button, Field, Input } from '@/components/ui/core';
import { useTheme } from '@/components/shell/app-shell';

export function ProfileForm({ name, phone, email, zh }: { name: string; phone: string | null; email: string; zh?: boolean }) {
  const router = useRouter();
  const [n, setN] = React.useState(name);
  const [p, setP] = React.useState(phone ?? '');
  const [err, setErr] = React.useState<string | null>(null);
  const [pending, start] = React.useTransition();
  return (
    <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); start(async () => { const r = await updateProfile({ name: n, phone: p }); if (!r.ok) return setErr(r.error ?? ''); setErr(null); toast.success(zh ? '已保存' : '저장했습니다'); router.refresh(); }); }}>
      <Field label={zh ? '邮箱' : '이메일'} htmlFor="pf-email" hint={zh ? '邮箱不可更改' : '이메일은 바꿀 수 없습니다'}><Input id="pf-email" value={email} disabled /></Field>
      <Field label={zh ? '姓名' : '이름'} htmlFor="pf-name" error={err ?? undefined}><Input id="pf-name" value={n} onChange={(e) => setN(e.target.value)} /></Field>
      <Field label={zh ? '手机' : '휴대전화'} htmlFor="pf-phone"><Input id="pf-phone" type="tel" value={p} onChange={(e) => setP(e.target.value)} /></Field>
      <div className="flex justify-end"><Button type="submit" variant="primary" disabled={pending}>{zh ? '保存' : '저장'}</Button></div>
    </form>
  );
}

export function OrgForm({ bizRegNo, address, phone, canEdit, zh }: { bizRegNo: string | null; address: string | null; phone: string | null; canEdit: boolean; zh?: boolean }) {
  const router = useRouter();
  const [b, setB] = React.useState(bizRegNo ?? '');
  const [a, setA] = React.useState(address ?? '');
  const [p, setP] = React.useState(phone ?? '');
  const [pending, start] = React.useTransition();
  return (
    <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); start(async () => { const r = await updateOrg({ bizRegNo: b, address: a, phone: p }); if (!r.ok) return void toast.error(r.error ?? ''); toast.success(zh ? '已保存' : '저장했습니다'); router.refresh(); }); }}>
      <Field label={zh ? '营业执照号' : '사업자등록번호'} htmlFor="of-brn"><Input id="of-brn" value={b} onChange={(e) => setB(e.target.value)} disabled={!canEdit} /></Field>
      <Field label={zh ? '地址' : '주소'} htmlFor="of-addr"><Input id="of-addr" value={a} onChange={(e) => setA(e.target.value)} disabled={!canEdit} /></Field>
      <Field label={zh ? '代表电话' : '대표 연락처'} htmlFor="of-ph"><Input id="of-ph" value={p} onChange={(e) => setP(e.target.value)} disabled={!canEdit} /></Field>
      {canEdit ? <div className="flex justify-end"><Button type="submit" variant="primary" disabled={pending}>{zh ? '保存' : '저장'}</Button></div> : <p className="text-xs text-muted">{zh ? '只有管理员可以修改公司信息' : '회사 정보는 관리자만 고칠 수 있습니다'}</p>}
    </form>
  );
}

export function ThemePicker({ zh }: { zh?: boolean }) {
  const { theme, setTheme } = useTheme();
  return (
    <div className="inline-flex rounded-sm border border-line bg-surface p-0.5" role="radiogroup" aria-label={zh ? '主题' : '화면 밝기'}>
      {(['light', 'dark', 'system'] as const).map((t) => (
        <button key={t} type="button" role="radio" aria-checked={theme === t} onClick={() => setTheme(t)} className={`h-8 rounded-[4px] px-3 text-sm font-semibold ${theme === t ? 'bg-ink text-on-ink' : 'text-muted hover:text-text'}`}>
          {t === 'light' ? (zh ? '明亮' : '밝게') : t === 'dark' ? (zh ? '暗色' : '어둡게') : zh ? '跟随系统' : '기기 설정'}
        </button>
      ))}
    </div>
  );
}
