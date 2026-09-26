'use client';
/**
 * 셀러 인터뷰 과제형 흐름 — 셀러가 링크로(self) 또는 운영이 통화하며 대신(interviewer).
 * 동의 → 최근 선적 → 화면 셋(미리 계산) → 확정가 사다리·반대 질문 → 지금 방식 → 자유 의견 → 끝.
 * 단계마다 저장(새 판). 모바일 우선 — 한 번에 한 화면, 누름 영역 44px 이상.
 */
import * as React from 'react';
import { AlertTriangle, CheckCircle2, ClipboardCheck, Mic, ShieldCheck, TrendingUp } from 'lucide-react';
import { Button, Chip, Field, NativeSelect, Textarea } from '@/components/ui/core';
import { NumberField } from '@/components/number-field';
import { cn } from '@/lib/cn';
import { num, pct } from '@/lib/format';
import { RESEARCH_ACTION } from '@/lib/terms';
import {
  COUNTER,
  COUNTER_LABEL,
  METHOD,
  METHOD_LABEL,
  ONESTOP,
  ONESTOP_LABEL,
  PAIN,
  PAIN_LABEL,
  PAST_EXTRA,
  PAST_EXTRA_LABEL,
  SCREEN_LABEL,
  STEPS,
  STEP_LABEL,
  type AnswersT,
  type LaneT,
  type ScreenKey,
  type Step,
} from '@/lib/research/answers';
import type { InterviewPreview } from '@/lib/server/research';
import { adminPreview, consentInterview, previewInterview, recordVerbalConsent, saveAsInterviewer, saveInterview } from '@/app/actions/research';

export interface FlowProps {
  mode: 'self' | 'interviewer';
  token?: string;
  participantId?: string;
  participantLabel?: string;
  initial: { answers: AnswersT | null; step: string | null; headId: string | null; version: number; consentState: string };
  rules: { ladderBp: number[]; consentVersion: string; retentionDays: number };
  hubs: { code: string; name_ko: string }[];
  ports: { code: string; name_ko: string }[];
  modes: { code: string; name_ko: string }[];
}

const bpPct = (bp: number, d = 1) => pct(bp / 10000, d);
const FLOW: Step[] = ['lane', 'screens', 'ladder', 'habits', 'comment'];

/** 인터뷰어 모드에서 그대로 읽는 말(docs/research-plan.md 4-3) */
const SCRIPT: Partial<Record<Step, string>> = {
  consent: '「이 인터뷰는 서비스 개선을 위한 것이고, 답은 이름 없이 모아 봅니다. 기록해도 될까요?」',
  lane: '「가장 최근에 중국에서 쿠팡 FC 로 보낸 짐, 어디서 어디로 어떻게 보내셨어요? 부피는 대략요? 그때 물류비 총액은 대략 얼마였어요?」',
  screens: '화면을 함께 보며: 「이 화면이 그때 있었다면 쓸모가 1~5 중 몇이에요? 왜요?」 — 칭찬이 나오면 「마지막으로 이 문제 때문에 돈이나 시간을 쓴 게 언제예요?」',
  ladder: '「같은 조건에서 나중에 추가비용이 절대 없는 한 가격이, 평소 견적보다 1% 비싸다면 그걸로 받으시겠어요?」 — 예면 다음 값. 숫자를 먼저 권하지 않는다',
  habits: '「중국→FC 물류에서 제일 불편한 게 하나만 꼽으면요?」「지금은 한 포워더에 맡기세요, 배대지를 쓰세요, 매번 비교하세요?」「원스톱 배대지 써 보셨어요? 어땠어요?」',
  comment: '「더 하고 싶은 말씀 있으세요? 방금 하신 말을 이름 없이 인용해도 될까요?」',
};

function Radio<K extends string>({ name, value, options, labels, onChange, legend }: { name: string; value: K | undefined; options: readonly K[]; labels: Record<K, string>; onChange: (k: K) => void; legend: string }) {
  return (
    <fieldset className="grid gap-2">
      <legend className="mb-1 text-sm font-semibold">{legend}</legend>
      {options.map((k) => (
        <label key={k} className={cn('flex min-h-11 cursor-pointer items-center gap-3 rounded-sm border px-3 py-2 text-md', value === k ? 'border-ink bg-surface-2 font-semibold' : 'border-line bg-surface hover:bg-surface-2')}>
          <input type="radio" name={name} value={k} checked={value === k} onChange={() => onChange(k)} className="size-4 accent-[var(--ink)]" />
          {labels[k]}
        </label>
      ))}
    </fieldset>
  );
}

