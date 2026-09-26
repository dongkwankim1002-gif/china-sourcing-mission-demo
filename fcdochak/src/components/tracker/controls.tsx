'use client';
/** 화주 통관 목록의 입력들 — 번호 더하기 · 알림 켜고 끄기 · 지금 다시 조회 · 목록에서 빼기/다시 지켜보기 · 선적/업체 잇기. 운영 버튼 둘 */
import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Bell, BellOff, Loader2, RefreshCw } from 'lucide-react';
import { adminPoll, adminRecompute, archiveTrack, linkTrack, refreshTrackAction, restoreTrack, saveTrackAction, setTrackWatch } from '@/app/actions/tracker';
import { Button, Field, Input, NativeSelect } from '@/components/ui/core';
import { TRACK_KIND_LABEL, validateTrackInput } from '@/lib/unipass/validate';
import { TRACK_ACTION } from '@/lib/terms';

export interface Opt {
  id: string;
  label: string;
}

const MODES: [string, string][] = [['', '모름'], ['LCL', 'LCL 혼적'], ['FCL', 'FCL 컨테이너'], ['FERRY', '카페리'], ['AIR', '항공']];

export function TrackAddForm({ thisYear, shipments }: { thisYear: number; shipments: Opt[] }) {
  const router = useRouter();
  const [kind, setKind] = React.useState('hbl');
  const [number, setNumber] = React.useState('');
  const [year, setYear] = React.useState(String(thisYear));
  const [label, setLabel] = React.useState('');
  const [shipment, setShipment] = React.useState('');
  const [mode, setMode] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<{ text: string; field?: string } | null>(null);
  const bl = kind !== 'cargo_no';
  return (
    <form
      className="grid gap-3 p-4 md:grid-cols-[150px_1fr_100px] lg:grid-cols-[150px_1fr_100px_1fr_1fr_120px_auto] lg:items-end"
      aria-label="번호 더하기"
      onSubmit={async (e) => {
        e.preventDefault();
        setErr(null);
        const pre = validateTrackInput({ kind, number, year: bl ? year : null }, thisYear);
        if (!pre.ok) {
          setErr({ text: pre.error, field: pre.field });
          if (pre.personal) setNumber('');
          return;
        }
        setBusy(true);
        const r = await saveTrackAction({ kind, number, year: bl ? year : null, label, shipmentId: shipment || null, mode: mode || null });
        setBusy(false);
        if (!r.ok) {
          setErr({ text: r.error ?? '저장하지 못했습니다', field: r.field });
          if (r.personal) setNumber('');
          return;
        }
        setNumber('');
        setLabel('');
        router.push(`/app/tracking/${r.id}`);
      }}
    >
      <Field label="번호 종류" htmlFor="add-kind">
        <NativeSelect id="add-kind" value={kind} onChange={(e) => setKind(e.target.value)}>
          {Object.entries(TRACK_KIND_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </NativeSelect>
      </Field>
      <Field label="번호" htmlFor="add-number" error={err && err.field !== 'year' ? err.text : undefined}>
        <Input id="add-number" value={number} onChange={(e) => setNumber(e.target.value)} autoComplete="off" spellCheck={false} placeholder="영문·숫자·하이픈" aria-invalid={!!err && err.field !== 'year'} />
      </Field>
      <Field label="B/L 연도" htmlFor="add-year" error={err?.field === 'year' ? err.text : undefined}>
        <Input id="add-year" value={bl ? year : ''} disabled={!bl} inputMode="numeric" onChange={(e) => setYear(e.target.value.replace(/\D/g, '').slice(0, 4))} />
      </Field>
      <Field label="별명(선택)" htmlFor="add-label">
        <Input id="add-label" value={label} maxLength={60} onChange={(e) => setLabel(e.target.value)} placeholder="예: 가을 이불 1차" />
      </Field>
      <Field label="FC도착 선적과 잇기(선택)" htmlFor="add-ship">
        <NativeSelect id="add-ship" value={shipment} onChange={(e) => setShipment(e.target.value)}>
          <option value="">잇지 않음</option>
          {shipments.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </NativeSelect>
      </Field>
      <Field label="방식" htmlFor="add-mode" hint={shipment ? '선적을 이으면 선적의 방식을 따릅니다' : undefined}>
        <NativeSelect id="add-mode" value={mode} onChange={(e) => setMode(e.target.value)} disabled={!!shipment}>
          {MODES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </NativeSelect>
      </Field>
      <Button type="submit" variant="primary" disabled={busy}>
        {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
        {TRACK_ACTION.save}
      </Button>
    </form>
  );
}

export function TrackControls({ id, watching, archived = false }: { id: string; watching: boolean; archived?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = React.useState<string | null>(null);
  const [msg, setMsg] = React.useState<string | null>(null);
  const act = async (k: string, fn: () => Promise<{ ok: boolean; error?: string }>, after?: () => void) => {
    setBusy(k);
    setMsg(null);
    const r = await fn();
    setBusy(null);
    if (!r.ok) setMsg(r.error ?? '하지 못했습니다');
    else {
      after?.();
      router.refresh();
    }
  };
  if (archived) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="primary" disabled={!!busy} onClick={() => act('u', () => restoreTrack(id))}>
          {busy === 'u' ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Bell className="size-4" aria-hidden />}
          {TRACK_ACTION.restore}
        </Button>
        {msg ? <span role="alert" className="text-sm text-stamp">{msg}</span> : null}
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button type="button" variant={watching ? 'secondary' : 'primary'} disabled={!!busy} onClick={() => act('w', () => setTrackWatch(id, !watching))} aria-pressed={watching}>
        {watching ? <BellOff className="size-4" aria-hidden /> : <Bell className="size-4" aria-hidden />}
        {watching ? TRACK_ACTION.watchOff : TRACK_ACTION.watchOn}
      </Button>
      <Button type="button" variant="secondary" disabled={!!busy} onClick={() => act('r', () => refreshTrackAction(id))}>
        {busy === 'r' ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <RefreshCw className="size-4" aria-hidden />}
        {TRACK_ACTION.refresh}
      </Button>
      <Button type="button" variant="ghost" disabled={!!busy} onClick={() => act('a', () => archiveTrack(id), () => router.push('/app/tracking'))}>
        {TRACK_ACTION.unlist}
      </Button>
      {msg ? <span role="alert" className="text-sm text-stamp">{msg}</span> : null}
    </div>
  );
}

export function TrackLinkForm({ id, initial, shipments, partners, brokers }: { id: string; initial: { label: string; mode: string; shipmentId: string; partnerId: string; brokerId: string }; shipments: Opt[]; partners: Opt[]; brokers: Opt[] }) {
  const router = useRouter();
  const [v, setV] = React.useState(initial);
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState<{ ok: boolean; text: string } | null>(null);
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setV({ ...v, [k]: e.target.value });
  return (
    <form
      className="grid gap-3 sm:grid-cols-2"
      aria-label="선적·업체 잇기"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        const r = await linkTrack(id, { label: v.label, mode: v.mode || null, shipmentId: v.shipmentId || null, partnerId: v.partnerId || null, brokerId: v.brokerId || null });
        setBusy(false);
        setMsg(r.ok ? { ok: true, text: '이었습니다. 이 번호의 실측이 선적·업체 통계에 들어갑니다.' } : { ok: false, text: r.error ?? '잇지 못했습니다' });
        if (r.ok) router.refresh();
      }}
    >
      <Field label="별명" htmlFor="ln-label">
        <Input id="ln-label" value={v.label} maxLength={60} onChange={set('label')} />
      </Field>
      <Field label="FC도착 선적" htmlFor="ln-ship" hint="이으면 선적의 물류사·방식을 따르고, 선적 화면의 통관 단계가 실측으로 보입니다">
        <NativeSelect id="ln-ship" value={v.shipmentId} onChange={set('shipmentId')}>
          <option value="">잇지 않음</option>
          {shipments.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </NativeSelect>
      </Field>
      <Field label="물류사(선적을 잇지 않을 때)" htmlFor="ln-partner">
        <NativeSelect id="ln-partner" value={v.partnerId} onChange={set('partnerId')} disabled={!!v.shipmentId}>
          <option value="">고르지 않음</option>
          {partners.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </NativeSelect>
      </Field>
      <Field label="관세사" htmlFor="ln-broker">
        <NativeSelect id="ln-broker" value={v.brokerId} onChange={set('brokerId')}>
          <option value="">고르지 않음</option>
          {brokers.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </NativeSelect>
      </Field>
      <Field label="방식" htmlFor="ln-mode">
        <NativeSelect id="ln-mode" value={v.mode} onChange={set('mode')} disabled={!!v.shipmentId}>
          {MODES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </NativeSelect>
      </Field>
      <div className="flex flex-wrap items-end gap-3">
        <Button type="submit" variant="primary" disabled={busy}>{TRACK_ACTION.link}</Button>
        {msg ? <span role={msg.ok ? 'status' : 'alert'} className={msg.ok ? 'text-sm text-ok' : 'text-sm text-stamp'}>{msg.text}</span> : null}
      </div>
    </form>
  );
}

export function AdminTrackerButtons() {
  const router = useRouter();
  const [busy, setBusy] = React.useState<string | null>(null);
  const [msg, setMsg] = React.useState<string | null>(null);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        type="button"
        variant="primary"
        disabled={!!busy}
        onClick={async () => {
          setBusy('p');
          const r = await adminPoll();
          setBusy(null);
          setMsg(r.ok ? `본 번호 ${r.summary!.seen} · 호출 ${r.summary!.calls} · 바뀜 ${r.summary!.changed} · 건너뜀 ${r.summary!.skipped} · 실패 ${r.summary!.failures}` : r.error ?? '돌리지 못했습니다');
          router.refresh();
        }}
      >
        {busy === 'p' ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
        {TRACK_ACTION.poll}
      </Button>
      <Button
        type="button"
        variant="secondary"
        disabled={!!busy}
        onClick={async () => {
          setBusy('s');
          const r = await adminRecompute();
          setBusy(null);
          setMsg(r.ok ? `통계 새 판 ${r.rows}줄` : r.error ?? '셈하지 못했습니다');
          router.refresh();
        }}
      >
        {TRACK_ACTION.recompute}
      </Button>
      {msg ? <span role="status" className="text-sm text-muted">{msg}</span> : null}
    </div>
  );
}
