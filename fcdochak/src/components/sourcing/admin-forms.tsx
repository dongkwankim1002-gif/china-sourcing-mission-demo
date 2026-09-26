'use client';
/** 운영 — 소싱 요청 상태·담당, 후보 넣기, 흉내 제공자 예시 채우기, 조건 새 판·내리기. 모두 쌓기만(고치지 않음), 발송 없음 */
import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { addCandidate, fillMockCandidates, reviseCandidateQuote, setSourcingStatus } from '@/app/actions/sourcing';
import { NumberField } from '@/components/number-field';
import { Button, Field, Input, NativeSelect, Textarea } from '@/components/ui/core';
import { SOURCING_ACTION, SOURCING_STATUS_LABEL } from '@/lib/terms';
import { SOURCING_STATUSES, type SourcingStatus } from '@/lib/sourcing/settings';

export function StatusForm({ requestId, status, assigneeId, people }: { requestId: string; status: SourcingStatus; assigneeId: string | null; people: { id: string; name: string }[] }) {
  const router = useRouter();
  const [pending, start] = React.useTransition();
  const [s, setS] = React.useState<SourcingStatus>(status);
  const [a, setA] = React.useState(assigneeId ?? '');
  const [note, setNote] = React.useState('');
  return (
    <form
      className="grid gap-3 p-4"
      aria-label="상태·담당"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await setSourcingStatus({ requestId, status: s, assigneeId: a || null, note });
          if (!r.ok) return void toast.error(r.error ?? '상태를 남기지 못했습니다');
          toast.success('상태를 남겼습니다(새 기록)');
          setNote('');
          router.refresh();
        });
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="상태" htmlFor="st-status">
          <NativeSelect id="st-status" value={s} onChange={(e) => setS(e.target.value as SourcingStatus)}>
            {SOURCING_STATUSES.map((x) => (
              <option key={x} value={x}>{SOURCING_STATUS_LABEL[x]}</option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="담당" htmlFor="st-assignee">
          <NativeSelect id="st-assignee" value={a} onChange={(e) => setA(e.target.value)}>
            <option value="">담당 없음</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </NativeSelect>
        </Field>
      </div>
      <Field label="메모" htmlFor="st-note">
        <Input id="st-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} />
      </Field>
      <div>
        <Button type="submit" size="sm" variant="primary" disabled={pending}>{SOURCING_ACTION.setStatus}</Button>
      </div>
    </form>
  );
}

export function FillMockButton({ requestId }: { requestId: string }) {
  const router = useRouter();
  const [pending, start] = React.useTransition();
  return (
    <Button
      size="sm"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const r = await fillMockCandidates({ requestId });
          if (!r.ok) return void toast.error(r.error ?? '예시 후보를 채우지 못했습니다');
          toast.success(`예시 후보 ${r.added ?? 0}곳을 넣었습니다(흉내 제공자 — 밖을 부르지 않음)`);
          router.refresh();
        })
      }
    >
      {SOURCING_ACTION.fillMock}
    </Button>
  );
}

interface QuoteState {
  currency: 'RMB' | 'USD';
  tiersText: string;
  moq: number | null;
  leadDaysMin: number | null;
  leadDaysMax: number | null;
  sampleFee: number | null;
  sampleDays: number | null;
  unitKg: number | null;
  unitCbm: number | null;
  unitsPerCarton: number | null;
}

function QuoteFields({ v, set, idp }: { v: QuoteState; set: (p: Partial<QuoteState>) => void; idp: string }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <Field label="단가 구간(수량:단가)" htmlFor={`${idp}-tiers`} hint="예: 300:12.5, 900:11.8, 3000:11" className="sm:col-span-2">
        <Input id={`${idp}-tiers`} value={v.tiersText} onChange={(e) => set({ tiersText: e.target.value })} maxLength={300} />
      </Field>
      <Field label="통화" htmlFor={`${idp}-cur`}>
        <NativeSelect id={`${idp}-cur`} value={v.currency} onChange={(e) => set({ currency: e.target.value as 'RMB' | 'USD' })}>
          <option value="RMB">RMB(元)</option>
          <option value="USD">USD</option>
        </NativeSelect>
      </Field>
      <Field label="최소 주문량" htmlFor={`${idp}-moq`}>
        <NumberField id={`${idp}-moq`} value={v.moq} onValueChange={(n) => set({ moq: n })} unit="개" />
      </Field>
      <Field label="생산 일수(부터)" htmlFor={`${idp}-l1`}>
        <NumberField id={`${idp}-l1`} value={v.leadDaysMin} onValueChange={(n) => set({ leadDaysMin: n })} unit="일" />
      </Field>
      <Field label="생산 일수(까지)" htmlFor={`${idp}-l2`}>
        <NumberField id={`${idp}-l2`} value={v.leadDaysMax} onValueChange={(n) => set({ leadDaysMax: n })} unit="일" />
      </Field>
      <Field label="샘플비" htmlFor={`${idp}-sf`}>
        <NumberField id={`${idp}-sf`} value={v.sampleFee} onValueChange={(n) => set({ sampleFee: n })} decimals={2} unit={v.currency === 'RMB' ? '元' : 'USD'} />
      </Field>
      <Field label="샘플 일수" htmlFor={`${idp}-sd`}>
        <NumberField id={`${idp}-sd`} value={v.sampleDays} onValueChange={(n) => set({ sampleDays: n })} unit="일" />
      </Field>
      <Field label="개당 무게" htmlFor={`${idp}-kg`}>
        <NumberField id={`${idp}-kg`} value={v.unitKg} onValueChange={(n) => set({ unitKg: n })} decimals={3} unit="kg" />
      </Field>
      <Field label="개당 부피" htmlFor={`${idp}-cbm`}>
        <NumberField id={`${idp}-cbm`} value={v.unitCbm} onValueChange={(n) => set({ unitCbm: n })} decimals={5} unit="CBM" />
      </Field>
      <Field label="박스 입수" htmlFor={`${idp}-upc`}>
        <NumberField id={`${idp}-upc`} value={v.unitsPerCarton} onValueChange={(n) => set({ unitsPerCarton: n })} unit="개" />
      </Field>
    </div>
  );
}

