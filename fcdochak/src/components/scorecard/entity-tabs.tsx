'use client';
/**
 * 업체 화면 탭(v2 6차 scorecard) — 「개요」 · 「성적표」. 업체 화면은 정적 페이지라 성적표는 누를 때 /api/scorecard/[id] 에서 받는다
 * (이름 붙은 성적은 로그인 화주에게만 — 서버가 가른다). 주소 끝 #scorecard 로 바로 열린다.
 */
import * as React from 'react';
import Link from 'next/link';
import { Lock } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/radix';
import { EmptyState, Panel, Skeleton } from '@/components/ui/core';
import { ScorecardDetail, TradeMetrics } from './parts';
import type { Snap } from '@/lib/server/scorecard';

type Resp = { locked: boolean; loggedIn: boolean; minSamples: number; unlisted?: boolean; rows?: Snap[]; trade?: { metrics: Record<string, number | null> | null; quote: { hours: number; n: number } | null } };

export function EntityTabs({
  entityId,
  overview,
  extra,
  ports,
  modes,
  next,
  entityKind = 'partner',
}: {
  entityId: string;
  overview: React.ReactNode;
  /** 성적표가 열렸을 때(잠금 아님)만 함께 싣는 부품 — 잠긴 화면에 이름 붙은 숫자가 새지 않게(검토 고침) */
  extra?: React.ReactNode;
  /** 관세사 조직이면 broker 판, 아니면 partner 판(한 조직의 두 판이 섞이지 않게) */
  entityKind?: 'partner' | 'broker';
  ports: Record<string, string>;
  modes: Record<string, string>;
  next: string;
}) {
  const [tab, setTab] = React.useState('overview');
  const [data, setData] = React.useState<Resp | null>(null);
  const [err, setErr] = React.useState(false);
  React.useEffect(() => {
    const sync = () => setTab(window.location.hash === '#scorecard' ? 'scorecard' : 'overview');
    sync();
    window.addEventListener('hashchange', sync);
    return () => window.removeEventListener('hashchange', sync);
  }, []);
  React.useEffect(() => {
    if (tab !== 'scorecard' || data) return;
    let off = false;
    fetch(`/api/scorecard/${entityId}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((j: Resp) => !off && setData(j))
      .catch(() => !off && setErr(true));
    return () => {
      off = true;
    };
  }, [tab, data, entityId]);
  const onChange = (v: string) => {
    setTab(v);
    history.replaceState(null, '', v === 'scorecard' ? '#scorecard' : window.location.pathname + window.location.search);
  };
  const mine = (data?.rows ?? []).filter((r) => r.entity_kind === entityKind);
  const all = mine.find((r) => r.port == null && r.mode == null) ?? null;
  const rows = mine.filter((r) => r.port != null && r.mode != null);
  return (
    <Tabs value={tab} onValueChange={onChange}>
      <TabsList>
        <TabsTrigger value="overview">개요</TabsTrigger>
        <TabsTrigger value="scorecard">성적표</TabsTrigger>
      </TabsList>
      <TabsContent value="overview">{overview}</TabsContent>
      <TabsContent value="scorecard">
        <div className="grid gap-6" data-testid="entity-scorecard">
          {err ? (
            <Panel>
              <EmptyState title="성적표를 불러오지 못했습니다" body="잠시 뒤 다시 열어 주세요." />
            </Panel>
          ) : !data ? (
            <Panel className="grid gap-3 p-4">
              <Skeleton className="h-5 w-40" />
              <Skeleton className="h-16" />
              <Skeleton className="h-24" />
            </Panel>
          ) : data.locked && data.unlisted ? (
            <Panel data-testid="scorecard-locked">
              <EmptyState icon={<Lock aria-hidden />} title="공개정보 기준 업체라 성적표를 싣지 않습니다" body="입점해 알림을 받고 이의를 낼 수 있게 된 업체만 이름 붙은 성적표가 붙습니다. 이름 없는 항구·방식별 추이는 누구나 볼 수 있습니다." action={<Link href="/market/customs" className="text-sm font-semibold underline underline-offset-4">통관 시장 지표</Link>} />
            </Panel>
          ) : data.locked ? (
            <Panel data-testid="scorecard-locked">
              <EmptyState
                icon={<Lock aria-hidden />}
                title="업체 이름이 붙은 성적표는 로그인한 화주에게 보입니다"
                body="관세청 단계 기록으로 잰 통관 실측(입항 → 수리 · 검사 비율 · 반입 → 반출 · 반출 → FC 입고 · 제출률)입니다. 이름 없는 항구·방식별 추이는 누구나 볼 수 있습니다."
                action={
                  <>
                    {!data.loggedIn ? <Link href={`/login?next=${encodeURIComponent(next)}`} className="text-sm font-semibold underline underline-offset-4">로그인</Link> : null}
                    <Link href="/market/customs" className="text-sm font-semibold underline underline-offset-4">통관 시장 지표</Link>
                  </>
                }
              />
            </Panel>
          ) : (
            <>
              <ScorecardDetail all={all} rows={rows} minSamples={data.minSamples} portName={(c) => ports[c] ?? c} modeName={(c) => modes[c] ?? c} />
              {data.trade ? <TradeMetrics metrics={data.trade.metrics} quote={data.trade.quote} minSamples={data.minSamples} /> : null}
              {extra}
            </>
          )}
          <p className="text-2xs text-muted">
            계산 방법: 같은 화물은 한 번 · 번호 출처(플랫폼 선적·셀러 등록·물류사 제출)는 따로 세고 숫자는 모두 관세청 처리 일시 · 이상치는 분위수에서 뺍니다 · 업체는 이의를 낼 수 있습니다 · 순위·인증은 돈으로 살 수 없습니다. <Link href="/market/customs#method" className="underline underline-offset-4">계산 방법 자세히</Link>
          </p>
        </div>
      </TabsContent>
    </Tabs>
  );
}
