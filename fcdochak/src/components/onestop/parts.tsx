/**
 * 원스톱 구역 공용 조각 — 미리보기 표시 · 가격 하나 카드 · 단계 칩. 서버·브라우저 둘 다에서 그린다(훅 없음).
 * 색은 역할 토큰만. 상태는 글자 + 아이콘으로도 싣는다.
 */
import { Eye, Info } from 'lucide-react';
import { Chip, type Tone } from '@/components/ui/core';
import { cn } from '@/lib/cn';
import { won, num, pct } from '@/lib/format';
import { ONESTOP_LINE_LABEL, ONESTOP_STAGE_LABEL } from '@/lib/terms';
import type { OnestopLine } from '@/lib/money';

/** 「원스톱 · 미리보기」 — onestop.enabled 가 꺼져 있으면 「접수 기록만 · 대행 계약 전」 */
export function OnestopNotice({ on, className }: { on: boolean; className?: string }) {
  if (on)
    return (
      <p data-testid="onestop-notice" className={cn('mb-4 flex flex-wrap items-center gap-2 rounded-md border border-ok/40 bg-ok-bg px-4 py-2.5 text-sm text-ok', className)}>
        <Chip tone="ok">원스톱 · 시범</Chip>
        <span className="min-w-0">접수하면 운영이 확인합니다. 앱은 결제를 받거나 메일·문자를 보내지 않습니다.</span>
      </p>
    );
  return (
    <p data-testid="onestop-notice" className={cn('mb-4 flex flex-wrap items-center gap-2 rounded-md border border-caution/40 bg-caution-bg px-4 py-2.5 text-sm text-caution', className)}>
      <Chip tone="caution" icon={<Eye aria-hidden />}>
        원스톱 · 미리보기
      </Chip>
      <span className="min-w-0">접수 기록만 · 대행 계약 전 — 결제·사입·발송은 하지 않습니다. 요금은 가정치입니다.</span>
    </p>
  );
}

export type ShownStage = keyof typeof ONESTOP_STAGE_LABEL;

export function stageTone(s: ShownStage): Tone {
  if (s === 'fc_received') return 'ok';
  if (s === 'cancelled') return 'neutral';
  if (s === 'issue') return 'stamp';
  if (s === 'received') return 'label';
  return 'info';
}

export function StageChip({ stage, className }: { stage: ShownStage; className?: string }) {
  return (
    <Chip tone={stageTone(stage)} className={className}>
      {ONESTOP_STAGE_LABEL[stage]}
    </Chip>
  );
}

export interface PriceView {
  total: number;
  perUnit: number;
  billableCbm: number;
  lines: OnestopLine[];
  minApplied: boolean;
  minTopUp: number;
  lane: { perCbmKrw: number; daysMin: number; daysMax: number; port: string };
  example: boolean;
  checkedOn: string | null;
  nine?: { nineTotal: number; diff: number; diffBp: number | null; logisticsDiff: number; basis: 'market' | 'reference' } | null;
  arrival?: { perUnit: number; perUnitWithVat: number } | null;
}

/** 주문에 남긴 견적(서버가 셈한 기록) → 가격 카드 */
export function snapToView(s: {
  total: number;
  perUnit: number;
  billableCbm: number;
  lines: OnestopLine[];
  minApplied: boolean;
  minTopUp: number;
  lane: PriceView['lane'];
  tariff: { example: boolean; checkedOn: string | null };
  nine: NonNullable<PriceView['nine']>;
  arrival: PriceView['arrival'];
}): PriceView {
  return { ...s, example: s.tariff.example, checkedOn: s.tariff.checkedOn };
}

function lineQty(l: OnestopLine): string {
  if (l.key === 'freight' || l.key === 'remote_fc') return `${num(l.qty, 2)} CBM × ${won(l.rate)}`;
  if (l.key === 'purchase_fee') return `물품가 ${won(l.qty)} × ${pct(l.rate / 10000, 1)}`;
  return `${num(l.qty)}개 × ${won(l.rate)}`;
}

