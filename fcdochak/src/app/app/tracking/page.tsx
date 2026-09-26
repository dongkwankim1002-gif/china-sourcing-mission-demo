import Link from 'next/link';
import { Bell, ChevronRight, Radar } from 'lucide-react';
import { asUser, todayKst } from '@/lib/db';
import { requireViewer } from '@/lib/server/viewer';
import { myTracks } from '@/lib/server/tracker';
import { getReference, nameOf } from '@/lib/server/reference';
import { TrackAddForm } from '@/components/tracker/controls';
import { DemoChip } from '@/components/badges';
import { Button, Chip, EmptyState, PageTitle, Panel, PanelHead } from '@/components/ui/core';
import { cn } from '@/lib/cn';
import { ago, dateKo } from '@/lib/format';
import { TRACK_STAGE_LABEL, stageRank } from '@/lib/unipass/stages';
import { TRACK_KIND_LABEL } from '@/lib/unipass/validate';
import { env } from '@/lib/env';
import { TRACK_ACTION } from '@/lib/terms';

export const metadata = { title: '통관 알림' };

export default async function TrackingPage() {
  const v = await requireViewer('app');
  const [d, ref] = await Promise.all([
    asUser(v, async (q) => ({
      tracks: await myTracks(q, v.org.id),
      ships: await q.query<{ id: string; shipment_no: string; stage: number; port: string; mode: string }>(
        `select id, shipment_no, stage, port, mode from fcd.shipments where shipper_org_id = $1 and stage < 9 order by created_at desc limit 50`,
        [v.org.id],
      ),
    })),
    getReference(),
  ]);
  const shipments = d.ships.map((s) => ({ id: s.id, label: `${s.shipment_no} · ${nameOf(ref, 'port', s.port)} · ${nameOf(ref, 'mode', s.mode)}` }));
  const open = d.tracks.filter((t) => stageRank(t.stage) < 7);
  const done = d.tracks.filter((t) => stageRank(t.stage) >= 7);
  const Row = ({ t }: { t: (typeof d.tracks)[number] }) => {
    const r = stageRank(t.stage);
    return (
      <li>
        <Link href={`/app/tracking/${t.id}`} className="grid gap-2 px-4 py-3 hover:bg-surface-2 sm:grid-cols-[minmax(0,1fr)_auto_20px] sm:items-center">
          <span className="min-w-0">
            <span className="flex flex-wrap items-center gap-2">
              <b className="min-w-0 break-words text-sm">{t.label ?? t.number}</b>
              {t.is_demo ? <DemoChip /> : null}
              {t.watching ? <Chip tone="ink" icon={<Bell aria-hidden />}>알림 켬</Chip> : null}
              {t.last_error ? <Chip tone="caution">확인 필요</Chip> : null}
            </span>
            <span className="mt-0.5 block text-xs text-muted tnum">
              {TRACK_KIND_LABEL[t.kind]} <span className="font-mono">{t.number}</span>
              {t.bl_year ? ` · ${t.bl_year}` : ''}
              {t.port ? ` · ${nameOf(ref, 'port', t.port)}` : ''}
              {t.mode ? ` · ${nameOf(ref, 'mode', t.mode)}` : ''}
              {t.shipment_no ? ` · 선적 ${t.shipment_no}` : ''}
              {t.arrival_on ? ` · 입항 ${dateKo(t.arrival_on, { dow: false })}` : ''}
            </span>
          </span>
          <span className="flex flex-wrap items-center gap-2 sm:justify-end">
            <span className="flex items-center gap-[2px]" role="img" aria-label={`${r}/9 ${t.stage ? TRACK_STAGE_LABEL[t.stage] : '기록 없음'}`}>
              {Array.from({ length: 9 }, (_, i) => (
                <span key={i} className={cn('h-1.5 w-2.5 rounded-[1px]', i < r ? (r >= 7 ? 'bg-ok' : 'bg-[var(--seg-4)]') : 'bg-line')} />
              ))}
            </span>
            <Chip tone={r >= 7 ? 'ok' : r ? 'info' : 'neutral'}>{t.stage ? TRACK_STAGE_LABEL[t.stage] : '기록 없음'}</Chip>
            <span className="text-2xs text-muted">{t.last_checked_at ? `조회 ${ago(t.last_checked_at)}` : '아직 조회 전'}</span>
          </span>
          <ChevronRight className="hidden size-4 text-muted sm:block" aria-hidden />
        </Link>
      </li>
    );
  };
  return (
    <>
      <PageTitle
        title="통관 알림"
        sub="B/L·화물관리번호를 저장하면 관세청 단계가 바뀔 때 알림 센터에 알려 드립니다(메일·문자는 보내지 않음). FC도착 선적과 이으면 선적 화면의 통관 단계가 실측으로 보입니다."
        actions={
          <Button asChild variant="secondary">
            <Link href="/track/stats">{TRACK_ACTION.stats}</Link>
          </Button>
        }
      />
      {!env.unipassEnabled ? (
        <p className="mb-4 rounded-md border border-caution/40 bg-caution-bg px-4 py-2.5 text-sm" role="note">
          관세청 실제 조회는 아직 연결 준비 중입니다 — 예시 계정의 번호만 예시 단계로 움직이고, 새로 넣은 실제 번호는 연결되면 조회를 시작합니다.
        </p>
      ) : null}
      <Panel className="mb-4">
        <PanelHead title="번호 더하기" sub="개인통관고유부호는 받지 않습니다. 저장하면 바로 한 번 조회하고 알림을 켭니다." />
        <TrackAddForm thisYear={Number(todayKst().slice(0, 4))} shipments={shipments} />
      </Panel>
      <Panel className="mb-4">
        <PanelHead title={`진행 중 (${open.length})`} />
        {open.length ? (
          <ul className="divide-y divide-line-2" data-testid="tracking-open">{open.map((t) => <Row key={t.id} t={t} />)}</ul>
        ) : (
          <EmptyState icon={<Radar aria-hidden />} title="지켜보는 번호가 없습니다" body="위에서 B/L 번호를 넣거나, 공개 통관 조회에서 「내 목록에 저장」을 누르세요." />
        )}
      </Panel>
      {done.length ? (
        <Panel>
          <PanelHead title={`반출까지 끝남 (${done.length})`} sub="보관 끝내기를 하면 목록에서 빠집니다(기록은 남습니다)." />
          <ul className="divide-y divide-line-2" data-testid="tracking-done">{done.slice(0, 30).map((t) => <Row key={t.id} t={t} />)}</ul>
          {done.length > 30 ? <p className="px-4 py-3 text-xs text-muted">나머지 {done.length - 30}건은 가장 최근 30건 뒤에 있습니다.</p> : null}
        </Panel>
      ) : null}
    </>
  );
}
