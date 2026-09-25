import Link from 'next/link';
import { AlertTriangle, FileText, Handshake } from 'lucide-react';
import { asUser, todayKst } from '@/lib/db';
import { requireViewer } from '@/lib/server/viewer';
import { loadSettings } from '@/lib/server/settings';
import { allianceDetail, allianceList, candidateOrgs, loadAllianceConfig, type SettlementRow, type TermsRow } from '@/lib/server/alliance';
import { checklist, CHECK_STATE_LABEL } from '@/lib/alliance-check';
import { ALLIANCE_STATUS_LABEL, INCIDENT_LABEL, REQUIREMENT_LABEL, REQ_STATUS_LABEL, TERMS_MODEL_LABEL, TERMS_STATUS_LABEL, type AllianceRules } from '@/lib/alliance-settings';
import { daysUntil, expiryState, INCIDENT_KINDS, type SettlementLine } from '@/lib/money';
import { DemoChip, RelatedChip } from '@/components/badges';
import { Chip, EmptyState, PageTitle, Panel, PanelHead } from '@/components/ui/core';
import { dateKo, dateTimeKo, num, pct } from '@/lib/format';
import { AllianceSwitch, CandidateForm, ReviewButtons, SettlementForm, StatementVersionForm, StatusForm, TermsForm, type TermsSeed } from './forms';

export const metadata = { title: '제휴 주선사' };

const bp = (n: number, d = 1) => pct(n / 10000, d);
const FALLBACK_RULES: AllianceRules = { expiryWarnDays: 30, minBondAmount: 100_000_000, requiredKinds: ['registration_cert', 'guarantee_bond', 'biz_reg', 'incident_history'] };

