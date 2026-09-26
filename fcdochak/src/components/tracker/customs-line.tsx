/**
 * 선적 화면(·원스톱 주문)의 「관세청 실측」 줄 — 이은 통관 번호가 있으면 표준 9단계 중 6(한국 도착)·7(수입통관 완료)을
 * 관세청 단계 시각으로 보여 주고, 물류사 기록과 다르면 그 차이를 적는다.
 */
import Link from 'next/link';
import { Radar } from 'lucide-react';
import { Chip } from '@/components/ui/core';
import { dateTimeKo } from '@/lib/format';
import { TRACK_STAGE_LABEL } from '@/lib/unipass/stages';
import type { TrackStage } from '@/lib/unipass/types';

export interface CustomsFacts {
  id: string;
  number: string;
  stage: TrackStage | null;
  first: Partial<Record<TrackStage, string>>;
  source: 'unipass' | 'mock' | null;
  is_demo: boolean;
}

export function TrackCustomsLine({ t, partnerClearedAt, href, zh = false }: { t: CustomsFacts; partnerClearedAt?: string | null; href?: string | null; zh?: boolean }) {
  const L = (ko: string, cn: string) => (zh ? cn : ko);
  const arrival = t.first.arrival ?? t.first.unloading ?? null;
  const cleared = t.first.cleared ?? null;
  const released = t.first.released ?? null;
  const diffH = (a: string | null | undefined, b: string | null | undefined) => (a && b ? Math.round((Date.parse(b) - Date.parse(a)) / 3600_000) : null);
  const clearDiff = diffH(cleared, partnerClearedAt);
  return (
    <div className="mb-4 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-line bg-surface px-4 py-2.5 text-sm" data-testid="shipment-customs-actual">
      <Radar className="size-4 shrink-0 text-muted" aria-hidden />
      <span className="text-muted">{L('관세청 실측', '海关实测')}</span>
      {href ? <Link href={href} className="font-mono font-bold tnum underline underline-offset-4">{t.number}</Link> : <b className="font-mono tnum">{t.number}</b>}
      {t.source === 'mock' || t.is_demo ? <Chip tone="neutral">{L('예시', '示例')}</Chip> : null}
      <span className="tnum">6 {L('한국 도착', '到达韩国')} {arrival ? dateTimeKo(arrival) : '—'}</span>
      <span className="tnum">7 {L('수입통관(수리)', '进口清关')} {cleared ? dateTimeKo(cleared) : '—'}</span>
      {released ? <span className="tnum">{L('반출', '出库')} {dateTimeKo(released)}</span> : null}
      {!cleared && t.stage ? <span className="text-muted">{L('지금', '当前')}: {TRACK_STAGE_LABEL[t.stage]}</span> : null}
      {clearDiff != null && Math.abs(clearDiff) >= 3 ? (
        <span className="text-xs text-caution">
          {L('물류사 기록과', '与货代记录')} {Math.abs(clearDiff)}{L('시간', '小时')} {clearDiff > 0 ? L('차이(물류사 기록이 늦음)', '差(货代记录较晚)') : L('차이(물류사 기록이 이름)', '差(货代记录较早)')}
        </span>
      ) : null}
    </div>
  );
}
