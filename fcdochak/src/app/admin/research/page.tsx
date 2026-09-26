import Link from 'next/link';
import { AlertTriangle, CheckCircle2, HelpCircle, Mic, Quote } from 'lucide-react';
import { asUser } from '@/lib/db';
import { requireViewer } from '@/lib/server/viewer';
import { researchBoard } from '@/lib/server/research';
import { getReference } from '@/lib/server/reference';
import { DemoChip } from '@/components/badges';
import { DemoToggle } from '@/components/demo-toggle';
import { Chip, EmptyState, PageTitle, Panel, PanelHead, type Tone } from '@/components/ui/core';
import { FunnelBars, INCLUDES_LABEL, RankBars, VolumeCurves, WtpBars } from '@/components/research/board-charts';
import { ContactCell, LinkCell, ParticipantForm, VendorQuoteForm } from '@/components/research/admin-forms';
import { VERDICT_LABEL, type Verdict } from '@/lib/money/research';
import { COUNTER_LABEL, METHOD_LABEL, ONESTOP_LABEL, PAIN_LABEL, PAST_EXTRA_LABEL, PROGRESS_LABEL, SCREEN_LABEL, stepRatio, STEP_LABEL, type Step } from '@/lib/research/answers';
import { dateKo, dateTimeKo, num, pct } from '@/lib/format';
import { RESEARCH_ACTION } from '@/lib/terms';

export const metadata = { title: '셀러 인터뷰 · 결정 보드' };

const bpPct = (bp: number | null | undefined, d = 0) => (bp == null ? '—' : pct(bp / 10000, d));
const TONE: Record<Verdict, Tone> = { met: 'ok', not_met: 'stamp', insufficient: 'neutral' };
const ICON: Record<Verdict, React.ReactNode> = { met: <CheckCircle2 aria-hidden />, not_met: <AlertTriangle aria-hidden />, insufficient: <HelpCircle aria-hidden /> };
const PTONE: Record<string, Tone> = { done: 'ok', in_progress: 'label', opened: 'info', invited: 'neutral', not_invited: 'neutral', declined: 'stamp' };
const TIER: Record<string, string> = { t1: '월 1건 이하', t2: '월 2~3건', t3: '월 4건 이상' };
const SRC: Record<string, string> = { self: '셀러 혼자(링크)', interviewer: '통화(대신 적기)' };
const QKIND: Record<string, string> = { comment: '자유 의견', oneStop: '원스톱 배대지', why: '화면 반응' };

function VerdictChip({ v, testid }: { v: Verdict; testid?: string }) {
  return (
    <span data-testid={testid} data-verdict={v}>
      <Chip tone={TONE[v]} icon={ICON[v]}>{VERDICT_LABEL[v]}</Chip>
    </span>
  );
}