export default async function AllianceAdmin({ searchParams }: { searchParams: Promise<{ id?: string }> }) {
  const v = await requireViewer('admin');
  const sp = await searchParams;
  const today = todayKst();
  const d = await asUser(v, async (q) => {
    const [config, list, cands, s, versions] = await Promise.all([
      loadAllianceConfig(q),
      allianceList(q),
      candidateOrgs(q),
      loadSettings(q),
      q.query<{ n: number }>(`select count(*)::int n from fcd.settings where key = 'v2.alliance_enabled'`),
    ]);
    const pick = list.find((a) => a.id === sp.id) ?? list[0] ?? null;
    const detail = pick ? await allianceDetail(q, pick.id) : null;
    return { config, list, cands, vatBp: s.vatRateBp, versions: versions[0].n, detail };
  });
  const rules = d.config.rules ?? FALLBACK_RULES;
  const warn = rules.expiryWarnDays;

  // 만료 경고 — 요건(확인함)과 계약 판(서명함)의 만료가 warn 일 안이거나 지난 것
  const warnings = d.list.flatMap((a) => {
    const out: { key: string; alliance: string; org: string; what: string; until: string; left: number }[] = [];
    for (const r of a.reqs) {
      if (r.status !== 'verified' || !r.valid_until) continue;
      const st = expiryState(r.valid_until, today, warn);
      if (st === 'soon' || st === 'expired') out.push({ key: r.id, alliance: a.id, org: a.org_name, what: REQUIREMENT_LABEL[r.kind].ko, until: r.valid_until, left: daysUntil(r.valid_until, today) });
    }
    if (a.terms && a.terms.status === 'agreed') {
      const st = expiryState(a.terms.valid_until, today, warn);
      if (st === 'soon' || st === 'expired') out.push({ key: a.terms.id, alliance: a.id, org: a.org_name, what: `계약 ${a.terms.terms_no}`, until: a.terms.valid_until, left: daysUntil(a.terms.valid_until, today) });
    }
    return out;
  }).sort((x, y) => x.left - y.left);

  const det = d.detail;
  const ck = det ? checklist(det.reqs, rules, today) : null;
  const curTerms = det?.terms.find((t) => t.current) ?? null;
  const agreed = det?.terms.find((t) => t.current && t.status === 'agreed') ?? null;
  const defaults = d.config.defaults;
  const seed: TermsSeed | null = curTerms
    ? { supersedesId: curTerms.id, model: curTerms.model, commissionBp: curTerms.commission_bp, reserveBp: curTerms.reserve_bp, liability: curTerms.liability, validFrom: curTerms.valid_from, validUntil: curTerms.valid_until }
    : defaults
      ? { supersedesId: null, model: defaults.model, commissionBp: defaults.commissionBp, reserveBp: defaults.reserveBp, liability: defaults.liability, validFrom: today, validUntil: new Date(Date.parse(`${today}T00:00:00Z`) + defaults.validDays * 86_400_000).toISOString().slice(0, 10) }
      : null;
  const lastIssued = det?.settlements.find((s) => s.current && s.status === 'issued') ?? null;
  const kst = new Date(Date.now() + 9 * 3600_000);
  const prevMonth: [string, string] = [
    new Date(Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth() - 1, 1)).toISOString().slice(0, 10),
    new Date(Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), 0)).toISOString().slice(0, 10),
  ];

  return (
    <>
      <PageTitle
        title="제휴 주선사"
        sub="등록된 국제물류주선업체가 자기 이름으로 셀러와 확정가 계약을 맺고, 플랫폼은 표준화·위험 계산·준비금 일부 분담을 맡는 구조입니다. 후보·요건·계약 조건 판·정산 명세를 여기서 관리합니다."
        actions={<Link href="/admin/settings" className="text-sm font-semibold underline underline-offset-4">요율·기준값(설정)</Link>}
      />

      <Panel className="mb-4">
        <AllianceSwitch on={d.config.on} versions={d.versions} />
        <p className="flex items-start gap-2 border-t border-line-2 px-4 py-2.5 text-xs text-caution" data-testid="alliance-human">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <span>사람이 정할 일: 법률 검토(준비금 분담이 무등록 주선에 해당하는지) · 첫 제휴사 · 책임 비율·수수료율 · 준비금 보관 방식 · 세무 처리. 기획 문서 <span className="font-mono">docs/alliance-plan.md</span>.</span>
        </p>
      </Panel>

      <Panel className="mb-4" aria-labelledby="al-warn">
        <PanelHead id="al-warn" title={`만료 경고 ${warnings.length}건`} sub={`확인한 서류와 서명한 계약 판 중 ${warn}일 안에 끝나거나 이미 끝난 것`} />
        {warnings.length ? (
          <ul data-testid="alliance-warnings">
            {warnings.map((w) => (
              <li key={w.key} className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line-2 px-4 py-2 text-sm last:border-0">
                <Chip tone={w.left < 0 ? 'stamp' : 'caution'} icon={<AlertTriangle aria-hidden />}>{w.left < 0 ? `${-w.left}일 지남` : w.left === 0 ? '오늘 만료' : `${w.left}일 남음`}</Chip>
                <Link href={`/admin/alliance?id=${w.alliance}`} className="font-semibold underline-offset-4 hover:underline">{w.org}</Link>
                <span>{w.what}</span>
                <span className="text-xs text-muted tnum">{dateKo(w.until, { dow: false })}까지</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-4 py-3 text-sm text-muted">{warn}일 안에 끝나는 서류·계약이 없습니다.</p>
        )}
      </Panel>

      <Panel className="mb-6" aria-labelledby="al-list">
        <PanelHead id="al-list" title={`제휴 후보 ${d.list.length}곳`} sub="상태 · 필수 요건 확인 · 현재 계약 판 · 최근 정산" />
        {d.list.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <caption className="sr-only">제휴 후보 목록</caption>
              <thead className="bg-surface-2 text-left text-xs text-muted">
                <tr>
                  <th scope="col" className="px-4 py-2 font-semibold">업체</th>
                  <th scope="col" className="px-4 py-2 font-semibold">상태</th>
                  <th scope="col" className="px-4 py-2 font-semibold">필수 요건</th>
                  <th scope="col" className="px-4 py-2 font-semibold">계약 판</th>
                  <th scope="col" className="px-4 py-2 text-right font-semibold">최근 정산(주선사가 낼 돈)</th>
                </tr>
              </thead>
              <tbody>
                {d.list.map((a) => {
                  const c = checklist(a.reqs, rules, today);
                  const req = c.items.filter((i) => i.required);
                  const okN = req.filter((i) => i.state === 'verified').length;
                  const st = ALLIANCE_STATUS_LABEL[a.status];
                  return (
                    <tr key={a.id} className={`border-t border-line-2 ${det?.a.id === a.id ? 'bg-label/10' : ''}`}>
                      <td className="px-4 py-2">
                        <span className="flex flex-wrap items-center gap-1.5">
                          <Link href={`/admin/alliance?id=${a.id}`} className="font-semibold underline-offset-4 hover:underline" aria-current={det?.a.id === a.id ? 'true' : undefined}>{a.org_name}</Link>
                          {a.is_demo ? <DemoChip /> : null}
                          {a.related_party_note ? <RelatedChip note={a.related_party_note} /> : null}
                        </span>
                        <span className="block text-2xs text-muted">{a.registration_no ?? '등록번호 없음'}</span>
                      </td>
                      <td className="px-4 py-2"><Chip tone={st.tone}>{st.ko}</Chip></td>
                      <td className="px-4 py-2 tnum">
                        <span className="font-semibold">{okN}/{req.length}</span> 확인
                        {c.soon.length ? <Chip tone="caution" className="ml-1.5">곧 만료 {c.soon.length}</Chip> : null}
                      </td>
                      <td className="px-4 py-2 text-xs">
                        {a.terms ? (
                          <>
                            <span className="font-mono">{a.terms.terms_no} v{a.terms.version}</span> · {TERMS_STATUS_LABEL[a.terms.status]} · 수수료 {bp(a.terms.commission_bp, 2)}
                          </>
                        ) : (
                          <span className="text-muted">없음</span>
                        )}
                      </td>
                      <td className="px-4 py-2 text-right tnum">{a.lastStatement ? `${num(a.lastStatement.net_payable)}원` : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState icon={<Handshake aria-hidden />} title="아직 제휴 후보가 없습니다" body="물류사가 「제휴 신청」을 하거나 아래에서 운영자가 후보로 올립니다." />
        )}
        {d.cands.length ? <div className="border-t border-line-2"><CandidateForm orgs={d.cands} /></div> : null}
      </Panel>

      {det && ck ? (
        <section aria-labelledby="al-detail" className="grid gap-4" data-testid="alliance-detail">
          <div className="flex flex-wrap items-center gap-2">
            <h2 id="al-detail" className="text-lg font-bold">{det.a.org_name}</h2>
            <Chip tone={ALLIANCE_STATUS_LABEL[det.a.status].tone}>{ALLIANCE_STATUS_LABEL[det.a.status].ko}</Chip>
            {det.a.is_demo ? <DemoChip /> : null}
            {ck.ready ? <Chip tone="ok">필수 요건 모두 확인</Chip> : <Chip tone="neutral">필수 요건 확인 전</Chip>}
          </div>
          {det.a.applied_note || det.a.status_note ? (
            <p className="text-xs text-muted">
              {det.a.applied_note ? `신청 메모: ${det.a.applied_note}` : ''}
              {det.a.status_note ? ` · 상태 메모: ${det.a.status_note}${det.a.decided_at ? `(${dateTimeKo(det.a.decided_at)})` : ''}` : ''}
            </p>
          ) : null}
          <Panel className="p-4">
            <StatusForm key={det.a.status} allianceId={det.a.id} status={det.a.status} />
            <p className="mt-2 text-2xs text-muted">「제휴 중」은 서명한 계약 판이 있어야 고를 수 있습니다. 화주 카드에는 필수 요건이 모두 확인되고 만료 전일 때만 나옵니다.</p>
          </Panel>

          <Panel aria-labelledby="al-check">
            <PanelHead id="al-check" title="요건 체크리스트" sub={`보증보험 최소 ${num(rules.minBondAmount)}원 · 만료 경고 ${warn}일 · 확인·반려는 새 판으로 쌓입니다`} />
            <ul data-testid="alliance-checklist">
              {ck.items.map((i) => {
                const lab = REQUIREMENT_LABEL[i.kind];
                const s = CHECK_STATE_LABEL[i.state];
                return (
                  <li key={i.kind} className="grid gap-2 border-b border-line-2 px-4 py-3 last:border-0 md:grid-cols-[minmax(0,14rem)_minmax(0,1fr)_auto] md:items-center" data-kind={i.kind}>
                    <div className="min-w-0">
                      <p className="text-sm font-bold">{lab.ko}{i.required ? '' : <span className="ml-1 text-2xs font-normal text-muted">(선택)</span>}</p>
                      <p className="flex flex-wrap items-center gap-1.5 pt-0.5">
                        <Chip tone={s.tone}>{s.ko}</Chip>
                        {i.expiry === 'soon' && i.state === 'verified' ? <Chip tone="caution">곧 만료</Chip> : null}
                        {i.req ? <span className="text-2xs text-muted">v{i.req.version}</span> : null}
                      </p>
                    </div>
                    <div className="min-w-0 text-xs text-muted">
                      {i.req ? (
                        <>
                          {i.req.ref_no ? <span className="mr-3">번호 <b className="text-text">{i.req.ref_no}</b></span> : null}
                          {i.req.amount != null ? <span className="mr-3 tnum">금액 <b className="text-text">{num(i.req.amount)}원</b></span> : null}
                          {i.req.valid_until ? <span className="mr-3 tnum">만료 <b className="text-text">{dateKo(i.req.valid_until, { dow: false })}</b></span> : null}
                          {i.req.file_name ? (
                            <a href={`/api/alliance-docs/${i.req.id}`} className="inline-flex items-center gap-1 underline underline-offset-4">
                              <FileText className="size-3.5" aria-hidden />
                              {i.req.file_name}
                            </a>
                          ) : null}
                          {i.req.note ? <span className="mt-0.5 block">{i.req.note}</span> : null}
                        </>
                      ) : (
                        lab.hint
                      )}
                    </div>
                    <div>{i.req && i.req.status === 'submitted' ? <ReviewButtons requirementId={i.req.id} label={lab.ko} /> : null}</div>
                  </li>
                );
              })}
            </ul>
            <details className="border-t border-line-2 px-4 py-2 text-xs">
              <summary className="cursor-pointer font-semibold">확인 기록 {det.history.length}판</summary>
              <ol className="mt-2 grid gap-1">
                {det.history.map((h) => (
                  <li key={h.id} className="flex flex-wrap gap-x-3 text-muted">
                    <span className="tnum">{dateTimeKo(h.created_at)}</span>
                    <span className="text-text">{REQUIREMENT_LABEL[h.kind].ko} v{h.version}</span>
                    <span>{REQ_STATUS_LABEL[h.status].ko}</span>
                    <span>{h.created_by_name ?? ''}</span>
                    {h.note ? <span>— {h.note}</span> : null}
                  </li>
                ))}
              </ol>
            </details>
          </Panel>

          <Panel aria-labelledby="al-terms">
            <PanelHead id="al-terms" title={`계약 조건 판 ${det.terms.length}개`} sub="수수료율·준비금 적립률·책임 비율·유효기간. 고치지 않고 새 판으로 쌓입니다(UPDATE 없음)." />
            {det.terms.length ? (
              <ul className="grid gap-px bg-line-2" data-testid="alliance-terms">
                {det.terms.map((t) => (
                  <TermsItem key={t.id} t={t} />
                ))}
              </ul>
            ) : (
              <p className="px-4 py-3 text-sm text-muted">아직 계약 판이 없습니다. 아래에서 첫 판(초안)을 만듭니다 — 기본값은 설정 alliance.default_terms.</p>
            )}
            <div className="border-t border-line-2 p-4">
              <h3 className="mb-3 text-sm font-bold">{curTerms ? `새 판 만들기(${curTerms.terms_no} v${curTerms.version + 1})` : '첫 판 만들기'}</h3>
              {seed ? <TermsForm key={curTerms?.id ?? 'new'} allianceId={det.a.id} seed={seed} /> : <p className="text-sm text-muted">기본값 설정(alliance.default_terms)이 없습니다.</p>}
            </div>
          </Panel>

          <Panel aria-labelledby="al-stmt">
            <PanelHead id="al-stmt" title={`정산 명세 ${det.settlements.length}판`} sub="주선사가 낼 돈 = 수수료 + 부가세 + 준비금 적립 − 플랫폼 부담. 세금계산서는 플랫폼 → 주선사(수수료분)." />
            {det.settlements.length ? (
              <ul data-testid="alliance-settlements">
                {det.settlements.map((s) => (
                  <StatementItem key={s.id} s={s} allianceId={det.a.id} />
                ))}
              </ul>
            ) : (
              <p className="px-4 py-3 text-sm text-muted">아직 정산 명세가 없습니다.</p>
            )}
            <div className="border-t border-line-2 p-4">
              <h3 className="mb-3 text-sm font-bold">새 정산 명세</h3>
              <SettlementForm
                allianceId={det.a.id}
                terms={agreed ? { commissionBp: agreed.commission_bp, reserveBp: agreed.reserve_bp, liability: agreed.liability } : null}
                vatBp={d.vatBp}
                opening={lastIssued?.reserve_closing ?? 0}
                defaultPeriod={prevMonth}
              />
            </div>
          </Panel>
        </section>
      ) : null}
    </>
  );
}

function TermsItem({ t }: { t: TermsRow }) {
  return (
    <li className="bg-surface px-4 py-3 text-sm">
      <p className="flex flex-wrap items-center gap-2">
        <b className="font-mono text-xs">{t.terms_no} v{t.version}</b>
        <Chip tone={t.status === 'agreed' ? 'ok' : 'neutral'}>{TERMS_STATUS_LABEL[t.status]}</Chip>
        {t.current ? <Chip tone="label">현재 판</Chip> : <span className="text-2xs text-muted">이전 판</span>}
        <span className="text-xs text-muted">{TERMS_MODEL_LABEL[t.model]}</span>
      </p>
      <p className="mt-1 text-xs tnum">
        수수료 {bp(t.commission_bp, 2)} · 준비금 프리미엄의 {bp(t.reserve_bp, 0)} · {dateKo(t.valid_from, { dow: false })} ~ {dateKo(t.valid_until, { dow: false })}
        {t.signed_on ? ` · 서명 ${dateKo(t.signed_on, { dow: false })}` : ''}
      </p>
      <p className="mt-0.5 text-2xs text-muted tnum">
        외부 요인 플랫폼 부담: {INCIDENT_KINDS.map((k) => `${INCIDENT_LABEL[k]} ${bp(t.liability[k].platformBp, 0)}${t.liability[k].platformBp ? `(상한 ${bp(t.liability[k].capBp, 1)})` : ''}`).join(' · ')}
      </p>
      {t.note ? <p className="mt-0.5 text-2xs text-muted">{t.note}</p> : null}
    </li>
  );
}

function StatementItem({ s, allianceId }: { s: SettlementRow; allianceId: string }) {
  const lines = (Array.isArray(s.lines) ? s.lines : []) as SettlementLine[];
  const label = `${s.statement_no} v${s.version}`;
  return (
    <li className="border-b border-line-2 px-4 py-3 last:border-0">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <b className="font-mono text-xs">{label}</b>
        <Chip tone={s.status === 'issued' ? 'ok' : s.status === 'void' ? 'stamp' : 'neutral'}>{s.status === 'issued' ? '발행' : s.status === 'void' ? '무효' : '초안'}</Chip>
        {s.current ? null : <span className="text-2xs text-muted">이전 판</span>}
        <span className="text-xs text-muted tnum">{dateKo(s.period_start, { dow: false })} ~ {dateKo(s.period_end, { dow: false })} · 선적 {s.shipments}건</span>
        <span className="flex-1" />
        {s.current ? <StatementVersionForm allianceId={allianceId} id={s.id} periodStart={s.period_start} periodEnd={s.period_end} taxInvoiceNo={s.tax_invoice_no} status={s.status} label={label} /> : null}
      </div>
      <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs tnum sm:grid-cols-4 xl:grid-cols-8">
        {([
          ['수수료', s.commission],
          ['부가세', s.commission_vat],
          ['준비금 적립', s.reserve_in],
          ['플랫폼 부담', s.platform_share],
          ['주선사 부담', s.partner_share],
          ['셀러 부담', s.seller_share],
          ['기말 준비금', s.reserve_closing],
          ['주선사가 낼 돈', s.net_payable],
        ] as const).map(([k, v]) => (
          <div key={k} className="min-w-0">
            <dt className="text-muted">{k}</dt>
            <dd className="font-semibold">{num(v)}원</dd>
          </div>
        ))}
      </dl>
      <p className="mt-1 text-2xs text-muted">
        세금계산서 {s.tax_invoice_no ?? '발행 전'}{s.reserve_shortfall ? ` · 준비금 부족 ${num(s.reserve_shortfall)}원(플랫폼 자기 돈)` : ''}{s.note ? ` · ${s.note}` : ''}
      </p>
      {lines.length ? (
        <details className="mt-1 text-xs">
          <summary className="cursor-pointer font-semibold">선적 {lines.length}줄</summary>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[640px] text-xs tnum">
              <caption className="sr-only">{label} 선적 줄</caption>
              <thead className="text-left text-muted">
                <tr>
                  <th scope="col" className="py-1 pr-3 font-semibold">참조</th>
                  <th scope="col" className="py-1 pr-3 text-right font-semibold">확정가</th>
                  <th scope="col" className="py-1 pr-3 text-right font-semibold">실제 원가</th>
                  <th scope="col" className="py-1 pr-3 text-right font-semibold">수수료</th>
                  <th scope="col" className="py-1 pr-3 text-right font-semibold">적립</th>
                  <th scope="col" className="py-1 pr-3 text-right font-semibold">플랫폼 부담</th>
                  <th scope="col" className="py-1 text-right font-semibold">주선사·셀러 부담</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l, i) => (
                  <tr key={`${l.ref}-${i}`} className="border-t border-line-2">
                    <td className="py-1 pr-3 font-mono">{l.ref}</td>
                    <td className="py-1 pr-3 text-right">{num(l.firmPrice)}</td>
                    <td className="py-1 pr-3 text-right">{num(l.actualCost)}</td>
                    <td className="py-1 pr-3 text-right">{num(l.commission)}</td>
                    <td className="py-1 pr-3 text-right">{num(l.reserveIn)}</td>
                    <td className="py-1 pr-3 text-right">{num(l.platform)}{l.overrun?.capped ? ' (상한)' : ''}</td>
                    <td className="py-1 text-right">{num(l.partner)} · {num(l.seller)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      ) : null}
    </li>
  );
}
