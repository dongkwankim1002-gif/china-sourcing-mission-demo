'use client';
/**
 * 공개 통관 조회 — 번호 종류·번호·(B/L 이면) 연도·(선택) 운송 방식 → 결과.
 * 로그인하지 않으면 결과만 보여 주고 아무것도 저장하지 않는다. 화주로 로그인했으면 「내 목록에 저장」.
 * 개인통관고유부호(P + 12자리)는 브라우저에서 먼저 막고, 서버도 한 번 더 막는다.
 */
import * as React from 'react';
import Link from 'next/link';
import { Loader2, SearchCheck, ShieldAlert } from 'lucide-react';
import { lookupTrack, saveTrackAction, type LookupActionResult } from '@/app/actions/tracker';
import { Button, Field, Input, NativeSelect } from '@/components/ui/core';
import { TrackResultView } from './result';
import { TRACK_KIND_LABEL, validateTrackInput } from '@/lib/unipass/validate';
import { TRACK_ACTION } from '@/lib/terms';

const MODE_LABEL: Record<string, string> = { '': '모름', LCL: 'LCL 혼적', FCL: 'FCL 컨테이너', FERRY: '카페리', AIR: '항공' };

export function TrackLookup({ thisYear, initial }: { thisYear: number; initial?: { kind?: string; number?: string; year?: string } }) {
  const [kind, setKind] = React.useState(initial?.kind ?? 'hbl');
  const [number, setNumber] = React.useState(initial?.number ?? '');
  const [year, setYear] = React.useState(initial?.year ?? String(thisYear));
  const [mode, setMode] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<{ text: string; field?: string; personal?: boolean } | null>(null);
  const [res, setRes] = React.useState<LookupActionResult['data'] | null>(null);
  const [saved, setSaved] = React.useState<{ id: string; already: boolean } | null>(null);
  const [saveErr, setSaveErr] = React.useState<string | null>(null);
  const bl = kind !== 'cargo_no';

  async function run(over?: { kind: string; number: string }) {
    const k = over?.kind ?? kind;
    const n = over?.number ?? number;
    setErr(null);
    setSaved(null);
    setSaveErr(null);
    const pre = validateTrackInput({ kind: k, number: n, year: k === 'cargo_no' ? null : year }, thisYear);
    if (!pre.ok) {
      setErr({ text: pre.error, field: pre.field, personal: pre.personal });
      if (pre.personal) setNumber(''); // 막은 값은 칸에 남기지 않는다
      setRes(null);
      return;
    }
    setBusy(true);
    try {
      const r = await lookupTrack({ kind: k, number: n, year: k === 'cargo_no' ? null : year, mode: mode || null });
      if (!r.ok) {
        setErr({ text: r.error ?? '조회하지 못했습니다', field: r.field, personal: r.personal });
        setRes(null);
      } else setRes(r.data!);
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    setSaveErr(null);
    const r = await saveTrackAction({ kind, number, year: bl ? year : null, mode: mode || null });
    if (r.ok) setSaved({ id: r.id!, already: !!r.already });
    else setSaveErr(r.error ?? '저장하지 못했습니다');
  }

  return (
    <div className="grid gap-6">
      <form
        className="grid gap-4 rounded-md border border-line bg-surface p-4 md:grid-cols-[180px_1fr_120px_150px_auto] md:items-end"
        onSubmit={(e) => {
          e.preventDefault();
          void run();
        }}
        aria-label="통관 조회"
      >
        <Field label="번호 종류" htmlFor="trk-kind">
          <NativeSelect id="trk-kind" value={kind} onChange={(e) => setKind(e.target.value)}>
            {Object.entries(TRACK_KIND_LABEL).map(([k, l]) => (
              <option key={k} value={k}>{l}</option>
            ))}
          </NativeSelect>
        </Field>
        <Field label={TRACK_KIND_LABEL[kind as keyof typeof TRACK_KIND_LABEL] ?? '번호'} htmlFor="trk-number" error={err && err.field !== 'year' ? err.text : undefined} hint="영문·숫자·하이픈. 개인통관고유부호는 넣지 마세요.">
          <Input
            id="trk-number"
            name="number"
            value={number}
            onChange={(e) => setNumber(e.target.value)}
            placeholder={kind === 'cargo_no' ? '예: 26ABCD1234E56780001' : '예: ABCD12345678'}
            autoComplete="off"
            spellCheck={false}
            inputMode="text"
            aria-invalid={!!err && err.field !== 'year'}
            aria-describedby="trk-number-hint"
          />
        </Field>
        <Field label="B/L 연도" htmlFor="trk-year" error={err?.field === 'year' ? err.text : undefined}>
          <Input id="trk-year" value={bl ? year : ''} onChange={(e) => setYear(e.target.value.replace(/\D/g, '').slice(0, 4))} disabled={!bl} inputMode="numeric" placeholder={bl ? String(thisYear) : '필요 없음'} aria-invalid={err?.field === 'year'} />
        </Field>
        <Field label="운송 방식(선택)" htmlFor="trk-mode">
          <NativeSelect id="trk-mode" value={mode} onChange={(e) => setMode(e.target.value)}>
            {Object.entries(MODE_LABEL).map(([k, l]) => (
              <option key={k} value={k}>{l}</option>
            ))}
          </NativeSelect>
        </Field>
        <Button type="submit" variant="primary" disabled={busy} className="gap-1.5">
          {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <SearchCheck className="size-4" aria-hidden />}
          {TRACK_ACTION.search}
        </Button>
      </form>

      {err?.personal ? (
        <p role="alert" className="flex items-start gap-2 rounded-md border border-stamp/40 bg-stamp-bg/50 p-4 text-sm" data-testid="track-personal-block">
          <ShieldAlert className="mt-0.5 size-4 shrink-0 text-stamp" aria-hidden />
          <span>{err.text}</span>
        </p>
      ) : null}

      <div aria-live="polite">
        {res?.status === 'not_found' ? (
          <p className="rounded-md border border-line bg-surface p-4 text-sm" data-testid="track-not-found">
            조회 결과가 없습니다. 번호·연도·종류(M B/L / H B/L)를 확인해 주세요. 입항 3년이 지난 화물은 조회되지 않습니다(확인 필요).
          </p>
        ) : res?.status === 'multiple' ? (
          <div className="rounded-md border border-line bg-surface p-4 text-sm">
            <p className="font-semibold">이 B/L 로 화물이 여러 건입니다. 화물관리번호로 다시 조회해 주세요.</p>
            <ul className="mt-2 flex flex-wrap gap-2">
              {res.cargoNos.map((c) => (
                <li key={c}>
                  <Button type="button" variant="secondary" size="sm" className="font-mono" onClick={() => { setKind('cargo_no'); setNumber(c); void run({ kind: 'cargo_no', number: c }); }}>
                    {c}
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        ) : res?.status === 'found' && res.view ? (
          <div className="grid gap-4">
            <TrackResultView
              view={res.view}
              mock={res.mock}
              source={res.mock ? 'mock' : 'unipass'}
              headline={res.summary?.cargoNo ? <span className="font-mono text-sm font-bold">{res.summary.cargoNo}</span> : null}
            />
            <div className="flex flex-wrap items-center gap-3 rounded-md border border-line bg-surface-2 p-4 text-sm">
              {saved ? (
                <p data-testid="track-saved">
                  {saved.already ? '이미 저장한 번호입니다.' : '저장했습니다 — 단계가 바뀌면 알림 센터에 알려 드립니다.'}{' '}
                  <Link href={`/app/tracking/${saved.id}`} className="font-semibold underline underline-offset-4">내 통관 목록에서 보기</Link>
                </p>
              ) : res.canSave ? (
                <>
                  <Button type="button" variant="primary" onClick={() => void save()}>{TRACK_ACTION.save}</Button>
                  <span className="text-muted">저장하면 알림(화면 안)·FC도착 선적과 잇기·물류사별 실측이 됩니다.</span>
                  {saveErr ? <span role="alert" className="text-stamp">{saveErr}</span> : null}
                </>
              ) : (
                <span className="text-muted">
                  로그인하지 않아 이 결과는 저장하지 않았습니다.{' '}
                  <Link href="/login?next=/track" className="font-semibold text-text underline underline-offset-4">화주로 로그인</Link>하면 번호를 저장하고 단계가 바뀔 때 알림을 받습니다.
                </span>
              )}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
