'use client';
/**
 * 원스톱 행동 버튼·운영 폼 — 화주 취소 · 운영 단계 남기기 · 주문 새 판(실측·선적 잇기).
 * 모두 서버 행동을 부르고, 밖으로 연락하지 않는다.
 */
import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { addOnestopStage, cancelOnestopOrder, reviseOnestopOrder } from '@/app/actions/onestop';
import { NumberField } from '@/components/number-field';
import { Button, Field, Input, NativeSelect } from '@/components/ui/core';
import type { OnestopStage } from '@/lib/onestop/settings';
import { ONESTOP_ACTION, ONESTOP_STAGE_LABEL, ONESTOP_STAGE_ZH } from '@/lib/terms';

export function CancelOrderButton({ orderId }: { orderId: string }) {
  const router = useRouter();
  const [pending, start] = React.useTransition();
  return (
    <Button
      size="sm"
      variant="danger"
      disabled={pending}
      onClick={() => {
        if (!window.confirm('이 원스톱 주문을 취소할까요? 기록은 남습니다.')) return;
        start(async () => {
          const r = await cancelOnestopOrder({ orderId });
          if (!r.ok) return void toast.error(r.error ?? '취소하지 못했습니다');
          toast.success('주문을 취소했습니다');
          router.refresh();
        });
      }}
    >
      {ONESTOP_ACTION.cancel}
    </Button>
  );
}

export function StageForm({ orderId, next, canCancel, today }: { orderId: string; next: OnestopStage[]; canCancel: boolean; today: string }) {
  const router = useRouter();
  const [pending, start] = React.useTransition();
  const [stage, setStage] = React.useState<string>(next[0] ?? 'issue');
  const [note, setNote] = React.useState('');
  const [on, setOn] = React.useState('');
  const options: string[] = [...next, 'issue', ...(canCancel ? ['cancelled'] : [])];
  return (
    <form
      data-testid="onestop-stage-form"
      className="grid gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await addOnestopStage({ orderId, stage, note, occurredOn: on });
          if (!r.ok) return void toast.error(r.error ?? '남기지 못했습니다');
          toast.success(`「${ONESTOP_STAGE_LABEL[stage as keyof typeof ONESTOP_STAGE_LABEL]}」을 남겼습니다`);
          setNote('');
          router.refresh();
        });
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="단계 · 阶段" htmlFor="os-stage">
          <NativeSelect id="os-stage" value={stage} onChange={(e) => setStage(e.target.value)}>
            {options.map((s) => (
              <option key={s} value={s}>
                {ONESTOP_STAGE_LABEL[s as keyof typeof ONESTOP_STAGE_LABEL]} · {ONESTOP_STAGE_ZH[s as keyof typeof ONESTOP_STAGE_ZH]}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="일어난 날(비우면 지금)" htmlFor="os-on">
          <Input id="os-on" type="date" max={today} value={on} onChange={(e) => setOn(e.target.value)} />
        </Field>
      </div>
      <Field label={stage === 'issue' ? '무슨 문제인가(필수) · 说明' : '메모 · 备注'} htmlFor="os-snote" hint="앞으로만 남길 수 있습니다(건너뛰기는 됩니다). 잘못 남겼으면 문제 기록으로 설명을 남기세요.">
        <Input id="os-snote" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} />
      </Field>
      <div>
        <Button type="submit" variant="primary" disabled={pending}>
          {ONESTOP_ACTION.setStage}
        </Button>
      </div>
    </form>
  );
}

export function ReviseForm({ orderId, initial, shipments }: { orderId: string; initial: { units: number; cartons: number; cbm: number; kg: number; shipmentNo: string | null }; shipments: { shipment_no: string; stage: number }[] }) {
  const router = useRouter();
  const [pending, start] = React.useTransition();
  const [units, setUnits] = React.useState<number | null>(initial.units);
  const [cartons, setCartons] = React.useState<number | null>(initial.cartons);
  const [cbm, setCbm] = React.useState<number | null>(initial.cbm);
  const [kg, setKg] = React.useState<number | null>(initial.kg);
  const [measured, setMeasured] = React.useState(true);
  const [ship, setShip] = React.useState(initial.shipmentNo ?? '');
  const [why, setWhy] = React.useState('');
  return (
    <form
      data-testid="onestop-revise-form"
      className="grid gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!units || !cartons || !cbm || !kg) return void toast.error('수량·박스·CBM·무게를 적어 주세요');
        start(async () => {
          const r = await reviseOnestopOrder({ orderId, units, cartons, cbm, kg, measured, shipmentNo: ship, changeNote: why });
          if (!r.ok) return void toast.error(r.error ?? '새 판을 만들지 못했습니다');
          toast.success('주문 새 판을 만들었습니다 — 요금을 지금 요금표로 다시 셈했습니다');
          setWhy('');
          router.refresh();
        });
      }}
    >
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Field label="수량 · 数量" htmlFor="rv-units">
          <NumberField id="rv-units" value={units} onValueChange={setUnits} unit="개" />
        </Field>
        <Field label="박스 · 箱数" htmlFor="rv-cartons">
          <NumberField id="rv-cartons" value={cartons} onValueChange={setCartons} unit="박스" />
        </Field>
        <Field label="CBM · 体积" htmlFor="rv-cbm">
          <NumberField id="rv-cbm" value={cbm} onValueChange={setCbm} decimals={2} unit="CBM" />
        </Field>
        <Field label="무게 · 重量" htmlFor="rv-kg">
          <NumberField id="rv-kg" value={kg} onValueChange={setKg} decimals={1} unit="kg" />
        </Field>
      </div>
      <label className="flex min-h-10 items-center gap-2 text-sm">
        <input type="checkbox" className="size-4 accent-[var(--ink)]" checked={measured} onChange={(e) => setMeasured(e.target.checked)} />
        중국 창고 실측값 · 仓库实测
      </label>
      <Field label="이을 선적(그 화주의 선적 번호)" htmlFor="rv-ship" hint="이으면 출항·통관·FC 입고가 선적 9단계를 따라갑니다. 비우면 잇지 않음">
        <NativeSelect id="rv-ship" value={ship} onChange={(e) => setShip(e.target.value)}>
          <option value="">잇지 않음</option>
          {shipments.map((s) => (
            <option key={s.shipment_no} value={s.shipment_no}>
              {s.shipment_no} · {s.stage}단계
            </option>
          ))}
        </NativeSelect>
      </Field>
      <Field label="새 판을 만드는 까닭(필수)" htmlFor="rv-why">
        <Input id="rv-why" value={why} onChange={(e) => setWhy(e.target.value)} maxLength={300} placeholder="예) 공장 입고 실측 1.2 CBM" />
      </Field>
      <div>
        <Button type="submit" variant="secondary" disabled={pending}>
          {ONESTOP_ACTION.revise}
        </Button>
      </div>
    </form>
  );
}
