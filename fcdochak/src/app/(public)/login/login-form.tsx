'use client';
import * as React from 'react';
import { login, type LoginState } from '@/app/actions/session';
import { Button, Field, Input } from '@/components/ui/core';

export function LoginForm({ next }: { next: string }) {
  const [state, action, pending] = React.useActionState<LoginState, FormData>(login, {});
  return (
    <form action={action} className="mt-6 grid gap-4" noValidate>
      <input type="hidden" name="next" value={next} />
      <Field label="이메일" htmlFor="email">
        <Input id="email" name="email" type="email" autoComplete="email" defaultValue={state.email} required aria-invalid={!!state.error || undefined} />
      </Field>
      <Field label="비밀번호" htmlFor="password">
        <Input id="password" name="password" type="password" autoComplete="current-password" required aria-invalid={!!state.error || undefined} />
      </Field>
      {state.error ? <p role="alert" className="rounded-sm border border-stamp/40 bg-stamp-bg p-3 text-sm text-stamp">{state.error}</p> : null}
      <Button type="submit" variant="primary" size="lg" disabled={pending}>
        {pending ? '확인하는 중…' : '로그인'}
      </Button>
    </form>
  );
}
