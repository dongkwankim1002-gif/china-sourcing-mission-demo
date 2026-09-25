'use client';
import * as React from 'react';
import { Field, Input, NativeSelect } from '@/components/ui/core';
import { Switch } from '@/components/ui/radix';
import { NumberField } from '@/components/number-field';
import { RateLinesEditor } from './rate-lines-editor';
import type { RateCardInputT } from '@/lib/schemas';
import { emptyLines } from '@/lib/schemas';

export function blankCard(today: string, hub = 'YIW', port = 'ICN', mode: RateCardInputT['mode'] = 'LCL'): RateCardInputT {
  const to = new Date(Date.parse(today + 'T00:00:00Z') + 60 * 86400_000).toISOString().slice(0, 10);
  return {
    hub,
    port: port as 'ICN',
    mode,
    validFrom: today,
    validTo: to,
    transitMin: 7,
    transitMax: 12,
    certainty: 'confirmed',
    fuelSeparate: false,
    isPublicPrice: false,
    lines: emptyLines(),
    tiers: [],
  };
}

export function RateCardForm({
  value,
  onChange,
  errors,
  hubs,
  ports,
  modes,
  locale = 'ko',
}: {
  value: RateCardInputT;
  onChange: (v: RateCardInputT) => void;
  errors: Record<string, string>;
  hubs: { code: string; name: string }[];
  ports: { code: string; name: string }[];
  modes: { code: string; name: string }[];
  locale?: 'ko' | 'zh';
}) {
  const zh = locale === 'zh';
  const set = <K extends keyof RateCardInputT>(k: K, v: RateCardInputT[K]) => onChange({ ...value, [k]: v });
  const lineErr: Record<number, string> = {};
  for (const [k, m] of Object.entries(errors)) {
    const mm = /^lines\.(\d+)/.exec(k);
    if (mm) lineErr[Number(mm[1])] ??= m;
  }
  return (
    <div className="grid gap-5">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Field label={zh ? '起运地' : '출발 거점'} htmlFor="rc-hub" error={errors.hub}>
          <NativeSelect id="rc-hub" value={value.hub} onChange={(e) => set('hub', e.target.value)}>
            {hubs.map((h) => (
              <option key={h.code} value={h.code}>
                {h.name}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label={zh ? '目的港' : '도착항'} htmlFor="rc-port">
          <NativeSelect id="rc-port" value={value.port} onChange={(e) => set('port', e.target.value as 'ICN')}>
            {ports.map((p) => (
              <option key={p.code} value={p.code}>
                {p.name}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label={zh ? '运输方式' : '운송 방식'} htmlFor="rc-mode" error={errors.mode}>
          <NativeSelect id="rc-mode" value={value.mode} onChange={(e) => set('mode', e.target.value as RateCardInputT['mode'])}>
            {modes.map((m) => (
              <option key={m.code} value={m.code}>
                {m.name}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label={zh ? '整体确定程度' : '전체 확정도'} htmlFor="rc-cert">
          <NativeSelect id="rc-cert" value={value.certainty} onChange={(e) => set('certainty', e.target.value as RateCardInputT['certainty'])}>
            <option value="confirmed">{zh ? '确定' : '확정'}</option>
            <option value="estimated">{zh ? '预估' : '예상'}</option>
            <option value="extra_possible">{zh ? '可能加收' : '추가비용 가능'}</option>
          </NativeSelect>
        </Field>
        <Field label={zh ? '有效期起' : '유효 시작'} htmlFor="rc-from" error={errors.validFrom}>
          <Input id="rc-from" type="date" value={value.validFrom} onChange={(e) => set('validFrom', e.target.value)} />
        </Field>
        <Field label={zh ? '有效期至' : '유효 끝'} htmlFor="rc-to" error={errors.validTo}>
          <Input id="rc-to" type="date" value={value.validTo} onChange={(e) => set('validTo', e.target.value)} />
        </Field>
        <Field label={zh ? '时效(最短)' : '기간(최소)'} htmlFor="rc-tmin">
          <NumberField id="rc-tmin" value={value.transitMin} onValueChange={(v) => set('transitMin', v ?? 1)} unit={zh ? '天' : '일'} min={1} />
        </Field>
        <Field label={zh ? '时效(最长)' : '기간(최대)'} htmlFor="rc-tmax" error={errors.transitMax}>
          <NumberField id="rc-tmax" value={value.transitMax} onValueChange={(v) => set('transitMax', v ?? 1)} unit={zh ? '天' : '일'} min={1} />
        </Field>
      </div>
      <div className="flex flex-wrap gap-6">
        <label className="flex items-center gap-2 text-sm">
          <Switch checked={value.fuelSeparate} onCheckedChange={(v) => set('fuelSeparate', v)} />
          {zh ? '燃油附加费另计' : '유류할증 별도'}
        </label>
        <label className="flex items-center gap-2 text-sm">
          <Switch checked={value.isPublicPrice} onCheckedChange={(v) => set('isPublicPrice', v)} />
          {zh ? '公开价格（未登录用户可见）' : '공개가(비로그인 계산기에도 보임)'}
        </label>
      </div>
      <RateLinesEditor lines={value.lines} onChange={(lines) => set('lines', lines)} errors={lineErr} locale={locale} />
      {errors.lines ? <p role="alert" className="text-sm text-stamp">{errors.lines}</p> : null}
    </div>
  );
}

export function issuesToMap(issues: { path: (string | number)[]; message: string }[], strip = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const i of issues) {
    let k = i.path.join('.');
    if (strip && k.startsWith(strip)) k = k.slice(strip.length);
    out[k] ??= i.message;
  }
  return out;
}
