'use client';
import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { Steps, useDraft } from '@/components/stepper';
import { Button, Field, Input, NativeSelect } from '@/components/ui/core';
import { Checkbox } from '@/components/ui/radix';
import { RateCardForm, blankCard, issuesToMap } from '@/components/rate-card-form';
import { PartnerSignup, type PartnerSignupT } from '@/lib/schemas';
import { signupPartner } from '@/app/actions/signup';
import { BIZ_TYPE_LABEL } from '@/lib/terms';
import { cn } from '@/lib/cn';

const STEPS = ['사업자', '거점·운송 방식', '취급 능력', '첫 요금표·계정'];
const FIELDS: string[][] = [
  ['company', 'companyZh', 'businessType', 'bizRegNo', 'licenseNo', 'city', 'address', 'phone', 'locale'],
  ['hubs', 'ports', 'modes'],
  ['caps', 'insurance'],
  ['card', 'name', 'email', 'password', 'agree'],
];

type Opt = { code: string; name: string };

function Toggles({ label, options, value, onChange, error }: { label: string; options: Opt[]; value: string[]; onChange: (v: string[]) => void; error?: string }) {
  return (
    <fieldset>
      <legend className="mb-2 text-sm font-semibold">{label}</legend>
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => {
          const on = value.includes(o.code);
          return (
            <button key={o.code} type="button" aria-pressed={on} onClick={() => onChange(on ? value.filter((x) => x !== o.code) : [...value, o.code])} className={cn('h-9 rounded-xs border px-3 text-sm font-semibold', on ? 'border-ink bg-ink text-on-ink' : 'border-line bg-surface hover:border-muted/60')}>
              {o.name}
            </button>
          );
        })}
      </div>
      {error ? <p role="alert" className="mt-1 text-xs text-stamp">{error}</p> : null}
    </fieldset>
  );
}

