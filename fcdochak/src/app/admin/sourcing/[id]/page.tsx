import Link from 'next/link';
import { notFound } from 'next/navigation';
import { asUser, todayKst } from '@/lib/db';
import { requireViewer } from '@/lib/server/viewer';
import { candidatesFor, platformPeople, requestById, requestEvents, sampleInterestsFor, simContext } from '@/lib/server/sourcing';
import { candidateViews } from '@/lib/server/sourcing-views';
import { dueState } from '@/lib/sourcing/settings';
import { SourcingPreviewNotice } from '@/components/sourcing/preview';
import { CandidateTable, SimCard } from '@/components/sourcing/candidates';
import { CandidateForm, FillMockButton, ReviseForm, StatusForm } from '@/components/sourcing/admin-forms';
import { DemoChip } from '@/components/badges';
import { Chip, DefList, EmptyState, PageTitle, Panel, PanelHead } from '@/components/ui/core';
import { SOURCING_STATUS_LABEL } from '@/lib/terms';
import { dateKo, dateTimeKo, num, won } from '@/lib/format';

export const metadata = { title: '소싱 요청 처리' };

export default async function SourcingAdminRequest({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const v = await requireViewer('admin');
  const today = todayKst();
  const d = await asUser(v, async (q) => {
    const req = await requestById(q, id);
    if (!req) return null;
    const ctx = await simContext(q, today);
    const hubs = await q.query<{ code: string; name_ko: string }>(`select code, name_ko from fcd.hubs order by ord`);
    const hubName = new Map(hubs.map((h) => [h.code, h.name_ko]));
    const rows = await candidatesFor(q, req.id);
    const qty = req.first_order_units ?? 500;
    const views = await candidateViews(q, ctx, req, rows, { qty, price: req.target_price, hubName });
    return {
      req,
      ctx,
      hubs,
      rows,
      views,
      qty,
      events: await requestEvents(q, req.id),
      people: await platformPeople(q),
      samples: await sampleInterestsFor(q, req.id),
      categories: await q.query<{ category: string; name_ko: string }>(`select category, name_ko from fcd.v_current_duty_rates order by category`),
    };
  });
  if (!d) notFound();
  const { req } = d;
  const personName = new Map(d.people.map((p) => [p.id, p.name]));
  const due = dueState(req.due_on, today, req.status);
  const catName = d.categories.find((c) => c.category === req.category)?.name_ko ?? req.category;
  const rowById = new Map(d.rows.map((r) => [r.id, r]));
  return (
    <>
      <PageTitle
        eyebrow={<Link href="/admin/sourcing" className="underline underline-offset-4">소싱 요청 대기열</Link>}
        title={req.product_name}
        sub={`${req.request_no} · ${req.org_name} · ${dateTimeKo(req.created_at)} 접수`}
        actions={
          <>
            {req.is_demo ? <DemoChip /> : null}
            <Chip tone={req.status === 'candidates_ready' ? 'ok' : 'info'}>{SOURCING_STATUS_LABEL[req.status]}</Chip>
            {due === 'overdue' ? <Chip tone="stamp">기한 지남</Chip> : null}
          </>
        }
      />
      <SourcingPreviewNotice on={d.ctx.config.on} />
      <div className="grid gap-6 xl:grid-cols-[360px_minmax(0,1fr)]">
        <div className="grid min-w-0 content-start gap-4">
          <Panel aria-labelledby="ar-h">
            <PanelHead id="ar-h" title="요청 조건" />
            <div className="p-4">
              <DefList
                items={[
                  ['분류', catName],
                  ['낱말', req.keywords.length ? req.keywords.join(', ') : '—'],
                  ['목표 판매가', req.target_price ? won(req.target_price) : '—'],
                  ['월 판매량', req.monthly_units != null ? `${num(req.monthly_units)}개` : '—'],
                  ['첫 발주', req.first_order_units != null ? `${num(req.first_order_units)}개` : '—'],
                  ['인증', req.needs_cert ? `필요${req.cert_note ? ` — ${req.cert_note}` : ''}` : '필요 없음'],
                  ['출발지', req.hub ? (d.hubs.find((h) => h.code === req.hub)?.name_ko ?? req.hub) : '상관없음'],
                  ['시작점', req.origin === 'sku' ? '저장한 SKU' : req.origin === 'sales' ? '판매 분석 상품' : '직접 입력'],
                  ['처리 기한', dateKo(req.due_on)],
                  ['사진', req.image_url ? <a key="img" href={req.image_url} target="_blank" rel="noopener noreferrer nofollow" className="break-all underline">주소 열기</a> : '—'],
                ]}
              />
              {req.note ? <p className="mt-3 whitespace-pre-wrap break-words rounded-sm bg-surface-2 p-2 text-xs">{req.note}</p> : null}
            </div>
          </Panel>
          <Panel aria-labelledby="as-h">
            <PanelHead id="as-h" title="상태·담당" sub="바꿀 때마다 새 기록" />
            <StatusForm requestId={req.id} status={req.status} assigneeId={req.assignee_id} people={d.people} />
            {d.events.length ? (
              <ol className="border-t border-line-2 px-4 py-3 text-xs" aria-label="상태 기록">
                {d.events.map((e) => (
                  <li key={e.id} className="flex flex-wrap gap-x-2 py-1">
                    <span className="text-muted tnum">{dateTimeKo(e.created_at)}</span>
                    <b>{SOURCING_STATUS_LABEL[e.status]}</b>
                    {e.assignee_id ? <span>담당 {personName.get(e.assignee_id) ?? '운영자'}</span> : null}
                    {e.note ? <span className="text-muted">— {e.note}</span> : null}
                  </li>
                ))}
              </ol>
            ) : null}
          </Panel>
          <Panel aria-labelledby="ass-h">
            <PanelHead id="ass-h" title={`샘플 요청 ${d.samples.length}건`} sub="관심 등록 — 연락은 담당이 앱 밖에서" />
            {d.samples.length ? (
              <ul className="divide-y divide-line-2 text-sm">
                {d.samples.map((s) => (
                  <li key={s.id} className="px-4 py-2">
                    <b>{rowById.get(s.candidate_id)?.label ?? '후보'}</b> · {s.user_name}
                    <span className="block text-2xs text-muted tnum">
                      {dateTimeKo(s.created_at)}{s.detail?.qty ? ` · ${num(s.detail.qty)}개` : ''}{s.detail?.arrivalPerUnit ? ` · 그때 개당 도착원가 ${won(s.detail.arrivalPerUnit)}` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-4 py-3 text-sm text-muted">아직 없습니다.</p>
            )}
          </Panel>
        </div>
        <div className="grid min-w-0 content-start gap-4">
          <Panel aria-labelledby="acand-h">
            <PanelHead id="acand-h" title={`후보 ${d.views.length}곳`} sub={`요청당 ${d.ctx.config.rules.maxCandidates}곳까지 · 유사도는 넣을 때 셈해 남깁니다`} action={<FillMockButton requestId={req.id} />} />
            {d.views.length ? <CandidateTable items={d.views} caption="후보 공급처" /> : <EmptyState title="아직 후보가 없습니다" body="아래에서 담당이 찾은 후보를 넣거나, 미리보기용 예시 후보(흉내 제공자)를 채웁니다." />}
          </Panel>
          {d.views.map((c) => {
            const row = rowById.get(c.id!);
            const x = row?.quote;
            return (
              <SimCard
                key={c.key}
                c={c}
                action={
                  x && !c.withdrawn ? (
                    <ReviseForm
                      requestId={req.id}
                      candidateId={c.id!}
                      label={c.label}
                      tiersText={x.tiers.map((t) => `${t.minQty}:${t.unitPrice}`).join(', ')}
                      current={{ currency: x.currency, moq: x.moq, leadDaysMin: x.lead_days_min, leadDaysMax: x.lead_days_max, sampleFee: x.sample_fee, sampleDays: x.sample_days, unitKg: x.unit_kg, unitCbm: x.unit_cbm, unitsPerCarton: x.units_per_carton }}
                    />
                  ) : (
                    <span className="text-2xs text-muted">판 {c.version}</span>
                  )
                }
              />
            );
          })}
          <Panel aria-labelledby="add-h">
            <PanelHead id="add-h" title="후보 넣기" sub="현지 소싱 담당이 확인한 공급처 — 셀러가 붙인 링크를 확인했으면 「셀러 링크 확인」" />
            <CandidateForm requestId={req.id} hubs={d.hubs} categories={d.categories} defaultCategory={req.category} />
          </Panel>
        </div>
      </div>
    </>
  );
}
