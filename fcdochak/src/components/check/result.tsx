/**
 * 청구서 점검 결과 — 공개 /check 와 화주 보관 화면이 같은 모습으로 쓴다(훅 없음: 서버·브라우저 모두).
 * 청구서 막대와 시세 중간값 막대를 같은 척도로 위아래에, 구간 표, 짚을 점 문장.
 */
import { AlertTriangle, CircleCheck, Info, SearchX } from 'lucide-react';
import { NineBar, NineBarLegend, type BarSegment } from '@/components/nine-bar';
import { Chip, Panel, PanelHead } from '@/components/ui/core';
import { checkHeadline, segmentFinding, totalFinding, bpText } from '@/lib/check-text';
import { cargoSummaryText } from '@/lib/standard-cargo';
import { won, wonShort } from '@/lib/format';
import { SEGMENT_LABEL_KO } from '@/lib/money/segments';
import { CHECK_VERDICT } from '@/lib/terms';
import type { CheckOutcome } from '@/lib/invoice-check-input';

export function CheckResultView({ outcome, heading = 'h2' }: { outcome: CheckOutcome; heading?: 'h2' | 'h3' }) {
  const { result: r, lane, cargo } = outcome;
  const H = heading;
  const invoiceBar: BarSegment[] = r.segments.map((s) => ({ segment: s.segment, amount: s.amount, certainty: s.amount == null ? null : 'confirmed' }));
  const marketBar: BarSegment[] = r.segments.map((s) => ({
    segment: s.segment,
    amount: s.benchmark.median,
    certainty: s.benchmark.median == null ? null : 'estimated',
    filled: s.benchmark.source === 'reference',
  }));
  const sum = (b: BarSegment[]) => b.reduce((t, x) => t + Math.max(0, x.amount ?? 0), 0);
  const scaleMax = Math.max(sum(invoiceBar), sum(marketBar), 1);
  const findings = r.segments.map(segmentFinding).filter((x): x is string => !!x);
  const total = totalFinding(r);
  const over = r.market.overMedianBp;

  return (
    <div className="grid gap-4" data-testid="check-result">
      <Panel aria-labelledby="check-sum">
        <div className="grid gap-4 p-4 md:grid-cols-[1fr_auto] md:items-end">
          <div className="min-w-0">
            <H id="check-sum" className="text-lg font-bold">점검 결과</H>
            <p className="mt-0.5 text-xs text-muted">
              {lane.hubName} → {lane.portName} · {lane.modeName} · {cargoSummaryText(cargo)}
            </p>
            <p className="mt-3 text-base font-semibold" data-testid="check-headline">{checkHeadline(r)}</p>
            {total ? <p className="mt-1 text-sm text-muted">{total}</p> : null}
          </div>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm tnum sm:grid-cols-3">
            <div>
              <dt className="text-xs text-muted">물류비 청구 합계</dt>
              <dd className="display text-2xl" title={won(r.invoiceTotal)}>{wonShort(r.invoiceTotal)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">같은 조건 중간값</dt>
              <dd className="text-lg font-bold" title={r.market.median == null ? undefined : won(r.market.median)}>
                {r.market.median == null ? '표본 부족' : wonShort(r.market.median)}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted">중간값 대비</dt>
              <dd className={over == null ? 'text-lg font-bold text-muted' : over > 0 ? 'text-lg font-bold text-stamp' : 'text-lg font-bold text-ok'}>
                {over == null ? '—' : `${over > 0 ? '+' : '−'}${bpText(over)}`}
              </dd>
            </div>
          </dl>
        </div>
        <div className="flex flex-wrap gap-2 border-t border-line-2 px-4 py-3">
          <Chip tone={r.counts.high ? 'stamp' : 'neutral'} icon={<AlertTriangle aria-hidden />}>과한 구간 {r.counts.high}</Chip>
          <Chip tone={r.counts.missing ? 'caution' : 'neutral'} icon={<SearchX aria-hidden />}>
            빠진 구간 {r.counts.missing}{r.missingRisk ? ` · 약 ${wonShort(r.missingRisk)}` : ''}
          </Chip>
          <Chip tone={r.counts.low ? 'caution' : 'neutral'}>낮은 구간 {r.counts.low}</Chip>
          <Chip tone="info" icon={<Info aria-hidden />}>참고치로 비교 {r.referenceCount}</Chip>
          {r.taxTotal ? <Chip tone="neutral">관세·부가세 {wonShort(r.taxTotal)} (비교에서 뺌)</Chip> : null}
        </div>
      </Panel>

      <Panel aria-labelledby="check-bars">
        <PanelHead id="check-bars" title="9구간으로 나눠 보면" sub="같은 척도 — 길이가 곧 금액입니다. 점선 칸은 요금표가 모자라 플랫폼 참고치로 채운 곳입니다." />
        <div className="grid gap-4 p-4">
          <div>
            <p className="mb-1.5 text-xs font-semibold text-muted">내 청구서</p>
            <NineBar segments={invoiceBar} scaleMax={scaleMax} label="내 청구서 9구간" table="none" />
          </div>
          <div>
            <p className="mb-1.5 text-xs font-semibold text-muted">
              구간 시세 중간값{r.market.cards ? ` · 요금표 ${r.market.cards}장` : ' · 요금표 없음(참고치)'}
            </p>
            <NineBar segments={marketBar} scaleMax={scaleMax} label="구간 시세 중간값 9구간" table="none" />
          </div>
          <NineBarLegend />
        </div>
      </Panel>

      {findings.length ? (
        <Panel aria-labelledby="check-find">
          <PanelHead id="check-find" title="짚어 볼 곳" sub="청구가 틀렸다는 뜻이 아니라, 업체에 근거를 물어볼 자리입니다." />
          <ul className="divide-y divide-line-2" data-testid="check-findings">
            {r.segments
              .filter((s) => segmentFinding(s))
              .map((s) => (
                <li key={s.segment} className="flex items-start gap-3 px-4 py-3 text-sm leading-6">
                  <Chip tone={CHECK_VERDICT[s.verdict].tone} className="mt-0.5">{CHECK_VERDICT[s.verdict].label}</Chip>
                  <span className="min-w-0">{segmentFinding(s)}</span>
                </li>
              ))}
          </ul>
        </Panel>
      ) : (
        <p className="flex items-center gap-2 rounded-md border border-ok/40 bg-ok-bg p-3 text-sm text-ok">
          <CircleCheck className="size-4" aria-hidden /> 짚을 곳이 없습니다 — 9구간이 모두 시세 안입니다.
        </p>
      )}

      <Panel aria-labelledby="check-table">
        <PanelHead id="check-table" title="구간별 비교" sub="중간값·싼 쪽 25%·최저는 이 화물로 계산한 요금표 기준. 표본이 적은 구간은 싼 쪽 25%·최저를 싣지 않습니다(좁은 화면에서는 두 칸을 접습니다)." />
        <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="구간별 비교 표(옆으로 밀어 더 보기)">
          <table className="w-full min-w-[340px] text-sm tnum md:min-w-[720px]">
            <caption className="sr-only">9구간별 청구 금액과 구간 시세</caption>
            <thead className="bg-surface-2 text-xs text-muted">
              <tr>
                <th scope="col" className="px-3 py-2 text-left font-semibold">구간</th>
                <th scope="col" className="px-3 py-2 text-right font-semibold">내 청구</th>
                <th scope="col" className="px-3 py-2 text-right font-semibold">중간값</th>
                <th scope="col" className="hidden px-3 py-2 text-right font-semibold md:table-cell">싼 쪽 25%</th>
                <th scope="col" className="hidden px-3 py-2 text-right font-semibold md:table-cell">최저</th>
                <th scope="col" className="px-3 py-2 text-right font-semibold">중간값 대비</th>
                <th scope="col" className="hidden px-3 py-2 text-left font-semibold sm:table-cell">판정</th>
              </tr>
            </thead>
            <tbody>
              {r.segments.map((s, i) => (
                <tr key={s.segment} className="border-t border-line-2" data-seg={s.segment}>
                  <th scope="row" className="px-3 py-2 text-left font-semibold">
                    <span className="mr-1.5 inline-block size-2 rounded-[1px] align-middle" style={{ background: `var(--seg-${i + 1})` }} aria-hidden />
                    {SEGMENT_LABEL_KO[s.segment]}
                    {/* 좁은 화면에서는 판정 칸이 없어 구간 이름 아래에 */}
                    <span className="mt-1 block sm:hidden">
                      <Chip tone={CHECK_VERDICT[s.verdict].tone}>{CHECK_VERDICT[s.verdict].label}</Chip>
                    </span>
                  </th>
                  <td className="px-3 py-2 text-right font-semibold">{s.amount == null ? <span className="text-muted">없음</span> : won(s.amount)}</td>
                  <td className="px-3 py-2 text-right">
                    {s.benchmark.median == null ? '—' : won(s.benchmark.median)}
                    {s.benchmark.source === 'reference' ? <span className="block text-2xs text-muted">참고치</span> : s.benchmark.source === 'market' ? <span className="block text-2xs text-muted">{s.benchmark.n}장</span> : null}
                  </td>
                  <td className="hidden px-3 py-2 text-right text-muted md:table-cell">{s.benchmark.source === 'market' && s.benchmark.q1 != null ? won(s.benchmark.q1) : '—'}</td>
                  <td className="hidden px-3 py-2 text-right text-muted md:table-cell">{s.benchmark.min == null ? '—' : won(s.benchmark.min)}</td>
                  <td className={s.overMedianBp == null ? 'px-3 py-2 text-right text-muted' : s.overMedianBp > 0 ? 'px-3 py-2 text-right text-stamp' : 'px-3 py-2 text-right text-ok'}>
                    {s.overMedianBp == null ? (s.expected != null ? `+${won(s.expected)} 예상` : '—') : `${s.overMedianBp > 0 ? '+' : '−'}${bpText(s.overMedianBp)}`}
                  </td>
                  <td className="hidden px-3 py-2 sm:table-cell">
                    <Chip tone={CHECK_VERDICT[s.verdict].tone}>{CHECK_VERDICT[s.verdict].label}</Chip>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      {r.unclassified.length ? (
        <Panel aria-labelledby="check-uncl">
          <PanelHead id="check-uncl" title={`구간을 못 정한 항목 ${r.unclassified.length}줄`} sub="합계에는 넣고 구간 비교에서는 뺐습니다. 위 입력표에서 구간을 고르면 같이 비교합니다." />
          <ul className="divide-y divide-line-2 text-sm">
            {r.unclassified.map((u, i) => (
              <li key={i} className="flex justify-between gap-3 px-4 py-2">
                <span className="min-w-0 truncate">{u.label}</span>
                <span className="shrink-0 tnum">{won(u.amount)}</span>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}

      <p className="text-xs leading-5 text-muted">
        구간 시세는 공식·인증 대기 업체의 지금 유효한 요금표로 이 화물을 계산한 값이고, 개별 업체 가격은 싣지 않습니다. 외화는 RMB {outcome.fx.RMB}원 · USD {outcome.fx.USD}원으로 바꿨습니다.
        관세·부가세는 물류비가 아니라 비교에서 뺐습니다. 운송계약과 청구는 화주와 물류사가 직접 맺습니다.
      </p>
    </div>
  );
}