function YesNo({ value, onChange, label, testid }: { value: boolean | null | undefined; onChange: (v: boolean) => void; label: string; testid?: string }) {
  return (
    <div role="group" aria-label={label} className="grid grid-cols-2 gap-2" data-testid={testid}>
      {([true, false] as const).map((b) => (
        <button
          key={String(b)}
          type="button"
          aria-pressed={value === b}
          onClick={() => onChange(b)}
          className={cn('min-h-12 rounded-sm border text-md font-semibold', value === b ? 'border-ink bg-ink text-on-ink' : 'border-line bg-surface hover:bg-surface-2')}
        >
          {b ? '예' : '아니오'}
        </button>
      ))}
    </div>
  );
}

function ScoreRow({ value, onChange, label }: { value: number | null | undefined; onChange: (n: number) => void; label: string }) {
  return (
    <fieldset>
      <legend className="mb-1 text-sm font-semibold">{label}</legend>
      <div className="grid grid-cols-5 gap-1.5">
        {[1, 2, 3, 4, 5].map((n) => (
          <label key={n} className={cn('relative flex min-h-11 cursor-pointer items-center justify-center rounded-sm border text-md font-bold tnum', value === n ? 'border-ink bg-ink text-on-ink' : 'border-line bg-surface hover:bg-surface-2')}>
            <input type="radio" className="sr-only" name={label} value={n} checked={value === n} onChange={() => onChange(n)} />
            {n}
          </label>
        ))}
      </div>
      <p className="mt-1 flex justify-between text-2xs text-muted"><span>1 쓸모없음</span><span>5 꼭 필요</span></p>
    </fieldset>
  );
}

