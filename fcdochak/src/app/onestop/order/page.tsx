import Link from 'next/link';
import { asUser } from '@/lib/db';
import { requireViewer } from '@/lib/server/viewer';
import { entrustProps } from '@/lib/server/onestop';
import { EntrustForm, type EntrustInitial } from '@/components/onestop/entrust-form';
import { OnestopNotice } from '@/components/onestop/parts';
import { ONESTOP_ACTION } from '@/lib/terms';
import { nextCutoff, WEEKDAY_KO } from '@/lib/onestop/settings';
import { dateKo } from '@/lib/format';

export const metadata = { title: '원스톱 주문서(미리보기)' };

const posNum = (s: string | undefined, max: number) => {
  const n = Number(s);
  return Number.isFinite(n) && n > 0 && n <= max ? n : undefined;
};

export default async function OnestopOrder({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  // 로그인하러 갔다 와도 공개 홈 「맡기기」에서 적은 값(이름·링크·수량·박스·CBM·길·FC)이 그대로 오게 쿼리를 next 에 싣는다
  const keep = new URLSearchParams();
  for (const k of ['name', 'url', 'units', 'cartons', 'cbm', 'lane', 'fc'] as const) {
    const val = sp[k];
    if (typeof val === 'string' && val) keep.set(k, val.slice(0, 500));
  }
  const qs = keep.toString();
  const v = await requireViewer('app', `/onestop/order${qs ? `?${qs}` : ''}`);
  const p = await asUser(v, entrustProps);
  const cut = nextCutoff(Date.now(), p.tariff.cutoffWeekdays, p.tariff.cutoffHourKst);
  const initial: EntrustInitial = {
    name: sp.name?.slice(0, 120),
    url: sp.url && /^https?:\/\//.test(sp.url) ? sp.url.slice(0, 500) : undefined,
    units: posNum(sp.units, 1_000_000) && Math.round(posNum(sp.units, 1_000_000)!),
    cartons: posNum(sp.cartons, 100_000) && Math.round(posNum(sp.cartons, 100_000)!),
    cbm: posNum(sp.cbm, 200),
    lane: sp.lane,
    fc: sp.fc,
  };
  return (
    <>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-muted">{v.org.name}</p>
          <h1 className="text-xl font-bold tracking-tight">원스톱 주문서</h1>
          <p className="mt-0.5 text-sm text-muted">무엇을 얼마나 보낼지 적으면 가격 하나가 나옵니다. {p.on ? '보내면 운영이 확인합니다.' : '지금은 접수 기록만 남깁니다(대행 계약 전).'}</p>
        </div>
        <Link href="/onestop/orders" className="text-sm font-semibold underline underline-offset-4">
          {ONESTOP_ACTION.orders}
        </Link>
      </div>
      <OnestopNotice on={p.on} />
      <p className="mb-3 text-sm text-text tnum" data-testid="onestop-cutoff">
        다음 혼적 마감 <b>{dateKo(cut.date, { dow: false })}({WEEKDAY_KO[cut.weekday]}) {p.tariff.cutoffHourKst}시</b> — 마감 뒤 중국 창고에 들어오면 다음 회차로 나갑니다.
      </p>
      <section aria-label="주문서" className="rounded-md border border-line bg-surface p-4 sm:p-5">
        <EntrustForm mode="order" tariff={p.tariff} reference={p.reference} hubs={p.hubs} fcs={p.fcs} categories={p.categories} initial={initial} on={p.on} />
      </section>
    </>
  );
}
