import Link from 'next/link';
import { getLocale } from 'next-intl/server';
import { asUser, todayKst } from '@/lib/db';
import { requireViewer } from '@/lib/server/viewer';
import { getReference, nameOf } from '@/lib/server/reference';
import { DISPUTE_METRIC_LABEL, DISPUTE_STATUS_LABEL, disputes, indexSnaps, loadScorecardConfig, mySubmissions, namedSnaps, quoteResponseHours, snapKey } from '@/lib/server/scorecard';
import { lookupReady } from '@/lib/server/tracker';
import { daysLine } from '@/lib/scorecard/engine';
import { CertifiedChip, ScorecardDetail, TradeMetrics } from '@/components/scorecard/parts';
import { DisputeForm, SubmitNumbersForm, WithdrawButton } from '@/components/scorecard/forms';
import { DemoChip } from '@/components/badges';
import { Chip, EmptyState, PageTitle, Panel, PanelHead } from '@/components/ui/core';
import { TRACK_STAGE_LABEL } from '@/lib/unipass/stages';
import type { TrackStage } from '@/lib/unipass/types';
import { dateKo, pct } from '@/lib/format';
import { cn } from '@/lib/cn';

export const metadata = { title: '성적표 · 成绩单' };

export default async function PartnerScorecard() {
  const v = await requireViewer('partner');
  const zh = (await getLocale()) === 'zh';
  const ref = await getReference();
  const d = await asUser(v, async (q) => ({
    cfg: await loadScorecardConfig(q),
    snaps: await namedSnaps(q),
    subs: await mySubmissions(q, v.org.id, 20),
    disputes: await disputes(q, v.org.id, 20),
    metrics: (await q.query<Record<string, number | null>>('select * from fcd.v_partner_metrics where org_id = $1', [v.org.id]))[0] ?? null,
    biz: (await q.query<{ business_type: string | null }>('select business_type from fcd.orgs where id = $1', [v.org.id]))[0]?.business_type ?? null,
  }));
  const quote = (await quoteResponseHours([v.org.id]).catch(() => new Map())).get(v.org.id) ?? null;
  const idx = indexSnaps(d.snaps);
  // 물류사면 partner 판, 관세사 조직이면 broker 판 — 두 판이 섞이지 않게 종류로도 거른다(검토 고침)
  const kind = d.biz === 'customs_broker' ? 'broker' : 'partner';
  const all = d.snaps.find((s) => s.entity_org_id === v.org.id && s.entity_kind === kind && s.port == null && s.mode == null) ?? null;
  const rows = d.snaps.filter((s) => s.entity_org_id === v.org.id && s.entity_kind === kind && s.port != null && s.mode != null);
  // 「평균」은 모든 항구·방식 전체 판이다 — 내 항구·방식 구성과 다를 수 있어 그렇게 적고, 같은 항구·방식 대비는 아래 표의 칸으로 본다
  const overall = idx.get(snapKey('overall', null)) ?? null;
  const r = d.cfg.rules;
  const sub = all?.submission ?? null;
  const needRate = r.certifiedSubmissionBp / 10_000;
  const ready = lookupReady(v.org.is_demo);
  const L = (ko: string, cn_: string) => (zh ? `${cn_} · ${ko}` : `${ko} · ${cn_}`);
  return (
    <>
      <PageTitle
        title={L('성적표', '成绩单')}
        sub={zh ? '用海关(UNI-PASS)处理时间测量的通关实测。提交更多单号，样本就越多；提交率达到标准即可获得「实测认证」。排名和认证不能用钱买。' : '관세청 처리 일시로 잰 통관 실측입니다. 화물번호를 많이 낼수록 표본이 늘고, 제출률이 기준을 넘으면 「실측 인증」이 붙습니다. 순위·인증은 돈으로 살 수 없습니다.'}
        actions={<Link href="/market/customs" className="text-sm font-semibold underline underline-offset-4">{L('통관 시장 지표', '通关市场指标')}</Link>}
      />
      <Panel className="mb-4">
        <PanelHead
          title={L('내 성적 대 평균', '我的成绩 vs 平均')}
          sub={`${L('최근', '近')} ${r.windowDays}${zh ? '天' : '일'} · ${L('표본 기준', '最少样本')} ${r.minSamples} · ${L('평균 = 모든 항구·방식 전체(같은 항구·방식 대비는 아래 표)', '平均 = 全部港口·方式整体(同港口·方式对比见下表)')}`}
          action={<span className="flex flex-wrap gap-1">{all?.certified ? <CertifiedChip zh={zh} /> : null}{all?.is_example ? <DemoChip /> : null}</span>}
        />
        <dl className="grid grid-cols-2 gap-px bg-line-2 lg:grid-cols-4" data-testid="partner-score-vs">
          {[
            [L('입항 → 수리 보통', '通关中位'), all?.metrics.clear ? `${daysLine(all.metrics.clear).usual}${zh ? '天' : '일'}` : '—', overall?.metrics.clear ? `${L('전체 평균', '整体平均')} ${daysLine(overall.metrics.clear).usual}${zh ? '天' : '일'}` : ''],
            [L('늦으면', '慢时(90%)'), all?.metrics.clear ? `${daysLine(all.metrics.clear).late}${zh ? '天' : '일'}` : '—', overall?.metrics.clear ? `${L('전체 평균', '整体平均')} ${daysLine(overall.metrics.clear).late}${zh ? '天' : '일'}` : ''],
            [L('검사 비율', '查验率'), pct(all?.metrics.inspectRate ?? null, 1), overall ? `${L('평균', '平均')} ${pct(overall.metrics.inspectRate, 1)}` : ''],
            [L('제출률', '提交率'), sub?.rate != null ? pct(sub.rate, 0) : '—', sub ? `${L('등록', '登记')} ${sub.registered} · ${L('제출', '提交')} ${sub.submitted} · ${L('인증 기준', '认证标准')} ${pct(needRate, 0)}` : L('셀러 등록 화물이 아직 없습니다', '暂无卖家登记货物')],
          ].map(([k, val, s]) => (
            <div key={k} className="min-w-0 bg-surface p-4">
              <dt className="text-xs text-muted">{k}</dt>
              <dd className="display mt-1 text-2xl tnum">{val}</dd>
              <dd className="text-2xs text-muted">{s}</dd>
            </div>
          ))}
        </dl>
        <p className="border-t border-line-2 px-4 py-2 text-2xs text-muted">
          {zh ? '实测认证条件' : '실측 인증 조건'}: {L('표본', '样本')} ≥ {r.certifiedMinSamples} · {L('셀러·선적 등록', '卖家/订单登记')} ≥ {r.certifiedMinSamples} · {L('제출률', '提交率')} ≥ {pct(needRate, 0)}
          {all ? ` — ${L('지금', '当前')} ${all.n} / ${sub?.registered ?? 0} / ${pct(sub?.rate ?? null, 0)}` : ''}
        </p>
      </Panel>
      <div className="mb-4">
        <ScorecardDetail all={all} rows={rows} minSamples={r.minSamples} portName={(c) => nameOf(ref, 'port', c, zh)} modeName={(c) => nameOf(ref, 'mode', c, zh)} title={L('항구·방식별', '按港口·方式')} zh={zh} />
      </div>
      <div className="mb-4">
        <TradeMetrics metrics={d.metrics} quote={quote} minSamples={r.minSamples} zh={zh} />
      </div>
      <Panel className="mb-4">
        <PanelHead
          title={L('화물번호 제출', '提交单号')}
          sub={ready ? L('제출하면 바로 관세청 단계를 조회해 성적표에 보탭니다(앞 20건).', '提交后立即查询海关节点并计入成绩单(前20票)。') : L('제출은 쌓이고, 관세청 조회가 연결되면 조회를 시작합니다(연결 준비 중).', '提交会保存，海关查询接通后开始查询(准备中)。')}
        />
        <SubmitNumbersForm thisYear={Number(todayKst().slice(0, 4))} />
        {d.subs.length ? (
          <div className="border-t border-line-2">
            <p className="px-4 pt-3 text-xs font-semibold text-muted">{L('최근 제출', '最近提交')}</p>
            <ul className="grid gap-1 px-4 py-2 text-sm sm:grid-cols-2" data-testid="partner-submissions">
              {d.subs.map((s) => (
                <li key={`${s.kind}-${s.number}-${s.bl_year}`} className="flex min-w-0 flex-wrap items-center gap-2">
                  <span className="min-w-0 break-all font-mono text-xs">{s.number}</span>
                  {s.bl_year ? <span className="text-2xs text-muted">{s.bl_year}</span> : null}
                  <Chip tone={s.stage ? 'info' : 'neutral'}>{s.stage ? TRACK_STAGE_LABEL[s.stage as TrackStage] : L('조회 전', '未查询')}</Chip>
                  <span className="text-2xs text-muted">{dateKo(s.created_at, { dow: false })}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </Panel>
      <Panel>
        <PanelHead title={L('이의 제기', '异议')} sub={L('지표가 틀렸다고 보면 사유와 화물번호를 적어 주세요. 운영자가 받아들이면 그 화물을 빼고 다시 셉니다. 기록은 지우지 않고 쌓습니다.', '如认为指标有误，请填写理由和单号。运营采纳后会剔除该货物并重新计算。记录只追加不删除。')} />
        <DisputeForm />
        {d.disputes.length ? (
          <ul className="divide-y divide-line-2 border-t border-line-2" data-testid="partner-disputes">
            {d.disputes.map((x) => (
              <li key={x.id} className="grid gap-1 px-4 py-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <Chip tone={x.status === 'accepted' ? 'ok' : x.status === 'rejected' ? 'stamp' : 'neutral'}>{DISPUTE_STATUS_LABEL[x.status]}</Chip>
                  <b>{DISPUTE_METRIC_LABEL[x.metric ?? 'other']}</b>
                  {x.cargo_ref ? <span className="font-mono text-xs">{x.cargo_ref}</span> : null}
                  <span className="text-2xs text-muted">{dateKo(x.created_at, { dow: false })}</span>
                  {x.status === 'open' ? <WithdrawButton id={x.id} /> : null}
                </div>
                <p className="text-muted">{x.body}</p>
                {x.thread.map((t, i) => (
                  <p key={i} className={cn('border-l-2 pl-2 text-xs', t.kind === 'accepted' ? 'border-ok' : t.kind === 'rejected' ? 'border-stamp' : 'border-line')}>
                    {t.kind === 'accepted' ? '받아들임' : t.kind === 'rejected' ? '돌려보냄' : t.kind === 'withdrawn' ? '거둠' : '덧붙임'} — {t.body}
                  </p>
                ))}
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title={L('올린 이의가 없습니다', '暂无异议')} />
        )}
      </Panel>
    </>
  );
}
