import { getLocale } from 'next-intl/server';
import { FileText, Info } from 'lucide-react';
import { asUser, todayKst } from '@/lib/db';
import { requireViewer } from '@/lib/server/viewer';
import { loadAllianceConfig, partnerAlliance } from '@/lib/server/alliance';
import { checklist, CHECK_STATE_LABEL } from '@/lib/alliance-check';
import { ALLIANCE_STATUS_LABEL, INCIDENT_LABEL, REQUIREMENT_LABEL, TERMS_MODEL_LABEL, TERMS_STATUS_LABEL, type AllianceRules } from '@/lib/alliance-settings';
import { INCIDENT_KINDS } from '@/lib/money';
import { Chip, PageTitle, Panel, PanelHead } from '@/components/ui/core';
import { dateKo, num, pct } from '@/lib/format';
import { ApplyForm, RequirementUpload } from './forms';

export const metadata = { title: '제휴 주선사' };

const bp = (n: number, d = 1) => pct(n / 10000, d);
const FALLBACK_RULES: AllianceRules = { expiryWarnDays: 30, minBondAmount: 100_000_000, requiredKinds: ['registration_cert', 'guarantee_bond', 'biz_reg', 'incident_history'] };

export default async function PartnerAlliance() {
  const v = await requireViewer('partner');
  const zh = (await getLocale()) === 'zh';
  const today = todayKst();
  const d = await asUser(v, async (q) => {
    const [config, detail, lic] = await Promise.all([
      loadAllianceConfig(q),
      partnerAlliance(q, v.org.id),
      q.query<{ license_no: string | null }>(`select license_no from fcd.orgs where id = $1`, [v.org.id]),
    ]);
    return { config, detail, license: lic[0]?.license_no ?? null };
  });
  const rules = d.config.rules ?? FALLBACK_RULES;
  const locked = !d.config.on;
  const det = d.detail;
  const ck = det ? checklist(det.reqs, rules, today) : null;
  const terms = det?.terms.filter((t) => t.current) ?? [];
  const stmts = det?.settlements.filter((s) => s.current) ?? [];
  const L = (ko: string, cn: string) => (zh ? cn : ko);

  return (
    <>
      <PageTitle
        title={L('제휴 주선사', '合作货代(确定价)')}
        sub={L(
          '등록된 국제물류주선업체가 자기 이름으로 셀러와 확정가 계약을 맺고, FC도착은 확정가 계산·셀러 모집·청구 대조·준비금 일부 분담을 맡습니다.',
          '已在韩国登记的国际物流代理企业以自身名义与卖家签订确定价合同；FC도착 负责确定价计算、招揽卖家、账单核对，并以准备金分担部分风险。',
        )}
      />

      {locked ? (
        <p className="mb-4 flex items-start gap-2 rounded-md border border-line bg-surface-2 px-4 py-2.5 text-sm" data-testid="alliance-locked">
          <Info className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden />
          {L('지금은 제휴 신청·서류를 받지 않습니다(준비 중). 운영자가 열면 이 화면에서 신청할 수 있습니다.', '目前暂不接受合作申请和资料(准备中)。运营方开放后可在此页面申请。')}
        </p>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="grid min-w-0 content-start gap-4">
          {!det ? (
            <Panel>
              <PanelHead title={L('제휴 신청', '申请合作')} sub={L('한 회사에 한 번. 신청하면 필요한 서류 칸이 열립니다.', '每家公司一次。申请后可提交所需资料。')} />
              <div className="p-4">
                <ApplyForm zh={zh} locked={locked} defaultNo={d.license} />
              </div>
            </Panel>
          ) : (
            <>
              <Panel>
                <div className="flex flex-wrap items-center gap-2 px-4 py-3" data-testid="alliance-mine">
                  <span className="text-sm font-bold">{L('내 제휴 상태', '我的合作状态')}</span>
                  <Chip tone={ALLIANCE_STATUS_LABEL[det.a.status].tone}>{zh ? ALLIANCE_STATUS_LABEL[det.a.status].zh : ALLIANCE_STATUS_LABEL[det.a.status].ko}</Chip>
                  {ck?.ready ? <Chip tone="ok">{L('필수 서류 모두 확인', '必需资料均已确认')}</Chip> : null}
                  {det.a.status_note ? <span className="text-xs text-muted">{det.a.status_note}</span> : null}
                </div>
              </Panel>
              <Panel aria-labelledby="pa-check">
                <PanelHead id="pa-check" title={L('필요한 서류', '所需资料')} sub={L(`보증보험은 ${num(rules.minBondAmount)}원 이상 · 만료 ${rules.expiryWarnDays}일 전부터 알려 드립니다 · 올린 서류는 고치지 않고 새 판으로 쌓입니다`, `保证保险需 ${num(rules.minBondAmount)} 韩元以上 · 到期前 ${rules.expiryWarnDays} 天提醒 · 提交的资料不修改, 以新版本累积`)} />
                <ul data-testid="alliance-partner-checklist">
                  {ck!.items.map((i) => {
                    const lab = REQUIREMENT_LABEL[i.kind];
                    const s = CHECK_STATE_LABEL[i.state];
                    const canUpload = !i.req || i.state !== 'verified' || i.expiry === 'soon' || i.expiry === 'expired';
                    return (
                      <li key={i.kind} className="border-b border-line-2 px-4 py-3 last:border-0" data-kind={i.kind}>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-bold">{zh ? lab.zh : lab.ko}</span>
                          {!i.required ? <span className="text-2xs text-muted">{L('(선택)', '(可选)')}</span> : null}
                          <Chip tone={s.tone}>{zh ? s.zh : s.ko}</Chip>
                          {i.expiry === 'soon' && i.state === 'verified' ? <Chip tone="caution">{L('곧 만료', '即将到期')}</Chip> : null}
                        </div>
                        {i.req ? (
                          <p className="mt-1 text-xs text-muted">
                            {i.req.ref_no ? `${i.req.ref_no} · ` : ''}
                            {i.req.amount != null ? `${num(i.req.amount)}${L('원', ' 韩元')} · ` : ''}
                            {i.req.valid_until ? `${L('만료', '到期')} ${dateKo(i.req.valid_until, { dow: false })} · ` : ''}
                            v{i.req.version}
                            {i.req.file_name ? (
                              <a href={`/api/alliance-docs/${i.req.id}`} className="ml-2 inline-flex items-center gap-1 underline underline-offset-4">
                                <FileText className="size-3.5" aria-hidden />
                                {i.req.file_name}
                              </a>
                            ) : null}
                            {i.req.note ? <span className={`mt-0.5 block ${i.state === 'rejected' ? 'font-semibold text-stamp' : ''}`}>{i.req.note}</span> : null}
                          </p>
                        ) : null}
                        {canUpload ? (
                          <details className="mt-2" open={!i.req && i.required && !locked}>
                            <summary className="cursor-pointer text-xs font-semibold">{i.req ? L('새 판 올리기', '提交新版本') : L('올리기', '提交')}</summary>
                            <div className="mt-2">
                              <RequirementUpload kind={i.kind} zh={zh} locked={locked} again={!!i.req} />
                            </div>
                          </details>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              </Panel>
            </>
          )}
        </div>

        <div className="grid min-w-0 content-start gap-4">
          <Panel aria-labelledby="pa-liab">
            <PanelHead id="pa-liab" title={L('책임 나누기(첫 판 기본값)', '责任划分(初版默认值)')} sub={L('실제 비율은 계약 조건 판에 적힌 것이 기준입니다', '实际比例以合同条件版本为准')} />
            <ul className="grid gap-1.5 px-4 py-3 text-xs">
              <li>{L('셀러 귀책(신고와 다른 화물·상품 오류) → 셀러 100%', '卖家原因(与申报不符·商品错误) → 卖家 100%')}</li>
              <li>{L('주선사 귀책(견적 누락·라벨·포장) → 주선사 100%', '货代原因(报价遗漏·标签·包装) → 货代 100%')}</li>
              {d.config.defaults ? (
                <li>
                  {L('외부 요인', '外部因素')}:{' '}
                  {INCIDENT_KINDS.map((k) => {
                    const x = d.config.defaults!.liability[k];
                    const name = zh ? ({ overrun: '超支', return: '退回', loss: '丢失', delay: '延误' } as const)[k] : INCIDENT_LABEL[k];
                    return `${name} ${L('플랫폼', '平台')} ${bp(x.platformBp, 0)}${x.platformBp ? `(${L('건당 확정가', '每票确定价')} ${bp(x.capBp, 1)} ${L('상한', '封顶')})` : ''}`;
                  }).join(' · ')}
                  {L(' — 나머지는 주선사. 플랫폼 몫은 준비금에서 먼저 냅니다.', ' — 其余由货代承担。平台部分先由准备金支付。')}
                </li>
              ) : null}
            </ul>
          </Panel>

          <Panel aria-labelledby="pa-terms">
            <PanelHead id="pa-terms" title={L('계약 조건', '合同条件')} sub={L('운영자가 만든 판을 봅니다. 서명은 계약서로 따로 합니다.', '查看运营方制定的版本。签字另以合同进行。')} />
            {terms.length ? (
              <ul data-testid="alliance-partner-terms">
                {terms.map((t) => (
                  <li key={t.id} className="border-b border-line-2 px-4 py-3 text-sm last:border-0">
                    <p className="flex flex-wrap items-center gap-2">
                      <b className="font-mono text-xs">{t.terms_no} v{t.version}</b>
                      <Chip tone={t.status === 'agreed' ? 'ok' : 'neutral'}>{zh ? ({ draft: '草案', agreed: '已签署', ended: '已结束' } as const)[t.status] : TERMS_STATUS_LABEL[t.status]}</Chip>
                    </p>
                    <p className="mt-1 text-xs tnum">
                      {zh ? '' : `${TERMS_MODEL_LABEL[t.model]} · `}
                      {L('수수료', '佣金')} {bp(t.commission_bp, 2)} · {L('준비금 적립 프리미엄의', '准备金 = 溢价的')} {bp(t.reserve_bp, 0)}
                    </p>
                    <p className="text-2xs text-muted tnum">
                      {dateKo(t.valid_from, { dow: false })} ~ {dateKo(t.valid_until, { dow: false })}
                      {' · '}
                      {INCIDENT_KINDS.map((k) => `${zh ? ({ overrun: '超支', return: '退回', loss: '丢失', delay: '延误' } as const)[k] : INCIDENT_LABEL[k]} ${bp(t.liability[k].platformBp, 0)}`).join(' · ')}
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-4 py-3 text-sm text-muted">{L('아직 계약 조건 판이 없습니다.', '尚无合同条件版本。')}</p>
            )}
          </Panel>

          <Panel aria-labelledby="pa-stmt">
            <PanelHead id="pa-stmt" title={L('정산 명세', '结算明细')} sub={L('낼 돈 = 수수료 + 부가세 + 준비금 적립 − 플랫폼 부담', '应付 = 佣金 + 增值税 + 准备金 − 平台承担')} />
            {stmts.length ? (
              <ul data-testid="alliance-partner-settlements">
                {stmts.map((s) => (
                  <li key={s.id} className="border-b border-line-2 px-4 py-3 text-xs last:border-0">
                    <p className="flex flex-wrap items-center gap-2 text-sm">
                      <b className="font-mono text-xs">{s.statement_no} v{s.version}</b>
                      <span className="text-muted tnum">{dateKo(s.period_start, { dow: false })} ~ {dateKo(s.period_end, { dow: false })}</span>
                    </p>
                    <p className="mt-1 tnum">
                      {L('선적', '货件')} {s.shipments} · {L('수수료', '佣金')} {num(s.commission)} · {L('부가세', '增值税')} {num(s.commission_vat)} · {L('적립', '准备金')} {num(s.reserve_in)} · {L('플랫폼 부담', '平台承担')} {num(s.platform_share)}
                    </p>
                    <p className="mt-0.5 font-bold tnum">{L('낼 돈', '应付')} {num(s.net_payable)}{L('원', ' 韩元')}</p>
                    <p className="text-2xs text-muted">{L('세금계산서', '税务发票')} {s.tax_invoice_no ?? L('발행 전', '未开具')}</p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-4 py-3 text-sm text-muted">{L('아직 정산 명세가 없습니다.', '尚无结算明细。')}</p>
            )}
          </Panel>
        </div>
      </div>
    </>
  );
}
