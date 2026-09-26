'use client';
import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { savePartnerProfile } from '@/app/actions/partner';
import { Button, Field, Input, NativeSelect, Textarea } from '@/components/ui/core';
import { cn } from '@/lib/cn';

type Opt = { code: string; name: string };
export interface ProfileValue { intro: string; website: string; phone: string; address: string; insurance: string; licenseNo: string; locale: 'ko' | 'zh'; hubs: string[]; modes: string[]; caps: string[] }

function Toggles({ label, options, value, onChange }: { label: string; options: Opt[]; value: string[]; onChange: (v: string[]) => void }) {
  return (
    <fieldset>
      <legend className="mb-1.5 text-sm font-semibold">{label}</legend>
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => {
          const on = value.includes(o.code);
          return <button key={o.code} type="button" aria-pressed={on} onClick={() => onChange(on ? value.filter((x) => x !== o.code) : [...value, o.code])} className={cn('h-8 rounded-xs border px-2.5 text-xs font-semibold', on ? 'border-ink bg-ink text-on-ink' : 'border-line hover:border-muted/60')}>{o.name}</button>;
        })}
      </div>
    </fieldset>
  );
}

export function PartnerProfileForm({ init, hubs, modes, traits, zh, canEdit }: { init: ProfileValue; hubs: Opt[]; modes: Opt[]; traits: Opt[]; zh: boolean; canEdit: boolean }) {
  const t = useTranslations('p');
  const router = useRouter();
  const [v, setV] = React.useState(init);
  const [pending, start] = React.useTransition();
  const set = <K extends keyof ProfileValue>(k: K, x: ProfileValue[K]) => setV((s) => ({ ...s, [k]: x }));
  return (
    <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); start(async () => { const r = await savePartnerProfile(v); if (!r.ok) return void toast.error(r.error ?? ''); toast.success(t('prof.saved')); router.refresh(); }); }}>
      <fieldset disabled={!canEdit} className="grid gap-4 disabled:opacity-70">
        <Field label={zh ? '公司介绍' : '소개'} htmlFor="pp-intro" hint={zh ? '600字以内' : '600자 이내 — 공식 등록 업체만 공개 페이지에 실립니다'}><Textarea id="pp-intro" value={v.intro} onChange={(e) => set('intro', e.target.value)} maxLength={600} /></Field>
        <div className="grid gap-3 md:grid-cols-2">
          <Field label={zh ? '网站' : '누리집'} htmlFor="pp-web"><Input id="pp-web" value={v.website} onChange={(e) => set('website', e.target.value)} placeholder="https://" /></Field>
          <Field label={zh ? '代表电话' : '대표 연락처'} htmlFor="pp-ph"><Input id="pp-ph" value={v.phone} onChange={(e) => set('phone', e.target.value)} /></Field>
          <Field label={zh ? '地址' : '주소'} htmlFor="pp-addr" className="md:col-span-2"><Input id="pp-addr" value={v.address} onChange={(e) => set('address', e.target.value)} /></Field>
          <Field label={zh ? '资质登记号' : '업역 등록번호'} htmlFor="pp-lic"><Input id="pp-lic" value={v.licenseNo} onChange={(e) => set('licenseNo', e.target.value)} /></Field>
          <Field label={zh ? '货运险' : '적하보험'} htmlFor="pp-ins"><Input id="pp-ins" value={v.insurance} onChange={(e) => set('insurance', e.target.value)} /></Field>
          <Field label={zh ? '控制台语言' : '콘솔 기본 언어'} htmlFor="pp-loc"><NativeSelect id="pp-loc" value={v.locale} onChange={(e) => set('locale', e.target.value as 'ko')}><option value="ko">한국어</option><option value="zh">中文</option></NativeSelect></Field>
        </div>
        <Toggles label={zh ? '起运地' : '출발 거점'} options={hubs} value={v.hubs} onChange={(x) => set('hubs', x)} />
        <Toggles label={zh ? '运输方式' : '운송 방식'} options={modes} value={v.modes} onChange={(x) => set('modes', x)} />
        <Toggles label={zh ? '承运能力' : '취급 능력'} options={traits} value={v.caps} onChange={(x) => set('caps', x)} />
      </fieldset>
      {canEdit ? <div className="flex justify-end"><Button type="submit" variant="primary" disabled={pending}>{t('common.save')}</Button></div> : null}
    </form>
  );
}
