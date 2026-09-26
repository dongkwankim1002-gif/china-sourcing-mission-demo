'use client';
/**
 * 연결 시험(v2 3차 sales) — 스위치가 꺼져 있으면(또는 데모) 「시험 모드」: 쿠팡을 부르지 않고 저장·암호화·동의·만료·연동 IP 만 본다.
 */
import * as React from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle2, CircleAlert, PlugZap } from 'lucide-react';
import { testWingConnection, type TestResult } from '@/app/actions/sales';
import { Button, Chip, Panel, PanelHead } from '@/components/ui/core';
import { SALES_ACTION } from '@/lib/terms';

export function ConnectionTestPanel({ testMode }: { testMode: boolean }) {
  const router = useRouter();
  const [res, setRes] = React.useState<TestResult | null>(null);
  const [err, setErr] = React.useState<string | null>(null);
  const [pending, start] = React.useTransition();
  return (
    <Panel aria-labelledby="wt-h" data-testid="wing-connection-test">
      <PanelHead
        id="wt-h"
        title="연결 시험"
        sub={testMode ? '연동이 꺼져 있어 쿠팡을 부르지 않습니다' : '쿠팡에 재고 요약을 한 번 물어봅니다(읽기)'}
        action={testMode ? <Chip tone="caution">시험 모드</Chip> : <Chip tone="ok">연동 켜짐</Chip>}
      />
      <div className="grid gap-3 p-4">
        <div className="flex justify-end">
          <Button
            variant="secondary"
            disabled={pending}
            onClick={() =>
              start(async () => {
                setErr(null);
                const r = await testWingConnection();
                if (!r.ok || !r.data) return setErr(r.error ?? '연결 시험을 하지 못했습니다');
                setRes(r.data);
                router.refresh();
              })
            }
          >
            <PlugZap aria-hidden /> {pending ? '확인하는 중…' : SALES_ACTION.test}
          </Button>
        </div>
        {err ? (
          <p role="alert" className="text-sm text-stamp">
            {err}
          </p>
        ) : null}
        {res ? (
          <div className="grid gap-2" data-testid="wing-test-result">
            <p className={`text-sm font-semibold ${res.passed ? 'text-ok' : 'text-caution'}`} role="status">
              {res.mode === 'test' ? '시험 모드 · ' : ''}
              {res.message}
            </p>
            <ul className="divide-y divide-line-2 rounded-sm border border-line-2 text-xs">
              {res.checks.map((c) => (
                <li key={c.label} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 px-3 py-2">
                  {c.ok ? <CheckCircle2 className="size-3.5 text-ok" aria-label="됨" /> : <CircleAlert className="size-3.5 text-caution" aria-label="아직" />}
                  <span className="font-semibold">{c.label}</span>
                  {c.note ? <span className="min-w-0 break-all text-muted">{c.note}</span> : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </Panel>
  );
}
