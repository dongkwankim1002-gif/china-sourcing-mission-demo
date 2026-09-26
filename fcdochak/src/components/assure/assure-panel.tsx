/**
 * 「확정가로 받기」 카드 — 화주 비교·요청 화면.
 * 스위치가 꺼져 있으면 참고 확정가와 「관심 등록」만. 켜져 있어도 실제 계약·결제는 없고, 사람이 정할 일을 적는다.
 */
import type { ReactNode } from 'react';
import { AlertTriangle, Handshake, Info, ShieldCheck } from 'lucide-react';
import { Chip } from '@/components/ui/core';
import { ASSURE_HUMAN_TODO, ASSURE_KIND_LABEL, type AssureKind } from '@/lib/assure-settings';
import type { AssureView, FirmQuoteRow } from '@/lib/server/assure';
import type { ContractParty } from '@/lib/server/alliance';
import { dateKo, num, pct } from '@/lib/format';
import { FirmQuoteButton, InterestButton, type AssureCtx } from './buttons';

const bpPct = (bp: number, digits = 1) => pct(bp / 10000, digits);

export function AssurePanel({ view, mine, ctx, current, sampleLabel, modeLabel, party }: { view: AssureView; mine: AssureKind[]; ctx: AssureCtx; current: FirmQuoteRow | null; sampleLabel: string; modeLabel?: string | null; /** v2 alliance — 확정가 계약 상대(없으면 「제휴 주선사 확정 전」) */ party?: ContractParty | null }) {
  const { config, firm, coverage, deferred } = view;
  const on = config.on;
  const anyOn = Object.values(on).some(Boolean);
  const has = (k: AssureKind) => mine.includes(k);
  const title = on.firm ? '확정가로 받기(시범)' : '확정가로 받기(시범 준비 중)';
  return (
    <section aria-labelledby="assure-title" data-testid="assure-card" className="mt-4 min-w-0 rounded-md border border-line bg-surface">
      <div className="flex flex-wrap items-start justify-between gap-2 border-b border-line-2 px-4 py-3">
        <div className="min-w-0">
          <h2 id="assure-title" className="flex flex-wrap items-center gap-2 text-base font-bold">
            <ShieldCheck className="size-4 text-muted" aria-hidden /> {title}
          </h2>
          <p className="text-xs text-muted">
            업체마다 다른 총액의 흔들림을 값에 미리 넣어, 나중에 더 나오지 않는 한 가지 가격으로 받는 방식입니다. {on.firm ? '지금은 시범 견적 기록까지만 합니다.' : '지금은 참고 숫자만 보여 드리고 관심 등록을 받습니다.'}
          </p>
        </div>
        <Chip tone={on.firm ? 'label' : 'neutral'}>{on.firm ? '시범' : '준비 중'}</Chip>
      </div>

      <div className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="min-w-0" data-testid="assure-firm">
          {!config.firmRates ? (
            <p className="text-sm text-muted">확정가 요율 설정이 아직 없습니다.</p>
          ) : !firm || !firm.ok ? (
            <p className="text-sm text-muted">같은 조건에서 견줄 {sampleLabel} 총액이 없어 참고 확정가를 낼 수 없습니다.</p>
          ) : (
            <>
              <p className="text-xs font-semibold text-muted">{on.firm ? '시범 확정가' : '참고 확정가'}</p>
              <p className="mt-0.5 text-xl font-bold tnum">{num(firm.firmPrice)}원</p>
              <p className="mt-1 text-xs text-muted tnum">
                기준 총액(같은 조건 {sampleLabel} {firm.stats.n}곳{modeLabel ? ` · ${modeLabel}` : ''} 중간값) {num(firm.base)}원 + 초과 위험 프리미엄 {num(firm.premium)}원({bpPct(firm.premiumBp)}) · 신뢰수준 {bpPct(firm.confidenceBp, 0)}
              </p>
              <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-2xs tnum sm:grid-cols-4">
                {([
                  ['표본', `${firm.stats.n}곳`],
                  ['최저', `${num(firm.stats.min)}원`],
                  [`상위 ${bpPct(10000 - firm.confidenceBp, 0)} 경계`, `${num(firm.stats.upper)}원`],
                  ['변동계수', bpPct(firm.stats.cvBp)],
                ] as const).map(([k, val]) => (
                  <div key={k} className="min-w-0">
                    <dt className="text-muted">{k}</dt>
                    <dd className="font-semibold">{val}</dd>
                  </div>
                ))}
              </dl>
              <div className="mt-2 flex flex-wrap gap-1">
                {firm.lowSample ? <Chip tone="caution" icon={<AlertTriangle aria-hidden />}>표본 적음 — 최소 프리미엄 적용</Chip> : null}
                {firm.stats.stdev === 0 ? <Chip tone="neutral">총액이 모두 같음 — 최소 프리미엄만</Chip> : null}
                {!firm.offerable ? <Chip tone="stamp" icon={<AlertTriangle aria-hidden />}>변동폭이 커서 시범 대상 아님</Chip> : null}
              </div>
              {current ? (
                <p className="mt-2 rounded-sm bg-surface-2 px-3 py-2 text-xs tnum" data-testid="assure-current">
                  기록한 시범 견적 <b>{current.quote_no}</b>{current.version > 1 ? ` v${current.version}` : ''} · {num(current.firm_price)}원 · {dateKo(current.valid_until, { dow: false })}까지 · 계약·결제 없음
                </p>
              ) : null}
            </>
          )}
          <PartyLine party={party ?? null} reference={!on.firm} />
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {on.firm && firm?.ok && firm.offerable ? <FirmQuoteButton ctx={ctx} again={!!current} /> : null}
            <InterestButton kind="firm" label={ASSURE_KIND_LABEL.firm} ctx={ctx} shown={firm?.ok ? firm.firmPrice : null} done={has('firm')} pilot={on.firm} />
          </div>
        </div>

        <ul className="grid min-w-0 content-start gap-2" aria-label="함께 준비 중인 것">
          <AssureRow
            kind="coverage"
            on={on.coverage}
            body={
              coverage ? (
                <>
                  {coverage.partnerName} 기준 참고 보장료 <b className="tnum">{num(coverage.fee)}원</b> — 보장 금액 {num(coverage.coveredAmount)}원(국내 창고·FC 운송) × 회송률 {bpPct(coverage.rateBp)}
                  {coverage.shipments ? ` (최근 30일 ${coverage.shipments}건 중 ${coverage.returns}건 회송, 실측 비중 ${bpPct(coverage.credibilityBp, 0)})` : ' (실측 없음 — 시장 기본값)'}
                  {!coverage.offerable ? <span className="font-semibold text-stamp"> · 회송률이 높아 보장 대상 아님</span> : null}
                </>
              ) : (
                'FC 입고가 반려돼 회송되면 다시 드는 비용을 물어 주는 방식입니다.'
              )
            }
            ctx={ctx}
            shown={coverage?.fee}
            done={has('coverage')}
          />
          <AssureRow
            kind="deferred"
            on={on.deferred}
            body={
              deferred ? (
                <>
                  {num(deferred.amount)}원을 {deferred.termDays}일 뒤에 내면 참고 수수료 <b className="tnum">{num(deferred.fee)}원</b>
                  {!deferred.withinLimit ? <span className="font-semibold text-caution"> · 한 건 한도를 넘습니다</span> : null}
                </>
              ) : (
                '물류비를 입고·판매 뒤에 내는 방식입니다.'
              )
            }
            ctx={ctx}
            shown={deferred?.fee}
            done={has('deferred')}
          />
          <AssureRow kind="consolidation" on={on.consolidation} body="같은 구간·같은 주의 화물을 모아 한 번에 보내 단가를 낮추는 방식입니다." ctx={ctx} done={has('consolidation')} />
        </ul>
      </div>

      <div className="flex items-start gap-2 border-t border-line-2 px-4 py-2.5 text-2xs text-muted" data-testid="assure-notice">
        <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        {anyOn ? (
          <span>
            시범이어도 <b className="text-text">실제 계약·결제는 없습니다.</b> 사람이 정할 일: 주선업 등록·보험사·금융사 제휴 —{' '}
            {(Object.keys(on) as AssureKind[]).filter((k) => on[k]).map((k) => `${ASSURE_KIND_LABEL[k]}은 ${ASSURE_HUMAN_TODO[k]}`).join(' · ')}.
          </span>
        ) : (
          <span>참고 숫자이며 계약·결제·보장이 아닙니다. 운송계약은 지금처럼 업체와 직접 맺습니다. 관심 등록은 연락처를 밖으로 보내지 않습니다.</span>
        )}
      </div>
    </section>
  );
}

