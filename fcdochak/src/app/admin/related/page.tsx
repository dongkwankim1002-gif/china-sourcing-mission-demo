import { asUser } from '@/lib/db';
import { requireViewer } from '@/lib/server/viewer';
import { setRelatedParty } from '@/app/actions/admin';
import { ConfirmAction } from '@/components/admin/confirm-action';
import { DemoChip, RelatedChip } from '@/components/badges';
import { EmptyState, PageTitle, Panel, PanelHead } from '@/components/ui/core';

export const metadata = { title: '특수관계 공개' };

export default async function Related() {
  const v = await requireViewer('admin');
  const orgs = await asUser(v, (q) => q.query<{ id: string; name: string; is_demo: boolean; related_party_note: string | null; status: string }>(`select id, name, is_demo, related_party_note, status from fcd.orgs where kind = 'partner' and status <> 'deleted' order by (related_party_note is null), name`));
  const withNote = orgs.filter((o) => o.related_party_note);
  const rest = orgs.filter((o) => !o.related_party_note);
  return (
    <>
      <PageTitle title="특수관계 공개" sub="플랫폼 운영사와 특수관계가 있는 업체는 카드·상세에 「특수관계 공개」가 붙습니다. 추천 점수에는 영향이 없습니다." />
      <Panel className="mb-6">
        <PanelHead title={`공개 중 ${withNote.length}곳`} />
        {withNote.length ? (
          <ul>
            {withNote.map((o) => (
              <li key={o.id} className="flex flex-wrap items-start gap-3 border-b border-line-2 px-4 py-3 last:border-0">
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 font-bold">{o.name}<RelatedChip />{o.is_demo ? <DemoChip /> : null}</p>
                  <p className="mt-1 text-sm">{o.related_party_note}</p>
                </div>
                <ConfirmAction label="문구 바꾸기" needNote title={`${o.name} 특수관계 문구`} description="새 문구를 적으세요. 비우면 공개를 거둡니다." action={setRelatedParty.bind(null, o.id)} />
              </li>
            ))}
          </ul>
        ) : <EmptyState title="공개 중인 특수관계가 없습니다" />}
      </Panel>
      <Panel>
        <PanelHead title="특수관계 추가" />
        <ul className="grid gap-px bg-line-2 sm:grid-cols-2 lg:grid-cols-3">
          {rest.map((o) => (
            <li key={o.id} className="flex items-center justify-between gap-2 bg-surface px-4 py-2.5 text-sm">
              <span className="flex items-center gap-1.5 truncate">{o.name}{o.is_demo ? <DemoChip /> : null}</span>
              <ConfirmAction label="공개" needNote title={`${o.name} 특수관계 공개`} notePlaceholder="예: 운영사 임원의 가족이 지분 20% 보유" action={setRelatedParty.bind(null, o.id)} />
            </li>
          ))}
        </ul>
      </Panel>
    </>
  );
}