/** 가격 하나 — 큰 합계 한 줄, 그 아래 줄별 내역(접을 수 있게), 9구간 차이·개당 도착원가 */
export function PriceCard({ v, testId = 'onestop-price', compact = false }: { v: PriceView; testId?: string; compact?: boolean }) {
  const diffText =
    v.nine == null
      ? null
      : v.nine.diff === 0
        ? '같습니다'
        : `${v.nine.diff > 0 ? '+' : '−'}${won(Math.abs(v.nine.diff))}${v.nine.diffBp != null ? ` (${v.nine.diff > 0 ? '+' : '−'}${pct(Math.abs(v.nine.diffBp) / 10000, 1)})` : ''}`;
  return (
    <div data-testid={testId} className="min-w-0 rounded-md border border-line bg-surface">
      <div className="border-b border-line-2 px-4 py-3">
        <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-muted">
          가격 하나
          {v.example ? <Chip tone="caution">가정치</Chip> : v.checkedOn ? <Chip tone="ok">확인 {v.checkedOn}</Chip> : null}
          {v.minApplied ? <Chip tone="label">최소 요금 적용</Chip> : null}
        </p>
        <p className="mt-1 text-2xl font-bold tracking-tight text-text tnum" data-testid={`${testId}-total`}>
          {won(v.total)}
        </p>
        <p className="text-sm text-muted tnum">
          개당 {won(v.perUnit)} · 청구 {num(v.billableCbm, 2)} CBM · {v.lane.daysMin}~{v.lane.daysMax}일 · 관세·부가세 별도(실비)
        </p>
      </div>
      <details className="group border-b border-line-2" open={!compact}>
        <summary className="cursor-pointer list-none px-4 py-2 text-sm font-semibold text-text hover:bg-surface-2">
          <span className="group-open:hidden">내역 보기</span>
          <span className="hidden group-open:inline">내역</span>
        </summary>
        <ul className="px-4 pb-3 text-sm">
          {v.lines.map((l) => (
            <li key={l.key} className="flex min-w-0 items-baseline justify-between gap-3 py-1">
              <span className="min-w-0">
                <span className="block">{ONESTOP_LINE_LABEL[l.key]}</span>
                <span className="block text-2xs text-muted tnum">{lineQty(l)}</span>
              </span>
              <span className="shrink-0 tnum">{won(l.amount)}</span>
            </li>
          ))}
          {v.minApplied ? (
            <li className="flex items-baseline justify-between gap-3 py-1">
              <span>최소 요금까지</span>
              <span className="shrink-0 tnum">{won(v.minTopUp)}</span>
            </li>
          ) : null}
        </ul>
      </details>
      <dl className="grid gap-2 px-4 py-3 text-sm">
        {v.nine ? (
          <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3" data-testid={`${testId}-nine`}>
            <dt className="text-muted">
              9구간 {v.nine.basis === 'market' ? '구간 시세 중간값' : '참고치'} {won(v.nine.nineTotal)} 대비
            </dt>
            <dd className={cn('font-semibold tnum', v.nine.diff > 0 ? 'text-caution' : 'text-ok')}>{diffText}</dd>
          </div>
        ) : null}
        {v.nine ? (
          <p className="flex items-start gap-1 text-2xs text-muted">
            <Info aria-hidden className="mt-0.5 size-3 shrink-0" />
            <span>
              9구간에는 개당 작업·바코드·검품·사입 수수료가 없습니다. 운임만 견주면 {v.nine.logisticsDiff >= 0 ? '+' : '−'}
              {won(Math.abs(v.nine.logisticsDiff))}.
            </span>
          </p>
        ) : null}
        {v.arrival ? (
          <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3" data-testid={`${testId}-arrival`}>
            <dt className="text-muted">개당 도착원가(물품가 + 가격 하나 + 관세 참고)</dt>
            <dd className="font-semibold tnum">{won(v.arrival.perUnit)}</dd>
          </div>
        ) : null}
        {v.arrival ? <p className="text-2xs text-muted tnum">통관 때 먼저 낼 부가세까지 개당 {won(v.arrival.perUnitWithVat)} — 관세·부가세는 참고 추정입니다.</p> : null}
      </dl>
    </div>
  );
}
