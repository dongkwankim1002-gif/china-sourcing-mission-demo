/**
 * 통관·입고 알리미 결과 한 벌 — 아홉 단계 · 예상 통관일/FC 입고일 · 같은 항구 분포 · 같은 날 입항분 · 타임라인.
 * 공개 /track(브라우저)·화주 /app/tracking/[id](서버)가 같은 것을 쓴다. 훅 없음.
 */
import { AlertTriangle, CalendarClock, Clock, PackageCheck, Ship } from 'lucide-react';
import type { TrackView } from '@/lib/tracker/view';
import { BASIS_LABEL } from '@/lib/tracker/view';
import { TRACK_STAGE_LABEL } from '@/lib/unipass/stages';
import { Chip } from '@/components/ui/core';
import { cn } from '@/lib/cn';
import { dateKo, dateTimeKo, pct } from '@/lib/format';

export function TrackSteps({ steps }: { steps: TrackView['steps'] }) {
  const cur = steps.find((s) => s.state === 'current');
  return (
    <div className="@container"><ol className="grid grid-cols-3 gap-2 @lg:grid-cols-5 @4xl:grid-cols-9 @4xl:gap-[2px]" aria-label={`통관·입고 아홉 단계 — 지금 ${cur ? `${cur.label} 기다림` : '모두 끝남'}`} data-testid="track-steps">
      {steps.map((s, i) => (
        <li key={s.stage} className="min-w-0" aria-current={s.state === 'current' ? 'step' : undefined}>
          <span className={cn('block h-2 rounded-[2px]', s.state === 'done' ? (steps[8].state === 'done' ? 'bg-ok' : 'bg-[var(--seg-4)]') : s.state === 'current' ? 'bg-label' : 'bg-line')} />
          <p className={cn('mt-1.5 text-2xs font-bold', s.state === 'done' ? 'text-text' : 'text-muted')}>
            <span className="tnum">{i + 1}</span> {s.label}
          </p>
          <p className="text-2xs text-muted tnum">
            {s.at ? dateTimeKo(s.at) : s.state === 'done' ? '기록 없음' : s.state === 'current' ? '기다리는 중' : ''}
            {s.from === 'shipment' ? <span className="block">물류사 기록</span> : null}
          </p>
        </li>
      ))}
    </ol></div>
  );
}

function EstimateCard({ title, icon, e, doneLabel, untracked }: { title: string; icon: React.ReactNode; e: TrackView['clearance']; doneLabel: string; untracked?: boolean }) {
  return (
    <div className="min-w-0 rounded-md border border-line bg-surface p-4">
      <p className="flex items-center gap-1.5 text-xs font-semibold text-muted">
        {icon}
        {title}
      </p>
      {e.done ? (
        <>
          <p className="mt-1 text-lg font-bold text-ok">{doneLabel} {dateKo(e.done)}</p>
          <p className="text-xs text-muted">실제 기록</p>
        </>
      ) : e.usual ? (
        <>
          <p className="mt-1 text-lg font-bold">
            보통 <span className="tnum">{dateKo(e.usual)}</span>
          </p>
          <p className="text-sm">
            늦으면 <b className="tnum">{dateKo(e.late)}</b>
          </p>
          {untracked ? (
            <p className="mt-1 text-xs text-muted">FC 입고 시각은 FC도착 선적과 이으면 기록됩니다 — 지금은 예상만.</p>
          ) : e.overdue ? (
            <p className="mt-1 flex items-center gap-1 text-xs font-semibold text-caution">
              <AlertTriangle className="size-3.5" aria-hidden />
              보통보다 늦어지고 있습니다
            </p>
          ) : null}
          <p className="mt-1 text-xs text-muted">
            {BASIS_LABEL[e.basis]}
            {e.n != null ? ` · 표본 ${e.n}건` : ''} · 보통 {e.usualDays}영업일 · 늦으면 {e.lateDays}영업일
          </p>
        </>
      ) : (
        <>
          <p className="mt-1 text-lg font-bold text-muted">입항하면 셈합니다</p>
          <p className="text-xs text-muted">
            입항 뒤 보통 {e.usualDays}영업일 · 늦으면 {e.lateDays}영업일({BASIS_LABEL[e.basis]})
          </p>
        </>
      )}
    </div>
  );
}