export default async function ResearchBoardPage({ searchParams }: { searchParams: Promise<{ demo?: string }> }) {
  const sp = await searchParams;
  const v = await requireViewer('admin', '/admin/research');
  // 예시 자료는 데모 운영 계정에서만 기본으로 넣는다 — 실제 운영자의 판정에는 기본으로 빠진다(토글로 바꿈)
  const includeDemo = sp.demo === '1' ? true : sp.demo === '0' ? false : v.org.is_demo;
  const [d, ref] = await Promise.all([asUser(v, (q) => researchBoard(q, 30, { includeDemo })), getReference()]);
  const r = d.rules;
  const t = d.wtp.threshold.confirmed;
  const vendorVerdict = d.vendor.verdict;
  return (
    <>
      <PageTitle
        title="셀러 인터뷰 · 결정 보드"
        sub="분석의 「먼저 검증할 실험」 셋을 한 화면에서 봅니다. 링크는 복사해 직접 전하고(발송 없음), 판정선은 설정 research.rules 에서 바꿉니다."
        actions={
          <>
            <a href="#add-participant" className="text-sm font-semibold underline underline-offset-4">{RESEARCH_ACTION.addParticipant}</a>
            <Link href="/admin/settings" className="text-sm font-semibold underline underline-offset-4">판정선 바꾸기</Link>
            <DemoToggle include={includeDemo} href={(x) => (x ? '/admin/research?demo=1' : '/admin/research?demo=0')} />
          </>
        }
      />

      {/* 판정 셋 */}
      <ul className="mb-6 grid gap-3 lg:grid-cols-3" aria-label="실험 판정">
        <li className="min-w-0 rounded-md border border-line bg-surface p-4" data-testid="verdict-wtp">
          <p className="text-xs font-semibold text-muted">실험 ① 확정가 지불 의향</p>
          <p className="mt-1 text-base font-bold">
            +{bpPct(r.thresholdBp)} 이상 비율 <span className="tnum">{bpPct(t?.confirmedBp)}</span>
            <span className="text-xs font-normal text-muted tnum"> ({t?.confirmed ?? 0}/{d.wtp.n}명)</span>
          </p>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-sm">
            방안 A <VerdictChip v={d.wtp.verdict} testid="wtp-verdict" />
            {d.inProgressAnswered ? <span className="text-2xs font-normal text-muted">끝내지 않은 {d.inProgressAnswered}명은 빼고 셈</span> : null}
            {d.wtp.verdict === 'met' ? <Chip tone={d.wtp.strong ? 'ok' : 'caution'}>{d.wtp.strong ? '95% 구간 아래 끝도 넘음' : '약한 충족 — 더 모으기'}</Chip> : null}
          </p>
          <p className="mt-2 text-2xs text-muted">
            기준: 반대 질문을 통과한 +{bpPct(r.thresholdBp)} 이상 「예」가 {bpPct(r.majorityBp)} 초과 · 표본 {r.minSample}명 이상. 말로 한 의향 {bpPct(d.wtp.threshold.stated?.statedBp)} · 흔들림 {d.wtp.wavered}명
          </p>
        </li>
        <li className="min-w-0 rounded-md border border-line bg-surface p-4" data-testid="verdict-upload" data-visitors={d.funnel.counts.visitors}>
          <p className="text-xs font-semibold text-muted">실험 ② 청구서 점검 업로드 비율(최근 {d.funnel.days}일)</p>
          <p className="mt-1 text-base font-bold">
            점검까지 <span className="tnum">{bpPct(d.funnel.upload.runBp, 1)}</span>
            <span className="text-xs font-normal text-muted tnum"> ({num(Math.min(d.funnel.counts.runners, d.funnel.counts.visitors))}/{num(d.funnel.counts.visitors)}대)</span>
          </p>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-sm">점검 입구 <VerdictChip v={d.funnel.upload.verdict} testid="upload-verdict" /></p>
          <p className="mt-2 text-2xs text-muted">기준: 방문 기기 {num(r.uploadMinVisitors)}대 이상에서 {bpPct(r.uploadTargetBp)} 이상 · 로그인 화주 보관 {num(d.funnel.savedChecks)}건(같은 기간)</p>
          <p className={`mt-1 text-2xs ${d.funnel.outliers.heavy ? 'text-caution' : 'text-muted'}`} data-testid="funnel-outliers">
            살필 기기: 20번 넘게 들어온 기기 {num(d.funnel.outliers.heavy)}대(가장 많이 {num(d.funnel.outliers.max_events)}번) · 방문만 한 기기 {num(d.funnel.outliers.visit_only)}대 — 판정 전에 부풀린 방문이 없는지 봅니다
          </p>
        </li>
        <li className="min-w-0 rounded-md border border-line bg-surface p-4" data-testid="verdict-vendor">
          <p className="text-xs font-semibold text-muted">실험 ③ 콘솔사 물량 단가</p>
          <p className="mt-1 text-base font-bold">
            {d.vendor.consolidation.length ? (
              d.vendor.consolidation.map((c) => (
                <span key={c.includes} className="mr-3 inline-block">
                  {INCLUDES_LABEL[c.includes]} <span className="tnum">{c.discountBp == null ? '—' : `${bpPct(c.discountBp)} 쌈`}</span>
                </span>
              ))
            ) : (
              <span>단가 없음</span>
            )}
          </p>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-sm">공동 혼적 <VerdictChip v={vendorVerdict} testid="vendor-verdict" /></p>
          <p className="mt-2 text-2xs text-muted">기준: 콘솔사 {r.consolidationVolumeCbm} CBM 이상 중간값이 포워더 {r.consolidationBaseCbm} CBM 이하보다 {bpPct(r.consolidationDiscountBp)} 이상 쌈 · 양쪽 {r.consolidationMinQuotes}건 이상 · 같은 포함 범위끼리</p>
        </li>
      </ul>
      <p className="mb-6 rounded-md border border-caution/40 bg-caution-bg px-4 py-2.5 text-sm text-caution">
        판정은 결정의 근거 중 하나입니다 — 지불 의향은 말로 한 것이라 실제 결제보다 부풀려집니다. 읽는 법은 docs/research-plan.md 5절. 사람이 정할 일: 판정선 확정 · 동의 문구 법률 검토 · 외부 셀러가 링크를 열 수 있게 할지(v2 미리보기는 Vercel 로그인 필요).
      </p>

      {/* 대상 · 진행 */}
      <Panel className="mb-6">
        <PanelHead
          title={`대상 ${d.progress.total}명`}
          sub={`끝 ${d.progress.done} · 진행 중 ${d.progress.inProgress} · 동의 안 함 ${d.progress.declined} · 링크는 만들 때 한 번만 보입니다(해시만 저장)`}
        />
        {d.participants.length ? (
          <div className="relative overflow-x-auto">
            <table className="w-full min-w-[980px] text-sm" data-testid="participants">
              <caption className="sr-only">인터뷰 대상과 진행</caption>
              <thead className="bg-surface-2 text-left text-xs text-muted">
                <tr>
                  <th scope="col" className="px-4 py-2 font-semibold">번호</th>
                  <th scope="col" className="px-4 py-2 font-semibold">부르는 이름</th>
                  <th scope="col" className="px-4 py-2 font-semibold">기준</th>
                  <th scope="col" className="px-4 py-2 font-semibold">연락처</th>
                  <th scope="col" className="px-4 py-2 font-semibold">동의</th>
                  <th scope="col" className="px-4 py-2 font-semibold">진행</th>
                  <th scope="col" className="px-4 py-2 font-semibold">링크</th>
                  <th scope="col" className="px-4 py-2 font-semibold"><span className="sr-only">통화</span></th>
                </tr>
              </thead>
              <tbody>
                {d.participants.map((p) => {
                  const rc = p.recruit;
                  const fits = rc.chinaSourcing && rc.rocketGrowth && rc.lcl;
                  return (
                    <tr key={p.id} className="border-t border-line-2 align-top" data-testid={`participant-${p.code}`} data-progress={p.progress}>
                      <td className="whitespace-nowrap px-4 py-2 font-mono text-xs">{p.code}</td>
                      <td className="px-4 py-2">
                        <span className="flex flex-wrap items-center gap-1.5 font-semibold">{p.label}{p.is_demo ? <DemoChip /> : null}</span>
                        {p.scheduled_at ? <span className="text-2xs text-muted">{dateTimeKo(p.scheduled_at)}</span> : null}
                      </td>
                      <td className="px-4 py-2 text-xs">
                        {fits ? <Chip tone="ok">기준 맞음</Chip> : <Chip tone="caution">기준 밖</Chip>}
                        <span className="mt-1 block text-2xs text-muted">{rc.monthlyShipments != null ? `월 ${rc.monthlyShipments}건` : '월 선적 모름'}{rc.channel ? ` · ${rc.channel}` : ''}</span>
                      </td>
                      <td className="px-4 py-2"><ContactCell id={p.id} masked={p.contact_masked} /></td>
                      <td className="whitespace-nowrap px-4 py-2 text-xs">
                        {p.consent_state === 'agreed' ? `동의 · ${p.consent_method === 'verbal' ? '구두' : '스스로'}` : p.consent_state === 'none' ? '—' : p.consent_state === 'declined' ? '거부' : '철회'}
                        {p.consent_at ? <span className="block text-2xs text-muted">{dateKo(p.consent_at, { dow: false })}</span> : null}
                      </td>
                      <td className="px-4 py-2">
                        <Chip tone={PTONE[p.progress]}>{PROGRESS_LABEL[p.progress]}</Chip>
                        <span className="mt-1 block h-1 w-24 rounded-xs bg-line" aria-hidden>
                          <span className="block h-1 rounded-xs bg-ink" style={{ width: `${stepRatio(p.completed ? 'done' : p.head_step) * 100}%` }} />
                        </span>
                        {p.head_step && !p.completed ? <span className="text-2xs text-muted">{STEP_LABEL[p.head_step as Step]}까지 · {SRC[p.head_source ?? 'self']}</span> : p.completed ? <span className="text-2xs text-muted">{SRC[p.head_source ?? 'self']}</span> : null}
                      </td>
                      <td className="px-4 py-2">
                        {p.completed || p.progress === 'declined' ? (
                          <span className="text-2xs text-muted">{p.completed ? '끝나서 닫힘' : '—'}</span>
                        ) : (
                          <>
                            <LinkCell id={p.id} code={p.code} hasOpen={!!p.open_invite_expires} disabled={false} />
                            {p.open_invite_expires ? <span className="mt-1 block text-2xs text-muted">열린 링크 {dateKo(p.open_invite_expires, { dow: false })}까지</span> : null}
                          </>
                        )}
                      </td>
                      <td className="px-4 py-2">
                        {p.progress !== 'declined' ? (
                          <Link href={`/admin/research/${p.id}/conduct`} className="inline-flex items-center gap-1 whitespace-nowrap text-xs font-semibold underline underline-offset-4">
                            <Mic className="size-3.5" aria-hidden /> {p.completed ? '답 보기·고치기' : RESEARCH_ACTION.conduct}
                          </Link>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState title="아직 대상이 없습니다" body="아래에서 대상을 넣고 링크를 만들거나, 통화하며 대신 적으세요." />
        )}
      </Panel>

      <div className="mb-6"><ParticipantForm /></div>

      {/* 보관 기간 · 지울 대상 */}
      <Panel className="mb-6">
        <PanelHead
          title="지울 대상"
          sub={`동의 문구의 약속 — 보관 ${r.retentionDays}일이 지났거나 철회한 참여자의 답은 운영 담당이 지웁니다(자동 삭제 없음 · 절차 docs/research-plan.md 7절)`}
        />
        {d.retention.expired.length || d.retention.withdrawn.length ? (
          <ul className="divide-y divide-line-2 text-sm" data-testid="retention-due">
            {[...d.retention.expired.map((p) => ({ p, why: `보관 ${r.retentionDays}일 지남` })), ...d.retention.withdrawn.map((p) => ({ p, why: '철회함' }))].map(({ p, why }) => (
              <li key={`${p.id}-${why}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2">
                <span className="font-mono text-xs">{p.code}</span>
                <span className="font-semibold">{p.label}</span>
                {p.is_demo ? <DemoChip /> : null}
                <Chip tone="caution">{why}</Chip>
                {p.completed_at ? <span className="text-2xs text-muted">끝낸 날 {dateKo(p.completed_at, { dow: false })}</span> : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-4 py-3 text-sm text-muted" data-testid="retention-due">지금 지울 대상은 없습니다. 삭제 요청을 받으면 통화 화면에서 「철회」로 적어 두세요 — 여기에 올라옵니다.</p>
        )}
      </Panel>

      {/* 실험 ① */}
      <div className="mb-6 grid gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Panel>
          <PanelHead title="확정가 지불 의향 곡선" sub={`사다리 ${r.ladderBp.map((b) => `+${bpPct(b)}`).join(' → ')} · 처음 「아니오」에서 멈춤 · 사다리에 답한 ${d.wtp.n}명`} />
          <div className="p-4">
            {d.wtp.n ? <WtpBars curve={d.wtp} majorityBp={r.majorityBp} thresholdBp={r.thresholdBp} /> : <EmptyState title="사다리 답이 아직 없습니다" />}
            {d.wtp.inconsistent ? <p className="mt-2 text-xs text-caution">모순 답(「아니오」 뒤 「예」) {d.wtp.inconsistent}명 — 이어진 「예」까지만 셌습니다.</p> : null}
            {d.wtp.gapBp != null && d.wtp.gapBp >= 1500 ? <p className="mt-2 text-xs text-caution">말로 한 의향과 확인된 의향이 {bpPct(d.wtp.gapBp)}p 벌어졌습니다 — 좋아 보이지만 망설이는 신호.</p> : null}
          </div>
        </Panel>
        <Panel>
          <PanelHead title="나눠 보기" sub={`+${bpPct(r.thresholdBp)} 이상 확인된 의향 · 3명 미만인 칸은 읽지 않습니다`} />
          <ul className="grid gap-2 p-4 text-sm" data-testid="wtp-split">
            {[...d.byTier.map((x) => ({ k: TIER[x.tier], c: x.curve })), ...d.bySource.map((x) => ({ k: SRC[x.source], c: x.curve }))].map(({ k, c }) => {
              const s = c.threshold.confirmed;
              return (
                <li key={k} className="flex flex-wrap items-center justify-between gap-2 border-b border-line-2 pb-2 last:border-0">
                  <span>{k}</span>
                  <span className="tnum">{c.n < 3 ? <span className="text-muted">{c.n}명 — 적음</span> : <><b>{bpPct(s?.confirmedBp)}</b> <span className="text-2xs text-muted">({s?.confirmed ?? 0}/{c.n})</span></>}</span>
                </li>
              );
            })}
          </ul>
          <div className="border-t border-line-2 p-4">
            <p className="mb-2 text-xs font-semibold text-muted">보조 신호(판정에 안 넣음)</p>
            <ul className="grid gap-1 text-sm">
              <li className="flex justify-between gap-2"><span>시범 대기 명단 「예」</span><span className="tnum"><b>{d.signals.pilot.yes}</b>/{d.signals.pilot.n}명</span></li>
              {d.signals.pastExtra.slice(0, 5).map((x) => (
                <li key={x.key} className="flex justify-between gap-2"><span className="text-muted">지난 6개월 추가 청구 {PAST_EXTRA_LABEL[x.key]}</span><span className="tnum">{x.n}명</span></li>
              ))}
              {d.signals.counter.map((x) => (
                <li key={x.key} className="flex justify-between gap-2"><span className="text-muted">반대 질문 「{COUNTER_LABEL[x.key]}」</span><span className="tnum">{x.n}명</span></li>
              ))}
              {d.signals.shownVsMax.length ? (
                <li className="flex justify-between gap-2">
                  <span className="text-muted">본 참고 프리미엄보다 한도가 낮은 사람</span>
                  <span className="tnum">{d.signals.shownVsMax.filter((x) => x.max < x.shown).length}/{d.signals.shownVsMax.length}명</span>
                </li>
              ) : null}
            </ul>
          </div>
        </Panel>
      </div>

      {/* 불편·방식·화면 */}
      <div className="mb-6 grid gap-4 lg:grid-cols-3">
        <Panel>
          <PanelHead title="불편 1위" sub="한 사람 하나" />
          <div className="p-4">
            {d.pain.some((x) => x.n) ? <RankBars testid="pain-rank" caption="불편 순위" rows={d.pain.filter((x) => x.n).map((x) => ({ label: PAIN_LABEL[x.key], n: x.n, bp: x.bp }))} /> : <EmptyState title="답이 없습니다" />}
          </div>
        </Panel>
        <Panel>
          <PanelHead title="지금 쓰는 방식 · 원스톱 배대지" />
          <div className="grid gap-4 p-4">
            <RankBars caption="지금 쓰는 방식" rows={d.method.filter((x) => x.n).map((x) => ({ label: METHOD_LABEL[x.key], n: x.n, bp: x.bp }))} />
            <RankBars caption="원스톱 배대지 경험" rows={d.oneStop.filter((x) => x.n).map((x) => ({ label: ONESTOP_LABEL[x.key], n: x.n, bp: x.bp }))} />
          </div>
        </Panel>
        <Panel>
          <PanelHead title="화면 셋 쓸모(1~5)" sub="4·5 점 비율 · 평균" />
          <ul className="grid gap-3 p-4" data-testid="screen-scores">
            {d.screens.map(({ key, s }) => (
              <li key={key} className="min-w-0">
                <p className="flex justify-between gap-2 text-sm"><span className="font-semibold">{SCREEN_LABEL[key]}</span><span className="tnum">{s.mean ?? '—'}점 · 4·5 점 <b>{bpPct(s.topBoxBp)}</b> <span className="text-2xs text-muted">({s.n}명)</span></span></p>
                <div className="mt-1 flex h-3 gap-0.5" aria-hidden>
                  {s.dist.map((n, i) => (
                    <span key={i} className="rounded-xs bg-[var(--chart-1)]" style={{ flexGrow: n, opacity: 0.35 + i * 0.16 }} title={`${i + 1}점 ${n}명`} />
                  ))}
                </div>
                <p className="sr-only">{s.dist.map((n, i) => `${i + 1}점 ${n}명`).join(', ')}</p>
              </li>
            ))}
          </ul>
        </Panel>
      </div>

      <Panel className="mb-6">
        <PanelHead title={`인용 모음 ${d.quotes.length}개`} sub="인용을 허락한 사람의 말만 · 이름 없이 번호로" />
        {d.quotes.length ? (
          <ul className="grid gap-3 p-4 md:grid-cols-2" data-testid="quotes">
            {d.quotes.slice(0, 24).map((q, i) => (
              <li key={i} className="flex min-w-0 gap-2 rounded-sm border border-line-2 p-3 text-sm">
                <Quote className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden />
                <div className="min-w-0">
                  <p className="break-words">{q.text}</p>
                  <p className="mt-1 text-2xs text-muted">{q.code} · {QKIND[q.kind]}{q.screen ? ` — ${SCREEN_LABEL[q.screen as keyof typeof SCREEN_LABEL]}` : ''}</p>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title="인용할 말이 없습니다" />
        )}
      </Panel>

      {/* 실험 ② */}
      <Panel className="mb-6">
        <PanelHead title={`실험 ② 청구서 점검 퍼널 — 최근 ${d.funnel.days}일`} sub="기기 수(브라우저 무작위 번호의 해시만 저장 · IP·계정·청구서 내용 없음)" />
        <div className="grid gap-4 p-4 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <FunnelBars read={d.funnel.upload} />
          <div className="text-sm">
            <p className="mb-2 text-xs font-semibold text-muted">입력 방법별(기기)</p>
            {d.funnel.byMethod.length ? (
              <ul className="grid gap-1">
                {d.funnel.byMethod.map((m) => (
                  <li key={m.method} className="flex justify-between"><span>{m.method === 'paste' ? '표 붙여넣기' : m.method === 'excel' ? '엑셀 올리기' : '직접 입력'}</span><span className="tnum">{num(m.n)}대</span></li>
                ))}
              </ul>
            ) : <p className="text-muted">아직 없습니다</p>}
            {d.funnel.upload.runCi ? <p className="mt-3 text-2xs text-muted">점검까지 비율 95% 구간 {bpPct(d.funnel.upload.runCi[0], 1)}~{bpPct(d.funnel.upload.runCi[1], 1)}</p> : null}
          </div>
        </div>
      </Panel>

      {/* 실험 ③ */}
      <Panel className="mb-6">
        <PanelHead title="실험 ③ 물량별 단가 곡선" sub="콘솔사·포워더에게 받은 CBM 당 단가(운영이 넣음, 공개하지 않음) · 새 판이 나오면 옛 판은 빠집니다" />
        <div className="p-4">
          {d.vendor.curves.length ? <VolumeCurves curves={d.vendor.curves} /> : <EmptyState title="아직 받은 단가가 없습니다" body="아래 폼에 통화·메일·견적서로 받은 단가를 넣으세요." />}
          {d.vendor.consolidation.length ? (
            <ul className="mt-4 grid gap-2 text-sm" data-testid="consolidation">
              {d.vendor.consolidation.map((c) => (
                <li key={c.includes} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <b>{INCLUDES_LABEL[c.includes]}</b>
                  <span className="tnum text-muted">콘솔사 {r.consolidationVolumeCbm} CBM~ {c.big.median == null ? '—' : `${num(c.big.median)}원`}({c.big.n}건) · 포워더 ~{r.consolidationBaseCbm} CBM {c.small.median == null ? '—' : `${num(c.small.median)}원`}({c.small.n}건)</span>
                  <VerdictChip v={c.verdict} />
                </li>
              ))}
            </ul>
          ) : null}
        </div>
        <div className="border-t border-line-2">
          <VendorQuoteForm hubs={ref.hubs.map((h) => ({ code: h.code, name_ko: h.name_ko }))} ports={ref.ports.map((p) => ({ code: p.code, name_ko: p.name_ko }))} />
        </div>
        {d.vendor.rows.length ? (
          <details className="border-t border-line-2 px-4 py-3 text-sm">
            <summary className="cursor-pointer text-xs font-semibold text-muted">받은 단가 {d.vendor.rows.length}건 보기</summary>
            <div className="relative mt-2 overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm tnum">
                <caption className="sr-only">받은 물량 단가</caption>
                <thead className="text-left text-xs text-muted"><tr><th scope="col" className="py-1">업체</th><th scope="col">종류</th><th scope="col">범위</th><th scope="col" className="text-right">물량</th><th scope="col" className="text-right">CBM 당</th><th scope="col">받은 날</th><th scope="col">메모</th></tr></thead>
                <tbody>
                  {d.vendor.rows.map((x) => (
                    <tr key={x.id} className="border-t border-line-2">
                      <td className="py-1">{x.vendor_label}</td>
                      <td>{x.vendor_kind === 'consolidator' ? '콘솔사' : '포워더'}</td>
                      <td>{INCLUDES_LABEL[x.includes]}</td>
                      <td className="text-right">{num(x.volume_cbm, 1)} CBM</td>
                      <td className="text-right">{num(x.unit_price_krw)}원</td>
                      <td>{x.quoted_on}</td>
                      <td className="text-xs text-muted">{x.note ?? ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        ) : null}
      </Panel>
    </>
  );
}
