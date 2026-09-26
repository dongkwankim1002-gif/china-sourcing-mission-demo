import Link from 'next/link';
import { notFound } from 'next/navigation';
import { asUser, todayKst } from '@/lib/db';
import { requireViewer } from '@/lib/server/viewer';
import { candidatesFor, mySampleInterests, requestById, simContext } from '@/lib/server/sourcing';
import { candidateViews, mockViews } from '@/lib/server/sourcing-views';
import { skusForSourcing } from '@/lib/sourcing/seeds';
import { dueState } from '@/lib/sourcing/settings';
import { SourcingPreviewNotice } from '@/components/sourcing/preview';
import { CandidateTable, SimCard } from '@/components/sourcing/candidates';
import { CancelRequestButton, SampleButton } from '@/components/sourcing/buttons';
import { Button, Chip, DefList, Field, Input, PageTitle, Panel, PanelHead } from '@/components/ui/core';
import { SOURCING_ACTION, SOURCING_STATUS_LABEL } from '@/lib/terms';
import { dateKo, num, won } from '@/lib/format';

export const metadata = { title: '소싱 요청' };

const clampInt = (s: string | undefined, lo: number, hi: number) => {
  const n = Number(String(s ?? '').replace(/[,\s]/g, ''));
  return Number.isFinite(n) && n >= lo && n <= hi ? Math.round(n) : null;
};

