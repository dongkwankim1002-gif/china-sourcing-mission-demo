import { asUser, todayKst } from '@/lib/db';
import { requireViewer } from '@/lib/server/viewer';
import { getReference, nameOf } from '@/lib/server/reference';
import { endAd } from '@/app/actions/admin';
import { ConfirmAction } from '@/components/admin/confirm-action';
import { AdChip, DemoChip } from '@/components/badges';
import { Chip, EmptyState, PageTitle, Panel, PanelHead } from '@/components/ui/core';
import { AdForm } from './form';
import { dateKo } from '@/lib/format';

export const metadata = { title: '광고 자리' };

export default async function Ads() {
  const v = await requireViewer('admin');
  const today = todayKst();
  const [ref, d] = await Promise.all([
    getReference(),
    asUser(v, async (q) => ({
      ads: await q.query<{ id: string; name: string; is_demo: boolean; lane_hub: string | null; lane_port: string | null; starts_on: string; ends_on: string; status: string }>(
        `select a.id, o.name, o.is_demo, a.lane_hub, a.lane_port, a.starts_on, a.ends_on, a.status from fcd.ad_slots a join fcd.orgs o on o.id = a.org_id order by a.status, a.starts_on desc`,
      ),
      partners: await q.query<{ id: string; name: string }>(`select id, name from fcd.orgs where kind = 'partner' and status = 'official' order by name`),
    })),
  ]);
  return (
    <>
      <PageTitle title="광고 자리" sub="광고는 비교 목록 맨 위 한 자리에만, 「광고」 표시와 함께. 추천 점수에는 들어가지 않습니다." />
      <Panel className="mb-6"><PanelHead title="새 광고 자리" /><div className="p-4"><AdForm partners={d.partners} hubs={ref.hubs.map((h) => ({ code: h.code, name: h.name_ko }))} today={today} /></div></Panel>
      <Panel>
        <PanelHead title="광고 목록" />
        {d.ads.length ? (
          <ul>
            {d.ads.map((a) => {
              const live = a.status === 'active' && a.starts_on <= today && a.ends_on >= today;
              return (
                <li key={a.id} className="flex flex-wrap items-center gap-3 border-b border-line-2 px-4 py-3 last:border-0">
                  <AdChip />
                  <b>{a.name}</b>
                  {a.is_demo ? <DemoChip /> : null}
                  <span className="text-sm text-muted">{a.lane_hub ? nameOf(ref, 'hub', a.lane_hub) : '모든 출발'} → {a.lane_port ? nameOf(ref, 'port', a.lane_port) : '모든 도착항'} · {dateKo(a.starts_on, { dow: false })} ~ {dateKo(a.ends_on, { dow: false })}</span>
                  <span className="flex-1" />
                  <Chip tone={live ? 'ok' : 'neutral'}>{live ? '게재 중' : a.status === 'ended' ? '끝남' : '대기'}</Chip>
                  {a.status === 'active' ? <ConfirmAction label="끝내기" variant="danger" action={endAd.bind(null, a.id)} /> : null}
                </li>
              );
            })}
          </ul>
        ) : <EmptyState title="광고 자리가 없습니다" />}
      </Panel>
    </>
  );
}