export function InterviewFlow(props: FlowProps) {
  const { mode, rules } = props;
  const self = mode === 'self';
  const [answers, setAnswers] = React.useState<AnswersT>(props.initial.answers ?? { v: 1 });
  const [consent, setConsent] = React.useState(props.initial.consentState);
  const firstStep = (): Step => {
    const s = props.initial.step as Step | null;
    if (props.initial.consentState !== 'agreed') return 'consent';
    if (!s || s === 'consent') return 'lane';
    return s;
  };
  const [step, setStep] = React.useState<Step>(firstStep);
  const [head, setHead] = React.useState<{ id: string | null; version: number }>({ id: props.initial.headId, version: props.initial.version });
  const [preview, setPreview] = React.useState<InterviewPreview | null>(null);
  const [previewErr, setPreviewErr] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, start] = React.useTransition();
  const topRef = React.useRef<HTMLHeadingElement>(null);

  const set = <K extends keyof AnswersT>(k: K, v: AnswersT[K]) => setAnswers((a) => ({ ...a, [k]: v }));
  const setLane = <K extends keyof LaneT>(k: K, v: LaneT[K] | null) =>
    setAnswers((a) => {
      const lane = { ...(a.lane ?? {}) } as LaneT;
      if (v == null || (v as unknown) === '') delete lane[k];
      else lane[k] = v as LaneT[K];
      return { ...a, lane };
    });
  const setScreen = (k: ScreenKey, patch: { score?: number; why?: string }) =>
    setAnswers((a) => ({ ...a, screens: { ...(a.screens ?? {}), [k]: { ...(a.screens?.[k] ?? {}), ...patch } } }));

  const loadPreview = React.useCallback(
    (lane: LaneT | undefined) => {
      setPreviewErr(null);
      void (self ? previewInterview(props.token!, lane ?? {}) : adminPreview(lane ?? {})).then((r) => {
        if (!r.ok || !r.data) return setPreviewErr(r.error ?? '미리 계산하지 못했습니다.');
        setPreview(r.data);
        const bp = r.data.firm.ok ? r.data.firm.premiumBp : null;
        setAnswers((a) => ({ ...a, shownPremiumBp: bp }));
      });
    },
    [self, props.token],
  );

  // 화면 셋 단계로 바로 이어 들어오면(진행 저장 뒤 다시 연 경우) 미리 계산을 다시 한다
  React.useEffect(() => {
    if (step === 'screens' && !preview) loadPreview(answers.lane);
  }, [step, preview, answers.lane, loadPreview]);

  const go = (s: Step) => {
    setStep(s);
    setError(null);
    requestAnimationFrame(() => {
      topRef.current?.focus();
      topRef.current?.scrollIntoView({ block: 'start' });
    });
  };

  const save = (nextStep: Step, complete = false) => {
    setError(null);
    start(async () => {
      // 셀러가 고르지 않은 답은 싣지 않는다 — 빈 문자열 정리
      const clean: AnswersT = JSON.parse(JSON.stringify(answers, (_k, v) => (v === '' ? undefined : v)));
      const input = { step: nextStep, answers: clean, complete };
      const r = self ? await saveInterview(props.token!, input) : await saveAsInterviewer(props.participantId!, input, head);
      if (!r.ok || !r.data) return setError(r.error ?? '저장하지 못했습니다. 다시 눌러 주세요.');
      setHead({ id: r.data.id, version: r.data.version });
      if (nextStep === 'screens') {
        setPreview(null);
        loadPreview(clean.lane);
      }
      go(complete ? 'done' : nextStep);
    });
  };

  const doConsent = (agree: boolean) => {
    setError(null);
    start(async () => {
      const r = self ? await consentInterview(props.token!, agree) : await recordVerbalConsent(props.participantId!, agree ? 'agreed' : 'declined');
      if (!r.ok) return setError(r.error ?? '기록하지 못했습니다.');
      setConsent(agree ? 'agreed' : 'declined');
      if (agree) go('lane');
    });
  };

  const idx = FLOW.indexOf(step);
  const prev = idx > 0 ? FLOW[idx - 1] : null;
  const next = idx >= 0 && idx < FLOW.length - 1 ? FLOW[idx + 1] : null;

  // 사다리 — 낮은 값부터, 처음 「아니오」에서 멈춘다
  const ladder = answers.ladder ?? {};
  const askedUpTo = (() => {
    for (let i = 0; i < rules.ladderBp.length; i++) {
      const v = ladder[String(rules.ladderBp[i])];
      if (v !== true) return i;
    }
    return rules.ladderBp.length - 1;
  })();
  const ladderDone = rules.ladderBp.some((b) => ladder[String(b)] === false) || rules.ladderBp.every((b) => ladder[String(b)] === true);
  const setRung = (i: number, v: boolean) => {
    const nextL: Record<string, boolean | null> = {};
    rules.ladderBp.forEach((b, j) => {
      if (j < i) nextL[String(b)] = true;
      else if (j === i) nextL[String(b)] = v;
    });
    set('ladder', nextL);
  };

  const canNext = (() => {
    if (step === 'ladder') return ladderDone && !!answers.counter;
    return true;
  })();

  if (consent === 'declined' || consent === 'withdrawn') {
    return (
      <div className="rounded-md border border-line bg-surface p-6 text-center" data-testid="interview-declined">
        <p className="text-lg font-bold">동의하지 않으셨습니다</p>
        <p className="mt-2 text-md text-muted">아무 답도 저장하지 않았습니다. 시간 내 주셔서 고맙습니다.</p>
      </div>
    );
  }

  return (
    <div className="grid gap-4" data-testid="interview-flow" data-step={step}>
      {/* 진행 */}
      {step !== 'consent' && step !== 'done' ? (
        <ol className="grid grid-cols-5 gap-1" aria-label="진행">
          {FLOW.map((s, i) => (
            <li key={s} className="min-w-0">
              <span className={cn('block h-1.5 rounded-xs', i <= idx ? 'bg-ink' : 'bg-line')} aria-hidden />
              <span className={cn('mt-1 block truncate text-2xs', i === idx ? 'font-bold text-text' : 'text-muted')} aria-current={i === idx ? 'step' : undefined}>
                {STEP_LABEL[s]}
              </span>
            </li>
          ))}
        </ol>
      ) : null}

      <section className="rounded-md border border-line bg-surface" aria-labelledby="iv-step-title">
        <div className="border-b border-line-2 px-4 py-3">
          <h2 id="iv-step-title" ref={topRef} tabIndex={-1} className="text-lg font-bold outline-none">
            {step === 'consent' ? '시작하기 전에' : step === 'done' ? '끝났습니다' : `${idx + 1}. ${STEP_LABEL[step]}`}
          </h2>
          {!self && SCRIPT[step] ? (
            <p className="mt-2 flex items-start gap-2 rounded-sm bg-surface-2 px-3 py-2 text-sm" data-testid="interviewer-script">
              <Mic className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden />
              <span><b>읽을 말</b> {SCRIPT[step]}</span>
            </p>
          ) : null}
        </div>

        <div className="grid gap-5 p-4">
          {step === 'consent' ? (
            <>
              <div className="grid gap-2 text-md leading-7" data-testid="consent-text">
                <p>FC도착 서비스 개선 인터뷰입니다. <b>5~10분</b> 걸립니다.</p>
                <ul className="list-disc space-y-1 pl-5 text-base">
                  <li><b>모으는 것</b>: 최근 선적 조건(선택), 화면에 대한 의견, 가격에 대한 생각, 자유 의견. 이름·연락처는 묻지 않습니다.</li>
                  <li><b>쓰는 곳</b>: 서비스를 어떻게 만들지 정하는 내부 분석. 이름 없이 묶어서 봅니다. 인용은 마지막에 허락하신 경우에만 이름 없이 씁니다.</li>
                  <li><b>보관</b>: 인터뷰 끝난 뒤 {rules.retentionDays}일 뒤에 지웁니다. 그 전에라도 요청하시면 지웁니다.</li>
                  <li><b>거부</b>: 동의하지 않으셔도 아무 불이익이 없습니다. 동의하지 않으면 여기서 끝나고 아무것도 저장하지 않습니다.</li>
                </ul>
                <p className="text-xs text-muted">동의 문구 판: {rules.consentVersion} · 실제 계약·결제가 아닙니다. 화면의 가격은 참고 계산입니다.</p>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <Button variant="primary" size="lg" disabled={pending} onClick={() => doConsent(true)}>
                  <CheckCircle2 aria-hidden /> {self ? RESEARCH_ACTION.agree : RESEARCH_ACTION.verbalAgree}
                </Button>
                <Button size="lg" disabled={pending} onClick={() => doConsent(false)}>
                  {self ? RESEARCH_ACTION.decline : RESEARCH_ACTION.verbalDecline}
                </Button>
              </div>
            </>
          ) : null}

          {step === 'lane' ? (
            <>
              <p className="text-md text-muted">가장 최근 선적을 떠올려 주세요. 모르면 비워 두셔도 됩니다 — 기준 화물(이우→인천 3 CBM)로 계산합니다.</p>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="출발 거점" htmlFor="iv-hub">
                  <NativeSelect id="iv-hub" value={answers.lane?.hub ?? ''} onChange={(e) => setLane('hub', e.target.value || null)} className="text-md">
                    <option value="">모름·선택 안 함</option>
                    {props.hubs.map((h) => <option key={h.code} value={h.code}>{h.name_ko}</option>)}
                  </NativeSelect>
                </Field>
                <Field label="도착항" htmlFor="iv-port">
                  <NativeSelect id="iv-port" value={answers.lane?.port ?? ''} onChange={(e) => setLane('port', (e.target.value || null) as LaneT['port'] | null)} className="text-md">
                    <option value="">모름·선택 안 함</option>
                    {props.ports.map((p) => <option key={p.code} value={p.code}>{p.name_ko}</option>)}
                  </NativeSelect>
                </Field>
                <Field label="운송 방식" htmlFor="iv-mode">
                  <NativeSelect id="iv-mode" value={answers.lane?.mode ?? ''} onChange={(e) => setLane('mode', (e.target.value || null) as LaneT['mode'] | null)} className="text-md">
                    <option value="">모름·선택 안 함</option>
                    {props.modes.filter((m) => m.code !== 'ANY').map((m) => <option key={m.code} value={m.code}>{m.name_ko}</option>)}
                  </NativeSelect>
                </Field>
                <Field label="부피" htmlFor="iv-cbm" hint="대략이면 됩니다">
                  <NumberField id="iv-cbm" value={answers.lane?.cbm ?? null} onValueChange={(n) => setLane('cbm', n)} unit="CBM" decimals={1} min={0.1} max={200} size="lg" />
                </Field>
                <Field label="판매가(부가세 포함)" htmlFor="iv-price" hint="판매손익 계산에 씁니다">
                  <NumberField id="iv-price" value={answers.lane?.price ?? null} onValueChange={(n) => setLane('price', n == null ? null : Math.round(n))} unit="원" min={100} size="lg" />
                </Field>
                <Field label="그때 물류비 총액" htmlFor="iv-last" hint="청구서 점검 계산에 씁니다">
                  <NumberField id="iv-last" value={answers.lane?.lastTotal ?? null} onValueChange={(n) => setLane('lastTotal', n == null ? null : Math.round(n))} unit="원" min={1000} size="lg" />
                </Field>
              </div>
            </>
          ) : null}

          {step === 'screens' ? (
            <>
              <p className="text-md text-muted">넣으신 조건으로 저희가 만들고 있는 화면 셋을 미리 계산했습니다. 각각 얼마나 쓸모 있을지 알려 주세요.</p>
              {previewErr ? (
                <p role="alert" className="flex items-start gap-2 rounded-sm border border-stamp/40 bg-stamp-bg/50 px-3 py-2 text-sm text-stamp"><AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />{previewErr}</p>
              ) : !preview ? (
                <div className="grid gap-3" aria-busy="true" aria-label="미리 계산 중">
                  <div className="skeleton h-28 rounded-md" /><div className="skeleton h-28 rounded-md" /><div className="skeleton h-28 rounded-md" />
                </div>
              ) : (
                <>
                  <p className="text-xs text-muted" data-testid="preview-lane">
                    {preview.lane.hubName}→{preview.lane.portName} · {preview.lane.modeName} · {preview.lane.cargoText}{preview.lane.usedDefault ? ' (기준 화물)' : ' (예시 화물 — 부피에 맞춰 늘림)'}
                  </p>
                  <PreviewCard icon={<ClipboardCheck aria-hidden />} title={SCREEN_LABEL.check} testid="preview-check">
                    {preview.check.given ? (
                      <>
                        <p className="text-md">
                          그때 물류비 <b className="tnum">{num(preview.check.total)}원</b> — 이 구간 같은 화물 중간값 <b className="tnum">{num(preview.check.median)}원</b>
                          {preview.check.overMedianBp != null ? <> 보다 <b className="tnum">{preview.check.overMedianBp >= 0 ? '+' : ''}{bpPct(preview.check.overMedianBp)}</b></> : null}
                        </p>
                        <p className="mt-1"><Chip tone={preview.check.tone === 'high' ? 'stamp' : preview.check.tone === 'low' ? 'caution' : preview.check.tone === 'typical' ? 'ok' : 'neutral'}>{preview.check.tone === 'high' ? '과함 — 어느 구간이 높은지 청구서를 올려 보세요' : preview.check.tone === 'low' ? '낮음 — 빠진 구간이 없는지 보세요' : preview.check.tone === 'typical' ? '시세 안' : '기준 없음'}</Chip></p>
                      </>
                    ) : (
                      <p className="text-md">청구서를 올리면 9구간으로 갈라 이 구간 중간값({num(preview.arrival.median)}원)과 견주고, 과한 구간·빠진 구간을 짚어 드립니다.</p>
                    )}
                  </PreviewCard>
                  <ScreenReact k="check" answers={answers} setScreen={setScreen} />
                  <PreviewCard icon={<ShieldCheck aria-hidden />} title={SCREEN_LABEL.firm} testid="preview-firm">
                    {preview.firm.ok ? (
                      <>
                        <p className="text-md">
                          기준 총액 <b className="tnum">{num(preview.firm.base)}원</b> → 확정가 <b className="tnum text-lg">{num(preview.firm.firmPrice)}원</b>
                        </p>
                        <p className="mt-1 text-sm text-muted tnum">흔들림을 미리 넣은 몫 {num(preview.firm.premium)}원(+{bpPct(preview.firm.premiumBp)}) · 이 값이면 나중에 추가비용이 없는 방식 · 비교한 요금표 {preview.firm.n}장{preview.firm.lowSample ? ' · 표본 적음' : ''}</p>
                      </>
                    ) : (
                      <p className="text-md">이 조건은 견줄 요금표가 없어 확정가를 내지 못했습니다.</p>
                    )}
                    <p className="mt-2 text-xs text-muted">참고 계산입니다 — 실제로 이 가격에 계약하는 것이 아닙니다.</p>
                  </PreviewCard>
                  <ScreenReact k="firm" answers={answers} setScreen={setScreen} />
                  <PreviewCard icon={<TrendingUp aria-hidden />} title={SCREEN_LABEL.pnl} testid="preview-pnl">
                    <p className="text-md">
                      개당 도착원가 <b className="tnum">{num(preview.pnl.arrivalPerUnit)}원</b>(물류 {num(preview.pnl.logisticsPerUnit)}원 포함)
                      {preview.pnl.profit != null ? <> · 판매가 {num(preview.pnl.price)}원이면 개당 <b className={cn('tnum', preview.pnl.profit < 0 && 'text-stamp')}>{preview.pnl.profit >= 0 ? '' : '−'}{num(Math.abs(preview.pnl.profit))}원</b> 남음({bpPct(preview.pnl.marginBp ?? 0)})</> : null}
                    </p>
                    <p className="mt-1 text-sm text-muted tnum">손익분기 판매가 {Number.isFinite(preview.pnl.breakEvenPrice) ? `${num(preview.pnl.breakEvenPrice)}원` : '—'}{preview.pnl.example ? ' · 쿠팡 수수료는 예시 기준값' : ''}</p>
                  </PreviewCard>
                  <ScreenReact k="pnl" answers={answers} setScreen={setScreen} />
                </>
              )}
            </>
          ) : null}

          {step === 'ladder' ? (
            <>
              <p className="text-md">
                같은 조건에서 <b>나중에 추가비용이 절대 없는 한 가지 가격(확정가)</b>이 평소 받던 견적보다 아래만큼 비싸다면, 그 가격으로 받으시겠어요?
              </p>
              <ol className="grid gap-3" data-testid="ladder">
                {rules.ladderBp.map((b, i) =>
                  i <= askedUpTo ? (
                    <li key={b} className="grid gap-2 rounded-sm border border-line-2 p-3">
                      <p className="text-md font-semibold">평소보다 <span className="tnum">+{bpPct(b, 0)}</span> 비싸면?</p>
                      <YesNo value={ladder[String(b)]} onChange={(v) => setRung(i, v)} label={`+${bpPct(b, 0)} 이면 받겠는가`} testid={`rung-${b}`} />
                    </li>
                  ) : null,
                )}
              </ol>
              {ladderDone ? (
                <div className="grid gap-5 border-t border-line-2 pt-4">
                  <Radio name="counter" legend="반대로 여쭤볼게요. 「확정가 없이 지금처럼 받고, 추가비용이 나오면 그때 따지는 편이 낫다」" value={answers.counter} options={COUNTER} labels={COUNTER_LABEL} onChange={(k) => set('counter', k)} />
                  <Radio name="pastExtra" legend="지난 6개월, 견적에 없던 돈을 더 낸 적이 몇 번인가요?" value={answers.pastExtra} options={PAST_EXTRA} labels={PAST_EXTRA_LABEL} onChange={(k) => set('pastExtra', k)} />
                  <fieldset className="grid gap-2">
                    <legend className="mb-1 text-sm font-semibold">이 방식을 시범으로 해 볼 때 대기 명단에 올려 드릴까요? (결제 없음)</legend>
                    <YesNo value={answers.pilotWaitlist} onChange={(v) => set('pilotWaitlist', v)} label="시범 대기 명단" testid="pilot" />
                  </fieldset>
                  {answers.counter && preview?.firm.ok ? (
                    <p className="rounded-sm bg-surface-2 px-3 py-2 text-sm text-muted" data-testid="shown-premium">
                      참고로, 앞 화면의 조건에서 계산된 확정가는 기준보다 <b className="tnum text-text">+{bpPct(preview.firm.premiumBp)}</b>였습니다.
                    </p>
                  ) : null}
                </div>
              ) : null}
            </>
          ) : null}

          {step === 'habits' ? (
            <>
              <Radio name="pain" legend="중국→쿠팡 FC 물류에서 가장 불편한 것 하나" value={answers.pain} options={PAIN} labels={PAIN_LABEL} onChange={(k) => set('pain', k)} />
              {answers.pain === 'other' ? (
                <Field label="무엇이 불편하셨나요" htmlFor="iv-pain-o">
                  <Textarea id="iv-pain-o" value={answers.painOther ?? ''} onChange={(e) => set('painOther', e.target.value)} maxLength={200} className="min-h-16 text-md" />
                </Field>
              ) : null}
              <Radio name="method" legend="지금은 어떻게 보내세요?" value={answers.method} options={METHOD} labels={METHOD_LABEL} onChange={(k) => set('method', k)} />
              <Radio name="oneStop" legend="원스톱 배대지(구매부터 FC 입고까지 한 곳)를 써 보셨나요?" value={answers.oneStop} options={ONESTOP} labels={ONESTOP_LABEL} onChange={(k) => set('oneStop', k)} />
              {answers.oneStop && answers.oneStop !== 'never' ? (
                <Field label="어땠나요 — 좋았던 점·불편했던 점" htmlFor="iv-os">
                  <Textarea id="iv-os" value={answers.oneStopWhy ?? ''} onChange={(e) => set('oneStopWhy', e.target.value)} maxLength={400} className="min-h-16 text-md" />
                </Field>
              ) : null}
              <Field label="한 달에 보통 몇 번 선적하세요?" htmlFor="iv-ms">
                <NumberField id="iv-ms" value={answers.monthlyShipments ?? null} onValueChange={(n) => set('monthlyShipments', n == null ? undefined : Math.round(n))} unit="번" min={0} max={1000} size="lg" />
              </Field>
            </>
          ) : null}

          {step === 'comment' ? (
            <>
              <Field label="더 하고 싶은 말씀" htmlFor="iv-comment" hint="무엇이든 좋습니다">
                <Textarea id="iv-comment" value={answers.comment ?? ''} onChange={(e) => set('comment', e.target.value)} maxLength={1500} className="min-h-28 text-md" />
              </Field>
              <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-sm border border-line px-3 py-2 text-md">
                <input type="checkbox" checked={answers.quoteOk === true} onChange={(e) => set('quoteOk', e.target.checked)} className="mt-1 size-4 accent-[var(--ink)]" />
                <span>제가 쓴 말을 <b>이름 없이</b> 인용해도 됩니다</span>
              </label>
            </>
          ) : null}

          {step === 'done' ? (
            <div className="grid gap-2 text-center" data-testid="interview-done">
              <CheckCircle2 className="mx-auto size-10 text-ok" aria-hidden />
              <p className="text-lg font-bold">고맙습니다</p>
              <p className="text-md text-muted">{self ? '답을 모두 저장했습니다. 이 링크는 이제 닫힙니다.' : '대신 적은 답을 저장했습니다.'}</p>
            </div>
          ) : null}

          {error ? (
            <p role="alert" className="flex items-start gap-2 text-sm text-stamp"><AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />{error}</p>
          ) : null}
        </div>

        {idx >= 0 ? (
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line-2 px-4 py-3">
            {prev ? (
              <Button size="lg" variant="ghost" disabled={pending} onClick={() => go(prev)}>{RESEARCH_ACTION.back}</Button>
            ) : <span />}
            {next ? (
              <Button size="lg" variant="primary" disabled={pending || !canNext} onClick={() => save(next)}>{pending ? '저장하는 중…' : RESEARCH_ACTION.next}</Button>
            ) : (
              <Button size="lg" variant="primary" disabled={pending} onClick={() => save('done', true)}>{pending ? '저장하는 중…' : RESEARCH_ACTION.finish}</Button>
            )}
          </div>
        ) : null}
      </section>
      {step !== 'done' && step !== 'consent' ? <p className="text-center text-xs text-muted">단계마다 저장됩니다 — 닫았다가 같은 링크로 이어서 하셔도 됩니다.</p> : null}
    </div>
  );
}

