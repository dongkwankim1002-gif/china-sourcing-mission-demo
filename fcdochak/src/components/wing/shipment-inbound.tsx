/** 선적 화면의 쿠팡 WING 입고 요청 한 줄 — 짝을 확정한 번호·FC·예정일·수량·입고 결과. 화주·물류사 화면이 함께 쓴다 */
import { PackageCheck } from 'lucide-react';
import type { ShipmentInbound } from '@/lib/server/wing';
import { Chip } from '@/components/ui/core';
import { num } from '@/lib/format';

export function WingInboundLine({ inbound, zh = false }: { inbound: ShipmentInbound; zh?: boolean }) {
  const L = (ko: string, cn: string) => (zh ? cn : ko);
  const i = inbound;
  return (
    <p className="mb-4 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-line bg-surface px-4 py-2.5 text-sm" data-testid="shipment-wing-inbound">
      <PackageCheck className="size-4 shrink-0 text-muted" aria-hidden />
      <span className="text-muted">{L('쿠팡 입고 요청', '酷澎入库申请')}</span>
      <b className="font-mono tnum">{i.external_no}</b>
      {i.source === 'mock' ? <Chip tone="neutral">{L('예시', '示例')}</Chip> : null}
      {i.center_name || i.fc_code ? <span>{i.center_name ?? i.fc_code}</span> : null}
      {i.planned_on ? <span className="tnum">{L('입고 예정', '预计入库')} {i.planned_on}</span> : null}
      {i.units != null ? <span className="tnum">{num(i.units)}{L('개', '件')}{i.boxes != null ? ` · ${num(i.boxes)}${L('박스', '箱')}` : ''}</span> : null}
      {i.received_units != null || i.returned_units != null ? (
        <span className="tnum text-muted">
          {L('쿠팡 기록', '酷澎记录')} {L('입고', '入库')} {num(i.received_units ?? 0)} · {L('회송', '退回')} {num(i.returned_units ?? 0)}
        </span>
      ) : i.status_raw ? (
        <span className="text-muted">{i.status_raw}</span>
      ) : null}
    </p>
  );
}
