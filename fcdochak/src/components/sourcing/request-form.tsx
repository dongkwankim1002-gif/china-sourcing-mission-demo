'use client';
/**
 * 소싱 요청 폼 — 시작점(판매 분석 상품·저장한 SKU·직접 입력)을 고르면 조건을 미리 채운다.
 * 보내기는 서버 행동 createSourcingRequest(기록만, 발송 없음).
 */
import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { createSourcingRequest } from '@/app/actions/sourcing';
import { NumberField } from '@/components/number-field';
import { Button, Field, Input, NativeSelect, Textarea } from '@/components/ui/core';
import { SOURCING_ACTION } from '@/lib/terms';
import type { SourcingSeed } from '@/lib/sourcing/seeds';

export function SourcingRequestForm({
  seeds,
  categories,
  hubs,
  initialRef,
}: {
  seeds: SourcingSeed[];
  categories: { category: string; name_ko: string }[];
  hubs: { code: string; name_ko: string }[];
  initialRef: string | null;
}) {
  const router = useRouter();
  const [pending, start] = React.useTransition();
  const [from, setFrom] = React.useState<string>(initialRef && seeds.some((s) => `${s.origin}:${s.ref}` === initialRef) ? initialRef : 'manual');
  const [name, setName] = React.useState('');
  const [category, setCategory] = React.useState(categories.find((c) => c.category === 'general')?.category ?? categories[0]?.category ?? 'general');
  const [keywords, setKeywords] = React.useState('');
  const [imageUrl, setImageUrl] = React.useState('');
  const [price, setPrice] = React.useState<number | null>(null);
  const [monthly, setMonthly] = React.useState<number | null>(null);
  const [first, setFirst] = React.useState<number | null>(500);
  const [needsCert, setNeedsCert] = React.useState(false);
  const [certNote, setCertNote] = React.useState('');
  const [hub, setHub] = React.useState('');
  const [note, setNote] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);

  const apply = React.useCallback(
    (key: string) => {
      const s = seeds.find((x) => `${x.origin}:${x.ref}` === key);
      if (!s) return;
      setName(s.name);
      if (categories.some((c) => c.category === s.category)) setCategory(s.category);
      setPrice(s.targetPrice);
      setMonthly(s.monthlyUnits);
      setFirst(s.firstOrderUnits ?? 500);
      setNeedsCert(['toys', 'electronics', 'audio', 'kitchen'].includes(s.category));
    },
    [seeds, categories],
  );
  React.useEffect(() => {
    if (from !== 'manual') apply(from);
  }, [from, apply]);

  const seed = seeds.find((x) => `${x.origin}:${x.ref}` === from) ?? null;
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    start(async () => {
      const r = await createSourcingRequest({
        origin: seed ? seed.origin : 'manual',
        originRef: seed?.ref,
        productName: name,
        category,
        keywords,
        imageUrl,
        targetPrice: price,
        monthlyUnits: monthly,
        firstOrderUnits: first,
        needsCert,
        certNote,
        hub: hub || null,
        note,
      });
      if (!r.ok) {
        setError(r.error ?? '요청을 남기지 못했습니다');
        return;
      }
      toast.success('소싱 요청을 남겼습니다(미리보기 — 기록만, 연락은 가지 않습니다)');
      router.push(`/app/sourcing/${r.id}`);
    });
  };

  return (
    <form onSubmit={submit} className="grid gap-4 p-4" aria-label="소싱 요청" data-testid="sourcing-form">
      <Field label="시작점" htmlFor="sr-from" hint="잘 팔리는 내 상품에서 고르면 조건을 미리 채웁니다. 판매 분석 상품은 판매 분석과 합쳐지면 여기에 나옵니다.">
        <NativeSelect id="sr-from" value={from} onChange={(e) => setFrom(e.target.value)}>
          <option value="manual">직접 입력</option>
          {seeds.some((s) => s.origin === 'sales') ? (
            <optgroup label="판매 분석 상품">
              {seeds.filter((s) => s.origin === 'sales').map((s) => (
                <option key={s.ref} value={`sales:${s.ref}`}>{s.name}</option>
              ))}
            </optgroup>
          ) : null}
          {seeds.some((s) => s.origin === 'sku') ? (
            <optgroup label="저장한 SKU">
              {seeds.filter((s) => s.origin === 'sku').map((s) => (
                <option key={s.ref} value={`sku:${s.ref}`}>{s.name}</option>
              ))}
            </optgroup>
          ) : null}
        </NativeSelect>
      </Field>
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="상품명" htmlFor="sr-name" required>
          <Input id="sr-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} required placeholder="예: 실리콘 서랍 정리함" />
        </Field>
        <Field label="분류(관세 분류)" htmlFor="sr-cat" required>
          <NativeSelect id="sr-cat" value={category} onChange={(e) => setCategory(e.target.value)}>
            {categories.map((c) => (
              <option key={c.category} value={c.category}>{c.name_ko}</option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="찾을 낱말" htmlFor="sr-kw" hint="쉼표로 가릅니다. 중국어 낱말도 됩니다(예: 收纳盒).">
          <Input id="sr-kw" value={keywords} onChange={(e) => setKeywords(e.target.value)} maxLength={200} placeholder="서랍, 정리함, 收纳盒" />
        </Field>
        <Field label="사진 주소" htmlFor="sr-img" hint="사진 파일은 받지 않습니다 — 주소(https://…)만 남깁니다.">
          <Input id="sr-img" type="url" inputMode="url" value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} maxLength={500} placeholder="https://" />
        </Field>
        <Field label="목표 판매가(부가세 포함)" htmlFor="sr-price">
          <NumberField id="sr-price" value={price} onValueChange={setPrice} unit="원" />
        </Field>
        <Field label="월 판매량" htmlFor="sr-monthly">
          <NumberField id="sr-monthly" value={monthly} onValueChange={setMonthly} unit="개" />
        </Field>
        <Field label="첫 발주 수량" htmlFor="sr-first" hint="도착원가·마진 시뮬의 기본 수량">
          <NumberField id="sr-first" value={first} onValueChange={setFirst} unit="개" />
        </Field>
        <Field label="선호 출발지" htmlFor="sr-hub">
          <NativeSelect id="sr-hub" value={hub} onChange={(e) => setHub(e.target.value)}>
            <option value="">상관없음</option>
            {hubs.map((h) => (
              <option key={h.code} value={h.code}>{h.name_ko}</option>
            ))}
          </NativeSelect>
        </Field>
      </div>
      <fieldset className="grid gap-2 rounded-sm border border-line-2 p-3">
        <legend className="px-1 text-sm font-semibold">인증</legend>
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input type="checkbox" className="size-4" checked={needsCert} onChange={(e) => setNeedsCert(e.target.checked)} />
          KC 등 국내 인증이 필요한 상품입니다(전기·어린이·식품 접촉 등)
        </label>
        {needsCert ? (
          <Field label="필요한 인증" htmlFor="sr-cert" hint="중국 인증(CCC 등)은 KC 가 아닙니다. 인증 판단은 시험·인증기관에 확인하세요.">
            <Input id="sr-cert" value={certNote} onChange={(e) => setCertNote(e.target.value)} maxLength={120} placeholder="예: 어린이제품 안전확인" />
          </Field>
        ) : null}
      </fieldset>
      <Field label="메모" htmlFor="sr-note" hint="이미 본 1688·타오바오 링크가 있으면 붙여 주세요 — 담당이 직접 열어 확인합니다(앱이 긁어 오지 않습니다).">
        <Textarea id="sr-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={600} />
      </Field>
      <p className="text-xs text-muted">타사 상표·디자인을 그대로 베끼는 요청은 받지 않습니다. 유사도는 참고용이며 같은 상품·지식재산 판단이 아닙니다.</p>
      {error ? (
        <p role="alert" className="text-sm text-stamp">
          {error}
        </p>
      ) : null}
      <div>
        <Button type="submit" variant="primary" disabled={pending || name.trim().length < 2}>
          {SOURCING_ACTION.request}
        </Button>
      </div>
    </form>
  );
}