const emptyQuote: QuoteState = { currency: 'RMB', tiersText: '', moq: 300, leadDaysMin: 10, leadDaysMax: 20, sampleFee: null, sampleDays: 5, unitKg: 0.3, unitCbm: 0.002, unitsPerCarton: 40 };

function quoteOk(q: QuoteState) {
  return q.tiersText.trim() && q.moq && q.leadDaysMin != null && q.leadDaysMax != null && q.unitKg && q.unitCbm && q.unitsPerCarton;
}

export function CandidateForm({ requestId, hubs, categories, defaultCategory }: { requestId: string; hubs: { code: string; name_ko: string }[]; categories: { category: string; name_ko: string }[]; defaultCategory: string }) {
  const router = useRouter();
  const [pending, start] = React.useTransition();
  const [f, setF] = React.useState({
    label: '',
    supplierKind: 'factory' as 'factory' | 'trader' | 'unknown',
    hub: '',
    region: '',
    productTitle: '',
    category: defaultCategory,
    rating: null as number | null,
    yearsActive: null as number | null,
    certsClaimed: '',
    certsVerified: '',
    source: 'manual' as 'manual' | 'seller_link',
    sourceUrl: '',
    note: '',
  });
  const [q, setQ] = React.useState<QuoteState>(emptyQuote);
  const set = (p: Partial<typeof f>) => setF((x) => ({ ...x, ...p }));
  return (
    <form
      className="grid gap-3 p-4"
      aria-label="후보 넣기"
      onSubmit={(e) => {
        e.preventDefault();
        if (!quoteOk(q)) return void toast.error('조건 칸을 채워 주세요');
        start(async () => {
          const r = await addCandidate({
            requestId,
            label: f.label,
            supplierKind: f.supplierKind,
            hub: f.hub || null,
            region: f.region,
            productTitle: f.productTitle,
            category: f.category || null,
            rating: f.rating,
            yearsActive: f.yearsActive,
            certsClaimed: f.certsClaimed,
            certsVerified: f.certsVerified,
            source: f.source,
            sourceUrl: f.sourceUrl,
            note: f.note,
            quote: {
              currency: q.currency,
              tiersText: q.tiersText,
              moq: q.moq!,
              leadDaysMin: q.leadDaysMin!,
              leadDaysMax: q.leadDaysMax!,
              sampleFee: q.sampleFee,
              sampleDays: q.sampleDays,
              unitKg: q.unitKg!,
              unitCbm: q.unitCbm!,
              unitsPerCarton: q.unitsPerCarton!,
            },
          });
          if (!r.ok) return void toast.error(r.error ?? '후보를 넣지 못했습니다');
          toast.success('후보를 넣었습니다');
          setF((x) => ({ ...x, label: '', productTitle: '', sourceUrl: '', note: '' }));
          router.refresh();
        });
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="이름(화면에 보임)" htmlFor="cf-label" required hint="확인 전에는 「공장 A」처럼 적습니다">
          <Input id="cf-label" value={f.label} onChange={(e) => set({ label: e.target.value })} maxLength={60} required />
        </Field>
        <Field label="구분" htmlFor="cf-kind">
          <NativeSelect id="cf-kind" value={f.supplierKind} onChange={(e) => set({ supplierKind: e.target.value as typeof f.supplierKind })}>
            <option value="factory">공장</option>
            <option value="trader">무역상</option>
            <option value="unknown">확인 전</option>
          </NativeSelect>
        </Field>
        <Field label="어디서 찾았나" htmlFor="cf-src">
          <NativeSelect id="cf-src" value={f.source} onChange={(e) => set({ source: e.target.value as typeof f.source })}>
            <option value="manual">담당 조사</option>
            <option value="seller_link">셀러 링크 확인</option>
          </NativeSelect>
        </Field>
        <Field label="후보 상품명" htmlFor="cf-title" required className="sm:col-span-2">
          <Input id="cf-title" value={f.productTitle} onChange={(e) => set({ productTitle: e.target.value })} maxLength={160} required />
        </Field>
        <Field label="분류" htmlFor="cf-cat">
          <NativeSelect id="cf-cat" value={f.category} onChange={(e) => set({ category: e.target.value })}>
            {categories.map((c) => (
              <option key={c.category} value={c.category}>{c.name_ko}</option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="출발지" htmlFor="cf-hub">
          <NativeSelect id="cf-hub" value={f.hub} onChange={(e) => set({ hub: e.target.value })}>
            <option value="">모름</option>
            {hubs.map((h) => (
              <option key={h.code} value={h.code}>{h.name_ko}</option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="지역" htmlFor="cf-region">
          <Input id="cf-region" value={f.region} onChange={(e) => set({ region: e.target.value })} maxLength={40} placeholder="저장성 이우" />
        </Field>
        <Field label="평점(0~5)" htmlFor="cf-rating">
          <NumberField id="cf-rating" value={f.rating} onValueChange={(n) => set({ rating: n })} decimals={1} max={5} />
        </Field>
        <Field label="운영 연수" htmlFor="cf-years">
          <NumberField id="cf-years" value={f.yearsActive} onValueChange={(n) => set({ yearsActive: n })} unit="년" />
        </Field>
        <Field label="주장한 인증" htmlFor="cf-cc" hint="쉼표로: CCC, CE">
          <Input id="cf-cc" value={f.certsClaimed} onChange={(e) => set({ certsClaimed: e.target.value })} maxLength={120} />
        </Field>
        <Field label="서류로 확인한 인증" htmlFor="cf-cv">
          <Input id="cf-cv" value={f.certsVerified} onChange={(e) => set({ certsVerified: e.target.value })} maxLength={120} />
        </Field>
        <Field label="찾은 주소" htmlFor="cf-url" className="sm:col-span-2">
          <Input id="cf-url" type="url" value={f.sourceUrl} onChange={(e) => set({ sourceUrl: e.target.value })} maxLength={500} placeholder="https://" />
        </Field>
      </div>
      <QuoteFields v={q} set={(p) => setQ((x) => ({ ...x, ...p }))} idp="cf" />
      <Field label="메모" htmlFor="cf-note">
        <Textarea id="cf-note" value={f.note} onChange={(e) => set({ note: e.target.value })} maxLength={400} className="min-h-16" />
      </Field>
      <p className="text-2xs text-muted">브랜드 로고·상표가 보이는 상품은 넣지 않습니다. 공장/무역상·연수·평점은 확인한 값만 적습니다.</p>
      <div>
        <Button type="submit" size="sm" variant="primary" disabled={pending || !f.label.trim() || !f.productTitle.trim()}>{SOURCING_ACTION.addCandidate}</Button>
      </div>
    </form>
  );
}

export function ReviseForm({ requestId, candidateId, label, tiersText, current }: { requestId: string; candidateId: string; label: string; tiersText: string; current: Omit<QuoteState, 'tiersText'> }) {
  const router = useRouter();
  const [pending, start] = React.useTransition();
  const [open, setOpen] = React.useState(false);
  const [q, setQ] = React.useState<QuoteState>({ ...current, tiersText });
  const [note, setNote] = React.useState('');
  const send = (withdraw: boolean) =>
    start(async () => {
      if (!withdraw && !quoteOk(q)) return void toast.error('조건 칸을 채워 주세요');
      const r = await reviseCandidateQuote({
        requestId,
        candidateId,
        withdraw,
        quote: withdraw
          ? { note }
          : { currency: q.currency, tiersText: q.tiersText, moq: q.moq!, leadDaysMin: q.leadDaysMin!, leadDaysMax: q.leadDaysMax!, sampleFee: q.sampleFee, sampleDays: q.sampleDays, unitKg: q.unitKg!, unitCbm: q.unitCbm!, unitsPerCarton: q.unitsPerCarton!, note },
      });
      if (!r.ok) return void toast.error(r.error ?? '새 판을 남기지 못했습니다');
      toast.success(withdraw ? `${label} 을(를) 내렸습니다(새 판)` : '조건 새 판을 남겼습니다');
      setOpen(false);
      router.refresh();
    });
  if (!open)
    return (
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)} aria-label={`${label} ${SOURCING_ACTION.reviseQuote}`}>
        {SOURCING_ACTION.reviseQuote}
      </Button>
    );
  return (
    <div className="mt-3 grid w-full gap-3 rounded-sm border border-line-2 p-3">
      <QuoteFields v={q} set={(p) => setQ((x) => ({ ...x, ...p }))} idp={`rv-${candidateId.slice(0, 6)}`} />
      <Field label="바꾼 까닭" htmlFor={`rv-note-${candidateId.slice(0, 6)}`}>
        <Input id={`rv-note-${candidateId.slice(0, 6)}`} value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} />
      </Field>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="primary" disabled={pending} onClick={() => send(false)}>{SOURCING_ACTION.reviseQuote}</Button>
        <Button size="sm" variant="danger" disabled={pending} onClick={() => send(true)}>{SOURCING_ACTION.withdraw}</Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>닫기</Button>
      </div>
    </div>
  );
}
