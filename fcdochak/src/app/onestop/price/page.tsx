import type { Metadata } from 'next';
import Link from 'next/link';
import { asPublic } from '@/lib/db';
import { entrustProps } from '@/lib/server/onestop';
import { OnestopNotice, PriceCard } from '@/components/onestop/parts';
import { buttonVariants, Chip, Panel, PanelHead } from '@/components/ui/core';
import { compareWithNine, computeQuote, onestopQuote } from '@/lib/money';
import { nextCutoff, WEEKDAY_KO } from '@/lib/onestop/settings';
import { dateKo, num, won } from '@/lib/format';
import { ONESTOP_ACTION } from '@/lib/terms';

export const metadata: Metadata = {
  title: '원스톱 요금표(미리보기)',
  description: '공동 혼적 CBM당 요금(허브·방식별) · 개당 작업비·바코드·검품 · 최소 요금 · 혼적 마감 요일. 가정치 · 미리보기.',
  alternates: { canonical: '/onestop/price' },
};

const MODE_KO = { LCL: 'LCL 혼적', FERRY: '카페리 혼적' } as const;
/** 요금표 아래 예시 한 건(예시 화물) */
const EXAMPLE = { units: 300, cartons: 12, cbm: 1, kg: 170 } as const;

export default async function OnestopPrice() {
  const p = await asPublic(entrustProps);
  const t = p.tariff;
  const hub = (c: string) => p.hubs.find((h) => h.code === c)?.name_ko ?? c;
  const fcName = (c: string) => p.fcs.find((f) => f.code === c)?.name ?? c;
  const cut = nextCutoff(Date.now(), t.cutoffWeekdays, t.cutoffHourKst);
  const lane = t.lanes[0];
  const q = onestopQuote(t, { hub: lane.hub, mode: lane.mode, fc: 'FC-ICH', units: EXAMPLE.units, cbm: EXAMPLE.cbm, goodsKrw: 0, purchase: false, barcode: true, inspection: 'basic' });
  const ref = computeQuote(p.reference.lines, { ...EXAMPLE, goodsValue: 0, goodsCurrency: 'RMB' }, p.reference.params);
  const nineTotal = ref.segments.reduce((a, x) => a + (x.amount ?? 0), 0);
  return (
    <>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-bold tracking-tight">원스톱 요금표</h1>
          <p className="mt-0.5 text-sm text-muted">
            가격 하나 = 공동 혼적 운임 + 개당 작업·바코드·검품 (+ 사입 대행 수수료). 합계가 최소 요금보다 적으면 최소 요금입니다.
          </p>
        </div>
        <Link href="/onestop" className={buttonVariants({ variant: 'primary' })}>
          {ONESTOP_ACTION.entrust}
        </Link>
      </div>
      <OnestopNotice on={p.on} />
      <p className="mb-4 flex flex-wrap items-center gap-2 text-sm" data-testid="onestop-tariff-basis">
        {t.example ? <Chip tone="caution">가정치</Chip> : <Chip tone="ok">확인 {t.checkedOn}</Chip>}
        <span className="min-w-0 text-muted">
          {t.example ? '실제 콘솔사 단가로 확인하지 않은 값입니다. 9구간 참고치에서 혼적 규모 효과를 가정해 잡았습니다.' : '운영이 확인한 요금입니다.'}
        </span>
      </p>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="grid min-w-0 gap-6">
          <Panel aria-labelledby="lanes-h">
            <PanelHead id="lanes-h" title="공동 혼적 — CBM당" sub={`공장(중국 창고) 입고부터 쿠팡 FC 입고까지 · 청구 CBM 은 ${num(t.cbmStepCenti / 100, 2)} CBM 단위 올림 · 관세·부가세 별도`} />
            <p className="px-4 pt-2 text-2xs text-muted sm:hidden">표를 옆으로 넘기면 도착항·걸리는 날 칸이 더 있습니다.</p>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[420px] text-sm" data-testid="onestop-lanes">
                <thead className="text-left text-xs text-muted">
                  <tr className="border-b border-line-2">
                    <th scope="col" className="px-4 py-2 font-semibold">출발 · 방식</th>
                    <th scope="col" className="px-4 py-2 font-semibold">도착항</th>
                    <th scope="col" className="px-4 py-2 text-right font-semibold">CBM당</th>
                    <th scope="col" className="px-4 py-2 text-right font-semibold">걸리는 날</th>
                  </tr>
                </thead>
                <tbody>
                  {t.lanes.map((l) => (
                    <tr key={`${l.hub}-${l.mode}`} className="border-b border-line-2 last:border-0">
                      <th scope="row" className="px-4 py-2 text-left font-semibold">
                        {hub(l.hub)} · {MODE_KO[l.mode]}
                      </th>
                      <td className="px-4 py-2">{l.port === 'PTK' ? '평택' : '인천'}</td>
                      <td className="px-4 py-2 text-right tnum">{won(l.perCbmKrw)}</td>
                      <td className="px-4 py-2 text-right tnum">
                        {l.daysMin}~{l.daysMax}일
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {t.remoteFc.codes.length ? (
              <p className="border-t border-line-2 px-4 py-2 text-xs text-muted">
                원거리 FC({t.remoteFc.codes.map(fcName).join('·')})는 CBM당 {won(t.remoteFc.perCbmKrw)} 더합니다.
              </p>
            ) : null}
          </Panel>

          <Panel aria-labelledby="svc-h">
            <PanelHead id="svc-h" title="개당 작업 · 대행" />
            <dl className="grid gap-0 text-sm" data-testid="onestop-services">
              {[
                ['개당 작업비(입고·분류·재포장)', `개당 ${won(t.handlingPerUnitKrw)}`],
                ['쿠팡 바코드 부착', `개당 ${won(t.barcodePerUnitKrw)}`],
                ['기본 검품(수량·외관)', `개당 ${won(t.inspectionPerUnitKrw.basic)}`],
                ['정밀 검품(작동·치수)', `개당 ${won(t.inspectionPerUnitKrw.full)}`],
                ['사입 대행 수수료', `물품가의 ${num(t.purchaseFeeBp / 100, 1)}%`],
                ['최소 요금(한 건)', won(t.minChargeKrw)],
              ].map(([k, v]) => (
                <div key={k} className="flex min-w-0 items-baseline justify-between gap-3 border-b border-line-2 px-4 py-2 last:border-0">
                  <dt className="min-w-0">{k}</dt>
                  <dd className="shrink-0 font-semibold tnum">{v}</dd>
                </div>
              ))}
            </dl>
          </Panel>

          <Panel aria-labelledby="cut-h">
            <PanelHead id="cut-h" title="혼적 마감" />
            <p className="px-4 py-3 text-sm">
              매주 <b>{t.cutoffWeekdays.map((d) => WEEKDAY_KO[d]).join('·')}요일 {t.cutoffHourKst}시</b>(한국 시각)까지 중국 창고에 들어온 화물을 그 회차에 싣습니다. 다음 마감은{' '}
              <b className="tnum">
                {dateKo(cut.date, { dow: false })}({WEEKDAY_KO[cut.weekday]})
              </b>
              입니다.
            </p>
          </Panel>
        </div>

        <aside aria-labelledby="ex-h" className="min-w-0 self-start">
          <h2 id="ex-h" className="mb-2 text-base font-bold">
            예시 한 건
          </h2>
          <p className="mb-2 text-xs text-muted tnum">
            예시 화물 · {hub(lane.hub)} {MODE_KO[lane.mode]} · {num(EXAMPLE.units)}개 · {EXAMPLE.cartons}박스 · {EXAMPLE.cbm} CBM · 인천권 FC · 바코드·기본 검품
          </p>
          {q.ok ? (
            <PriceCard
              testId="onestop-example"
              v={{ ...q, example: t.example, checkedOn: t.checkedOn, nine: { ...compareWithNine(q, nineTotal), basis: 'reference' }, arrival: null }}
            />
          ) : null}
        </aside>
      </div>
    </>
  );
}
