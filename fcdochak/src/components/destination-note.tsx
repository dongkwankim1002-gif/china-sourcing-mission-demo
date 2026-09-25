import { Info } from 'lucide-react';
import { cn } from '@/lib/cn';
import { DESTINATION_KIND_LABEL, type DestinationKind } from '@/lib/money/destination';

/**
 * 쿠팡 FC 밖 목적지를 골랐을 때의 안내 — 「FC 운송」 칸을 거리 기준 참고치로 바꿔 계산했다는 것.
 * 계산기(남색 바탕, onInk)와 비교 화면(종이 바탕)이 같은 말을 쓴다.
 */
export function DestinationNote({ name, kind, onInk = false, className }: { name: string; kind: string; onInk?: boolean; className?: string }) {
  const label = DESTINATION_KIND_LABEL[kind as DestinationKind] ?? '다른 창고';
  return (
    <p
      data-testid="destination-note"
      className={cn(
        'flex items-start gap-2 rounded-md border px-3 py-2 text-xs',
        onInk ? 'border-white/20 bg-white/[0.06] text-on-ink-muted' : 'border-line bg-surface-2 text-muted',
        className,
      )}
    >
      <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
      <span>
        목적지 <b className={onInk ? 'text-on-ink' : 'text-text'}>{name}</b>({label}) — 업체 요금표의 「FC 운송」은 쿠팡 FC 기준이라, 이 목적지까지는
        도착항에서의 거리로 계산한 참고치로 바꿔 넣었습니다. 참고치는 확정 합계에 들어가지 않습니다.
      </span>
    </p>
  );
}

/** 목적지 고르기 목록 — 쿠팡 FC 를 앞에, 그 밖은 종류별 묶음으로 */
export function destinationGroups<T extends { kind?: string }>(list: T[]): { kind: DestinationKind; label: string; items: T[] }[] {
  const kinds: DestinationKind[] = ['coupang_fc', '3pl', 'mall_wh'];
  return kinds
    .map((k) => ({ kind: k, label: DESTINATION_KIND_LABEL[k], items: list.filter((x) => (x.kind ?? 'coupang_fc') === k) }))
    .filter((g) => g.items.length > 0);
}
