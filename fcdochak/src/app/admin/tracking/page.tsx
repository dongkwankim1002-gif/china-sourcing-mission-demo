import Link from 'next/link';
import { asUser } from '@/lib/db';
import { requireViewer } from '@/lib/server/viewer';
import { adminTrackerStatus, loadTrackerConfig, switchState } from '@/lib/server/tracker';
import { AdminTrackerButtons } from '@/components/tracker/controls';
import { Chip, EmptyState, PageTitle, Panel, PanelHead } from '@/components/ui/core';
import { dateTimeKo, num } from '@/lib/format';

export const metadata = { title: '통관 조회 폴링' };

const TRIGGER: Record<string, string> = { cron: '예약', manual: '운영자', lookup: '공개 조회', save: '저장 직후' };
const MODE: Record<string, string> = { http: '관세청', mock: '흉내', off: '꺼짐' };

export default async function AdminTrackingPage() {
  const v = await requireViewer('admin');
  const d = await asUser(v, async (q) => ({ s: await adminTrackerStatus(q), cfg: await loadTrackerConfig(q) }));
  const sw = switchState();
  const { s, cfg } = d;
  const tile = 'rounded-md border border-line bg-surface p-4';
  return (
    <>
      <PageTitle
        title="통관 조회 폴링"
        sub="관세청 UNI-PASS 조회 회차·호출 수·실패. 번호·키·응답 원문은 이 기록에 남기지 않습니다."
        actions={<AdminTrackerButtons />}
      />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className={tile}>
          <p className="text-xs font-semibold text-muted">관세청 조회</p>
          <p className="mt-1 flex flex-wrap gap-1.5">
            <Chip tone={sw.enabled ? 'ok' : 'neutral'}>{sw.enabled ? '켜짐' : '꺼짐 — 흉내만'}</Chip>
            <Chip tone={sw.keyPresent ? 'ok' : 'caution'}>{sw.keyPresent ? '인증키 있음' : '인증키 없음'}</Chip>
          </p>
          <p className="mt-1 text-2xs text-muted">UNIPASS_ENABLED · UNIPASS_API_KEY</p>
        </div>
        <div className={tile}>
          <p className="text-xs font-semibold text-muted">예약 경로</p>
          <p className="mt-1"><Chip tone={sw.cronSecretPresent ? 'ok' : 'caution'}>{sw.cronSecretPresent ? '열림' : '닫힘'}</Chip></p>
          <p className="mt-1 text-2xs text-muted">CRON_SECRET {sw.cronSecretPresent ? '있음' : '없음'} · 예약(vercel.json crons)은 넣지 않았습니다 — 사람이 정할 일</p>
        </div>
        <div className={tile}>
          <p className="text-xs font-semibold text-muted">오늘 호출</p>
          <p className="display mt-1 text-2xl tnum">{num(s.today.calls)}<span className="text-sm text-muted"> / {num(cfg.rules.dailyCallBudget)}</span></p>
          <p className="text-2xs text-muted tnum">회차 {s.today.runs} · 실패 {s.today.failures}</p>
        </div>
        <div className={tile}>
          <p className="text-xs font-semibold text-muted">번호</p>
          <p className="display mt-1 text-2xl tnum">{num(s.counts.tracks)}</p>
          <p className="text-2xs text-muted tnum">알림 켬 {s.counts.watched} · 진행 중 {s.counts.open} · 확인 필요 {s.counts.errors} · 예시 {s.counts.demo}</p>
        </div>
      </div>
      <Panel className="mb-4">
        <PanelHead title="규칙" sub={<><Link href="/admin/settings" className="underline underline-offset-4">설정(tracker.rules · calendar.kr_holidays)</Link>에서 새 판으로</>} />
        <p className="px-4 py-3 text-sm tnum">
          캐시 {cfg.rules.cacheMinutes}분 · 한 번에 {cfg.rules.batchLimit}건 · 하루 {num(cfg.rules.dailyCallBudget)}회 · 공개 분당 {cfg.rules.publicPerMinute}회 · 통계 {cfg.rules.windowDays}일 · 표본 기준 {cfg.rules.minSamples}건
          {' · '}공휴일 목록 {d.cfg.holidays.confirmed ? `확인함(${d.cfg.holidays.checkedOn ?? ''})` : '확인 필요'} · 통계 {s.stats.computed_at ? `${dateTimeKo(s.stats.computed_at)} ${s.stats.rows}줄` : '아직 없음'}
        </p>
      </Panel>
      <Panel>
        <PanelHead title="최근 회차" sub="최근 30회" />
        {s.runs.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="text-left text-xs text-muted">
                <tr className="border-b border-line-2">
                  <th scope="col" className="px-4 py-2">때</th>
                  <th scope="col" className="px-4 py-2">누가</th>
                  <th scope="col" className="px-4 py-2">방식</th>
                  <th scope="col" className="px-4 py-2 text-right">본 번호</th>
                  <th scope="col" className="px-4 py-2 text-right">호출</th>
                  <th scope="col" className="px-4 py-2 text-right">바뀜</th>
                  <th scope="col" className="px-4 py-2 text-right">건너뜀</th>
                  <th scope="col" className="px-4 py-2 text-right">실패</th>
                  <th scope="col" className="px-4 py-2">메모</th>
                </tr>
              </thead>
              <tbody>
                {s.runs.map((r) => (
                  <tr key={r.id} className="border-b border-line-2 last:border-0">
                    <td className="px-4 py-2 tnum whitespace-nowrap">{dateTimeKo(r.started_at)}</td>
                    <td className="px-4 py-2">{TRIGGER[r.trigger] ?? r.trigger}</td>
                    <td className="px-4 py-2"><Chip tone={r.mode === 'http' ? 'info' : 'neutral'}>{MODE[r.mode] ?? r.mode}</Chip></td>
                    <td className="px-4 py-2 text-right tnum">{r.tracks_seen}</td>
                    <td className="px-4 py-2 text-right tnum">{r.calls}</td>
                    <td className="px-4 py-2 text-right tnum">{r.changed}</td>
                    <td className="px-4 py-2 text-right tnum">{r.skipped}</td>
                    <td className={`px-4 py-2 text-right tnum ${r.failures ? 'font-semibold text-stamp' : ''}`}>{r.failures}</td>
                    <td className="px-4 py-2 text-xs text-muted">{r.note ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState title="아직 돈 회차가 없습니다" body="「폴링 한 번 돌리기」를 누르면 알림 켠 번호를 봅니다(꺼짐이면 예시 조직 번호만 흉내로)." />
        )}
      </Panel>
    </>
  );
}
