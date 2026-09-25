'use client';
/** 화물 조건 입력 — 비교·견적 요청·판매손익이 같이 쓴다. SKU 를 고르면 채워진다. */
import * as React from 'react';
import { Field, NativeSelect } from '@/components/ui/core';
import { NumberField } from '@/components/number-field';
import { cn } from '@/lib/cn';
import { destinationGroups } from '@/components/destination-note';

export interface CargoValue {
  hub: string;
  port: string;
  mode: string; // 'ANY' | LCL | FERRY | FCL | AIR
  units: number | null;
  cartons: number | null;
  kg: number | null;
  cbm: number | null;
  goods: number | null;
  cur: 'RMB' | 'USD' | 'KRW';
  fc: string;
  traits: string[];
  skuId?: string | null;
}

export interface SkuOption {
  id: string;
  name: string;
  units: number;
  cartons: number;
  kg: number;
  cbm: number;
  goods_value: number;
  goods_currency: string;
  traits: string[];
}

const SHANDONG = ['QDG', 'WEH', 'YNT', 'RZH'];

export function CargoFields({
  value,
  onChange,
  hubs,
  fcs,
  traits,
  skus = [],
  errors = {},
  anyMode = true,
}: {
  value: CargoValue;
  onChange: (v: CargoValue) => void;
  hubs: { code: string; name_ko: string }[];
  fcs: { code: string; name: string; kind?: string }[];
  traits: { code: string; name_ko: string }[];
  skus?: SkuOption[];
  errors?: Record<string, string>;
  anyMode?: boolean;
}) {
  const set = <K extends keyof CargoValue>(k: K, v: CargoValue[K]) => onChange({ ...value, [k]: v });
  const shandong = SHANDONG.includes(value.hub);
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      {skus.length ? (
        <Field label="저장한 SKU 에서 불러오기" htmlFor="cf-sku" className="col-span-2 md:col-span-4">
          <NativeSelect
            id="cf-sku"
            value={value.skuId ?? ''}
            onChange={(e) => {
              const s = skus.find((x) => x.id === e.target.value);
              if (!s) return set('skuId', null);
              onChange({ ...value, skuId: s.id, units: s.units, cartons: s.cartons, kg: s.kg, cbm: s.cbm, goods: s.goods_value, cur: s.goods_currency as 'RMB', traits: s.traits });
            }}
          >
            <option value="">직접 넣기</option>
            {skus.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} · {s.units.toLocaleString('ko-KR')}개 · {s.cbm} CBM
              </option>
            ))}
          </NativeSelect>
        </Field>
      ) : null}
      <Field label="출발 거점" htmlFor="cf-hub">
        <NativeSelect
          id="cf-hub"
          value={value.hub}
          onChange={(e) => {
            const hub = e.target.value;
            onChange({ ...value, hub, port: SHANDONG.includes(hub) ? value.port : 'ICN', mode: value.mode === 'FERRY' && !SHANDONG.includes(hub) ? (anyMode ? 'ANY' : 'LCL') : value.mode });
          }}
        >
          {hubs.map((h) => (
            <option key={h.code} value={h.code}>
              {h.name_ko}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <Field label="도착항" htmlFor="cf-port">
        <NativeSelect id="cf-port" value={value.port} onChange={(e) => set('port', e.target.value)}>
          <option value="ICN">인천항</option>
          <option value="PTK">평택항</option>
        </NativeSelect>
      </Field>
      <Field label="운송 방식" htmlFor="cf-mode">
        <NativeSelect id="cf-mode" value={value.mode} onChange={(e) => set('mode', e.target.value)}>
          {anyMode ? <option value="ANY">상관없음</option> : null}
          <option value="LCL">LCL 혼적</option>
          {shandong ? <option value="FERRY">카페리</option> : null}
          <option value="FCL">FCL 컨테이너</option>
          <option value="AIR">항공</option>
        </NativeSelect>
      </Field>
      <Field label="목적지" htmlFor="cf-fc">
        <NativeSelect id="cf-fc" value={value.fc} onChange={(e) => set('fc', e.target.value)}>
          {destinationGroups(fcs).map((g) => (
            <optgroup key={g.kind} label={g.label}>
              {g.items.map((f) => (
                <option key={f.code} value={f.code}>
                  {f.name}
                </option>
              ))}
            </optgroup>
          ))}
        </NativeSelect>
      </Field>
      <Field label="수량" htmlFor="cf-units" error={errors.units}>
        <NumberField id="cf-units" value={value.units} onValueChange={(v) => set('units', v)} unit="개" min={1} invalid={!!errors.units} />
      </Field>
      <Field label="박스" htmlFor="cf-cartons" error={errors.cartons}>
        <NumberField id="cf-cartons" value={value.cartons} onValueChange={(v) => set('cartons', v)} unit="박스" min={1} invalid={!!errors.cartons} />
      </Field>
      <Field label="무게" htmlFor="cf-kg" error={errors.kg}>
        <NumberField id="cf-kg" value={value.kg} onValueChange={(v) => set('kg', v)} unit="kg" decimals={1} min={0.1} invalid={!!errors.kg} />
      </Field>
      <Field label="부피" htmlFor="cf-cbm" error={errors.cbm}>
        <NumberField id="cf-cbm" value={value.cbm} onValueChange={(v) => set('cbm', v)} unit="CBM" decimals={2} min={0.01} invalid={!!errors.cbm} />
      </Field>
      <Field label="물품가" htmlFor="cf-goods" className="col-span-2" error={errors.goods}>
        <div className="flex gap-2">
          <NumberField id="cf-goods" value={value.goods} onValueChange={(v) => set('goods', v)} unit={value.cur} className="flex-1" invalid={!!errors.goods} />
          <NativeSelect aria-label="통화" value={value.cur} onChange={(e) => set('cur', e.target.value as CargoValue['cur'])} className="w-24">
            <option value="RMB">RMB</option>
            <option value="USD">USD</option>
            <option value="KRW">KRW</option>
          </NativeSelect>
        </div>
      </Field>
      <fieldset className="col-span-2">
        <legend className="mb-1.5 text-sm font-semibold">화물 특성</legend>
        <div className="flex flex-wrap gap-1.5">
          {traits.map((t) => {
            const on = value.traits.includes(t.code);
            return (
              <button
                key={t.code}
                type="button"
                aria-pressed={on}
                onClick={() => set('traits', on ? value.traits.filter((x) => x !== t.code) : [...value.traits, t.code])}
                className={cn('h-8 rounded-xs border px-2.5 text-xs font-semibold', on ? 'border-ink bg-ink text-on-ink' : 'border-line bg-surface hover:border-muted/60')}
              >
                {t.name_ko}
              </button>
            );
          })}
        </div>
      </fieldset>
    </div>
  );
}

export function cargoToParams(v: CargoValue): URLSearchParams {
  const p = new URLSearchParams({
    hub: v.hub,
    port: v.port,
    mode: v.mode,
    units: String(v.units ?? ''),
    cartons: String(v.cartons ?? ''),
    kg: String(v.kg ?? ''),
    cbm: String(v.cbm ?? ''),
    goods: String(v.goods ?? 0),
    cur: v.cur,
    fc: v.fc,
  });
  if (v.traits.length) p.set('traits', v.traits.join(','));
  if (v.skuId) p.set('sku', v.skuId);
  return p;
}
