import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { asUser } from '@/lib/db';
import { requireViewer } from '@/lib/server/viewer';
import { loadOnestopConfig, onestopSummary, orderQueue } from '@/lib/server/onestop';
import { nextCutoff, ONESTOP_MODE_KO, stageRank, WEEKDAY_KO } from '@/lib/onestop/settings';
import { DemoToggle } from '@/components/demo-toggle';
import { env } from '@/lib/env';
import { OnestopNotice, StageChip } from '@/components/onestop/parts';
import { DemoChip } from '@/components/badges';
import { Chip, EmptyState, PageTitle, Panel, PanelHead } from '@/components/ui/core';
import { dateKo, num, pct, won } from '@/lib/format';

export const metadata = { title: '원스톱 주문 대기열' };

export default async function OnestopAdmin({ searchParams }: { searchParams: Promise<{ demo?: string }> }) {
  const sp = await searchParams;
  const v = await requireViewer('admin');
  // 예시(데모) 주문은 DEMO_MODE 일 때만, 그리고 「예시 빼고」를 고르지 않았을 때만 센다(/admin/metrics 와 같은 토글)
  const include = env.demoMode && sp.demo !== '0';
  const d = await asUser(v, async (q) => {
    const rows = await orderQueue(q, include);
    return { config: await loadOnestopConfig(q), rows, m: onestopSummary(rows) };
  });
  const cut = nextCutoff(Date.now(), d.config.tariff.cutoffWeekdays, d.config.tariff.cutoffHourKst);
  const cutLabel = `${dateKo(cut.date, { dow: false })}(${WEEKDAY_KO[cut.weekday]})`;
  /** 회차 — 중국 창고에 들어온 주문(출항 전)은 다음 마감 회차, 아직 안 들어온 주문은 「빨라야」 그 회차 */
  const round = (r: (typeof d.rows)[number]) => {
    if (r.shown === 'cancelled' || stageRank(r.shown) >= stageRank('departed')) return null;
    return stageRank(r.shown) >= stageRank('factory_received') ? `회차 ${cutLabel}` : `창고 입고 전 · 빨라야 ${cutLabel} 회차`;
  };
  const open = d.rows.filter((r) => r.shown !== 'fc_received' && r.shown !== 'cancelled');
  const done = d.rows.filter((r) => r.shown === 'fc_received' || r.shown === 'cancelled');
  const tile = 'rounded-md border border-line bg-surface p-4';
  const Row = ({ r }: { r: (typeof d.rows)[number] }) => (
    <li>
      <Link href={`/admin/onestop/${r.root}`} className="flex min-w-0 items-center gap-3 px-4 py-3 hover:bg-surface-2">
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <b className="min-w-0 break-words">{r.product_name}</b>
            <StageChip stage={r.shown} />
            {r.preview ? <Chip tone="caution">접수 기록만</Chip> : null}
            {r.quote.minApplied ? <Chip tone="neutral">최소 요금</Chip> : null}
          </span>
          <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted tnum">
            <span className="flex items-center gap-1">
              {r.org_name}
              {r.is_demo ? <DemoChip /> : null}
            </span>
            <span>
              {r.order_no} · {r.hub_name ?? r.hub} · {ONESTOP_MODE_KO[r.mode]} · {num(r.units)}개 · {num(r.cbm, 2)} CBM · {won(r.total_krw)} · 접수 {dateKo(r.received_at, { dow: false })}
              {r.shipment_no ? ` · 선적 ${r.shipment_no}` : ''}
            </span>
            {round(r) ? <span className="font-semibold text-text">{round(r)}</span> : null}
          </span>
        </span>
        <ArrowRight aria-hidden className="size-4 shrink-0 text-muted" />
      </Link>
    </li>
  );
  return (
    <>
      <PageTitle
        title="원스톱 주문 대기열"
        sub="맡기기 접수 — 단계 남기기·실측 새 판·선적 잇기. 모두 새 기록으로 쌓이고, 앱은 화주·공장에 연락하거나 돈을 받지 않습니다."
        actions={
          <>
            {env.demoMode ? <DemoToggle include={include} href={(x) => (x ? '/admin/onestop' : '/admin/onestop?demo=0')} /> : null}
            <Link href="/admin/settings" className="text-sm font-semibold underline underline-offset-4">
              스위치·요금표 바꾸기(onestop.*)
            </Link>
          </>
        }
      />
      <OnestopNotice on={d.config.on} />
      <ul className="mb-6 grid grid-cols-2 gap-3 xl:grid-cols-4" aria-label="요약" data-testid="onestop-metrics">
        <li className={tile}>
          <p className="text-sm font-bold">진행 중</p>
          <p className="mt-1 text-xl font-bold tnum">{num(d.m.open)}건</p>
          <p className="text-2xs text-muted tnum">
            전체 {num(d.m.orders)} · FC 입고 {num(d.m.done)} · 취소 {num(d.m.cancelled)}
          </p>
        </li>
        <li className={tile}>
          <p className="text-sm font-bold">다음 혼적 마감</p>
          <p className="mt-1 text-xl font-bold tnum">
            {cutLabel}
          </p>
          <p className="text-2xs text-muted">{d.config.tariff.cutoffHourKst}시(한국 시각)</p>
        </li>
        <li className={tile}>
          <p className="text-sm font-bold">주문당 CBM · 최소 요금</p>
          <p className="mt-1 text-xl font-bold tnum">{d.m.avg_cbm == null ? '—' : `${num(d.m.avg_cbm, 2)} CBM`}</p>
          <p className="text-2xs text-muted tnum">최소 요금 적용 {num(d.m.min_applied)}건</p>
        </li>
        <li className={tile}>
          <p className="text-sm font-bold">9구간 대비 · 걸린 날</p>
          <p className="mt-1 text-xl font-bold tnum">{d.m.avg_diff_bp == null ? '—' : pct(d.m.avg_diff_bp / 10000, 1, true)}</p>
          <p className="text-2xs text-muted tnum">접수 → FC 입고 평균 {d.m.avg_days == null ? '—' : `${num(d.m.avg_days, 1)}일`}</p>
        </li>
      </ul>
      <Panel className="mb-6">
        <PanelHead title={`처리할 주문 ${open.length}건`} sub="앞 단계부터, 같은 단계면 먼저 접수한 것부터" />
        {open.length ? (
          <ul className="divide-y divide-line-2" data-testid="onestop-queue">
            {open.map((r) => (
              <Row key={r.root} r={r} />
            ))}
          </ul>
        ) : (
          <EmptyState title="처리할 원스톱 주문이 없습니다" body="화주가 /onestop 에서 맡기면 여기에 쌓입니다." />
        )}
      </Panel>
      {done.length ? (
        <Panel>
          <PanelHead title={`끝난 주문 ${done.length}건`} sub="FC 입고·취소" />
          <ul className="divide-y divide-line-2">
            {done.map((r) => (
              <Row key={r.root} r={r} />
            ))}
          </ul>
        </Panel>
      ) : null}
      <p className="mt-6 text-2xs text-muted">
        견주기(docs/onestop-plan.md 9절): 이 요약과 운영 지표(/admin/metrics)·셀러 인터뷰(/admin/research)를 함께 봅니다. 사람이 정할 일은 8절.
      </p>
    </>
  );
}
