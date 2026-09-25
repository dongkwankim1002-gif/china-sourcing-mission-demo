import { AlertTriangle, BadgeCheck, Ban, CheckCircle2, Clock, Handshake, Megaphone, PackageCheck, ShieldQuestion, Sparkles } from 'lucide-react';
import { Chip, type Tone } from '@/components/ui/core';
import { REQUEST_STATUS, STAGES, EXCEPTION_LABEL, PARTNER_STATUS_LABEL, CERTAINTY_LABEL } from '@/lib/terms';
import { cn } from '@/lib/cn';
import { wonShort, won, remaining } from '@/lib/format';

export function RequestStatusChip({ status }: { status: string }) {
  const s = REQUEST_STATUS[status] ?? { label: status, tone: 'neutral' as Tone };
  const icon =
    status === 'closing_soon' ? <Clock aria-hidden /> : status === 'selected' ? <CheckCircle2 aria-hidden /> : status === 'cancelled' || status === 'expired' ? <Ban aria-hidden /> : null;
  return (
    <Chip tone={s.tone as Tone} icon={icon}>
      {s.label}
    </Chip>
  );
}

export function PartnerStatusChip({ status, zh }: { status: string; zh?: boolean }) {
  if (status === 'official')
    return (
      <Chip tone="ok" icon={<BadgeCheck aria-hidden />}>
        {zh ? '正式入驻' : '공식 등록'}
      </Chip>
    );
  if (status === 'pending_verification') return <Chip tone="neutral" icon={<ShieldQuestion aria-hidden />}>{zh ? '认证中' : '인증 대기'}</Chip>;
  if (status === 'public_info') return <Chip tone="neutral">{zh ? '公开信息' : '공개정보 기준'}</Chip>;
  return <Chip tone="stamp">{PARTNER_STATUS_LABEL[status] ?? status}</Chip>;
}

export function FcReadyChip({ zh }: { zh?: boolean }) {
  return (
    <Chip tone="label" icon={<PackageCheck aria-hidden />} title="FC 입고 60건 이상 · 30일 회송률 3.5% 이하(운영 설정 기준)">
      {zh ? 'FC 入库准备认证' : 'FC 입고 준비 인증'}
    </Chip>
  );
}

export function RelatedChip({ note }: { note?: string | null }) {
  return (
    <Chip tone="caution" icon={<Handshake aria-hidden />} title={note ?? undefined}>
      특수관계 공개
    </Chip>
  );
}

export function AdChip() {
  return (
    <Chip tone="ink" icon={<Megaphone aria-hidden />}>
      광고
    </Chip>
  );
}

export function DemoChip() {
  return (
    <Chip tone="label" icon={<Sparkles aria-hidden />}>
      예시
    </Chip>
  );
}

export function CertaintyChip({ c }: { c: string | null }) {
  if (!c) return null;
  const tone: Tone = c === 'confirmed' ? 'ok' : c === 'extra_possible' ? 'caution' : 'neutral';
  return <Chip tone={tone}>{CERTAINTY_LABEL[c] ?? c}</Chip>;
}

export function ExceptionChip({ kind, resolved }: { kind: string; resolved?: boolean }) {
  return (
    <Chip tone={resolved ? 'neutral' : 'stamp'} icon={<AlertTriangle aria-hidden />}>
      {EXCEPTION_LABEL[kind] ?? kind}
      {resolved ? ' · 해결' : ''}
    </Chip>
  );
}

export function StageChip({ stage, zh }: { stage: number; zh?: boolean }) {
  const ZH = ['', '订舱确认', '已提货', '已入中国仓', '出口报关完成', '已装船出港', '已到韩国', '进口清关完成', '已入韩国仓', 'FC入库完成'];
  return (
    <Chip tone={stage === 9 ? 'ok' : 'info'}>
      <span className="tnum">{stage}</span> {zh ? ZH[stage] : STAGES[stage]}
    </Chip>
  );
}

/** 큰 금액은 만·억 요약 + 원 단위 풍선 */
export function Won({ v, short = false, className }: { v: number | null | undefined; short?: boolean; className?: string }) {
  if (v == null) return <span className={className}>—</span>;
  return (
    <span className={cn('tnum', className)} title={short ? won(v) : undefined}>
      {short ? wonShort(v) : won(v)}
    </span>
  );
}

export function Deadline({ at, now }: { at: string; now?: Date }) {
  const r = remaining(at, now);
  return (
    <span className={cn('inline-flex items-center gap-1 text-xs tnum', r.past ? 'text-muted' : r.hours < 24 ? 'font-semibold text-caution' : 'text-muted')}>
      <Clock className="size-3.5" aria-hidden />
      {r.text}
    </span>
  );
}

/** 표준 9단계 진행 띠 */
export function StageTrack({
  stage,
  events,
  zh,
  compact,
}: {
  stage: number;
  events?: { stage: number; occurred_at: string; raw_status: string | null }[];
  zh?: boolean;
  compact?: boolean;
}) {
  const ZH = ['', '订舱确认', '已提货', '已入中国仓', '出口报关完成', '已装船出港', '已到韩国', '进口清关完成', '已入韩国仓', 'FC入库完成'];
  const names = zh ? ZH : STAGES;
  if (compact) {
    return (
      <span className="flex items-center gap-[2px]" role="img" aria-label={`${stage}/9 ${names[stage]}`}>
        {Array.from({ length: 9 }, (_, i) => (
          <span key={i} className={cn('h-1.5 w-2.5 rounded-[1px]', i < stage ? (stage === 9 ? 'bg-ok' : 'bg-[var(--seg-4)]') : 'bg-line')} />
        ))}
      </span>
    );
  }
  const byStage = new Map((events ?? []).map((e) => [e.stage, e]));
  return (
    <ol className="grid grid-cols-3 gap-2 sm:grid-cols-9 sm:gap-[2px]">
      {Array.from({ length: 9 }, (_, i) => {
        const n = i + 1;
        const done = n <= stage;
        const cur = n === stage && stage < 9;
        const ev = byStage.get(n);
        return (
          <li key={n} className="min-w-0" aria-current={cur ? 'step' : undefined}>
            <span className={cn('block h-2 rounded-[2px]', done ? (stage === 9 ? 'bg-ok' : 'bg-[var(--seg-4)]') : 'bg-line', cur && 'bg-label')} />
            <p className={cn('mt-1.5 text-2xs font-bold', done ? 'text-text' : 'text-muted')}>
              <span className="tnum">{n}</span> {names[n]}
            </p>
            {ev ? (
              <p className="text-2xs text-muted">
                {new Date(ev.occurred_at).toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric', timeZone: 'Asia/Seoul' })}
                {ev.raw_status ? <span className="block truncate" title={ev.raw_status}>「{ev.raw_status}」</span> : null}
              </p>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

export { EXCEPTION_LABEL };
