'use client';
/**
 * 가져온 입고 요청 목록 — 줄마다 선적과 짝(자동 제안 → 사람이 확정 · 다른 선적 고르기 · 풀기)과 바코드 PDF 올리기.
 * 390 폭에서도 넘치지 않게 표 대신 카드 줄로 쌓는다.
 */
import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { CheckCircle2, FileCheck2, Link2, Unlink2, UploadCloud } from 'lucide-react';
import { confirmWingMatch, fileWingBarcode, unlinkWingMatch } from '@/app/actions/wing';
import { Button, Chip, EmptyState, NativeSelect } from '@/components/ui/core';
import { StageChip } from '@/components/badges';
import { dateKo, num } from '@/lib/format';
import { WING_ACTION, WING_SOURCE_LABEL } from '@/lib/terms';

export interface InboundItem {
  externalNo: string;
  source: 'mock' | 'file' | 'api';
  centerName: string | null;
  fcName: string | null;
  plannedOn: string | null;
  skuCount: number | null;
  units: number | null;
  boxes: number | null;
  statusRaw: string | null;
  receivedUnits: number | null;
  returnedUnits: number | null;
  version: number;
  match: { shipmentId: string; shipmentNo: string; stage: number; hasBarcode: boolean; score: number | null } | null;
  suggestion: { shipmentId: string; shipmentNo: string; score: number; why: string } | null;
}

export function WingInboundList({ items, shipments }: { items: InboundItem[]; shipments: { id: string; label: string }[] }) {
  if (!items.length)
    return (
      <EmptyState
        title="아직 가져온 입고 요청이 없습니다"
        body="WING 에서 내려받은 입고 목록 파일을 올리면 여기에 쌓이고, FC도착의 선적과 짝을 제안합니다."
      />
    );
  return (
    <ul className="divide-y divide-line-2" data-testid="wing-inbound-list">
      {items.map((i) => (
        <InboundLine key={i.externalNo} i={i} shipments={shipments} />
      ))}
    </ul>
  );
}

function InboundLine({ i, shipments }: { i: InboundItem; shipments: { id: string; label: string }[] }) {
  const router = useRouter();
  const [pending, start] = React.useTransition();
  const [pick, setPick] = React.useState('');
  const file = React.useRef<HTMLInputElement>(null);
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, okText: string) =>
    start(async () => {
      const r = await fn();
      if (r.ok) {
        toast.success(okText);
        router.refresh();
      } else toast.error(r.error ?? '하지 못했습니다');
    });
  const done = i.receivedUnits != null || i.returnedUnits != null;
  return (
    <li className="grid gap-2 px-4 py-3" data-testid="wing-inbound" data-external-no={i.externalNo}>
      <div className="flex flex-wrap items-center gap-2">
        <b className="font-mono text-sm tnum">{i.externalNo}</b>
        <Chip tone={i.source === 'mock' ? 'neutral' : 'info'}>{WING_SOURCE_LABEL[i.source]}</Chip>
        {i.statusRaw ? <Chip tone={done ? 'ok' : 'neutral'}>{i.statusRaw}</Chip> : null}
        {i.version > 1 ? <span className="text-2xs text-muted">{i.version}번째 판</span> : null}
      </div>
      <p className="text-xs text-muted tnum">
        {i.centerName ?? '센터 모름'}
        {i.fcName ? ` → ${i.fcName}` : i.centerName ? ' → FC 못 맞춤' : ''}
        {i.plannedOn ? ` · ${dateKo(i.plannedOn, { dow: false })} 입고 예정` : ''}
        {i.units != null ? ` · ${num(i.units)}개` : ''}
        {i.boxes != null ? ` · ${num(i.boxes)}박스` : ''}
        {i.skuCount != null ? ` · SKU ${i.skuCount}` : ''}
      </p>
      {done ? (
        <p className="text-xs tnum">
          쿠팡 입고 결과: 입고 {num(i.receivedUnits ?? 0)}개 · 회송 <span className={i.returnedUnits ? 'font-semibold text-stamp' : ''}>{num(i.returnedUnits ?? 0)}개</span>
        </p>
      ) : null}

      {i.match ? (
        <div className="flex flex-wrap items-center gap-2 rounded-sm border border-ok/30 bg-ok-bg/50 px-3 py-2" data-testid="wing-match">
          <CheckCircle2 className="size-4 text-ok" aria-hidden />
          <span className="text-sm">
            짝: <Link href={`/app/shipments/${i.match.shipmentId}`} className="font-semibold hover:underline">{i.match.shipmentNo}</Link>
          </span>
          <StageChip stage={i.match.stage} />
          <span className="flex-1" />
          {i.match.hasBarcode ? (
            <Chip tone="ok" icon={<FileCheck2 aria-hidden />}>바코드 PDF 있음</Chip>
          ) : (
            <>
              <input
                ref={file}
                type="file"
                accept="application/pdf,.pdf"
                className="sr-only"
                aria-label={`${i.externalNo} 바코드 PDF 고르기`}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  const fd = new FormData();
                  fd.set('externalNo', i.externalNo);
                  fd.set('file', f);
                  run(() => fileWingBarcode(fd), '바코드 PDF 를 서류함에 넣었습니다');
                }}
              />
              <Button size="sm" variant="secondary" disabled={pending} onClick={() => file.current?.click()}>
                <UploadCloud aria-hidden /> {WING_ACTION.fileBarcode}
              </Button>
            </>
          )}
          <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => unlinkWingMatch({ externalNo: i.externalNo }), '짝을 풀었습니다')}>
            <Unlink2 aria-hidden /> {WING_ACTION.unlink}
          </Button>
        </div>
      ) : (
        <div className="grid gap-2 rounded-sm border border-line-2 bg-surface-2 px-3 py-2">
          {i.suggestion ? (
            <div className="flex flex-wrap items-center gap-2" data-testid="wing-suggestion">
              <span className="text-sm">
                제안: <b>{i.suggestion.shipmentNo}</b> <span className="text-xs text-muted tnum">· {i.suggestion.score}점 · {i.suggestion.why}</span>
              </span>
              <span className="flex-1" />
              <Button size="sm" variant="secondary" disabled={pending} onClick={() => run(() => confirmWingMatch({ externalNo: i.externalNo, shipmentId: i.suggestion!.shipmentId }), '짝을 확정했습니다')}>
                <Link2 aria-hidden /> {WING_ACTION.confirmMatch}
              </Button>
            </div>
          ) : (
            <p className="text-xs text-muted">맞는 선적을 찾지 못했습니다(FC·날짜·수량 기준). 직접 고르세요.</p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <NativeSelect aria-label={`${i.externalNo} 짝 지을 선적`} value={pick} onChange={(e) => setPick(e.target.value)} className="h-8 min-w-0 flex-1 basis-48 text-sm">
              <option value="">다른 선적 고르기…</option>
              {shipments.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </NativeSelect>
            <Button size="sm" variant="ghost" disabled={pending || !pick} onClick={() => run(() => confirmWingMatch({ externalNo: i.externalNo, shipmentId: pick }), '짝을 확정했습니다')}>
              {WING_ACTION.pickMatch}
            </Button>
          </div>
        </div>
      )}
    </li>
  );
}
