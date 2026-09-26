'use client';
import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { createAd } from '@/app/actions/admin';
import { Button, Field, Input, NativeSelect } from '@/components/ui/core';

export function AdForm({ partners, hubs, today }: { partners: { id: string; name: string }[]; hubs: { code: string; name: string }[]; today: string }) {
  const router = useRouter();
  const [org, setOrg] = React.useState(partners[0]?.id ?? '');
  const [hub, setHub] = React.useState('');
  const [port, setPort] = React.useState('');
  const [from, setFrom] = React.useState(today);
  const [to, setTo] = React.useState(() => new Date(Date.parse(today) + 30 * 86400_000).toISOString().slice(0, 10));
  const [pending, start] = React.useTransition();
  return (
    <form className="grid gap-3 md:grid-cols-6 md:items-end" onSubmit={(e) => { e.preventDefault(); start(async () => { const r = await createAd({ orgId: org, hub: hub || null, port: port || null, startsOn: from, endsOn: to }); if (!r.ok) return void toast.error(r.error ?? ''); toast.success('광고 자리를 만들었습니다'); router.refresh(); }); }}>
      <Field label="업체(공식)" htmlFor="ad-org" className="md:col-span-2"><NativeSelect id="ad-org" value={org} onChange={(e) => setOrg(e.target.value)}>{partners.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</NativeSelect></Field>
      <Field label="출발" htmlFor="ad-hub"><NativeSelect id="ad-hub" value={hub} onChange={(e) => setHub(e.target.value)}><option value="">모든 구간</option>{hubs.map((h) => <option key={h.code} value={h.code}>{h.name}</option>)}</NativeSelect></Field>
      <Field label="도착항" htmlFor="ad-port"><NativeSelect id="ad-port" value={port} onChange={(e) => setPort(e.target.value)}><option value="">모두</option><option value="ICN">인천</option><option value="PTK">평택</option></NativeSelect></Field>
      <Field label="시작" htmlFor="ad-from"><Input id="ad-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
      <Field label="끝" htmlFor="ad-to"><Input id="ad-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
      <div className="md:col-span-6 flex justify-end"><Button type="submit" variant="primary" disabled={pending}>광고 자리 만들기</Button></div>
    </form>
  );
}
