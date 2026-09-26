'use client';
/**
 * 물류사 성적표 입력(v2 6차 scorecard) — 물류사: 화물번호 일괄 제출 · 이의 제기 · 거두기. 운영: 이의 처리 · 새 판 · 제출 번호 조회 · 부호 찾기/연결 · 관세사 기본 정보.
 * 물류사 화면은 중국어 병기 관례(한 / 中).
 */
import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import {
  adminBrokerProfile,
  adminDisputeAction,
  adminFindCodes,
  adminLinkCode,
  adminRecomputeScorecards,
  adminRefreshSubmitted,
  openDisputeAction,
  submitNumbersAction,
  withdrawDisputeAction,
} from '@/app/actions/scorecard';
import { Button, Field, Input, NativeSelect, Textarea } from '@/components/ui/core';
import type { ForwarderRecord } from '@/lib/unipass/forwarders';
import { SCORECARD_ACTION } from '@/lib/terms';

const Spin = () => <Loader2 className="size-4 animate-spin" aria-hidden />;

export function SubmitNumbersForm({ thisYear }: { thisYear: number }) {
  const router = useRouter();
  const [text, setText] = React.useState('');
  const [kind, setKind] = React.useState('hbl');
  const [year, setYear] = React.useState(String(thisYear));
  const [port, setPort] = React.useState('');
  const [mode, setMode] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState<{ ok: boolean; text: string; rejected?: { line: number; raw: string; error: string }[] } | null>(null);
  const lines = text.split(/\r?\n/).filter((s) => s.trim()).length;
  return (
    <form
      aria-label="화물번호 제출"
      className="grid gap-3 p-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        const r = await submitNumbersAction({ text, kind, year, port: port || null, mode: mode || null });
        setBusy(false);
        if (!r.ok || !r.result) return setMsg({ ok: false, text: r.error ?? '제출하지 못했습니다' });
        const x = r.result;
        setMsg({
          ok: true,
          text: `새로 ${x.added}건 · 이미 낸 번호 ${x.already}건 · 거절 ${x.rejected.length}건 / 新增 ${x.added} · 已提交 ${x.already} · 拒绝 ${x.rejected.length}${x.waiting ? ' — 관세청 조회는 연결되면 시작합니다(연결 준비 중)' : x.lookedUp ? ` — ${x.lookedUp}건 바로 조회` : ''}`,
          rejected: x.rejected,
        });
        if (x.added) setText('');
        router.refresh();
      }}
    >
      <Field label="화물번호 붙여 넣기 · 粘贴单号" htmlFor="sc-text" hint={`한 줄에 하나(최대 200줄). 「번호 연도」로 연도를 줄마다 바꿀 수 있습니다. 개인통관고유부호는 받지 않습니다. 지금 ${lines}줄 · 每行一个(最多200行)，可写「单号 年份」，不接收个人通关代码。当前 ${lines} 行`}>
        <Textarea id="sc-text" value={text} onChange={(e) => setText(e.target.value)} rows={6} spellCheck={false} placeholder={'EXHBL-0001\nEXHBL-0002 2025\n26EXMP00ANLU0830001'} className="font-mono text-sm" />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1fr_1fr_auto] lg:items-end">
        <Field label="B/L 종류 · 提单类型" htmlFor="sc-kind">
          <NativeSelect id="sc-kind" value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="hbl">H B/L(하우스 · 分单)</option>
            <option value="mbl">M B/L(마스터 · 主单)</option>
          </NativeSelect>
        </Field>
        <Field label="기본 연도 · 年份" htmlFor="sc-year">
          <Input id="sc-year" value={year} inputMode="numeric" onChange={(e) => setYear(e.target.value.replace(/\D/g, '').slice(0, 4))} />
        </Field>
        <Field label="도착항 · 到港(선택)" htmlFor="sc-port">
          <NativeSelect id="sc-port" value={port} onChange={(e) => setPort(e.target.value)}>
            <option value="">관세청 기록으로 · 按海关记录</option>
            <option value="ICN">인천 · 仁川</option>
            <option value="PTK">평택 · 平泽</option>
          </NativeSelect>
        </Field>
        <Field label="방식 · 方式(선택)" htmlFor="sc-mode">
          <NativeSelect id="sc-mode" value={mode} onChange={(e) => setMode(e.target.value)}>
            <option value="">모름 · 不确定</option>
            <option value="LCL">LCL 拼箱</option>
            <option value="FCL">FCL 整箱</option>
            <option value="FERRY">카페리 客滚</option>
            <option value="AIR">항공 空运</option>
          </NativeSelect>
        </Field>
        <Button type="submit" variant="primary" disabled={busy || !lines}>
          {busy ? <Spin /> : null}
          {SCORECARD_ACTION.submit}
        </Button>
      </div>
      {msg ? (
        <div role="status" className={msg.ok ? 'text-sm text-text' : 'text-sm font-semibold text-stamp'}>
          <p>{msg.text}</p>
          {msg.rejected?.length ? (
            <ul className="mt-1 grid gap-0.5 text-xs text-muted">
              {msg.rejected.slice(0, 10).map((r) => (
                <li key={r.line}>
                  {r.line}줄 <span className="font-mono">{r.raw}</span> — {r.error}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </form>
  );
}

const METRICS: [string, string][] = [
  ['clearance', '입항 → 수리 · 通关时长'],
  ['inspection', '검사 비율 · 查验率'],
  ['bonded_release', '반입 → 반출 · 入库→出库'],
  ['release_fc', '반출 → FC 입고 · 出库→FC'],
  ['submission', '제출률 · 提交率'],
  ['other', '그 밖 · 其他'],
];

export function DisputeForm() {
  const router = useRouter();
  const [metric, setMetric] = React.useState('clearance');
  const [cargoRef, setRef] = React.useState('');
  const [body, setBody] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState<{ ok: boolean; text: string } | null>(null);
  return (
    <form
      aria-label="이의 제기"
      className="grid gap-3 p-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        const r = await openDisputeAction({ metric: metric as never, cargoRef: cargoRef || null, body });
        setBusy(false);
        setMsg(r.ok ? { ok: true, text: '이의를 올렸습니다. 운영자가 확인합니다 / 已提交，运营会确认' } : { ok: false, text: r.error ?? '올리지 못했습니다' });
        if (r.ok) {
          setBody('');
          setRef('');
          router.refresh();
        }
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="지표 · 指标" htmlFor="dp-metric">
          <NativeSelect id="dp-metric" value={metric} onChange={(e) => setMetric(e.target.value)}>
            {METRICS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </NativeSelect>
        </Field>
        <Field label="화물번호 · 单号(선택)" htmlFor="dp-ref" hint="받아들이면 그 화물을 성적에서 뺍니다 · 采纳后该货物不计入成绩">
          <Input id="dp-ref" value={cargoRef} onChange={(e) => setRef(e.target.value)} spellCheck={false} placeholder="EXHBL-0001" />
        </Field>
      </div>
      <Field label="사유 · 理由" htmlFor="dp-body">
        <Textarea id="dp-body" value={body} onChange={(e) => setBody(e.target.value)} rows={3} maxLength={1000} placeholder="예: 화주가 서류를 늦게 줘서 수리가 늦었습니다 · 例：货主提交资料晚，放行延迟" />
      </Field>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant="secondary" disabled={busy || body.trim().length < 5}>
          {busy ? <Spin /> : null}
          {SCORECARD_ACTION.dispute}
        </Button>
        {msg ? <span role="status" className={msg.ok ? 'text-sm' : 'text-sm font-semibold text-stamp'}>{msg.text}</span> : null}
      </div>
    </form>
  );
}

export function WithdrawButton({ id }: { id: string }) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  return (
    <Button
      type="button"
      size="sm"
      variant="ghost"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await withdrawDisputeAction(id);
        setBusy(false);
        router.refresh();
      }}
    >
      {SCORECARD_ACTION.withdraw}
    </Button>
  );
}

export function AdminDisputeForm({ id }: { id: string }) {
  const router = useRouter();
  const [body, setBody] = React.useState('');
  const [busy, setBusy] = React.useState<string | null>(null);
  const [err, setErr] = React.useState<string | null>(null);
  const go = async (kind: 'accepted' | 'rejected' | 'note') => {
    setBusy(kind);
    const r = await adminDisputeAction({ rootId: id, kind, body });
    setBusy(null);
    if (!r.ok) return setErr(r.error ?? '처리하지 못했습니다');
    setBody('');
    setErr(null);
    router.refresh();
  };
  return (
    <div className="grid gap-2" aria-label="이의 처리" role="group">
      <label className="sr-only" htmlFor={`adp-${id}`}>처리 사유</label>
      <Input id={`adp-${id}`} value={body} onChange={(e) => setBody(e.target.value)} placeholder="처리 사유(업체에게 보입니다)" maxLength={1000} />
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="primary" disabled={!!busy || body.trim().length < 2} onClick={() => go('accepted')}>{busy === 'accepted' ? <Spin /> : null}{SCORECARD_ACTION.accept}</Button>
        <Button size="sm" variant="secondary" disabled={!!busy || body.trim().length < 2} onClick={() => go('rejected')}>{SCORECARD_ACTION.reject}</Button>
        <Button size="sm" variant="ghost" disabled={!!busy || body.trim().length < 2} onClick={() => go('note')}>덧붙이기</Button>
      </div>
      {err ? <p role="alert" className="text-xs font-semibold text-stamp">{err}</p> : null}
    </div>
  );
}

export function AdminScorecardButtons() {
  const router = useRouter();
  const [busy, setBusy] = React.useState<string | null>(null);
  const [msg, setMsg] = React.useState<string | null>(null);
  return (
    <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2">
      <Button
        variant="primary"
        disabled={!!busy}
        onClick={async () => {
          setBusy('r');
          const r = await adminRecomputeScorecards();
          setBusy(null);
          setMsg(r.ok ? `성적표 새 판 ${r.rows}줄${r.withSamples ? '' : ' — 표본 없음(옛 숫자는 더 보이지 않습니다)'}` : r.error ?? '셈하지 못했습니다');
          router.refresh();
        }}
      >
        {busy === 'r' ? <Spin /> : null}
        {SCORECARD_ACTION.recompute}
      </Button>
      <Button
        variant="secondary"
        disabled={!!busy}
        onClick={async () => {
          setBusy('s');
          const r = await adminRefreshSubmitted();
          setBusy(null);
          setMsg(r.ok ? `제출 번호 후보 ${r.candidates} · 조회 ${r.seen}` : r.error ?? '돌리지 못했습니다');
          router.refresh();
        }}
      >
        {busy === 's' ? <Spin /> : null}
        {SCORECARD_ACTION.refreshSubmitted}
      </Button>
      {msg ? <span role="status" className="text-sm text-muted">{msg}</span> : null}
    </div>
  );
}

export function CodeLinker({ orgId, name, current }: { orgId: string; name: string; current: string | null }) {
  const router = useRouter();
  const [recs, setRecs] = React.useState<ForwarderRecord[] | null>(null);
  const [mock, setMock] = React.useState(false);
  const [code, setCode] = React.useState(current ?? '');
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState<string | null>(null);
  const link = async (c: string | null, n: string | null, source: 'unipass' | 'mock' | 'admin') => {
    setBusy(true);
    const r = await adminLinkCode({ orgId, code: c, name: n, source, note: c ? null : '운영자가 연결을 끊음' });
    setBusy(false);
    setMsg(r.ok ? (c ? `${c} 로 연결했습니다(새 판)` : '연결을 끊었습니다(새 판)') : r.error ?? '연결하지 못했습니다');
    router.refresh();
  };
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-end gap-2">
        <Button
          size="sm"
          variant="secondary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            const r = await adminFindCodes(orgId);
            setBusy(false);
            if (!r.ok) return setMsg(r.error ?? '찾지 못했습니다');
            setRecs(r.records ?? []);
            setMock(!!r.mock);
          }}
        >
          {SCORECARD_ACTION.findCode}
        </Button>
        <label className="sr-only" htmlFor={`code-${orgId}`}>{name} 부호 직접 넣기</label>
        <Input id={`code-${orgId}`} value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} className="h-9 w-32 font-mono" placeholder="부호" />
        <Button size="sm" variant="ghost" disabled={busy || !/^[A-Z0-9]{2,12}$/.test(code)} onClick={() => link(code, name, 'admin')}>직접 연결</Button>
        {current ? <Button size="sm" variant="ghost" disabled={busy} onClick={() => link(null, null, 'admin')}>끊기</Button> : null}
      </div>
      {recs ? (
        recs.length ? (
          <ul className="grid gap-1 text-sm" aria-label={`${name} 관세청 목록 결과`}>
            {recs.map((r) => (
              <li key={r.code} className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-xs">{r.code}</span>
                <span>{r.name}</span>
                <Button size="sm" variant="secondary" disabled={busy} onClick={() => link(r.code, r.name, r.source)}>{SCORECARD_ACTION.linkCode}</Button>
              </li>
            ))}
            {mock ? <li className="text-2xs text-muted">흉내 목록(UNIPASS_ENABLED 꺼짐) — 실제 부호가 아닙니다</li> : null}
          </ul>
        ) : (
          <p className="text-xs text-muted">목록에서 찾지 못했습니다 — 상호를 확인하거나 부호를 직접 넣어 주세요.</p>
        )
      ) : null}
      {msg ? <p role="status" className="text-xs text-muted">{msg}</p> : null}
    </div>
  );
}

