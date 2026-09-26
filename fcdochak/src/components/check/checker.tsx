'use client';
/**
 * 청구서 점검 — 받은 견적서·청구서를 엑셀 올리기·표 붙여넣기·직접 입력으로 받아 9구간으로 가르고 점검한다.
 * 비로그인은 결과만 보여 주고 저장하지 않는다. 로그인한 화주는 「이 결과 보관」으로 남긴다(서버에서 다시 계산해 넣음).
 * 입력 초안은 이 브라우저 sessionStorage 에만(로그인하러 다녀와도 이어서) — 서버에 남지 않는다.
 */
import * as React from 'react';
import Link from 'next/link';
import { ArrowRight, ClipboardPaste, FileSpreadsheet, ListPlus, Loader2, PencilLine, Plus, Trash2 } from 'lucide-react';
import { ExcelImport, type ImportColumn } from '@/components/excel-import';
import { NumberField } from '@/components/number-field';
import { Button, Field, Input, NativeSelect, Textarea } from '@/components/ui/core';
import { CheckResultView } from './result';
import { runCheck, saveCheck, loadSavedInput } from '@/app/actions/check';
import { trackCheck } from '@/app/actions/research';
import { visitorId } from '@/lib/research/visitor';
import { classifyItem, inferMode, lineFromRow, parseInvoiceText } from '@/lib/invoice-parse';
import { SEGMENTS, SEGMENT_LABEL_KO } from '@/lib/money/segments';
import type { Currency, LineSegment } from '@/lib/money';
import type { CheckInputT, CheckOutcome } from '@/lib/invoice-check-input';
import { STANDARD_CARGO as C, STANDARD_ROUTE as R } from '@/lib/standard-cargo';
import { ACTION, CHECK_ACTION } from '@/lib/terms';
import { cn } from '@/lib/cn';
import { won } from '@/lib/format';

interface EditLine {
  key: number;
  label: string;
  amount: number | null;
  currency: Currency;
  segment: LineSegment;
  /** 이름에서 자동으로 고른 구간이면 true — 이름을 고치면 다시 고른다 */
  auto: boolean;
}

interface CargoState {
  title: string;
  hub: string;
  port: 'ICN' | 'PTK';
  mode: CheckInputT['mode'];
  units: number | null;
  cartons: number | null;
  kg: number | null;
  cbm: number | null;
  goods: number | null;
  cur: 'RMB' | 'USD' | 'KRW';
}

const FIRST: CargoState = {
  title: '',
  hub: R.hub,
  port: R.port,
  mode: 'ANY',
  units: C.units,
  cartons: C.cartons,
  kg: C.kg,
  cbm: C.cbm,
  goods: C.goodsValue,
  cur: C.goodsCurrency,
};

const EXCEL_COLUMNS: ImportColumn[] = [
  { key: 'item', label: '항목', aliases: ['품목', '내역', '내용', '비용 항목', '청구 항목', 'item', 'description', 'charge', '费用名称', '项目', '费用项目'], type: 'string', required: true },
  { key: 'amount', label: '금액', aliases: ['청구 금액', '합계 금액', '금액(원)', 'amount', 'total', '金额', '费用', '小计'], type: 'number', required: true },
  { key: 'currency', label: '통화', aliases: ['화폐', 'currency', 'cur', '币种', '货币'], type: 'string' },
];

const SEG_OPTIONS: [string, string][] = [
  ...SEGMENTS.map((s, i) => [s, `${i + 1}. ${SEGMENT_LABEL_KO[s]}`] as [string, string]),
  ['tax', '관세·부가세(비교에서 뺌)'],
  ['', '구간 모름'],
];

const PASTE_EXAMPLE = `중국 내륙 집하\t350\tRMB
창고 입고·검수\t280\tRMB
수출 통관\t300\tRMB
LCL 해상운임\t262,000\t원
THC·CFS\t95,000\t원
관세사 통관수수료\t33,000\t원
관세\t360,000\t원`;

