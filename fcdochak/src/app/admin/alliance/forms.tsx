'use client';
/**
 * 제휴 주선사 운영 화면의 손 — 스위치·후보 등록·상태·요건 확인·계약 조건 새 판·정산 명세 새 판.
 * 모두 서버 행동을 부르고 결과를 알림으로 보인다. 금액 미리보기는 서버와 같은 순수 함수(settleAlliance)로 셈한다.
 */
import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { addSetting } from '@/app/actions/admin';
import { addAllianceCandidate, addAllianceSettlement, addAllianceTerms, reviewRequirement, setAllianceStatus } from '@/app/actions/alliance';
import { Button, Chip, Field, Input, NativeSelect, Textarea } from '@/components/ui/core';
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/radix';
import { ALLIANCE_STATUS, ALLIANCE_STATUS_LABEL, ALLIANCE_SWITCH_KEY, INCIDENT_LABEL, TERMS_MODEL_LABEL, TERMS_MODELS, type AllianceStatus, type TermsModel } from '@/lib/alliance-settings';
import { INCIDENT_KINDS, settleAlliance, type Liability } from '@/lib/money/alliance';
import { parseSettlementLines } from '@/lib/alliance-lines';
import { num } from '@/lib/format';

function useAct() {
  const router = useRouter();
  const [pending, start] = React.useTransition();
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, done: string, after?: () => void) =>
    start(async () => {
      const r = await fn();
      if (!r.ok) return void toast.error(r.error ?? '저장하지 못했습니다');
      toast.success(done);
      after?.();
      router.refresh();
    });
  return { pending, run };
}

export function AllianceSwitch({ on, versions }: { on: boolean; versions: number }) {
  const { pending, run } = useAct();
  const [open, setOpen] = React.useState(false);
  const [note, setNote] = React.useState('');
  const verb = on ? '끄기' : '켜기';
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3" data-testid="alliance-switch">
      <div className="min-w-0">
        <p className="flex flex-wrap items-center gap-2 text-sm font-bold">
          제휴 주선사 스위치 <Chip tone={on ? 'label' : 'neutral'}>{on ? '켜짐' : '꺼짐'}</Chip>
        </p>
        <p className="font-mono text-2xs text-muted">{ALLIANCE_SWITCH_KEY} · 판 {versions}개</p>
        <p className="mt-0.5 text-xs text-muted">
          켜면 물류사가 신청·서류를 올리고, 요건과 서명한 계약 판을 갖춘 제휴사가 화주 확정가 카드에 계약 상대로 나옵니다. 계약서 서명·돈의 이동·외부 연락은 앱이 하지 않습니다.
        </p>
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button size="sm" variant={on ? 'secondary' : 'ink'} aria-label={`제휴 주선사 스위치 ${verb}`}>{verb}</Button>
        </DialogTrigger>
        <DialogContent title={`제휴 주선사 스위치 ${verb}`} description={on ? '끄면 화주 카드는 「제휴 주선사 확정 전」으로 돌아가고 물류사 신청이 잠깁니다. 기록은 지우지 않습니다.' : '켜기 전에 사람이 정할 일: 법률 검토 · 첫 제휴사 계약 서명 · 준비금 보관 방식.'}>
          <form
            className="grid gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              run(() => addSetting(ALLIANCE_SWITCH_KEY, JSON.stringify(!on), note), `제휴 주선사 스위치를 ${on ? '껐습니다' : '켰습니다'}(새 판)`, () => {
                setOpen(false);
                setNote('');
              });
            }}
          >
            <Field label="바꾸는 이유" htmlFor="al-switch-note">
              <Input id="al-switch-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="예: 내부 시범 화면 점검" />
            </Field>
            <div className="flex justify-end">
              <Button type="submit" variant="primary" disabled={pending}>{verb} — 새 판 저장</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function CandidateForm({ orgs }: { orgs: { id: string; name: string; is_demo: boolean }[] }) {
  const { pending, run } = useAct();
  const [orgId, setOrgId] = React.useState('');
  return (
    <form
      className="flex flex-wrap items-end gap-2 px-4 py-3"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => addAllianceCandidate({ orgId }), '제휴 후보로 올렸습니다', () => setOrgId(''));
      }}
    >
      <Field label="후보로 올릴 물류사" htmlFor="al-cand" className="min-w-0 flex-1 basis-56">
        <NativeSelect id="al-cand" value={orgId} onChange={(e) => setOrgId(e.target.value)}>
          <option value="">고르세요</option>
          {orgs.map((o) => (
            <option key={o.id} value={o.id}>{o.name}{o.is_demo ? ' (예시)' : ''}</option>
          ))}
        </NativeSelect>
      </Field>
      <Button type="submit" size="md" disabled={pending || !orgId}>후보로 올리기</Button>
    </form>
  );
}