/** 입항→수리 영업일 분포 — 한 계열 막대(DESIGN 차트 규칙). 글로도 요약 */
export function DistBars({ hist, n, p50, p90, title = '같은 항구·방식 최근 분포(입항 → 수리)' }: { hist: number[]; n: number; p50: number; p90: number; title?: string }) {
  const max = Math.max(1, ...hist);
  const last = hist.length - 1;
  return (
    <figure className="min-w-0">
      <figcaption className="text-xs font-semibold text-muted">
        {title} · 표본 {n}건
      </figcaption>
      <p className="sr-only">
        {hist.map((c, i) => `${i === last ? `${i}일 이상` : `${i}일`} ${c}건`).join(', ')}. 중앙값 {p50}영업일, 90% 지점 {p90}영업일.
      </p>
      <div className="mt-2 flex h-24 items-end gap-1" aria-hidden>
        {hist.map((c, i) => (
          <div key={i} className="flex min-w-0 flex-1 flex-col items-center gap-1">
            <span className="text-2xs text-muted tnum">{c || ''}</span>
            <span className="w-full max-w-6 rounded-t-[4px] bg-[var(--seg-4)]" style={{ height: `${Math.max(c ? 4 : 1, (c / max) * 64)}px`, opacity: c ? 1 : 0.25 }} />
          </div>
        ))}
      </div>
      <div className="mt-1 flex gap-1 border-t border-line pt-1" aria-hidden>
        {hist.map((_, i) => (
          <span key={i} className="min-w-0 flex-1 text-center text-2xs text-muted tnum">
            {i === last ? `${i}+` : i}
          </span>
        ))}
      </div>
      <p className="mt-1 text-2xs text-muted">가로: 영업일 · 보통(중앙값) {p50}일 · 늦으면(90% 지점) {p90}일</p>
    </figure>
  );
}

export function TrackResultView({ view, headline, mock, source }: { view: TrackView; headline?: React.ReactNode; mock?: boolean; source?: 'unipass' | 'mock' | null }) {
  const cur = view.current;
  return (
    <div className="grid gap-4" data-testid="track-result">
      {mock ? (
        <p className="flex items-start gap-2 rounded-md border border-caution/40 bg-caution-bg px-4 py-2.5 text-sm" role="note">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-caution" aria-hidden />
          <span>
            <b>예시 자료</b> — 관세청 실제 조회는 아직 꺼져 있습니다(연결 준비 중). 아래 단계·날짜는 번호로 만든 예시입니다.
          </span>
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        {headline}
        <Chip tone={cur === 'fc' ? 'ok' : cur ? 'info' : 'neutral'}>{cur ? `지금: ${TRACK_STAGE_LABEL[cur]}` : '아직 기록 없음'}</Chip>
        {view.arrivalOn ? <span className="text-xs text-muted tnum">입항 {dateKo(view.arrivalOn)}</span> : null}
        {source ? <span className="text-xs text-muted">{source === 'unipass' ? '관세청 UNI-PASS 기준' : '예시(흉내) 기록'}</span> : null}
      </div>
      <TrackSteps steps={view.steps} />
      <div className="grid gap-3 md:grid-cols-2">
        <EstimateCard title="예상 통관(수리)일" icon={<CalendarClock className="size-3.5" aria-hidden />} e={view.clearance} doneLabel="수리" />
        <EstimateCard title="예상 FC 입고일" icon={<PackageCheck className="size-3.5" aria-hidden />} e={view.fc} doneLabel="FC 입고" untracked={!view.fcTracked} />
      </div>
      <p className="text-xs text-muted">예상일은 실측 분포로 셈한 참고치입니다 — 약속이 아닙니다. 한국 영업일(주말·공휴일 제외, 공휴일 목록 확인 필요) 기준.</p>
      {view.dist || view.sameDay ? (
        <div className="grid gap-4 rounded-md border border-line bg-surface p-4 md:grid-cols-[1fr_220px]">
          {view.dist ? <DistBars {...view.dist} /> : <p className="text-sm text-muted">같은 항구·방식 분포는 표본이 모이면 보입니다.</p>}
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-xs font-semibold text-muted">
              <Ship className="size-3.5" aria-hidden />
              같은 날 입항분
            </p>
            {view.sameDay ? (
              <>
                <p className="display mt-1 text-2xl tnum">{pct(view.sameDay.rate, 0)}</p>
                <p className="text-xs text-muted tnum">
                  {view.sameDay.total}건 중 {view.sameDay.cleared}건 수리
                </p>
              </>
            ) : (
              <p className="mt-1 text-sm text-muted">표본이 적어 숨겼습니다</p>
            )}
          </div>
        </div>
      ) : null}
      <section aria-labelledby="track-timeline">
        <h3 id="track-timeline" className="flex items-center gap-1.5 text-sm font-bold">
          <Clock className="size-4 text-muted" aria-hidden />
          처리 기록
        </h3>
        {view.timeline.length ? (
          <ol className="mt-2 divide-y divide-line-2 rounded-md border border-line bg-surface">
            {view.timeline.map((e, i) => (
              <li key={`${e.at}-${i}`} className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-0.5 px-4 py-2 text-sm">
                <span className="w-32 shrink-0 text-xs text-muted tnum">{dateTimeKo(e.at)}</span>
                <b className="min-w-0 break-words">{e.rawType}</b>
                {e.label && e.label !== e.rawType ? <Chip tone="neutral">{e.label}</Chip> : null}
                {e.summary ? <span className="min-w-0 break-words text-xs text-muted">{e.summary}</span> : null}
              </li>
            ))}
          </ol>
        ) : (
          <p className="mt-2 text-sm text-muted">아직 처리 기록이 없습니다. 적하목록이 제출되면 생깁니다.</p>
        )}
      </section>
    </div>
  );
}