export default async function SourcingRequestPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { id } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const v = await requireViewer('app', `/app/sourcing/${id}`);
  const today = todayKst();
  const d = await asUser(v, async (q) => {
    const req = await requestById(q, id);
    if (!req || req.org_id !== v.org.id) return null;
    const ctx = await simContext(q, today);
    const hubs = await q.query<{ code: string; name_ko: string }>(`select code, name_ko from fcd.hubs`);
    const hubName = new Map(hubs.map((h) => [h.code, h.name_ko]));
    const qty = clampInt(sp.qty, 1, 10_000_000) ?? req.first_order_units ?? 500;
    const price = clampInt(sp.price, 100, 100_000_000) ?? req.target_price;
    const rows = await candidatesFor(q, req.id);
    const done = await mySampleInterests(q, v.id, req.id);
    const stored = await candidateViews(q, ctx, req, rows, { qty, price, hubName, sampleDone: done });
    let mock: Awaited<ReturnType<typeof mockViews>> = [];
    if (!stored.length) {
      const sku = req.origin === 'sku' && req.origin_ref ? (await skusForSourcing(q, v.org.id)).find((s) => s.ref === req.origin_ref) : undefined;
      mock = await mockViews(q, ctx, req, { qty, price, hubName, unitKg: sku?.unitKg, unitCbm: sku?.unitCbm });
    }
    const category = (await q.query<{ name_ko: string }>(`select name_ko from fcd.v_current_duty_rates where category = $1`, [req.category]))[0]?.name_ko ?? req.category;
    return { req, ctx, qty, price, stored, mock, done, category, hubName };
  });
  if (!d) notFound();
  const { req } = d;
  const due = dueState(req.due_on, today, req.status);
  const open = req.status !== 'cancelled' && req.status !== 'closed';
  const items = d.stored.length ? d.stored : d.mock;
  const fees = d.ctx.config.fees;
  return (
    <>
      <PageTitle
        eyebrow={<Link href="/app/sourcing" className="underline underline-offset-4">소싱처 찾기</Link>}
        title={req.product_name}
        sub={`${req.request_no} · ${dateKo(req.created_at)} 접수`}
        actions={
          <>
            <Chip tone={req.status === 'candidates_ready' ? 'ok' : req.status === 'cancelled' ? 'neutral' : 'info'}>{SOURCING_STATUS_LABEL[req.status]}</Chip>
            {due === 'overdue' ? <Chip tone="stamp">기한 지남</Chip> : null}
            {open ? <CancelRequestButton requestId={req.id} /> : null}
          </>
        }
      />
      <SourcingPreviewNotice on={d.ctx.config.on} />
      <div className="grid gap-6 xl:grid-cols-[320px_minmax(0,1fr)]">
        <div className="grid min-w-0 content-start gap-4">
          <Panel aria-labelledby="rq-h">
            <PanelHead id="rq-h" title="유사상품 조건" />
            <div className="p-4">
              <DefList
                items={[
                  ['분류', d.category],
                  ['낱말', req.keywords.length ? req.keywords.join(', ') : '—'],
                  ['목표 판매가', req.target_price ? won(req.target_price) : '—'],
                  ['월 판매량', req.monthly_units != null ? `${num(req.monthly_units)}개` : '—'],
                  ['첫 발주', req.first_order_units != null ? `${num(req.first_order_units)}개` : '—'],
                  ['인증', req.needs_cert ? `필요${req.cert_note ? ` — ${req.cert_note}` : ''}` : '필요 없음'],
                  ['출발지', req.hub ? (d.hubName.get(req.hub) ?? req.hub) : '상관없음'],
                  ['처리 기한', due === 'done' ? '처리됨' : dateKo(req.due_on)],
                  ['사진', req.image_url ? <a key="img" href={req.image_url} rel="noopener noreferrer nofollow" target="_blank" className="break-all underline">주소 열기</a> : '—'],
                ]}
              />
              {req.note ? <p className="mt-3 whitespace-pre-wrap break-words rounded-sm bg-surface-2 p-2 text-xs">{req.note}</p> : null}
            </div>
          </Panel>
          <Panel aria-labelledby="rc-h">
            <PanelHead id="rc-h" title="시뮬 조건" sub="수량·판매가를 바꿔 다시 셈합니다" />
            <form method="get" className="grid gap-3 p-4">
              <Field label="발주 수량" htmlFor="sim-qty">
                <Input id="sim-qty" name="qty" inputMode="numeric" defaultValue={String(d.qty)} />
              </Field>
              <Field label="판매가(부가세 포함, 원)" htmlFor="sim-price">
                <Input id="sim-price" name="price" inputMode="numeric" defaultValue={d.price != null ? String(d.price) : ''} />
              </Field>
              <div>
                <Button type="submit" size="sm">{SOURCING_ACTION.recalc}</Button>
              </div>
              <p className="text-2xs text-muted">
                대행 수수료 {(fees.agentFeeBp / 100).toFixed(1)}% · 샘플 처리 {won(fees.sampleHandlingKrw)}은 {fees.example ? '가정치' : '확인한 값'}입니다. 쿠팡 수수료·로켓그로스 비용은 판매손익 계산기와 같은 기준값입니다.
              </p>
            </form>
          </Panel>
        </div>
        <div className="grid min-w-0 content-start gap-4">
          <Panel aria-labelledby="cc-h">
            <PanelHead
              id="cc-h"
              title={d.stored.length ? `후보 공급처 ${d.stored.length}곳` : '예시 후보 3곳 — 담당이 후보를 넣기 전 미리보기'}
              sub={d.stored.length ? '현지 소싱 담당이 넣은 후보입니다. 조건이 바뀌면 새 판으로 쌓입니다.' : '흉내 제공자가 만든 가짜 후보입니다(실제 공장 아님). 화면과 계산이 어떻게 보이는지만 보여 드립니다.'}
            />
            <CandidateTable items={items} caption="후보 공급처 비교" />
            <p className="border-t border-line-2 px-4 py-2 text-2xs text-muted">
              인증은 「주장」(공급처 말)과 「확인」(담당이 서류로 확인)을 나눕니다. 중국 인증은 KC 가 아닙니다. 유사도는 낱말·분류·가격대로 셈한 참고치입니다.
            </p>
          </Panel>
          <section aria-labelledby="sim-h" className="grid gap-3">
            <h2 id="sim-h" className="text-base font-bold">
              후보마다 도착원가·개당 마진 <span className="text-xs font-normal text-muted">{num(d.qty)}개 · 판매가 {d.price != null ? won(d.price) : '—'}</span>
            </h2>
            {items.map((c) => (
              <SimCard
                key={c.key}
                c={c}
                action={
                  c.id && !c.withdrawn && open ? (
                    <SampleButton requestId={req.id} candidateId={c.id} label={c.label} done={d.done.has(c.id)} qty={d.qty} arrivalPerUnit={c.sim?.sim.arrivalPerUnit ?? null} version={c.version} />
                  ) : c.id ? null : (
                    <span className="text-2xs text-muted">예시 후보는 샘플 요청을 받지 않습니다</span>
                  )
                }
              />
            ))}
          </section>
          <p className="text-xs text-muted">
            발주·대금·품질·인증 취득은 셀러와 공급처가 직접 합니다. FC도착 패밀리는 후보 소개·조건 정리·도착원가 계산까지 돕습니다(미리보기).
          </p>
        </div>
      </div>
    </>
  );
}
