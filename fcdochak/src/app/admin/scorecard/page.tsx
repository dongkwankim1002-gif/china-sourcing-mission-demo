import Link from 'next/link';
import { asUser } from '@/lib/db';
import { requireViewer } from '@/lib/server/viewer';
import { adminScorecardStatus, customsCodes, DISPUTE_METRIC_LABEL, DISPUTE_STATUS_LABEL, disputeImpact, disputes, listBrokers, loadScorecardConfig, scorecardQuality } from '@/lib/server/scorecard';
import { env } from '@/lib/env';
import { normRef, SOURCE_LABEL, type NumberSource } from '@/lib/scorecard/engine';
import { switchState } from '@/lib/server/tracker';
import { sourceLine } from '@/lib/scorecard/engine';
import { AdminDisputeForm, AdminScorecardButtons, BrokerProfileForm, CodeLinker } from '@/components/scorecard/forms';
import { DemoChip } from '@/components/badges';
import { Chip, EmptyState, PageTitle, Panel, PanelHead } from '@/components/ui/core';
import { BIZ_TYPE_LABEL } from '@/lib/terms';
import { dateKo, dateTimeKo, num, pct } from '@/lib/format';

export const metadata = { title: '물류사 성적표 운영' };

export default async function AdminScorecardPage() {
  const v = await requireViewer('admin');
  const d = await asUser(v, async (q) => ({
    s: await adminScorecardStatus(q),
    cfg: await loadScorecardConfig(q),
    disputes: await disputes(q, null, 40),
    codes: await customsCodes(q),
    brokers: await listBrokers(q),
  }));
  const sw = switchState();
  // 이상치·귀속 충돌 화물 목록(실제 판 + 예시 판은 DEMO_MODE 일 때) · 이의마다 빠질 화물 수(받아들이기 전에 보인다)
  const [qReal, qDemo, impact] = await Promise.all([
    scorecardQuality(false),
    env.demoMode ? scorecardQuality(true) : Promise.resolve([]),
    disputeImpact(d.disputes.filter((x) => x.status === 'open' && x.cargo_ref).map((x) => x.cargo_ref!)),
  ]);
  const quality = [...qReal, ...qDemo];
  const { s, cfg } = d;
  const o = s.overall;
  const tile = 'min-w-0 rounded-md border border-line bg-surface p-4';
  const open = d.disputes.filter((x) => x.status === 'open');
  const closed = d.disputes.filter((x) => x.status !== 'open');
  return (
    <>
      <PageTitle
        title="물류사 성적표 운영"
        sub="자료 품질 · 이상치 · 이의 처리 · 관세청 화물운송주선업자 부호 연결 · 관세사 기본 정보. 계산 결과는 새 판으로만 쌓입니다."
        actions={<AdminScorecardButtons />}
      />
      <div className="mb-4 grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 lg:grid-cols-4">
        <div className={tile}>
          <p className="text-xs font-semibold text-muted">관세청 · 이름 공개</p>
          <p className="mt-1 flex flex-wrap gap-1.5">
            <Chip tone={sw.enabled ? 'ok' : 'neutral'}>{sw.enabled ? '관세청 켜짐' : '관세청 꺼짐 — 흉내'}</Chip>
            <Chip tone={cfg.publicNamed ? 'caution' : 'neutral'}>{cfg.publicNamed ? '이름 공개 켜짐' : '이름 공개 꺼짐'}</Chip>
          </p>
          <p className="mt-1 text-2xs text-muted">UNIPASS_ENABLED · 설정 scorecard.public_named</p>
        </div>
        <div className={tile}>
          <p className="text-xs font-semibold text-muted">전체 표본(최근 판)</p>
          <p className="display mt-1 text-2xl tnum">{num(o?.n ?? 0)}</p>
          <p className="text-2xs text-muted">{o ? sourceLine(o.sources) : s.computedAt ? '표본 없음(최근 판 0건 · 표본 기준 미만)' : '아직 셈하지 않음'}</p>
        </div>
        <div className={tile}>
          <p className="text-xs font-semibold text-muted">이상치 · 귀속 충돌</p>
          <p className="display mt-1 text-2xl tnum">{num(o?.sources.outliers ?? 0)}<span className="text-sm text-muted"> · {num(o?.sources.conflicts ?? 0)}</span></p>
          <p className="text-2xs text-muted">이상치 = 입항 → 수리 {cfg.rules.outlierDays}영업일 넘음(분위수에서 뺌) · 충돌 = 출처마다 다른 물류사</p>
        </div>
        <div className={tile}>
          <p className="text-xs font-semibold text-muted">제출 · 부호 · 이의</p>
          <p className="display mt-1 text-2xl tnum">{num(s.counts.submissions)}</p>
          <p className="text-2xs text-muted tnum">물류사 번호 {s.counts.partnerTracks}(진행 {s.counts.partnerOpen}) · 부호 연결 {s.counts.codesLinked} · 공식인데 부호 없음 {s.counts.codesMissing} · 열린 이의 {s.counts.disputesOpen}</p>
        </div>
      </div>
      <Panel className="mb-4">
        <PanelHead title="규칙" sub={<><Link href="/admin/settings" className="underline underline-offset-4">설정(scorecard.rules · scorecard.public_named)</Link>에서 새 판으로</>} />
        <p className="px-4 py-3 text-sm tnum">
          표본 기준 {cfg.rules.minSamples}건 · 기간 {cfg.rules.windowDays}일 · 인증 표본·등록 {cfg.rules.certifiedMinSamples}건 · 인증 제출률 {pct(cfg.rules.certifiedSubmissionBp / 10_000, 0)} · 이상치 {cfg.rules.outlierDays}영업일 · 추이 {cfg.rules.trendWeeks}주 · 출처{' '}
          {(['platform', 'seller', 'partner'] as const).filter((k) => cfg.rules.sources[k]).map((k) => ({ platform: '플랫폼 선적', seller: '셀러 등록', partner: '물류사 제출' })[k]).join('·')}
          {cfg.rules.example ? ' · 첫 판 가정치' : ''} · 최근 판 {s.computedAt ? `${dateTimeKo(s.computedAt)} ${s.rows}줄${o ? '' : ' — 표본 없음'}` : '없음'}
        </p>
      </Panel>
      <Panel className="mb-4">
        <PanelHead title={`이상치 · 귀속 충돌 화물 (${quality.length})`} sub={`이상치 = 입항 → 수리 ${cfg.rules.outlierDays}영업일 넘음(분위수에서 뺌 · 검사 비율에는 셈) · 충돌 = 출처마다 다른 물류사(귀속은 플랫폼 선적 > 셀러 등록 > 물류사 제출). 빼야 하면 그 업체의 이의를 받아들이거나 운영 판단을 적어 주세요.`} />
        {quality.length ? (
          <>
          <p className="px-4 pt-2 text-2xs text-muted md:hidden">표를 옆으로 넘기면 출처·귀속 업체·항구·입항 → 수리 칸이 더 있습니다.</p>
          <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="이상치·귀속 충돌 화물 표(옆으로 밀어 더 보기)">
            <table className="w-full min-w-[720px] text-sm" data-testid="admin-quality">
              <thead className="text-left text-xs text-muted">
                <tr className="border-b border-line-2">
                  <th scope="col" className="px-4 py-2">화물 번호</th>
                  <th scope="col" className="px-4 py-2">종류</th>
                  <th scope="col" className="px-4 py-2">출처</th>
                  <th scope="col" className="px-4 py-2">귀속 업체</th>
                  <th scope="col" className="px-4 py-2">항구 · 방식</th>
                  <th scope="col" className="px-4 py-2 text-right">입항 → 수리</th>
                </tr>
              </thead>
              <tbody>
                {quality.map((x) => (
                  <tr key={`${x.isDemo}-${x.key}`} className="border-b border-line-2 last:border-0">
                    <th scope="row" className="px-4 py-2 text-left font-mono text-xs font-normal break-all">{x.refs.join(' · ') || x.key}{x.isDemo ? <span className="ml-1 font-sans text-2xs text-muted">예시</span> : null}</th>
                    <td className="px-4 py-2"><Chip tone={x.kind === 'outlier' ? 'caution' : 'neutral'}>{x.kind === 'outlier' ? '이상치' : '귀속 충돌'}</Chip></td>
                    <td className="px-4 py-2 text-xs">{x.sources.map((k) => SOURCE_LABEL[k as NumberSource]).join(' · ')}</td>
                    <td className="px-4 py-2 text-xs">{x.partnerName ?? '—'}</td>
                    <td className="px-4 py-2 text-xs">{x.port ?? '—'} · {x.mode ?? '—'}</td>
                    <td className="px-4 py-2 text-right tnum">{x.days != null ? `${x.days}영업일` : '—'}<span className="block text-2xs text-muted">{x.arrival ?? '?'} → {x.cleared}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          </>
        ) : (
          <p className="px-4 py-3 text-sm text-muted">기간 안에 이상치·귀속 충돌 화물이 없습니다.</p>
        )}
      </Panel>
      <Panel className="mb-4">
        <PanelHead title="한 조직 쏠림" sub="한 조직이 그 업체 표본의 절반 이상을 등록 — 자동으로 빼지 않습니다(사람이 정할 일)" />
        {s.concentrated.length ? (
          <ul className="divide-y divide-line-2" data-testid="admin-concentrated">
            {s.concentrated.map((c) => (
              <li key={c.entity_org_id} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm">
                <b>{c.name}</b>
                <Chip tone="caution">한 조직 {pct(c.topRegistrantBp / 10_000, 0)}</Chip>
                <span className="text-xs text-muted tnum">표본 {c.n}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-4 py-3 text-sm text-muted">쏠린 업체가 없습니다.</p>
        )}
      </Panel>
      <Panel className="mb-4">
        <PanelHead title={`이의 처리 (${open.length})`} sub="받아들이면 이의에 적힌 화물을 빼고 곧바로 다시 셉니다. 처리 사유는 업체에게 보입니다." />
        {open.length ? (
          <ul className="divide-y divide-line-2" data-testid="admin-disputes">
            {open.map((x) => (
              <li key={x.id} className="grid gap-2 px-4 py-3 text-sm lg:grid-cols-[minmax(0,1fr)_minmax(0,380px)]">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2">
                    <b>{x.partner_name}</b>
                    {x.is_demo ? <DemoChip /> : null}
                    <Chip tone="neutral">{DISPUTE_METRIC_LABEL[x.metric ?? 'other']}</Chip>
                    {x.cargo_ref ? <span className="break-all font-mono text-xs">{x.cargo_ref}</span> : null}
                    <span className="text-2xs text-muted">{dateKo(x.created_at, { dow: false })}</span>
                  </p>
                  <p className="mt-1 text-muted">{x.body}</p>
                  {x.cargo_ref ? (
                    <p className="mt-1 text-xs" data-testid="dispute-impact">
                      {(() => {
                        const n = impact.get(normRef(x.cargo_ref)) ?? 0;
                        return n ? <>받아들이면 빠질 화물 <b className="tnum">{n}건</b>(번호가 똑같은 화물 — 모든 업체 판·전체 판에서)</> : <span className="text-caution">이 번호와 똑같은 화물이 없습니다 — 받아들여도 빠지는 화물이 없습니다</span>;
                      })()}
                    </p>
                  ) : (
                    <p className="mt-1 text-xs text-muted">화물번호가 없는 이의 — 받아들여도 숫자는 바뀌지 않습니다(운영 판단 기록)</p>
                  )}
                </div>
                <AdminDisputeForm id={x.id} />
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title="열린 이의가 없습니다" />
        )}
        {closed.length ? (
          <details className="border-t border-line-2">
            <summary className="cursor-pointer px-4 py-2.5 text-sm font-semibold">처리한 이의 {closed.length}건</summary>
            <ul className="divide-y divide-line-2">
              {closed.map((x) => (
                <li key={x.id} className="flex flex-wrap items-center gap-2 px-4 py-2 text-sm">
                  <Chip tone={x.status === 'accepted' ? 'ok' : x.status === 'rejected' ? 'stamp' : 'neutral'}>{DISPUTE_STATUS_LABEL[x.status]}</Chip>
                  <b>{x.partner_name}</b>
                  {x.cargo_ref ? <span className="break-all font-mono text-xs">{x.cargo_ref}</span> : null}
                  <span className="min-w-0 text-xs text-muted">{x.thread[x.thread.length - 1]?.body}</span>
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </Panel>
      <Panel className="mb-4">
        <PanelHead title="관세청 화물운송주선업자 부호 연결" sub="업체 ↔ 관세청 부호. 켜기 전에는 흉내 목록(예시 부호)이고, 연결·끊기는 새 판으로 쌓입니다(운영 확인). 연결 메모는 그 업체 구성원도 읽습니다 — 내부 판단은 적지 마세요." />
        <p className="px-4 pt-2 text-2xs text-muted md:hidden">표를 옆으로 넘기면 연결 칸(부호 고르기·메모)이 더 있습니다.</p>
        <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="부호 연결 표(옆으로 밀어 더 보기)">
          <table className="w-full min-w-[760px] text-sm" data-testid="admin-codes">
            <thead className="text-left text-xs text-muted">
              <tr className="border-b border-line-2">
                <th scope="col" className="px-4 py-2">업체</th>
                <th scope="col" className="px-4 py-2">지금 부호</th>
                <th scope="col" className="px-4 py-2">연결</th>
              </tr>
            </thead>
            <tbody>
              {d.codes.filter((c) => c.status !== 'public_info').map((c) => (
                <tr key={c.org_id} className="border-b border-line-2 align-top last:border-0">
                  <th scope="row" className="px-4 py-2 text-left">
                    <span className="font-semibold">{c.name}</span>
                    <span className="block text-2xs font-normal text-muted">{BIZ_TYPE_LABEL[c.business_type ?? ''] ?? ''}{c.is_demo ? ' · 예시' : ''}</span>
                  </th>
                  <td className="px-4 py-2">
                    {c.code ? (
                      <span className="grid gap-0.5">
                        <span className="font-mono text-xs">{c.code}</span>
                        <span className="text-2xs text-muted">{c.registered_name} · {c.source === 'mock' ? '흉내' : c.source === 'unipass' ? '관세청' : '운영 입력'} · {c.linked_at ? dateKo(c.linked_at, { dow: false }) : ''}</span>
                      </span>
                    ) : (
                      <Chip tone="caution">연결 안 됨</Chip>
                    )}
                  </td>
                  <td className="px-4 py-2">
                    <CodeLinker orgId={c.org_id} name={c.name} current={c.code} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
      <Panel>
        <PanelHead title="관세사 기본 정보" sub="공개 관세사 목록 API 를 확인하지 못해 운영자가 넣습니다(예시는 흉내). 고치면 새 판." />
        {d.brokers.length ? (
          <ul className="divide-y divide-line-2">
            {d.brokers.map((b) => (
              <li key={b.id} className="grid gap-2 px-4 py-3">
                <p className="flex flex-wrap items-center gap-2 text-sm">
                  <Link href={`/brokers/${b.id}`} className="font-semibold underline underline-offset-4">{b.name}</Link>
                  <Chip tone="neutral">{b.profile_source === 'admin' ? '운영 입력' : b.profile_source === 'mock' ? '흉내' : '입력 전'}</Chip>
                </p>
                <BrokerProfileForm orgId={b.id} initial={{ registrationNo: b.registration_no, offices: b.customs_offices ?? [], ports: b.ports ?? [], specialties: b.specialties }} />
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title="관세사 업체가 없습니다" />
        )}
      </Panel>
    </>
  );
}