const DRAFT_KEY = 'fcd.check.draft';
const MODES: [CheckInputT['mode'], string][] = [
  ['ANY', '상관없음'],
  ['LCL', 'LCL'],
  ['FERRY', '카페리'],
  ['FCL', 'FCL'],
  ['AIR', '항공'],
];

let seq = 1;
const mk = (l: Omit<EditLine, 'key'>): EditLine => ({ ...l, key: seq++ });

export function InvoiceChecker({
  hubs,
  ports,
}: {
  hubs: { code: string; name_ko: string; province_ko: string }[];
  ports: { code: string; name_ko: string }[];
}) {
  const [cargo, setCargo] = React.useState<CargoState>(FIRST);
  const [lines, setLines] = React.useState<EditLine[]>([]);
  const [tab, setTab] = React.useState<'paste' | 'excel' | 'manual'>('paste');
  const [paste, setPaste] = React.useState('');
  const [pasteCur, setPasteCur] = React.useState<Currency>('KRW');
  const [pasteNote, setPasteNote] = React.useState<string | null>(null);
  const [outcome, setOutcome] = React.useState<(CheckOutcome & { canSave: boolean }) | null>(null);
  /** 결과를 낸 입력 — 지금 입력과 다르면 결과가 낡은 것(보관 막기) */
  const [checked, setChecked] = React.useState<{ key: string; mode: CheckInputT['mode'] } | null>(null);
  const [modeNote, setModeNote] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, start] = React.useTransition();
  const [saving, startSave] = React.useTransition();
  const [saved, setSaved] = React.useState<{ id: string } | null>(null);
  const [saveError, setSaveError] = React.useState<string | null>(null);
  const [from, setFrom] = React.useState<{ id: string; title: string } | null>(null);
  const resultRef = React.useRef<HTMLDivElement>(null);
  const restored = React.useRef(false);
  // 실험 ② 퍼널(v2 interview) — 기기 번호 해시만. 기록이 실패해도 점검 흐름은 그대로
  const funnel = React.useRef<{ vid: string | null; method: 'paste' | 'excel' | 'manual' | null; inputs: Set<string> }>({ vid: null, method: null, inputs: new Set() });
  const track = (kind: 'check_visit' | 'check_input' | 'check_run' | 'check_saved', method: 'paste' | 'excel' | 'manual' | null = funnel.current.method) => {
    try {
      funnel.current.vid ??= visitorId();
      void trackCheck(kind, method, funnel.current.vid).catch(() => {});
    } catch {}
  };
  const inputFrom = (method: 'paste' | 'excel' | 'manual') => {
    funnel.current.method = method;
    if (funnel.current.inputs.has(method)) return;
    funnel.current.inputs.add(method);
    track('check_input', method);
  };
  React.useEffect(() => {
    track('check_visit', null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setC = <K extends keyof CargoState>(k: K, v: CargoState[K]) => setCargo((s) => ({ ...s, [k]: v }));
  const shandong = ['QDG', 'WEH', 'YNT', 'RZH'].includes(cargo.hub);

  // 보관한 점검 다시 불러오기(?from=) 또는 이 브라우저에 남은 초안
  React.useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('from');
    if (id) {
      void loadSavedInput(id).then((r) => {
        if (!r.ok || !r.data) {
          setError(r.error ?? '보관한 점검을 불러오지 못했습니다.');
          return;
        }
        const i = r.data.input;
        setCargo({ title: i.title ?? '', hub: i.hub, port: i.port, mode: i.mode, units: i.units, cartons: i.cartons, kg: i.kg, cbm: i.cbm, goods: i.goods, cur: i.cur });
        setLines(i.lines.map((l) => mk({ ...l, auto: false })));
        setTab('manual');
        if (!r.data.newerId) setFrom({ id, title: r.data.title });
        else setError('이 점검에는 이미 새 판이 있습니다. 보관하면 새 점검으로 남습니다.');
        restored.current = true;
      });
      return;
    }
    try {
      const raw = window.sessionStorage.getItem(DRAFT_KEY);
      if (raw) {
        const d = JSON.parse(raw) as { cargo: CargoState; lines: Omit<EditLine, 'key'>[] };
        if (d?.cargo) setCargo({ ...FIRST, ...d.cargo });
        if (Array.isArray(d?.lines) && d.lines.length) {
          setLines(d.lines.map((l) => mk(l)));
          setTab('manual');
        }
      }
    } catch {}
    restored.current = true;
  }, []);

  React.useEffect(() => {
    if (!restored.current) return;
    try {
      window.sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ cargo, lines: lines.map(({ key: _k, ...l }) => l) }));
    } catch {}
  }, [cargo, lines]);

  const edit = (key: number, patch: Partial<EditLine>) =>
    setLines((ls) =>
      ls.map((l) => {
        if (l.key !== key) return l;
        const next = { ...l, ...patch };
        if (patch.label != null && l.auto && patch.segment === undefined) next.segment = classifyItem(patch.label);
        return next;
      }),
    );

  /** 읽은 줄 이름에 방식이 적혀 있고 지금 「상관없음」이면 그 방식으로 미리 고른다 */
  const pickModeFrom = (labels: string[]) => {
    const m = inferMode(labels);
    if (!m || cargo.mode !== 'ANY') return;
    if (m === 'FERRY' && !shandong) return;
    setC('mode', m);
    setModeNote(`청구서 항목에 「${MODES.find(([k]) => k === m)?.[1] ?? m}」이 있어 운송 방식을 그것으로 골랐습니다. 다르면 바꾸세요.`);
  };

  const readPaste = () => {
    const got = parseInvoiceText(paste, pasteCur);
    if (got.length === 0) {
      setPasteNote('금액이 있는 줄을 찾지 못했습니다. 한 줄에 「항목 이름 … 금액」이 오도록 붙여 넣어 주세요.');
      return;
    }
    setLines(got.map(({ raw: _raw, ...l }) => mk({ ...l, auto: true })));
    pickModeFrom(got.map((g) => g.label));
    setPasteNote(`${got.length}줄을 읽었습니다. 아래에서 구간이 맞는지 확인하세요.`);
    inputFrom('paste');
    setOutcome(null);
    setSaved(null);
  };

  const input = (): CheckInputT | string => {
    if (!cargo.units || !cargo.cartons || !cargo.kg || !cargo.cbm || cargo.goods == null) return '화물 조건(수량·박스·무게·부피·물품가)을 채워 주세요.';
    // 금액을 비워 둔 줄은 「청구서에 없음」으로 본다(9구간 칸을 만들고 일부만 채운 경우)
    const ls = lines.filter((l) => l.amount != null);
    if (ls.length === 0) return '금액이 있는 청구서 항목을 한 줄 이상 넣어 주세요.';
    if (ls.some((l) => !l.label.trim())) return '금액이 있는 줄에는 항목 이름도 적어 주세요.';
    return {
      title: cargo.title.trim() || undefined,
      hub: cargo.hub,
      port: cargo.port,
      mode: cargo.mode,
      units: cargo.units,
      cartons: cargo.cartons,
      kg: cargo.kg,
      cbm: cargo.cbm,
      goods: cargo.goods,
      cur: cargo.cur,
      lines: ls.map((l) => ({ label: l.label.trim(), amount: l.amount!, currency: l.currency, segment: l.segment })),
    };
  };

  const submit = () => {
    const i = input();
    if (typeof i === 'string') {
      setError(i);
      return;
    }
    setError(null);
    setSaved(null);
    setSaveError(null);
    start(async () => {
      const r = await runCheck(i);
      if (!r.ok || !r.data) {
        setError(r.error ?? '점검하지 못했습니다.');
        return;
      }
      setOutcome(r.data);
      setChecked({ key: JSON.stringify(i), mode: i.mode });
      track('check_run');
      requestAnimationFrame(() => resultRef.current?.focus());
    });
  };

  const save = () => {
    const i = input();
    if (typeof i === 'string') {
      setSaveError(i);
      return;
    }
    startSave(async () => {
      const r = await saveCheck(i, from?.id ?? null);
      if (!r.ok || !r.data) {
        setSaveError(r.error ?? '보관하지 못했습니다.');
        return;
      }
      setSaveError(null);
      setSaved(r.data);
      track('check_saved');
      setFrom(null);
      try {
        window.sessionStorage.removeItem(DRAFT_KEY);
      } catch {}
    });
  };

  const classifiedCount = lines.filter((l) => l.segment && l.segment !== 'tax').length;
  // 결과를 낸 뒤 줄·화물 조건을 고쳤으면 결과가 낡았다 — 다시 점검해야 보관할 수 있다
  const nowInput = outcome ? input() : null;
  const stale = !!outcome && (!checked || typeof nowInput === 'string' || JSON.stringify(nowInput) !== checked.key);

  return (
    <div className="grid gap-6">
      {from ? (
        <p role="status" className="rounded-sm border border-line bg-surface-2 p-3 text-sm">
          보관한 점검 「{from.title}」을 불러왔습니다. 고쳐서 보관하면 이전 판은 그대로 두고 새 판으로 쌓입니다.
        </p>
      ) : null}

      <section aria-labelledby="step1" className="rounded-md border border-line bg-surface">
        <h2 id="step1" className="border-b border-line-2 px-4 py-3 text-base font-bold">
          <span className="mr-2 text-muted tnum">1</span>받은 견적서·청구서 넣기
        </h2>
        <div
          role="tablist"
          aria-label="넣는 방법"
          className="flex flex-wrap gap-1 border-b border-line-2 px-3 pt-2"
          onKeyDown={(e) => {
            // 탭 묶음 — 왼쪽·오른쪽 화살표(와 Home·End)로 옮기고 바로 고른다. Tab 은 고른 탭 하나에만 멈춘다
            const order = ['paste', 'excel', 'manual'] as const;
            const at = order.indexOf(tab);
            const next =
              e.key === 'ArrowRight' ? order[(at + 1) % order.length]
              : e.key === 'ArrowLeft' ? order[(at + order.length - 1) % order.length]
              : e.key === 'Home' ? order[0]
              : e.key === 'End' ? order[order.length - 1]
              : null;
            if (!next) return;
            e.preventDefault();
            setTab(next);
            document.getElementById(`tab-${next}`)?.focus();
          }}
        >
          {(
            [
              ['paste', '표 붙여넣기', ClipboardPaste],
              ['excel', '엑셀 올리기', FileSpreadsheet],
              ['manual', '직접 입력', PencilLine],
            ] as const
          ).map(([k, l, I]) => (
            <button
              key={k}
              type="button"
              role="tab"
              id={`tab-${k}`}
              aria-selected={tab === k}
              aria-controls={`panel-${k}`}
              tabIndex={tab === k ? 0 : -1}
              onClick={() => setTab(k)}
              className={cn(
                '-mb-px inline-flex h-10 items-center gap-1.5 rounded-t-sm border-b-2 px-3 text-sm font-semibold',
                tab === k ? 'border-label text-text' : 'border-transparent text-muted hover:text-text',
              )}
            >
              <I className="size-4" aria-hidden /> {l}
            </button>
          ))}
        </div>

        {tab === 'paste' ? (
          <div role="tabpanel" id="panel-paste" aria-labelledby="tab-paste" className="grid gap-3 p-4">
            <Field label="청구서 표를 그대로 붙여 넣으세요" htmlFor="ck-paste" hint="엑셀·메일·메신저에서 복사한 표. 한 줄에 항목과 금액이 있으면 됩니다. 합계 줄은 알아서 뺍니다.">
              <Textarea id="ck-paste" value={paste} onChange={(e) => setPaste(e.target.value)} rows={7} placeholder={PASTE_EXAMPLE} className="font-mono text-sm" />
            </Field>
            <div className="flex flex-wrap items-end gap-2">
              <Field label="통화가 안 적힌 금액은" htmlFor="ck-pcur" className="w-44">
                <NativeSelect id="ck-pcur" value={pasteCur} onChange={(e) => setPasteCur(e.target.value as Currency)}>
                  <option value="KRW">원(KRW)</option>
                  <option value="RMB">위안(RMB)</option>
                  <option value="USD">달러(USD)</option>
                </NativeSelect>
              </Field>
              <Button variant="ink" onClick={readPaste} disabled={!paste.trim()}>
                표 읽기
              </Button>
              <Button variant="ghost" onClick={() => setPaste(PASTE_EXAMPLE)}>
                예시 넣어 보기
              </Button>
            </div>
            {pasteNote ? <p role="status" className="text-sm text-muted">{pasteNote}</p> : null}
          </div>
        ) : null}

        {tab === 'excel' ? (
          <div role="tabpanel" id="panel-excel" aria-labelledby="tab-excel" className="p-4">
            <ExcelImport
              columns={EXCEL_COLUMNS}
              templateName="청구서-점검-양식"
              validate={() => null}
              onConfirm={async (rows) => {
                const got = rows.map((r) => lineFromRow(r, 'KRW')).filter((x): x is NonNullable<typeof x> => !!x);
                if (got.length === 0) return { ok: false, error: '금액이 있는 줄이 없습니다' };
                setLines(got.map((l) => mk({ ...l, auto: true })));
                pickModeFrom(got.map((g) => g.label));
                setOutcome(null);
                setSaved(null);
                inputFrom('excel');
                return { ok: true, created: got.length };
              }}
            />
            <p className="mt-2 text-xs text-muted">파일은 이 브라우저에서만 읽습니다. 올린 파일을 서버에 두지 않습니다.</p>
          </div>
        ) : null}

        {tab === 'manual' ? (
          <div role="tabpanel" id="panel-manual" aria-labelledby="tab-manual" className="flex flex-wrap gap-2 p-4">
            <Button
              variant="secondary"
              onClick={() => {
                setLines(SEGMENTS.map((s) => mk({ label: SEGMENT_LABEL_KO[s], amount: null, currency: 'KRW', segment: s, auto: false })));
                setOutcome(null);
                inputFrom('manual');
              }}
            >
              <ListPlus aria-hidden /> 9구간 칸 만들기
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setLines((ls) => [...ls, mk({ label: '', amount: null, currency: 'KRW', segment: null, auto: true })]);
                inputFrom('manual');
              }}
            >
              <Plus aria-hidden /> 한 줄 더하기
            </Button>
            <p className="w-full text-xs text-muted">항목 이름을 적으면 구간을 알아서 고릅니다. 틀리면 옆에서 바꾸세요.</p>
          </div>
        ) : null}

        {lines.length ? (
          <div className="border-t border-line-2">
            <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 text-xs text-muted">
              <span>
                {lines.length}줄 · 구간을 정한 줄 {classifiedCount}
              </span>
              <Button size="sm" variant="ghost" onClick={() => setLines((ls) => [...ls, mk({ label: '', amount: null, currency: 'KRW', segment: null, auto: true })])}>
                <Plus aria-hidden /> 한 줄 더하기
              </Button>
            </div>
            <ul aria-label="청구서 항목" data-testid="check-lines" className="divide-y divide-line-2">
              {lines.map((l, i) => (
                <li key={l.key} className="grid grid-cols-[minmax(0,1fr)_88px_40px] gap-2 px-4 py-2 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_96px_minmax(0,1.1fr)_40px] sm:items-center">
                  <Input aria-label={`${i + 1}번째 항목 이름`} value={l.label} onChange={(e) => edit(l.key, { label: e.target.value })} placeholder="항목 이름" className="col-span-2 sm:col-span-1" />
                  <Button size="icon" variant="ghost" aria-label={`${i + 1}번째 줄 지우기`} onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} className="sm:order-last">
                    <Trash2 aria-hidden />
                  </Button>
                  <NumberField ariaLabel={`${i + 1}번째 금액`} value={l.amount} onValueChange={(v) => edit(l.key, { amount: v })} decimals={2} className="col-span-1" />
                  <NativeSelect aria-label={`${i + 1}번째 통화`} value={l.currency} onChange={(e) => edit(l.key, { currency: e.target.value as Currency })} className="col-span-2 sm:col-span-1">
                    <option value="KRW">원</option>
                    <option value="RMB">RMB</option>
                    <option value="USD">USD</option>
                  </NativeSelect>
                  <NativeSelect
                    aria-label={`${i + 1}번째 구간`}
                    value={l.segment ?? ''}
                    onChange={(e) => edit(l.key, { segment: (e.target.value || null) as LineSegment, auto: false })}
                    className={cn('col-span-3 sm:col-span-1', !l.segment && 'border-caution')}
                  >
                    {SEG_OPTIONS.map(([v, t]) => (
                      <option key={v} value={v}>
                        {t}
                      </option>
                    ))}
                  </NativeSelect>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      <section aria-labelledby="step2" className="rounded-md border border-line bg-surface">
        <h2 id="step2" className="border-b border-line-2 px-4 py-3 text-base font-bold">
          <span className="mr-2 text-muted tnum">2</span>어느 구간, 어떤 화물인가요
        </h2>
        <div className="grid grid-cols-2 gap-3 p-4 md:grid-cols-4">
          <Field label="출발 거점" htmlFor="ck-hub">
            <NativeSelect
              id="ck-hub"
              value={cargo.hub}
              onChange={(e) => {
                const hub = e.target.value;
                const sd = ['QDG', 'WEH', 'YNT', 'RZH'].includes(hub);
                setCargo((s) => ({ ...s, hub, port: sd ? s.port : 'ICN', mode: !sd && s.mode === 'FERRY' ? 'ANY' : s.mode }));
              }}
            >
              {hubs.map((h) => (
                <option key={h.code} value={h.code}>
                  {h.name_ko} · {h.province_ko}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="도착항" htmlFor="ck-port">
            <NativeSelect id="ck-port" value={cargo.port} onChange={(e) => setC('port', e.target.value as 'ICN' | 'PTK')}>
              {ports.map((p) => (
                <option key={p.code} value={p.code}>
                  {p.name_ko}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="운송 방식" htmlFor="ck-mode" hint={modeNote ?? '고르면 같은 방식끼리 견줍니다. 「상관없음」은 항공·해상이 섞여 판정이 흐려집니다'}>
            <NativeSelect
              id="ck-mode"
              value={cargo.mode}
              onChange={(e) => {
                setC('mode', e.target.value as CheckInputT['mode']);
                setModeNote(null);
              }}
            >
              {MODES.filter(([m]) => m !== 'FERRY' || shandong).map(([m, l]) => (
                <option key={m} value={m}>
                  {l}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="이름(보관할 때)" htmlFor="ck-title">
            <Input id="ck-title" value={cargo.title} maxLength={80} onChange={(e) => setC('title', e.target.value)} placeholder="예: 9월 한바다 청구서" />
          </Field>
          <Field label="수량" htmlFor="ck-units">
            <NumberField id="ck-units" value={cargo.units} onValueChange={(v) => setC('units', v)} unit="개" min={1} />
          </Field>
          <Field label="박스" htmlFor="ck-cartons">
            <NumberField id="ck-cartons" value={cargo.cartons} onValueChange={(v) => setC('cartons', v)} unit="박스" min={1} />
          </Field>
          <Field label="무게" htmlFor="ck-kg">
            <NumberField id="ck-kg" value={cargo.kg} onValueChange={(v) => setC('kg', v)} unit="kg" decimals={1} min={0.1} />
          </Field>
          <Field label="부피" htmlFor="ck-cbm">
            <NumberField id="ck-cbm" value={cargo.cbm} onValueChange={(v) => setC('cbm', v)} unit="CBM" decimals={2} min={0.01} />
          </Field>
          <Field label="물품가" htmlFor="ck-goods" className="col-span-2">
            <div className="flex gap-2">
              <NumberField id="ck-goods" value={cargo.goods} onValueChange={(v) => setC('goods', v)} unit={cargo.cur} className="flex-1" />
              <NativeSelect aria-label="물품가 통화" value={cargo.cur} onChange={(e) => setC('cur', e.target.value as CargoState['cur'])} className="w-24">
                <option value="RMB">RMB</option>
                <option value="USD">USD</option>
                <option value="KRW">KRW</option>
              </NativeSelect>
            </div>
          </Field>
        </div>
        <p className="px-4 pb-4 text-xs text-muted">같은 화물로 이 구간 요금표들을 계산해 비교합니다. 청구서의 화물 크기를 넣을수록 정확합니다.</p>
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <Button variant="primary" size="lg" onClick={submit} disabled={pending} data-testid="check-run">
          {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
          {pending ? '점검하는 중…' : CHECK_ACTION.run}
        </Button>
        <p className="text-xs text-muted">로그인하지 않아도 결과를 보여 드립니다. 저장하지 않습니다.</p>
      </div>
      {error ? (
        <p role="alert" className="rounded-sm border border-stamp/40 bg-stamp-bg p-3 text-sm text-stamp">
          {error}
        </p>
      ) : null}

      {outcome ? (
        <div ref={resultRef} tabIndex={-1} aria-live="polite" className="grid gap-4 outline-none">
          {stale ? (
            <div role="status" className="flex flex-wrap items-center gap-3 rounded-md border border-caution/40 bg-caution-bg p-3 text-sm text-caution" data-testid="check-stale">
              <span className="min-w-0 flex-1">조건이 바뀌었습니다 — 아래 결과는 고치기 전 입력의 결과입니다. 다시 점검해 주세요.</span>
              <Button size="sm" variant="ink" onClick={submit} disabled={pending}>
                다시 점검
              </Button>
            </div>
          ) : null}
          {checked?.mode === 'ANY' ? (
            <p role="note" className="rounded-md border border-caution/40 bg-caution-bg p-3 text-sm text-caution" data-testid="check-mixed-mode">
              방식이 섞인 비교입니다 — 운송 방식을 「상관없음」으로 두어 항공·해상 요금표를 한데 모아 견줬습니다. 비싼 쪽 경계가 올라가 과한 구간을 놓칠 수 있으니 받은 방식을 골라 다시 점검해 보세요.
            </p>
          ) : null}
          <CheckResultView outcome={outcome} />
          <div className="flex flex-wrap items-center gap-3 rounded-md border border-line bg-surface-2 p-4" data-testid="check-save">
            {saved ? (
              <>
                <p role="status" className="text-sm font-semibold text-ok">보관했습니다. 화주 화면의 「{CHECK_ACTION.list}」에서 다시 봅니다.</p>
                <Button asChild variant="secondary" size="sm">
                  <Link href={`/app/checks/${saved.id}`}>
                    보관한 결과 보기 <ArrowRight aria-hidden />
                  </Link>
                </Button>
              </>
            ) : outcome.canSave ? (
              <>
                <Button variant="ink" onClick={save} disabled={saving || stale}>
                  {saving ? '보관하는 중…' : from ? `${CHECK_ACTION.save}(새 판)` : CHECK_ACTION.save}
                </Button>
                <p className="text-xs text-muted">{stale ? '조건이 바뀌어 다시 점검한 뒤에 보관할 수 있습니다.' : '보관한 점검은 나만 봅니다. 고쳐서 다시 보관하면 새 판으로 쌓입니다.'}</p>
              </>
            ) : (
              <>
                <p className="text-sm">
                  이 결과는 저장하지 않았습니다. <b>로그인하면</b> 결과를 보관하고 화주 화면에서 목록으로 봅니다.
                </p>
                <Button asChild variant="ink" size="sm">
                  <Link href="/login?next=/check">{ACTION.login}</Link>
                </Button>
                <Button asChild variant="secondary" size="sm">
                  <Link href="/join/shipper">{ACTION.joinShipper}</Link>
                </Button>
              </>
            )}
            {saveError ? <p role="alert" className="w-full text-sm text-stamp">{saveError}</p> : null}
          </div>
          <p className="text-sm text-muted">
            이 조건으로 업체를 바로 비교하려면{' '}
            <Link className="font-semibold text-text underline underline-offset-4" href={`/?hub=${cargo.hub}&port=${cargo.port}&mode=${cargo.mode}`}>
              공개 계산기
            </Link>
            에서 볼 수 있습니다. 합계 {won(outcome.result.invoiceTotal)}.
          </p>
        </div>
      ) : null}
    </div>
  );
}