export function BrokerProfileForm({ orgId, initial }: { orgId: string; initial: { registrationNo: string | null; offices: string[]; ports: string[]; specialties: string | null } }) {
  const router = useRouter();
  const [reg, setReg] = React.useState(initial.registrationNo ?? '');
  const [offices, setOffices] = React.useState(initial.offices.join(', '));
  const [ports, setPorts] = React.useState<string[]>(initial.ports);
  const [spec, setSpec] = React.useState(initial.specialties ?? '');
  const [msg, setMsg] = React.useState<string | null>(null);
  return (
    <form
      aria-label="관세사 기본 정보"
      className="grid gap-2 sm:grid-cols-2"
      onSubmit={async (e) => {
        e.preventDefault();
        const r = await adminBrokerProfile({ orgId, registrationNo: reg || null, offices, ports: ports as ('ICN' | 'PTK')[], specialties: spec || null });
        setMsg(r.ok ? '새 판으로 남겼습니다' : r.error ?? '고치지 못했습니다');
        router.refresh();
      }}
    >
      <Field label="등록번호" htmlFor={`br-reg-${orgId}`}><Input id={`br-reg-${orgId}`} value={reg} onChange={(e) => setReg(e.target.value)} maxLength={60} /></Field>
      <Field label="주 세관(쉼표로)" htmlFor={`br-off-${orgId}`}><Input id={`br-off-${orgId}`} value={offices} onChange={(e) => setOffices(e.target.value)} maxLength={300} /></Field>
      <fieldset className="flex flex-wrap items-center gap-3 text-sm">
        <legend className="mb-1 text-xs font-semibold text-muted">항구</legend>
        {[['ICN', '인천'], ['PTK', '평택']].map(([k, l]) => (
          <label key={k} className="inline-flex items-center gap-1.5">
            <input type="checkbox" checked={ports.includes(k)} onChange={(e) => setPorts(e.target.checked ? [...ports, k] : ports.filter((x) => x !== k))} /> {l}
          </label>
        ))}
      </fieldset>
      <Field label="전문(선택)" htmlFor={`br-sp-${orgId}`}><Input id={`br-sp-${orgId}`} value={spec} onChange={(e) => setSpec(e.target.value)} maxLength={300} /></Field>
      <div className="flex items-center gap-2 sm:col-span-2">
        <Button type="submit" size="sm" variant="secondary">새 판으로 남기기</Button>
        {msg ? <span role="status" className="text-xs text-muted">{msg}</span> : null}
      </div>
    </form>
  );
}
