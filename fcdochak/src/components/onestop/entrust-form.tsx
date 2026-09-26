'use client';
/**
 * 맡기기 — 홈의 「가격 하나」 미리보기(quick)와 로그인 화주의 주문서(order)가 같은 부품.
 * 가격은 브라우저에서 순수 함수(onestopQuote)로 바로 셈하고, 9구간은 플랫폼 참고치(computeQuote)로 견준다.
 * 주문서를 보내면 서버가 지금 요금표·구간 시세로 다시 셈해 기록한다(보낸 금액은 믿지 않는다). 결제·발송 없음.
 */
import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { createOnestopOrder } from '@/app/actions/onestop';
import { NumberField } from '@/components/number-field';
import { Button, Field, Input, NativeSelect, Textarea, buttonVariants } from '@/components/ui/core';
import { compareWithNine, computeQuote, goodsValueKrw, onestopArrival, onestopQuote, SEGMENTS_TO_KR_PORT, type Currency, type OnestopInspection, type QuoteParams, type RateLine } from '@/lib/money';
import type { OnestopTariff } from '@/lib/onestop/settings';
import { ONESTOP_ACTION, ONESTOP_INSPECTION_LABEL } from '@/lib/terms';
import { PriceCard } from './parts';

export interface EntrustInitial {
  name?: string;
  url?: string;
  units?: number;
  cartons?: number;
  cbm?: number;
  lane?: string;
  fc?: string;
}

export interface EntrustProps {
  mode: 'quick' | 'order';
  tariff: OnestopTariff;
  reference: { lines: RateLine[]; params: QuoteParams; vatRateBp: number; insuranceBp: number };
  hubs: { code: string; name_ko: string }[];
  fcs: { code: string; name: string }[];
  categories?: { category: string; name_ko: string; rate_bp: number }[];
  initial?: EntrustInitial;
  on: boolean;
}

const MODE_KO = { LCL: 'LCL 혼적', FERRY: '카페리 혼적' } as const;
const laneKey = (l: { hub: string; mode: string }) => `${l.hub}-${l.mode}`;