export function StatusForm({ allianceId, status }: { allianceId: string; status: AllianceStatus }) {
  const { pending, run } = useAct();
  const [next, setNext] = React.useState<AllianceStatus>(status);
  const [note, setNote] = React.useState('');
  return (
    <form
      className="grid gap-2 sm:grid-cols-[minmax(0,10rem)_minmax(0,1fr)_auto] sm:items-end"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => setAllianceStatus({ allianceId, status: next, note }), `상태를 「${ALLIANCE_STATUS_LABEL[next].ko}」로 바꿨습니다`, () => setNote(''));
      }}
    >
      <Field label="상태" htmlFor="al-status">
        <NativeSelect id="al-status" value={next} onChange={(e) => setNext(e.target.value as AllianceStatus)}>
          {ALLIANCE_STATUS.map((s) => (
            <option key={s} value={s}>{ALLIANCE_STATUS_LABEL[s].ko}</option>
          ))}
        </NativeSelect>
      </Field>
      <Field label="바꾸는 이유" htmlFor="al-status-note">
        <Input id="al-status-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="예: 요건 넷 확인 · 계약 v2 서명" />
      </Field>
      <Button type="submit" disabled={pending || next === status || note.trim().length < 2}>상태 바꾸기</Button>
    </form>
  );
}

export function ReviewButtons({ requirementId, label }: { requirementId: string; label: string }) {
  const { pending, run } = useAct();
  const [open, setOpen] = React.useState(false);
  const [note, setNote] = React.useState('');
  return (
    <div className="flex flex-wrap gap-1.5">
      <Button size="sm" variant="ink" disabled={pending} aria-label={`${label} 확인함`} onClick={() => run(() => reviewRequirement({ requirementId, decision: 'verified' }), `${label} — 확인함(새 판)`)}>
        확인함
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button size="sm" variant="danger" disabled={pending} aria-label={`${label} 반려`}>반려</Button>
        </DialogTrigger>
        <DialogContent title={`${label} 반려`} description="반려 사유는 물류사 화면에 보입니다. 물류사가 새 판으로 다시 올립니다.">
          <form
            className="grid gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              run(() => reviewRequirement({ requirementId, decision: 'rejected', note }), `${label} — 반려(새 판)`, () => {
                setOpen(false);
                setNote('');
              });
            }}
          >
            <Field label="반려 사유" htmlFor={`rej-${requirementId}`}>
              <Input id={`rej-${requirementId}`} value={note} onChange={(e) => setNote(e.target.value)} placeholder="예: 보험 금액이 기준보다 적습니다" />
            </Field>
            <div className="flex justify-end">
              <Button type="submit" variant="primary" disabled={pending || note.trim().length < 2}>반려 — 새 판 저장</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

const pctToBp = (s: string) => Math.round(Number(s) * 100);
const bpToPct = (bp: number) => String(bp / 100);

export interface TermsSeed {
  supersedesId: string | null;
  model: TermsModel;
  commissionBp: number;
  reserveBp: number;
  liability: Liability;
  validFrom: string;
  validUntil: string;
}