export function PartnerJoin({ today, hubs, ports, modes, traits, invite }: { today: string; hubs: Opt[]; ports: Opt[]; modes: Opt[]; traits: { code: string; name: string; req: string; needs: boolean }[]; invite?: { token: string; partnerName: string } | null }) {
  const router = useRouter();
  const init: PartnerSignupT = {
    company: invite?.partnerName ?? '', companyZh: '', businessType: 'forwarder', bizRegNo: '', licenseNo: '', city: '', address: '', phone: '', locale: 'ko',
    hubs: [], ports: [], modes: [], caps: [], insurance: '', card: blankCard(today), name: '', email: '', password: '', agree: false as unknown as true,
  };
  const { value: v, setValue, step, setStep, save, clear, restored } = useDraft<PartnerSignupT>('fcd-join-partner', init, ['password']);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [serverErr, setServerErr] = React.useState<string | null>(null);
  const [pending, start] = React.useTransition();
  const set = <K extends keyof PartnerSignupT>(k: K, val: PartnerSignupT[K]) => setValue((s) => ({ ...s, [k]: val }));

  // 첫 요금표의 구간을 고른 거점·방식 안에서
  React.useEffect(() => {
    if (step !== 3) return;
    setValue((s) => {
      const c = { ...s.card };
      if (s.hubs.length && !s.hubs.includes(c.hub)) c.hub = s.hubs[0];
      if (s.ports.length && !s.ports.includes(c.port)) c.port = s.ports[0] as 'ICN';
      if (s.modes.length && !s.modes.includes(c.mode)) c.mode = s.modes[0] as 'LCL';
      return { ...s, card: c };
    });
  }, [step, setValue]);

  const check = (upTo: number) => {
    const r = PartnerSignup.safeParse(v);
    const map = r.success ? {} : issuesToMap(r.error.issues);
    const keys = FIELDS.slice(0, upTo + 1).flat();
    const relevant = Object.fromEntries(Object.entries(map).filter(([k]) => keys.includes(k.split('.')[0])));
    setErrors(relevant);
    return Object.keys(relevant).length === 0;
  };
  const next = () => {
    if (!check(step)) return;
    save(v, step + 1);
    setStep(step + 1);
    window.scrollTo({ top: 0 });
  };
  const submit = () => {
    if (!check(3)) return;
    setServerErr(null);
    start(async () => {
      const r = await signupPartner(v, invite?.token ?? null);
      if (r.ok && r.redirect) {
        clear();
        router.push(r.redirect);
      } else {
        setServerErr(r.error ?? '신청하지 못했습니다');
        if (r.path) setErrors({ [r.path]: r.error ?? '' });
      }
    });
  };
  const cardErrors = Object.fromEntries(Object.entries(errors).filter(([k]) => k.startsWith('card.')).map(([k, m]) => [k.slice(5), m]));

  return (
    <div className="mt-6 rounded-md border border-line bg-surface p-5">
      <Steps steps={STEPS} current={step} onJump={setStep} />
      {restored ? <p className="mt-3 text-xs text-muted">저장해 둔 내용을 불러왔습니다. 비밀번호만 다시 넣어 주세요.</p> : null}
      <form className="mt-6 grid gap-4" noValidate onSubmit={(e) => { e.preventDefault(); if (step < 3) next(); else submit(); }}>
        {step === 0 ? (
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="회사 이름" htmlFor="co" required error={errors.company}>
              <Input id="co" value={v.company} onChange={(e) => set('company', e.target.value)} aria-invalid={!!errors.company || undefined} />
            </Field>
            <Field label="중국어 회사명 中文名称" htmlFor="coz">
              <Input id="coz" value={v.companyZh} onChange={(e) => set('companyZh', e.target.value)} lang="zh-CN" />
            </Field>
            <Field label="업종" htmlFor="bt" required>
              <NativeSelect id="bt" value={v.businessType} onChange={(e) => set('businessType', e.target.value as PartnerSignupT['businessType'])}>
                {Object.entries(BIZ_TYPE_LABEL).map(([k, l]) => (
                  <option key={k} value={k}>{l}</option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="사업자등록번호 / 营业执照号" htmlFor="brn" required error={errors.bizRegNo}>
              <Input id="brn" value={v.bizRegNo} onChange={(e) => set('bizRegNo', e.target.value)} aria-invalid={!!errors.bizRegNo || undefined} />
            </Field>
            <Field label="업역 등록번호" htmlFor="lic" hint="국제물류주선업·관세사·창고업 등록번호">
              <Input id="lic" value={v.licenseNo} onChange={(e) => set('licenseNo', e.target.value)} />
            </Field>
            <Field label="도시" htmlFor="city" required error={errors.city}>
              <Input id="city" value={v.city} onChange={(e) => set('city', e.target.value)} aria-invalid={!!errors.city || undefined} />
            </Field>
            <Field label="주소" htmlFor="addr" className="md:col-span-2">
              <Input id="addr" value={v.address} onChange={(e) => set('address', e.target.value)} autoComplete="street-address" />
            </Field>
            <Field label="대표 연락처" htmlFor="ph" hint="공개 페이지에 싣는 회사 대표 번호">
              <Input id="ph" type="tel" value={v.phone} onChange={(e) => set('phone', e.target.value)} />
            </Field>
            <Field label="콘솔 언어 / 控制台语言" htmlFor="loc">
              <NativeSelect id="loc" value={v.locale} onChange={(e) => set('locale', e.target.value as 'ko' | 'zh')}>
                <option value="ko">한국어</option>
                <option value="zh">中文(简体)</option>
              </NativeSelect>
            </Field>
          </div>
        ) : step === 1 ? (
          <div className="grid gap-5">
            <Toggles label="출발 거점" options={hubs} value={v.hubs} onChange={(x) => set('hubs', x)} error={errors.hubs} />
            <Toggles label="도착항" options={ports} value={v.ports} onChange={(x) => set('ports', x)} error={errors.ports} />
            <Toggles label="운송 방식" options={modes} value={v.modes} onChange={(x) => set('modes', x)} error={errors.modes} />
          </div>
        ) : step === 2 ? (
          <div className="grid gap-4">
            <fieldset>
              <legend className="mb-2 text-sm font-semibold">취급할 수 있는 화물</legend>
              <ul className="grid gap-2 md:grid-cols-2">
                {traits.map((t) => {
                  const on = v.caps.includes(t.code);
                  return (
                    <li key={t.code}>
                      <label className={cn('flex h-full items-start gap-3 rounded-sm border p-3', on ? 'border-ink' : 'border-line')}>
                        <Checkbox checked={on} onCheckedChange={(c) => set('caps', c ? [...v.caps, t.code] : v.caps.filter((x) => x !== t.code))} className="mt-0.5" />
                        <span>
                          <span className="block text-sm font-semibold">{t.name}{t.needs ? <span className="ml-1 text-2xs font-normal text-caution">등록해야 요청을 받음</span> : null}</span>
                          <span className="block text-xs text-muted">{t.req}</span>
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            </fieldset>
            <Field label="적하보험" htmlFor="ins" hint="예: 적하보험 가입(건당 최대 3억 원)">
              <Input id="ins" value={v.insurance} onChange={(e) => set('insurance', e.target.value)} />
            </Field>
          </div>
        ) : (
          <div className="grid gap-6">
            <RateCardForm
              value={v.card}
              onChange={(c) => set('card', c)}
              errors={cardErrors}
              hubs={hubs.filter((h) => !v.hubs.length || v.hubs.includes(h.code))}
              ports={ports.filter((p) => !v.ports.length || v.ports.includes(p.code))}
              modes={modes.filter((m) => !v.modes.length || v.modes.includes(m.code))}
              locale={v.locale}
            />
            <div className="grid gap-4 border-t border-line-2 pt-5 md:grid-cols-3">
              <Field label="담당자 이름" htmlFor="nm" required error={errors.name}>
                <Input id="nm" value={v.name} onChange={(e) => set('name', e.target.value)} autoComplete="name" />
              </Field>
              <Field label="이메일" htmlFor="em" required error={errors.email}>
                <Input id="em" type="email" value={v.email} onChange={(e) => set('email', e.target.value)} autoComplete="email" />
              </Field>
              <Field label="비밀번호" htmlFor="pw" required error={errors.password} hint="10자 이상, 영문+숫자">
                <Input id="pw" type="password" value={v.password} onChange={(e) => set('password', e.target.value)} autoComplete="new-password" />
              </Field>
            </div>
            <label className="flex items-start gap-2 text-sm">
              <Checkbox checked={!!v.agree} onCheckedChange={(c) => set('agree', (c === true) as true)} className="mt-0.5" />
              <span>
                <Link href="/policy#listing" className="underline" target="_blank">게시 기준</Link>과 <Link href="/policy#fees" className="underline" target="_blank">수수료 기준</Link>에 동의합니다. 요금표는 새 판으로만 쌓이고 고쳐지지 않는다는 것을 압니다.
              </span>
            </label>
            {errors.agree ? <p role="alert" className="text-xs text-stamp">{errors.agree}</p> : null}
          </div>
        )}
        {serverErr ? <p role="alert" className="rounded-sm border border-stamp/40 bg-stamp-bg p-3 text-sm text-stamp">{serverErr}</p> : null}
        <div className="mt-2 flex items-center justify-between">
          {step > 0 ? <Button variant="ghost" onClick={() => setStep(step - 1)}><ArrowLeft aria-hidden /> 이전</Button> : <span />}
          <Button type="submit" variant="primary" size="lg" disabled={pending}>
            {step < 3 ? <>다음 <ArrowRight aria-hidden /></> : pending ? '보내는 중…' : '입점 신청하기'}
          </Button>
        </div>
      </form>
    </div>
  );
}
