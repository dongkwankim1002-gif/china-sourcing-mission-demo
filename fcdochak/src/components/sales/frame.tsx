/**
 * 판매 분석 화면 틀(v2 3차 sales) — 제목 · 열림 상태 띠(예시·시험 모드·연결 권유) · 기간 · 탭 다섯. 서버에서 그린다.
 */
import Link from 'next/link';
import { Suspense } from 'react';
import { FlaskConical, Plug2 } from 'lucide-react';
import { Button, Chip, PageTitle } from '@/components/ui/core';
import { PeriodPicker } from '@/components/period-picker';
import { cn } from '@/lib/cn';
import { dateKo, dateTimeKo } from '@/lib/format';
import { SALES_ACTION } from '@/lib/terms';
import type { SalesView } from '@/lib/server/sales';
import { SalesSyncButton } from './sync-button';

export const SALES_TABS = [
  { href: '/app/sales', label: '개요' },
  { href: '/app/sales/products', label: '상품별' },
  { href: '/app/sales/pnl', label: '손익' },
  { href: '/app/sales/returns', label: '반품' },
  { href: '/app/sales/inbound', label: '입고 성과' },
] as const;

export function SalesFrame({ view, active, title, sub, children }: { view: SalesView; active: (typeof SALES_TABS)[number]['href']; title: string; sub: string; children: React.ReactNode }) {
  const lastOk = view.runs.find((r) => r.status === 'ok');
  const lastRun = view.runs[0];
  return (
    <>
      <PageTitle
        eyebrow="판매 분석"
        title={title}
        sub={sub}
        actions={
          <>
            {view.example ? (
              <Chip tone="label" icon={<FlaskConical aria-hidden />}>
                예시
              </Chip>
            ) : null}
            <Suspense fallback={null}>
              <PeriodPicker value={view.periodDays} />
            </Suspense>
            {view.access !== 'none' ? <SalesSyncButton /> : null}
          </>
        }
      />
      {view.expiry ? (
        <p role="status" data-testid="sales-expiry-alert" className={cn('mb-4 rounded-md border px-4 py-3 text-sm font-semibold', view.expiry.kind === 'expired' ? 'border-stamp/40 bg-stamp-bg text-stamp' : 'border-caution/40 bg-caution-bg text-caution')}>
          {view.expiry.title} — <Link className="underline" href="/app/integrations/wing">새 키 넣기</Link>
        </p>
      ) : null}
      {view.access === 'none' ? (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-md border border-label/60 bg-label/10 px-4 py-3" data-testid="sales-connect-cta">
          <div className="min-w-0">
            <p className="text-sm font-bold">쿠팡 API 키를 맡기면 내 판매 기록으로 열립니다</p>
            <p className="text-xs text-muted">지금 보이는 숫자는 모두 「예시」입니다(저장하지 않는 미리보기). 키는 암호화해 보관하고 읽기만 합니다.</p>
          </div>
          <Button asChild variant="primary">
            <Link href="/app/integrations/wing">
              <Plug2 aria-hidden /> {SALES_ACTION.connect}
            </Link>
          </Button>
        </div>
      ) : view.preview ? (
        <p className="mb-4 rounded-md border border-caution/40 bg-caution-bg px-4 py-3 text-sm text-caution" role="status" data-testid="sales-test-mode">
          시험 모드 — 키는 맡겼지만 쿠팡 연동이 아직 꺼져 있어 가져온 판매 기록이 없습니다. 아래는 「예시」 미리보기입니다.
          {lastRun ? ` 마지막 시도 ${dateTimeKo(lastRun.created_at)}.` : ''}
        </p>
      ) : view.access === 'example' ? (
        <p className="mb-4 rounded-md border border-line bg-surface-2 px-4 py-3 text-xs text-muted" role="status" data-testid="sales-example-note">
          데모 조직 — 흉내 어댑터가 만든 180일 「예시」 판매 기록입니다. 실제 쿠팡 자료가 아닙니다.
          {lastOk ? ` 마지막 가져오기 ${dateTimeKo(lastOk.created_at)}.` : ''}
        </p>
      ) : lastOk ? (
        <p className="mb-4 text-xs text-muted">
          {view.analysis.period.cur.from ? `${dateKo(view.analysis.period.cur.from, { dow: false })} ~ ${dateKo(view.analysis.period.cur.to, { dow: false })} · ` : ''}마지막 가져오기 {dateTimeKo(lastOk.created_at)}
        </p>
      ) : null}
      <nav aria-label="판매 분석" className="mb-4 -mx-4 overflow-x-auto px-4 md:mx-0 md:px-0">
        <ul className="flex min-w-max gap-1 border-b border-line">
          {SALES_TABS.map((t) => (
            <li key={t.href}>
              <Link
                href={`${t.href}${view.periodDays !== 30 ? `?p=${view.periodDays}` : ''}`}
                aria-current={active === t.href ? 'page' : undefined}
                className={cn(
                  '-mb-px inline-block border-b-2 px-3 py-2 text-sm font-semibold',
                  active === t.href ? 'border-label text-text' : 'border-transparent text-muted hover:text-text',
                )}
              >
                {t.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      {children}
    </>
  );
}

export function basisChip(b: 'actual' | 'market' | 'none', samples: number) {
  if (b === 'actual') return <Chip tone="ok">실제 {samples}건</Chip>;
  if (b === 'market') return <Chip tone="info">구간 시세</Chip>;
  return <Chip tone="neutral">원가 없음</Chip>;
}
