'use client';
/** 운영 결정 보드의 입력 — 대상 넣기 · 링크 만들기/거두기 · 연락처 보기/지우기 · 물량 단가 넣기. 발송은 없다. */
import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Copy, Eye, Link2, Plus } from 'lucide-react';
import { addParticipant, addVendorQuote, clearContact, makeResearchLink, recordVerbalConsent, revealContact, revokeResearchLinks } from '@/app/actions/research';
import { Button, Field, Input, NativeSelect, Panel, PanelHead, Textarea } from '@/components/ui/core';
import { NumberField } from '@/components/number-field';
import { dateTimeKo } from '@/lib/format';
import { RESEARCH_ACTION, RESEARCH_ACTION_MORE } from '@/lib/terms';

export function ParticipantForm() {
  const router = useRouter();
  const [label, setLabel] = React.useState('');
  const [contact, setContact] = React.useState('');
  const [cs, setCs] = React.useState(true);
  const [rg, setRg] = React.useState(true);
  const [lcl, setLcl] = React.useState(true);
  const [ms, setMs] = React.useState<number | null>(null);
  const [channel, setChannel] = React.useState('');
  const [when, setWhen] = React.useState('');
  const [note, setNote] = React.useState('');
  const [err, setErr] = React.useState<string | null>(null);
  const [pending, start] = React.useTransition();
  const fits = cs && rg && lcl;
  return (
    <Panel id="add-participant">
      <PanelHead title={RESEARCH_ACTION.addParticipant} sub="이름 대신 부르는 이름(「셀러 07」)이면 됩니다 · 연락처는 선택이고 표에는 가려서 보입니다" />
      <form
        className="grid gap-4 p-4 md:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          setErr(null);
          start(async () => {
            const r = await addParticipant({ label, contact, chinaSourcing: cs, rocketGrowth: rg, lcl, monthlyShipments: ms, channel, scheduledAt: when || undefined, note });
            if (!r.ok || !r.data) return setErr(r.error ?? '넣지 못했습니다');
            toast.success(`${r.data.code} 을(를) 넣었습니다 — 표에서 링크를 만드세요`);
            setLabel('');
            setContact('');
            setMs(null);
            setChannel('');
            setWhen('');
            setNote('');
            router.refresh();
          });
        }}
      >
        <Field label="부르는 이름" htmlFor="rp-label" required error={err ?? undefined}>
          <Input id="rp-label" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={60} placeholder="예: 셀러 07" />
        </Field>
        <Field label="연락처(선택)" htmlFor="rp-contact" hint="일정 연락에만 씁니다. 메시지·메일은 보내지 않습니다">
          <Input id="rp-contact" value={contact} onChange={(e) => setContact(e.target.value)} maxLength={120} autoComplete="off" />
        </Field>
        <fieldset className="grid gap-2 md:col-span-2">
          <legend className="mb-1 text-sm font-semibold">모집 기준 — 셋 다 맞아야 합니다</legend>
          <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
            {([['중국 사입', cs, setCs], ['로켓그로스', rg, setRg], ['LCL 경험', lcl, setLcl]] as const).map(([t, v, f]) => (
              <label key={t} className="flex min-h-11 items-center gap-2">
                <input type="checkbox" checked={v} onChange={(e) => f(e.target.checked)} className="size-4 accent-[var(--ink)]" /> {t}
              </label>
            ))}
          </div>
          {!fits ? <p className="text-xs text-caution">기준에 맞지 않는 참여자는 층 밖에서 따로 읽습니다(판정에는 그대로 들어갑니다 — 넣기 전에 한 번 더 확인하세요).</p> : null}
        </fieldset>
        <Field label="월 선적 수" htmlFor="rp-ms" hint="층: 1건 이하 · 2~3건 · 4건 이상">
          <NumberField id="rp-ms" value={ms} onValueChange={(n) => setMs(n == null ? null : Math.round(n))} unit="건" min={0} max={1000} />
        </Field>
        <Field label="모집 경로" htmlFor="rp-ch">
          <Input id="rp-ch" value={channel} onChange={(e) => setChannel(e.target.value)} maxLength={60} placeholder="예: 셀러 커뮤니티 공지" />
        </Field>
        <Field label="인터뷰 일정(선택)" htmlFor="rp-when">
          <Input id="rp-when" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
        </Field>
        <Field label="메모" htmlFor="rp-note">
          <Textarea id="rp-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={400} className="min-h-10" />
        </Field>
        <div className="flex justify-end md:col-span-2">
          <Button type="submit" variant="primary" disabled={pending}><Plus aria-hidden /> {pending ? '넣는 중…' : RESEARCH_ACTION.addParticipant}</Button>
        </div>
      </form>
    </Panel>
  );
}