export function EntrustForm({ mode, tariff, reference, hubs, fcs, categories = [], initial = {}, on }: EntrustProps) {
  const router = useRouter();
  const [pending, start] = React.useTransition();
  const lanes = tariff.lanes;
  const [lane, setLane] = React.useState(initial.lane && lanes.some((l) => laneKey(l) === initial.lane) ? initial.lane : laneKey(lanes[0]));
  const [name, setName] = React.useState(initial.name ?? '');
  const [url, setUrl] = React.useState(initial.url ?? '');
  const [units, setUnits] = React.useState<number | null>(initial.units ?? 300);
  const [cartons, setCartons] = React.useState<number | null>(initial.cartons ?? 10);
  const [cbm, setCbm] = React.useState<number | null>(initial.cbm ?? 0.8);
  const [kg, setKg] = React.useState<number | null>(null);
  const [fc, setFc] = React.useState(initial.fc && fcs.some((f) => f.code === initial.fc) ? initial.fc : (fcs.find((f) => f.code === 'FC-ICH')?.code ?? fcs[0]?.code ?? 'FC-ICH'));
  const [category, setCategory] = React.useState(categories.find((c) => c.category === 'general')?.category ?? categories[0]?.category ?? 'general');
  const [unitPrice, setUnitPrice] = React.useState<number | null>(null);
  const [currency, setCurrency] = React.useState<Currency>('RMB');
  const [purchase, setPurchase] = React.useState(false);
  const [barcode, setBarcode] = React.useState(true);
  const [inspection, setInspection] = React.useState<OnestopInspection>('basic');
  const [note, setNote] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);

  const L = lanes.find((l) => laneKey(l) === lane) ?? lanes[0];
  const kgUsed = kg ?? (cbm ? Math.max(1, Math.round(cbm * 167)) : 1);
  const view = React.useMemo(() => {
    if (!units || !cbm || !cartons || units < 1 || cbm <= 0) return null;
    const cargo = { units, cartons, kg: kgUsed, cbm, goodsValue: unitPrice ? Math.round(unitPrice * units * 100) / 100 : 0, goodsCurrency: currency };
    const goodsKrw = cargo.goodsValue > 0 ? goodsValueKrw(cargo, reference.params.fx) : 0;
    const q = onestopQuote(tariff, { hub: L.hub, mode: L.mode, fc, units, cbm, goodsKrw, purchase: mode === 'order' ? purchase : false, barcode, inspection });
    if (!q.ok) return null;
    const ref = computeQuote(reference.lines, cargo, reference.params);
    const nineTotal = ref.segments.reduce((a, x) => a + (x.amount ?? 0), 0);
    const toPort = ref.segments.filter((x) => SEGMENTS_TO_KR_PORT.includes(x.segment)).reduce((a, x) => a + (x.amount ?? 0), 0);
    const rate = categories.find((c) => c.category === category)?.rate_bp ?? 0;
    const arrival = goodsKrw > 0 ? onestopArrival({ units, goodsKrw, onestopTotal: q.total, freightToPortKrw: toPort, dutyRateBp: rate, vatRateBp: reference.vatRateBp, insuranceBp: reference.insuranceBp }) : null;
    return {
      total: q.total,
      perUnit: q.perUnit,
      billableCbm: q.billableCbm,
      lines: q.lines,
      minApplied: q.minApplied,
      minTopUp: q.minTopUp,
      lane: q.lane,
      example: tariff.example,
      checkedOn: tariff.checkedOn,
      nine: { ...compareWithNine(q, nineTotal), basis: 'reference' as const },
      arrival: arrival ? { perUnit: arrival.perUnit, perUnitWithVat: arrival.perUnitWithVat } : null,
    };
  }, [units, cbm, cartons, kgUsed, unitPrice, currency, reference, tariff, L, fc, purchase, barcode, inspection, mode, categories, category]);

  const hubName = (c: string) => hubs.find((h) => h.code === c)?.name_ko ?? c;
  const portName = (c: string) => (c === 'PTK' ? '평택' : '인천');

  const toOrderHref = () => {
    const p = new URLSearchParams();
    if (name.trim()) p.set('name', name.trim());
    if (url.trim()) p.set('url', url.trim());
    if (units) p.set('units', String(units));
    if (cartons) p.set('cartons', String(cartons));
    if (cbm) p.set('cbm', String(cbm));
    p.set('lane', lane);
    p.set('fc', fc);
    return `/onestop/order?${p.toString()}`;
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (mode === 'quick') return router.push(toOrderHref());
    if (!units || !cartons || !cbm) return setError('수량·박스·CBM 을 적어 주세요');
    start(async () => {
      const r = await createOnestopOrder({
        productName: name,
        category,
        sourceUrl: url,
        units,
        cartons,
        cbm,
        kg: kgUsed,
        unitPrice,
        currency,
        hub: L.hub,
        mode: L.mode,
        fc,
        purchase,
        barcode,
        inspection,
        note,
      });
      if (!r.ok) {
        setError(r.error ?? '접수하지 못했습니다');
        return void toast.error(r.error ?? '접수하지 못했습니다');
      }
      toast.success(on ? '맡기기를 접수했습니다' : '접수 기록을 남겼습니다 — 대행 계약 전이라 연락·결제는 없습니다');
      router.push(`/onestop/orders/${r.id}`);
    });
  };

  return (
    <form onSubmit={submit} className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start" data-testid={`entrust-${mode}`} noValidate>
      <div className="grid min-w-0 gap-4">
        <Field label="사입처 링크(선택)" htmlFor="os-url" hint="1688·도매시장 상품 주소 — 앱은 그 페이지를 열거나 긁어 오지 않습니다(운영이 확인)">
          <Input id="os-url" inputMode="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" />
        </Field>
        <Field label="상품명" htmlFor="os-name" required={mode === 'order'}>
          <Input id="os-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="예시) 실리콘 서랍 정리함" maxLength={120} />
        </Field>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Field label="수량" htmlFor="os-units" required>
            <NumberField id="os-units" value={units} onValueChange={setUnits} unit="개" min={1} />
          </Field>
          <Field label="박스" htmlFor="os-cartons" required>
            <NumberField id="os-cartons" value={cartons} onValueChange={setCartons} unit="박스" min={1} />
          </Field>
          <Field label="부피(전체)" htmlFor="os-cbm" required hint="모르면 대략 — 중국 창고에 들어올 때 실측합니다">
            <NumberField id="os-cbm" value={cbm} onValueChange={setCbm} unit="CBM" decimals={2} min={0.01} />
          </Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="출발 · 방식" htmlFor="os-lane">
            <NativeSelect id="os-lane" value={lane} onChange={(e) => setLane(e.target.value)}>
              {lanes.map((l) => (
                <option key={laneKey(l)} value={laneKey(l)}>
                  {hubName(l.hub)} · {MODE_KO[l.mode]} → {portName(l.port)} ({l.daysMin}~{l.daysMax}일)
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="도착 쿠팡 FC" htmlFor="os-fc">
            <NativeSelect id="os-fc" value={fc} onChange={(e) => setFc(e.target.value)}>
              {fcs.map((f) => (
                <option key={f.code} value={f.code}>
                  {f.name}
                  {tariff.remoteFc.codes.includes(f.code) ? ' (원거리 할증)' : ''}
                </option>
              ))}
            </NativeSelect>
          </Field>
        </div>

        {mode === 'order' ? (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="무게(전체)" htmlFor="os-kg" hint={kg == null && cbm ? `비우면 ${kgUsed} kg 로 셈합니다` : undefined}>
                <NumberField id="os-kg" value={kg} onValueChange={setKg} unit="kg" decimals={1} min={0.1} />
              </Field>
              <Field label="분류(관세율)" htmlFor="os-cat">
                <NativeSelect id="os-cat" value={category} onChange={(e) => setCategory(e.target.value)}>
                  {categories.map((c) => (
                    <option key={c.category} value={c.category}>
                      {c.name_ko}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            </div>
            <div className="grid grid-cols-[minmax(0,1fr)_110px] gap-3">
              <Field label={purchase ? '개당 매입가(필수)' : '개당 매입가(선택)'} htmlFor="os-price" hint="개당 도착원가·관부가세 추정에 씁니다">
                <NumberField id="os-price" value={unitPrice} onValueChange={setUnitPrice} decimals={2} min={0.01} />
              </Field>
              <Field label="통화" htmlFor="os-cur">
                <NativeSelect id="os-cur" value={currency} onChange={(e) => setCurrency(e.target.value as Currency)}>
                  <option value="RMB">RMB</option>
                  <option value="USD">USD</option>
                  <option value="KRW">원</option>
                </NativeSelect>
              </Field>
            </div>
            <fieldset className="grid gap-2 rounded-md border border-line p-3">
              <legend className="px-1 text-sm font-semibold">맡길 일</legend>
              <label className="flex min-h-10 items-start gap-2 text-sm">
                <input type="checkbox" className="mt-1 size-4 accent-[var(--ink)]" checked={purchase} onChange={(e) => setPurchase(e.target.checked)} />
                <span>
                  사입 대행 — 공장에 대금을 내고 입고까지 확인(물품가의 {(tariff.purchaseFeeBp / 100).toFixed(1)}%)
                  <span className="block text-2xs text-muted">미리보기에서는 대금을 받지 않습니다. 대금 보관 방식은 정해지지 않았습니다.</span>
                </span>
              </label>
              <label className="flex min-h-10 items-center gap-2 text-sm">
                <input type="checkbox" className="size-4 accent-[var(--ink)]" checked={barcode} onChange={(e) => setBarcode(e.target.checked)} />
                <span>쿠팡 바코드 부착(바코드는 WING 에서 만들어 주세요) · 개당 {tariff.barcodePerUnitKrw}원</span>
              </label>
              <Field label="검품" htmlFor="os-insp">
                <NativeSelect id="os-insp" value={inspection} onChange={(e) => setInspection(e.target.value as OnestopInspection)}>
                  {(['none', 'basic', 'full'] as const).map((k) => (
                    <option key={k} value={k}>
                      {ONESTOP_INSPECTION_LABEL[k]}
                      {k === 'none' ? '' : ` · 개당 ${tariff.inspectionPerUnitKrw[k]}원`}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            </fieldset>
            <Field label="남길 말(선택)" htmlFor="os-note" hint="연락처·주소·사람 이름 같은 개인정보는 적지 마세요 — 남긴 말은 고치거나 지울 수 없고 중국 창고도 봅니다.">
              <Textarea id="os-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={600} placeholder="옵션·색상별 수량, 포장 요청 등" />
            </Field>
            <p className="text-xs text-muted">수입자는 셀러 본인입니다 — KC 인증·표시사항·상표 확인은 셀러 책임입니다. 관세·부가세는 통관 때 실비로 냅니다.</p>
          </>
        ) : (
          <p className="text-xs text-muted">바코드 부착·기본 검품을 넣은 가격입니다. 사입 대행·정밀 검품은 주문서에서 고릅니다.</p>
        )}
      </div>

      <div className="grid min-w-0 gap-3 lg:sticky lg:top-24">
        {view ? <PriceCard v={view} compact={mode === 'quick'} /> : <p className="rounded-md border border-dashed border-line p-4 text-sm text-muted">수량·박스·CBM 을 넣으면 가격 하나가 나옵니다.</p>}
        {error ? (
          <p role="alert" className="text-sm text-stamp">
            {error}
          </p>
        ) : null}
        <Button type="submit" variant="primary" size="lg" disabled={pending || !view} className="w-full">
          {mode === 'quick' ? ONESTOP_ACTION.entrust : on ? ONESTOP_ACTION.submit : `${ONESTOP_ACTION.submit} · 접수 기록만`}
        </Button>
        {mode === 'quick' ? (
          <Link href="/onestop/price" className={buttonVariants({ variant: 'link', size: 'sm' })}>
            {ONESTOP_ACTION.price}
          </Link>
        ) : (
          <p className="text-2xs text-muted">보내면 서버가 지금 요금표·구간 시세로 다시 셈해 남깁니다. 결제·계약은 아직 없습니다.</p>
        )}
      </div>
    </form>
  );
}
