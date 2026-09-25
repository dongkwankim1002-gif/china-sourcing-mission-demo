'use client';
import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { Steps, useDraft } from '@/components/stepper';
import { Button, Field, Input } from '@/components/ui/core';
import { Checkbox } from '@/components/ui/radix';
import { ShipperSignup, type ShipperSignupT } from '@/lib/schemas';
import { signupShipper } from '@/app/actions/signup';
import { issuesToMap } from '@/components/rate-card-form';
import { cn } from '@/lib/cn';

const STEPS = ['회사', '담당자 계정', '주로 보내는 화물'];
const FIELDS: (keyof ShipperSignupT)[][] = [['company', 'bizRegNo'], ['name', 'email', 'phone', 'password'], ['hubs', 'category', 'agree']];

export function ShipperJoin({ hubs }: { hubs: { code: string; name: string }[] }) {
  const router = useRouter();
  const init = { company: '', bizRegNo: '', category: '', hubs: [] as string[], name: '', email: '', phone: '', password: '', agree: false as unknown as true };
  const { value: v, setValue, step, setStep, save, clear, restored } = useDraft('fcd-join-shipper', init, ['password']);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [pending, start] = React.useTransition();
  const [serverErr, setServerErr] = React.useState<string | null>(null);
  const set = <K extends keyof ShipperSignupT>(k: K, val: ShipperSignupT[K]) => setValue((s) => ({ ...s, [k]: val }));

  const check = (upTo: number) => {
    const r = ShipperSignup.safeParse(v);
    const map = r.success ? {} : issuesToMap(r.error.issues);
    const keys = FIELDS.slice(0, upTo + 1).flat() as string[];
    const relevant = Object.fromEntries(Object.entries(map).filter(([k]) => keys.includes(k.split('.')[0])));
    setErrors(relevant);
    return Object.keys(relevant).length === 0;
  };
  const next = () => {
    if (!check(step)) return;
    save(v, step + 1);
    setStep(step + 1);
  };
  const submit = () => {
    if (!check(2)) return;
    setServerErr(null);
    start(async () => {
      const r = await signupShipper(v);
      if (r.ok && r.redirect) {
        clear();
        router.push(r.redirect);
      } else {
        setServerErr(r.error ?? '가입하지 못했습니다');
        if (r.path) setErrors({ [r.path]: r.error ?? '' });
        if (r.path === 'email' || r.path === 'password') setStep(1);
      }
    });
  };

  return (
    <div className="mt-6 rounded-md border border-line bg-surface p-5">
      <Steps steps={STEPS} current={step} onJump={setStep} />
      {restored ? <p className="mt-3 text-xs text-muted">저장해 둔 내용을 불러왔습니다. 비밀번호만 다시 넣어 주세요.</p> : null}
      <form
        className="mt-6 grid gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (step < 2) next();
          else submit();
        }}
        noValidate
      >
        {step === 0 ? (
          <>
            <Field label="회사(상호) 이름" htmlFor="company" required error={errors.company}>
              <Input id="company" value={v.company} onChange={(e) => set('company', e.target.value)} onBlur={() => check(0)} autoComplete="organization" aria-invalid={!!errors.company || undefined} />
            </Field>
            <Field label="사업자등록번호" htmlFor="brn" hint="지금 없으면 비워 두세요. 견적 요청 전에 넣으면 됩니다." error={errors.bizRegNo}>
              <Input id="brn" inputMode="numeric" value={v.bizRegNo} onChange={(e) => set('bizRegNo', e.target.value)} placeholder="000-00-00000" aria-invalid={!!errors.bizRegNo || undefined} />
            </Field>
          </>
        ) : step === 1 ? (
          <>
            <Field label="이름" htmlFor="name" required error={errors.name}>
              <Input id="name" value={v.name} onChange={(e) => set('name', e.target.value)} autoComplete="name" aria-invalid={!!errors.name || undefined} />
            </Field>
            <Field label="이메일" htmlFor="email" required error={errors.email}>
              <Input id="email" type="email" value={v.email} onChange={(e) => set('email', e.target.value)} onBlur={() => check(1)} autoComplete="email" aria-invalid={!!errors.email || undefined} />
            </Field>
            <Field label="휴대전화" htmlFor="phone" hint="알림 문자를 켤 때만 씁니다">
              <Input id="phone" type="tel" value={v.phone} onChange={(e) => set('phone', e.target.value)} autoComplete="tel" />
            </Field>
            <Field label="비밀번호" htmlFor="pw" required hint="10자 이상, 영문과 숫자를 섞어 주세요" error={errors.password}>
              <Input id="pw" type="password" value={v.password} onChange={(e) => set('password', e.target.value)} onBlur={() => check(1)} autoComplete="new-password" aria-invalid={!!errors.password || undefined} />
            </Field>
          </>
        ) : (
          <>
            <fieldset>
              <legend className="mb-2 text-sm font-semibold">주로 보내는 거점</legend>
              <div className="flex flex-wrap gap-1.5">
                {hubs.map((h) => {
                  const on = v.hubs.includes(h.code);
                  return (
                    <button key={h.code} type="button" aria-pressed={on} onClick={() => set('hubs', on ? v.hubs.filter((x) => x !== h.code) : [...v.hubs, h.code])} className={cn('h-9 rounded-xs border px-3 text-sm font-semibold', on ? 'border-ink bg-ink text-on-ink' : 'border-line hover:border-muted/60')}>
                      {h.name}
                    </button>
                  );
                })}
              </div>
            </fieldset>
            <Field label="주 품목" htmlFor="cat" hint="예: 생활용품, 주방용품, 완구">
              <Input id="cat" value={v.category} onChange={(e) => set('category', e.target.value)} />
            </Field>
            <label className="flex items-start gap-2 text-sm">
              <Checkbox checked={!!v.agree} onCheckedChange={(c) => set('agree', (c === true) as true)} aria-invalid={!!errors.agree || undefined} className="mt-0.5" />
              <span>
                <Link href="/policy#terms" className="underline" target="_blank">이용약관</Link>과 <Link href="/policy#privacy" className="underline" target="_blank">개인정보 처리방침</Link>에 동의합니다. 운송계약은 물류사와 직접 맺는다는 것을 압니다.
              </span>
            </label>
            {errors.agree ? <p role="alert" className="text-xs text-stamp">{errors.agree}</p> : null}
          </>
        )}
        {serverErr ? <p role="alert" className="rounded-sm border border-stamp/40 bg-stamp-bg p-3 text-sm text-stamp">{serverErr}</p> : null}
        <div className="mt-2 flex items-center justify-between gap-2">
          {step > 0 ? (
            <Button variant="ghost" onClick={() => setStep(step - 1)}>
              <ArrowLeft aria-hidden /> 이전
            </Button>
          ) : (
            <span />
          )}
          <Button type="submit" variant="primary" size="lg" disabled={pending}>
            {step < 2 ? (
              <>
                다음 <ArrowRight aria-hidden />
              </>
            ) : pending ? (
              '만드는 중…'
            ) : (
              '가입하고 시작하기'
            )}
          </Button>
        </div>
      </form>
    </div>
  );
}