/** 링크 만들기 — 그 자리에 한 번만 보이고 복사한다 */
export function LinkCell({ id, code, hasOpen, disabled }: { id: string; code: string; hasOpen: boolean; disabled: boolean }) {
  const router = useRouter();
  const [made, setMade] = React.useState<{ link: string; exp: string } | null>(null);
  const [pending, start] = React.useTransition();
  const ref = React.useRef<HTMLInputElement>(null);
  const copy = async () => {
    if (!made) return;
    try {
      await navigator.clipboard.writeText(made.link);
      toast.success('링크를 복사했습니다', { description: '카톡·메일로 직접 보내 주세요. 저희는 보내지 않습니다.' });
    } catch {
      ref.current?.select();
      toast.message('링크를 골라 두었습니다 — 직접 복사해 주세요');
    }
  };
  if (made)
    return (
      <div className="grid min-w-0 gap-1" data-testid={`link-box-${code}`}>
        <div className="flex min-w-0 gap-1">
          <Input ref={ref} readOnly value={made.link} aria-label={`${code} 인터뷰 링크`} className="h-8 min-w-0 flex-1 font-mono text-2xs" onFocus={(e) => e.currentTarget.select()} data-testid="research-link" />
          <Button size="sm" onClick={copy} aria-label="링크 복사"><Copy aria-hidden /></Button>
        </div>
        <p className="text-2xs text-muted">지금 한 번만 보입니다 · {dateTimeKo(made.exp)}까지</p>
      </div>
    );
  return (
    <div className="flex flex-wrap gap-1">
      <Button
        size="sm"
        disabled={pending || disabled}
        onClick={() =>
          start(async () => {
            const r = await makeResearchLink(id);
            if (!r.ok || !r.data) return void toast.error(r.error ?? '만들지 못했습니다');
            setMade({ link: `${window.location.origin}/interview/${r.data.token}`, exp: r.data.expiresAt });
            router.refresh();
          })
        }
      >
        <Link2 aria-hidden /> {hasOpen ? RESEARCH_ACTION.newLink : RESEARCH_ACTION.makeLink}
      </Button>
      {hasOpen ? (
        <Button
          size="sm"
          variant="ghost"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const r = await revokeResearchLinks(id);
              if (!r.ok) return void toast.error(r.error ?? '거두지 못했습니다');
              toast.success('링크를 거뒀습니다');
              router.refresh();
            })
          }
        >
          {RESEARCH_ACTION.revokeLink}
        </Button>
      ) : null}
    </div>
  );
}

export function ContactCell({ id, masked }: { id: string; masked: string | null }) {
  const router = useRouter();
  const [shown, setShown] = React.useState<string | null>(null);
  const [pending, start] = React.useTransition();
  if (!masked) return <span className="text-muted">—</span>;
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <span className="font-mono text-xs">{shown ?? masked}</span>
      {!shown ? (
        <Button
          size="iconSm"
          variant="ghost"
          aria-label={RESEARCH_ACTION.revealContact}
          title={`${RESEARCH_ACTION.revealContact} — 감사 기록에 남습니다`}
          disabled={pending}
          onClick={() =>
            start(async () => {
              const r = await revealContact(id);
              if (!r.ok) return void toast.error(r.error ?? '볼 수 없습니다');
              setShown(r.data?.contact ?? '—');
            })
          }
        >
          <Eye aria-hidden />
        </Button>
      ) : null}
      <Button
        size="sm"
        variant="ghost"
        className="h-7 px-2 text-2xs"
        disabled={pending}
        onClick={() => {
          if (!window.confirm('이 참여자의 연락처를 지웁니다. 되돌릴 수 없습니다.')) return;
          start(async () => {
            const r = await clearContact(id);
            if (!r.ok) return void toast.error(r.error ?? '지우지 못했습니다');
            toast.success('연락처를 지웠습니다');
            setShown(null);
            router.refresh();
          });
        }}
      >
        {RESEARCH_ACTION.clearContact}
      </Button>
    </span>
  );
}

