import Link from 'next/link';
import { getLocale } from 'next-intl/server';
import { asUser } from '@/lib/db';
import { requireViewer } from '@/lib/server/viewer';
import { loadSettings } from '@/lib/server/settings';
import { emptyTrust, loadTrustFacts, loadTrustRule, partnerReviews } from '@/lib/server/trust';
import { recommendScore, scoreParts } from '@/lib/money';
import { ScoreBreakdown } from '@/components/trust/score-breakdown';
import { OutcomeChip } from '@/components/trust/review-item';
import { Chip, EmptyState, PageTitle, Panel, PanelHead } from '@/components/ui/core';
import { dateKo, num } from '@/lib/format';
import { ReplyForm } from './reply-form';

export const metadata = { title: '후기·답변' };

export default async function PartnerReviews() {
  const v = await requireViewer('partner');
  const zh = (await getLocale()) === 'zh';
  const d = await asUser(v, async (q) => {
    const [rows, s, rule, metrics] = await Promise.all([
      partnerReviews(q, v.org.id),
      loadSettings(q),
      loadTrustRule(q),
      q.query<{ shipments_done: number; on_time_rate: number | null; return_rate_30d: number | null; done_30d: number; avg_deviation: number | null; invoiced_count: number; price_certainty: number | null }>(
        'select shipments_done, on_time_rate, return_rate_30d, done_30d, avg_deviation, invoiced_count, price_certainty from fcd.v_partner_metrics where org_id = $1',
        [v.org.id],
      ),
    ]);
    const trust = (await loadTrustFacts(q, [v.org.id], rule)).get(v.org.id) ?? emptyTrust(rule);
    return { rows, caps: s.scoreCaps, trust, m: metrics[0] ?? null };
  });
  const m = d.m;
  const input = {
    onTimeRate: m?.shipments_done ? m.on_time_rate : null,
    avgDeviation: m?.invoiced_count ? m.avg_deviation : null,
    fcReturnRate: m?.done_30d ? m.return_rate_30d : null,
    priceCertainty: m?.price_certainty ?? 0,
  };
  const waiting = d.rows.filter((r) => !r.reply_id).length;

  return (
    <>
      <PageTitle
        title={zh ? '评价·回复' : '후기·답변'}
        sub={
          zh
            ? '货主评价公开显示在公司页面。回复也公开；修改会保存为新版本，旧版本留在记录中。'
            : '화주 평가는 회사 공개 페이지에 실립니다. 답변도 공개되며, 고치면 새 판으로 쌓이고 이전 판은 기록에 남습니다.'
        }
      />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <Panel className="self-start xl:col-start-2 xl:row-start-1">
          <PanelHead title={zh ? '我的推荐分项' : '내 추천 점수 항목'} sub={zh ? '比较页面按此计算' : '비교 화면은 이 항목으로 점수를 냅니다'} />
          <ScoreBreakdown
            parts={scoreParts(input, d.caps)}
            score={recommendScore(input, d.caps)}
            trust={d.trust}
            metrics={m}
            certainty={m?.price_certainty ?? null}
            certaintyNote="최근 180일 응찰 기준"
          />
        </Panel>
        <div className="grid min-w-0 content-start gap-3 xl:col-start-1 xl:row-start-1">
          <p className="text-xs text-muted">
            {zh ? `评价 ${num(d.rows.length)} 条 · 未回复 ${num(waiting)} 条` : `후기 ${num(d.rows.length)}건 · 답변 기다리는 후기 ${num(waiting)}건`}
          </p>
          {d.rows.length ? (
            <ul className="grid gap-3" data-testid="partner-review-list">
              {d.rows.map((r) => (
                <li key={r.id} className="min-w-0 rounded-md border border-line bg-surface p-4" data-review-id={r.id}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="display text-lg tnum">{r.rating}/5</span>
                    <OutcomeChip outcome={r.outcome} />
                    {r.on_time_ok ? <Chip tone="ok">{zh ? '准时入库' : '정시 입고'}</Chip> : <Chip tone="caution">{zh ? '晚到' : '늦은 입고'}</Chip>}
                    {r.billing_ok ? <Chip tone="ok">{zh ? '按报价结算' : '견적대로 청구'}</Chip> : <Chip tone="caution">{zh ? '账单差异' : '청구 차이'}</Chip>}
                    {!r.published ? <Chip tone="neutral">{zh ? '未公开' : '비공개'}</Chip> : null}
                  </div>
                  <p className="mt-2 text-sm">“{r.body}”</p>
                  <p className="mt-1 text-2xs text-muted">
                    {r.author_label} · {dateKo(r.created_at, { dow: false })} ·{' '}
                    <Link href={`/partner/shipments/${r.shipment_id}`} className="underline">{r.shipment_no}</Link>
                  </p>
                  <ReplyForm reviewId={r.id} current={r.reply_body} version={r.reply_version} at={r.reply_at} zh={zh} />
                </li>
              ))}
            </ul>
          ) : (
            <Panel>
              <EmptyState title={zh ? '还没有评价' : '아직 후기가 없습니다'} body={zh ? '货件结束后货主可以留下评价。' : '선적이 끝나면 화주가 평가를 남길 수 있습니다.'} />
            </Panel>
          )}
        </div>
      </div>
    </>
  );
}
