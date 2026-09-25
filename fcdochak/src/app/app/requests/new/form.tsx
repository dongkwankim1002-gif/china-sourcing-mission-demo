'use client';
import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { CargoFields, type CargoValue, type SkuOption } from '@/components/cargo-form';
import { Button, Field, Input, NativeSelect, Textarea } from '@/components/ui/core';
import { createRequest } from '@/app/actions/shipper';

export function NewRequestForm({
  initial,
  hubs,
  fcs,
  traits,
  skus,
  duty,
  today,
}: {
  initial: CargoValue;
  hubs: { code: string; name_ko: string }[];
  fcs: { code: string; name: string }[];
  traits: { code: string; name_ko: string; verdict_ko: string }[];
  skus: SkuOption[];
  duty: { category: string; name_ko: string }[];
  today: string;
}) {
  const router = useRouter();
  const [cargo, setCargo] = React.useState<CargoValue>(initial);
  const [title, setTitle] = React.useState('');
  const [hs, setHs] = React.useState('general');
  const [readyOn, setReadyOn] = React.useState(() => new Date(Date.parse(today) + 5 * 86400_000).toISOString().slice(0, 10));
  const [hours, setHours] = React.useState(48);
  const [note, setNote] = React.useState('');
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [pending, start] = React.useTransition();
  const verdicts = traits.filter((t) => cargo.traits.includes(t.code));

  const submit = () => {
    const e: Record<string, string> = {};
    if (!cargo.units) e.units = '수량을 넣으세요';
    if (!cargo.cartons) e.cartons = '박스 수를 넣으세요';
    if (!cargo.kg) e.kg = '무게를 넣으세요';
    if (!cargo.cbm) e.cbm = '부피를 넣으세요';
    if (cargo.goods == null) e.goods = '물품가를 넣으세요';
    setErrors(e);
    if (Object.keys(e).length) return;
    start(async () => {
      const r = await createRequest({
        title: title || undefined,
        hub: cargo.hub,
        port: cargo.port as 'ICN',
        mode: cargo.mode as 'ANY',
        fc: cargo.fc,
        units: cargo.units!,
        cartons: cargo.cartons!,
        kg: cargo.kg!,
        cbm: cargo.cbm!,
        goods: cargo.goods ?? 0,
        cur: cargo.cur,
        traits: cargo.traits,
        hsCategory: hs,
        readyOn,
        deadlineHours: hours,
        note: note || undefined,
        skuId: cargo.skuId ?? null,
      });
      if (!r.ok) {
        setErrors(r.path ? { [r.path]: r.error ?? '' } : {});
        toast.error(r.error ?? '올리지 못했습니다');
        return;
      }
      toast.success('견적 요청을 올렸습니다', { description: '이 구간을 맡는 업체들에게 알렸습니다.' });
      router.push(`/app/requests/${r.data!.id}`);
    });
  };

  return (
    <form
      className="grid gap-6"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <section className="rounded-md border border-line bg-surface p-4">
        <h2 className="mb-3 text-md font-bold">화물</h2>
        <CargoFields value={cargo} onChange={setCargo} hubs={hubs} fcs={fcs} traits={traits} skus={skus} errors={errors} />
        {verdicts.length ? (
          <ul className="mt-4 grid gap-1 rounded-sm border border-caution/40 bg-caution-bg p-3 text-xs">
            {verdicts.map((t) => (
              <li key={t.code}><b>{t.name_ko}</b> — {t.verdict_ko}</li>
            ))}
          </ul>
        ) : null}
      </section>
      <section className="grid gap-3 rounded-md border border-line bg-surface p-4 md:grid-cols-2">
        <h2 className="text-md font-bold md:col-span-2">요청</h2>
        <Field label="요청 이름" htmlFor="rq-title" hint="비워 두면 수량·구간으로 지어집니다">
          <Input id="rq-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} />
        </Field>
        <Field label="품목 분류(관세율 참고용)" htmlFor="rq-hs">
          <NativeSelect id="rq-hs" value={hs} onChange={(e) => setHs(e.target.value)}>
            {duty.map((d) => (
              <option key={d.category} value={d.category}>{d.name_ko}</option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="출고 준비일" htmlFor="rq-ready" error={errors.readyOn}>
          <Input id="rq-ready" type="date" min={today} value={readyOn} onChange={(e) => setReadyOn(e.target.value)} />
        </Field>
        <Field label="응찰 마감" htmlFor="rq-hours" hint="마감 뒤 7일 안에 골라야 합니다">
          <NativeSelect id="rq-hours" value={hours} onChange={(e) => setHours(Number(e.target.value))}>
            {[24, 48, 72, 96, 120].map((h) => (
              <option key={h} value={h}>{h}시간 뒤({h / 24}일)</option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="업체에 전할 말" htmlFor="rq-note" className="md:col-span-2" hint="개인 연락처는 적지 마세요. 예약 뒤에 서로 보입니다.">
          <Textarea id="rq-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="예: 박스마다 FC 바코드 라벨 부착 필요, 파손 주의" />
        </Field>
      </section>
      <div className="flex flex-wrap items-center justify-end gap-3">
        <p className="text-xs text-muted">올리면 이 거점을 맡는 공식·인증 대기 업체에게만 알림이 갑니다. 화주 이름은 예약 뒤에 보입니다.</p>
        <Button type="submit" variant="primary" size="lg" disabled={pending}>
          {pending ? '올리는 중…' : '견적 요청 올리기'}
        </Button>
      </div>
    </form>
  );
}