export function TermsForm({ allianceId, seed }: { allianceId: string; seed: TermsSeed }) {
  const { pending, run } = useAct();
  const [model, setModel] = React.useState<TermsModel>(seed.model);
  const [commission, setCommission] = React.useState(bpToPct(seed.commissionBp));
  const [reserve, setReserve] = React.useState(bpToPct(seed.reserveBp));
  const [liab, setLiab] = React.useState(() => Object.fromEntries(INCIDENT_KINDS.map((k) => [k, { p: bpToPct(seed.liability[k].platformBp), c: bpToPct(seed.liability[k].capBp) }])) as Record<(typeof INCIDENT_KINDS)[number], { p: string; c: string }>);
  const [from, setFrom] = React.useState(seed.validFrom);
  const [until, setUntil] = React.useState(seed.validUntil);
  const [status, setStatus] = React.useState<'draft' | 'agreed' | 'ended'>('draft');
  const [signed, setSigned] = React.useState('');
  const [note, setNote] = React.useState('');
  const agency = model === 'sales_agency';
  return (
    <form
      className="grid gap-3"
      data-testid="alliance-terms-form"
      onSubmit={(e) => {
        e.preventDefault();
        const liability = Object.fromEntries(INCIDENT_KINDS.map((k) => [k, { platformBp: agency ? 0 : pctToBp(liab[k].p), capBp: pctToBp(liab[k].c) }])) as Liability;
        run(
          () =>
            addAllianceTerms({
              allianceId,
              supersedesId: seed.supersedesId,
              model,
              commissionBp: pctToBp(commission),
              reserveBp: agency ? 0 : pctToBp(reserve),
              liability,
              validFrom: from,
              validUntil: until,
              status,
              signedOn: status === 'agreed' ? signed || null : null,
              note,
            }),
          seed.supersedesId ? '계약 조건 새 판을 만들었습니다' : '계약 조건 첫 판을 만들었습니다',
          () => setNote(''),
        );
      }}
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="갈래" htmlFor="t-model">
          <NativeSelect id="t-model" value={model} onChange={(e) => setModel(e.target.value as TermsModel)}>
            {TERMS_MODELS.map((m) => (
              <option key={m} value={m}>{TERMS_MODEL_LABEL[m]}</option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="수수료율(%)" htmlFor="t-comm" hint="기준 = 확정가 − 관세사 보수">
          <Input id="t-comm" inputMode="decimal" value={commission} onChange={(e) => setCommission(e.target.value)} />
        </Field>
        <Field label="준비금 적립률(프리미엄의 %)" htmlFor="t-res" hint={agency ? '영업 대리는 0' : undefined}>
          <Input id="t-res" inputMode="decimal" value={agency ? '0' : reserve} disabled={agency} onChange={(e) => setReserve(e.target.value)} />
        </Field>
      </div>
      <fieldset className="min-w-0 rounded-sm border border-line-2 p-3">
        <legend className="px-1 text-sm font-semibold">외부 요인 사건 — 플랫폼 부담(%)과 건당 상한(확정가의 %)</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {[0, 1].map((n) => (
            <div key={`h${n}`} className={`${n ? 'hidden sm:grid' : 'grid'} min-w-0 grid-cols-[5.5rem_minmax(0,1fr)_minmax(0,1fr)] gap-2 text-2xs font-semibold text-muted`} aria-hidden>
              <span>사건</span>
              <span>플랫폼 부담(%)</span>
              <span>건당 상한(%)</span>
            </div>
          ))}
          {INCIDENT_KINDS.map((k) => (
            <div key={k} className="grid min-w-0 grid-cols-[5.5rem_minmax(0,1fr)_minmax(0,1fr)] items-center gap-2">
              <span className="text-sm">{INCIDENT_LABEL[k]}</span>
              <Input aria-label={`${INCIDENT_LABEL[k]} 플랫폼 부담(%)`} inputMode="decimal" value={agency ? '0' : liab[k].p} disabled={agency} onChange={(e) => setLiab({ ...liab, [k]: { ...liab[k], p: e.target.value } })} />
              <Input aria-label={`${INCIDENT_LABEL[k]} 건당 상한(%)`} inputMode="decimal" value={liab[k].c} onChange={(e) => setLiab({ ...liab, [k]: { ...liab[k], c: e.target.value } })} />
            </div>
          ))}
        </div>
        <p className="mt-2 text-2xs text-muted">셀러 귀책은 셀러, 주선사 귀책은 주선사가 100% 부담합니다. 여기 비율은 누구 잘못도 아닌 외부 요인에만 씁니다.</p>
      </fieldset>
      <div className="grid gap-3 sm:grid-cols-4">
        <Field label="유효 시작" htmlFor="t-from">
          <Input id="t-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </Field>
        <Field label="유효 끝" htmlFor="t-until">
          <Input id="t-until" type="date" value={until} onChange={(e) => setUntil(e.target.value)} />
        </Field>
        <Field label="판 상태" htmlFor="t-status">
          <NativeSelect id="t-status" value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
            <option value="draft">초안</option>
            <option value="agreed">서명함</option>
            <option value="ended">끝남</option>
          </NativeSelect>
        </Field>
        <Field label="서명일" htmlFor="t-signed" hint="서명은 종이·전자계약으로 따로">
          <Input id="t-signed" type="date" value={signed} disabled={status !== 'agreed'} onChange={(e) => setSigned(e.target.value)} />
        </Field>
      </div>
      <Field label="메모" htmlFor="t-note">
        <Input id="t-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="예: 수수료 협의 결과" />
      </Field>
      <div className="flex flex-wrap items-center justify-end gap-2">
        <span className="text-2xs text-muted">고치지 않고 새 판으로 쌓입니다</span>
        <Button type="submit" variant="primary" disabled={pending}>{seed.supersedesId ? '계약 조건 새 판 만들기' : '계약 조건 첫 판 만들기'}</Button>
      </div>
    </form>
  );
}

const SAMPLE = '참조\t확정가\t프리미엄\t관세사 보수\t실제 원가\t초과 귀책\t회송\t회송 귀책\nSH-예시-1\t2200000\t100000\t150000\t2320000\t외부\nSH-예시-2\t1800000\t80000\t120000\t1700000\t외부\t80000\t주선사';

export function SettlementForm({ allianceId, terms, vatBp, opening, defaultPeriod }: { allianceId: string; terms: { commissionBp: number; reserveBp: number; liability: Liability } | null; vatBp: number; opening: number; defaultPeriod: [string, string] }) {
  const { pending, run } = useAct();
  const [start, setStart] = React.useState(defaultPeriod[0]);
  const [end, setEnd] = React.useState(defaultPeriod[1]);
  const [text, setText] = React.useState('');
  const [status, setStatus] = React.useState<'draft' | 'issued'>('draft');
  const parsed = React.useMemo(() => parseSettlementLines(text), [text]);
  const preview = React.useMemo(() => {
    if (!terms || !parsed.lines.length || parsed.errors.length) return null;
    try {
      return settleAlliance(parsed.lines, terms, vatBp, opening);
    } catch {
      return null;
    }
  }, [parsed, terms, vatBp, opening]);
  if (!terms) return <p className="text-sm text-muted">서명한 계약 판이 있어야 정산 명세를 만들 수 있습니다.</p>;
  return (
    <form
      className="grid gap-3"
      data-testid="alliance-settlement-form"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => addAllianceSettlement({ allianceId, periodStart: start, periodEnd: end, text, status }), '정산 명세를 만들었습니다', () => setText(''));
      }}
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="기간 시작" htmlFor="s-start">
          <Input id="s-start" type="date" value={start} onChange={(e) => setStart(e.target.value)} />
        </Field>
        <Field label="기간 끝" htmlFor="s-end">
          <Input id="s-end" type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
        </Field>
        <Field label="명세 상태" htmlFor="s-status">
          <NativeSelect id="s-status" value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
            <option value="draft">초안</option>
            <option value="issued">발행</option>
          </NativeSelect>
        </Field>
      </div>
      <Field
        label="선적 줄(엑셀에서 복사해 붙여 넣기)"
        htmlFor="s-text"
        hint="참조 · 확정가 · 프리미엄 · 관세사 보수 · 실제 원가 · 초과 귀책(외부/주선사/셀러) · 회송 · 회송 귀책 · 분실 · 분실 귀책 · 지연 · 지연 귀책"
        error={text && parsed.errors.length ? parsed.errors[0] : undefined}
      >
        <Textarea id="s-text" rows={5} value={text} onChange={(e) => setText(e.target.value)} placeholder={SAMPLE} className="font-mono text-xs" />
      </Field>
      <button type="button" className="justify-self-start text-xs font-semibold underline underline-offset-4" onClick={() => setText(SAMPLE)}>예시 줄 넣어 보기</button>
      {preview ? (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 rounded-sm bg-surface-2 p-3 text-xs tnum sm:grid-cols-4" data-testid="alliance-settlement-preview">
          {([
            ['선적', `${preview.count}건`],
            ['수수료', `${num(preview.commission)}원`],
            ['부가세', `${num(preview.commissionVat)}원`],
            ['준비금 적립', `${num(preview.reserveIn)}원`],
            ['플랫폼 부담', `${num(preview.platformShare)}원`],
            ['준비금 부족', `${num(preview.reserveShortfall)}원`],
            ['기말 준비금', `${num(preview.reserveClosing)}원`],
            ['주선사가 낼 돈', `${num(preview.netPayable)}원`],
          ] as const).map(([k, v]) => (
            <div key={k} className="min-w-0">
              <dt className="text-muted">{k}</dt>
              <dd className="font-semibold">{v}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      <div className="flex flex-wrap items-center justify-end gap-2">
        <span className="text-2xs text-muted">금액은 서버가 계약 판 요율로 다시 셉니다 · 기초 준비금 {num(opening)}원</span>
        <Button type="submit" variant="primary" disabled={pending || !parsed.lines.length || parsed.errors.length > 0}>정산 명세 만들기</Button>
      </div>
    </form>
  );
}

/** 명세 새 판 — 세금계산서 번호를 적거나 상태를 바꾼다(줄은 앞 판 그대로 다시 셈) */
export function StatementVersionForm({ allianceId, id, periodStart, periodEnd, taxInvoiceNo, status, label }: { allianceId: string; id: string; periodStart: string; periodEnd: string; taxInvoiceNo: string | null; status: 'draft' | 'issued' | 'void'; label: string }) {
  const { pending, run } = useAct();
  const [open, setOpen] = React.useState(false);
  const [tax, setTax] = React.useState(taxInvoiceNo ?? '');
  const [st, setSt] = React.useState<'draft' | 'issued' | 'void'>(status);
  const [note, setNote] = React.useState('');
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="secondary" aria-label={`${label} 새 판`}>새 판</Button>
      </DialogTrigger>
      <DialogContent title={`${label} — 새 판`} description="명세는 고치지 않습니다. 세금계산서 번호를 적거나 상태를 바꾸면 같은 줄로 다시 셈한 새 판이 쌓입니다.">
        <form
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => addAllianceSettlement({ allianceId, supersedesId: id, periodStart, periodEnd, status: st, taxInvoiceNo: tax, note }), '정산 명세 새 판을 만들었습니다', () => setOpen(false));
          }}
        >
          <Field label="세금계산서 발행 번호" htmlFor={`tax-${id}`} hint="플랫폼 → 주선사, 수수료분">
            <Input id={`tax-${id}`} value={tax} onChange={(e) => setTax(e.target.value)} />
          </Field>
          <Field label="명세 상태" htmlFor={`st-${id}`}>
            <NativeSelect id={`st-${id}`} value={st} onChange={(e) => setSt(e.target.value as typeof st)}>
              <option value="draft">초안</option>
              <option value="issued">발행</option>
              <option value="void">무효</option>
            </NativeSelect>
          </Field>
          <Field label="메모" htmlFor={`sn-${id}`}>
            <Input id={`sn-${id}`} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
          <div className="flex justify-end">
            <Button type="submit" variant="primary" disabled={pending}>새 판 저장</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