function PreviewCard({ icon, title, children, testid }: { icon: React.ReactNode; title: string; children: React.ReactNode; testid: string }) {
  return (
    <div className="rounded-md border border-line bg-surface-2 p-4 [&_svg]:size-4" data-testid={testid}>
      <p className="mb-2 flex items-center gap-2 text-sm font-bold text-muted">{icon} {title}</p>
      {children}
    </div>
  );
}

function ScreenReact({ k, answers, setScreen }: { k: ScreenKey; answers: AnswersT; setScreen: (k: ScreenKey, p: { score?: number; why?: string }) => void }) {
  return (
    <div className="grid gap-3 border-b border-line-2 pb-5 last:border-0" data-testid={`react-${k}`}>
      <ScoreRow label={`「${SCREEN_LABEL[k]}」 쓸모`} value={answers.screens?.[k]?.score} onChange={(n) => setScreen(k, { score: n })} />
      <Field label="왜 그렇게 보셨나요(선택)" htmlFor={`iv-why-${k}`}>
        <Textarea id={`iv-why-${k}`} value={answers.screens?.[k]?.why ?? ''} onChange={(e) => setScreen(k, { why: e.target.value })} maxLength={400} className="min-h-16 text-md" />
      </Field>
    </div>
  );
}

export { STEPS };