export function VendorQuoteForm({ hubs, ports }: { hubs: { code: string; name_ko: string }[]; ports: { code: string; name_ko: string }[] }) {
  const router = useRouter();
  const [f, setF] = React.useState({
    vendorLabel: '',
    vendorKind: 'consolidator' as 'consolidator' | 'forwarder',
    hub: '',
    port: '',
    mode: 'LCL',
    includes: 'sea_cfs' as 'sea_cfs' | 'to_port' | 'to_fc',
    volumeCbm: null as number | null,
    unitPriceKrw: null as number | null,
    source: 'call' as 'call' | 'email' | 'quote_doc' | 'other',
    quotedOn: new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10),
    note: '',
  });
  const [err, setErr] = React.useState<string | null>(null);
  const [pending, start] = React.useTransition();
  const up = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((s) => ({ ...s, [k]: v }));
  return (
    <form
      className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4"
      data-testid="vendor-quote-form"
      onSubmit={(e) => {
        e.preventDefault();
        setErr(null);
        start(async () => {
          const r = await addVendorQuote({
            ...f,
            hub: f.hub || null,
            port: (f.port || null) as 'ICN' | 'PTK' | null,
            mode: (f.mode || null) as 'LCL' | null,
            volumeCbm: f.volumeCbm as number,
            unitPriceKrw: f.unitPriceKrw == null ? (NaN as number) : Math.round(f.unitPriceKrw),
          });
          if (!r.ok) return setErr(r.error ?? '넣지 못했습니다');
          toast.success('단가를 넣었습니다');
          setF((s) => ({ ...s, volumeCbm: null, unitPriceKrw: null, note: '' }));
          router.refresh();
        });
      }}
    >
      <Field label="업체 부르는 이름" htmlFor="vq-label" required error={err ?? undefined} hint="공개되지 않습니다">
        <Input id="vq-label" value={f.vendorLabel} onChange={(e) => up('vendorLabel', e.target.value)} maxLength={60} placeholder="예: 콘솔사 A" />
      </Field>
      <Field label="종류" htmlFor="vq-kind">
        <NativeSelect id="vq-kind" value={f.vendorKind} onChange={(e) => up('vendorKind', e.target.value as typeof f.vendorKind)}>
          <option value="consolidator">콘솔사</option>
          <option value="forwarder">포워더</option>
        </NativeSelect>
      </Field>
      <Field label="포함 범위" htmlFor="vq-inc" hint="다른 범위끼리는 섞지 않습니다">
        <NativeSelect id="vq-inc" value={f.includes} onChange={(e) => up('includes', e.target.value as typeof f.includes)}>
          <option value="sea_cfs">해상+CFS</option>
          <option value="to_port">도착항까지</option>
          <option value="to_fc">FC 입고까지</option>
        </NativeSelect>
      </Field>
      <Field label="받은 곳" htmlFor="vq-src">
        <NativeSelect id="vq-src" value={f.source} onChange={(e) => up('source', e.target.value as typeof f.source)}>
          <option value="call">통화</option>
          <option value="email">메일</option>
          <option value="quote_doc">견적서</option>
          <option value="other">기타</option>
        </NativeSelect>
      </Field>
      <Field label="물량(월)" htmlFor="vq-vol" required>
        <NumberField id="vq-vol" value={f.volumeCbm} onValueChange={(n) => up('volumeCbm', n)} unit="CBM" decimals={1} min={0.1} />
      </Field>
      <Field label="CBM 당 단가" htmlFor="vq-price" required>
        <NumberField id="vq-price" value={f.unitPriceKrw} onValueChange={(n) => up('unitPriceKrw', n)} unit="원" min={0} />
      </Field>
      <Field label="출발 거점(선택)" htmlFor="vq-hub">
        <NativeSelect id="vq-hub" value={f.hub} onChange={(e) => up('hub', e.target.value)}>
          <option value="">구분 없음</option>
          {hubs.map((h) => <option key={h.code} value={h.code}>{h.name_ko}</option>)}
        </NativeSelect>
      </Field>
      <Field label="도착항(선택)" htmlFor="vq-port">
        <NativeSelect id="vq-port" value={f.port} onChange={(e) => up('port', e.target.value)}>
          <option value="">구분 없음</option>
          {ports.map((p) => <option key={p.code} value={p.code}>{p.name_ko}</option>)}
        </NativeSelect>
      </Field>
      <Field label="받은 날" htmlFor="vq-date">
        <Input id="vq-date" type="date" value={f.quotedOn} onChange={(e) => up('quotedOn', e.target.value)} />
      </Field>
      <Field label="메모" htmlFor="vq-note" className="sm:col-span-2 lg:col-span-2">
        <Input id="vq-note" value={f.note} onChange={(e) => up('note', e.target.value)} maxLength={400} placeholder="예: 유류할증 별도" />
      </Field>
      <div className="flex items-end justify-end">
        <Button type="submit" variant="primary" disabled={pending}><Plus aria-hidden /> {pending ? '넣는 중…' : RESEARCH_ACTION.addQuote}</Button>
      </div>
    </form>
  );
}

/** 인터뷰어 모드 — 셀러가 철회하거나 답을 지워 달라고 했을 때 한 줄 쌓는다(답은 그대로 — 지우기는 사람이 한다) */
export function WithdrawButton({ id }: { id: string }) {
  const router = useRouter();
  const [pending, start] = React.useTransition();
  return (
    <Button
      size="sm"
      disabled={pending}
      data-testid="record-withdrawal"
      onClick={() => {
        if (!window.confirm('철회·삭제 요청을 기록합니다. 이 참여자는 판정에서 빠지고 결정 보드의 「지울 대상」에 올라갑니다.')) return;
        start(async () => {
          const r = await recordVerbalConsent(id, 'withdrawn');
          if (!r.ok) return void toast.error(r.error ?? '기록하지 못했습니다');
          toast.success('철회를 기록했습니다', { description: '답을 지우는 일은 운영 담당이 절차대로 합니다' });
          router.refresh();
        });
      }}
    >
      {RESEARCH_ACTION_MORE.recordWithdrawal}
    </Button>
  );
}