function AssureRow({ kind, on, body, ctx, shown, done }: { kind: AssureKind; on: boolean; body: ReactNode; ctx: AssureCtx; shown?: number | null; done: boolean }) {
  return (
    <li className="flex min-w-0 flex-wrap items-start justify-between gap-2 rounded-sm border border-line-2 px-3 py-2">
      <div className="min-w-0 flex-1 basis-56">
        <p className="flex flex-wrap items-center gap-1.5 text-sm font-bold">
          <span>{ASSURE_KIND_LABEL[kind]}</span> <Chip tone={on ? 'label' : 'neutral'}>{on ? '시범' : '준비 중'}</Chip>
        </p>
        <p className="mt-0.5 text-xs text-muted">{body}</p>
      </div>
      <InterestButton kind={kind} label={ASSURE_KIND_LABEL[kind]} ctx={ctx} shown={shown ?? null} done={done} pilot={on} />
    </li>
  );
}

/** 확정가 계약 상대 — 등록된 제휴 주선사 이름과 등록번호 끝 4자리만(docs/alliance-plan.md) */
function PartyLine({ party, reference }: { party: ContractParty | null; reference: boolean }) {
  return (
    <p className="mt-2 flex min-w-0 flex-wrap items-center gap-1.5 text-xs" data-testid="assure-party">
      <Handshake className="size-3.5 shrink-0 text-muted" aria-hidden />
      <span className="text-muted">계약 상대{reference && party ? '(참고)' : ''}:</span>{' '}
      {party ? (
        <>
          <b>{party.partnerName}</b>{' '}
          <span className="text-muted tnum">(등록번호 끝 {party.regTail ?? '—'})</span>{' '}
          <span className="text-2xs text-muted tnum">
            · 조건 {party.termsNo} · ~{party.validUntil} · 제휴 주선사 명의 계약{party.preferred ? '' : ' · 비교 1위 업체와 다를 수 있음'}
            {reference ? ' · 시범이 꺼져 있어 지금 계약하지 않습니다' : ''}
          </span>
        </>
      ) : (
        <span className="font-semibold">제휴 주선사 확정 전</span>
      )}
    </p>
  );
}
