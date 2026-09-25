import Link from 'next/link';
import { asUser } from '@/lib/db';
import { requireViewer } from '@/lib/server/viewer';
import { listClientPartners, listInvites, workspaceSettings } from '@/lib/server/workspace';
import { InviteForm, RevokeButton } from '@/components/workspace/invite-form';
import { PartnerStatusChip } from '@/components/badges';
import { Chip, EmptyState, PageTitle, Panel, PanelHead, type Tone } from '@/components/ui/core';
import { BIZ_TYPE_LABEL } from '@/lib/terms';
import { dateKo, dateTimeKo, num } from '@/lib/format';
import { INVITE_STATUS_LABEL, inviteStatus, type InviteStatus } from '@/lib/workspace/invite';

export const metadata = { title: '거래처' };

const TONE: Record<InviteStatus, Tone> = { open: 'label', used: 'ok', expired: 'neutral', revoked: 'neutral' };

export default async function PartnersPage() {
  const v = await requireViewer('app');
  const { invites, partners, ws } = await asUser(v, async (q) => ({
    invites: await listInvites(q, v.org.id),
    partners: await listClientPartners(q, v.org.id),
    ws: await workspaceSettings(q),
  }));
  const now = new Date();
  return (
    <>
      <PageTitle title="거래처" sub="이미 거래하는 포워더를 초대해 이곳에서 견적·선적·서류·청구를 함께 봅니다. 운송계약은 화주와 물류사가 직접 맺습니다." />
      <div className="grid gap-6 xl:grid-cols-[1fr_1fr]">
        <div className="grid min-w-0 content-start gap-4">
          <InviteForm days={ws.inviteDays} />
          <Panel aria-labelledby="inv-h">
            <PanelHead id="inv-h" title={`보낸 초대 ${invites.length}건`} sub="링크 자체는 저장하지 않아 다시 보여 드릴 수 없습니다. 잃어버렸으면 거두고 새로 만드세요." />
            {invites.length ? (
              <ul className="divide-y divide-line-2" data-testid="invite-list">
                {invites.map((i) => {
                  const st = inviteStatus({ expires_at: i.expires_at, revoked_at: i.revoked_at, accepted: !!i.accepted_org }, now);
                  return (
                    <li key={i.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5">
                      <div className="min-w-0 flex-1 basis-48">
                        <p className="truncate text-sm font-semibold">{i.partner_name}</p>
                        <p className="text-xs text-muted">
                          {dateKo(i.created_at, { dow: false })} 만듦{i.who ? ` · ${i.who}` : ''}
                          {st === 'open' ? ` · ${dateTimeKo(i.expires_at)}까지` : ''}
                          {st === 'used' && i.accepted_org ? ` · 「${i.accepted_org}」로 가입` : ''}
                          {i.contact_email ? ` · ${i.contact_email}` : ''}
                        </p>
                      </div>
                      <Chip tone={TONE[st]}>{INVITE_STATUS_LABEL[st]}</Chip>
                      {st === 'open' ? <RevokeButton id={i.id} /> : null}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="px-4 py-4 text-sm text-muted">아직 보낸 초대가 없습니다.</p>
            )}
          </Panel>
        </div>
        <Panel className="content-start self-start" aria-labelledby="cp-h">
          <PanelHead id="cp-h" title={`내 거래처 ${partners.length}곳`} sub="초대로 연결한 곳과 예약으로 거래한 곳" />
          {partners.length ? (
            <ul className="divide-y divide-line-2" data-testid="client-partners">
              {partners.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5">
                  <div className="min-w-0 flex-1 basis-48">
                    <p className="truncate text-sm font-semibold">
                      {p.slug ? <Link href={`/p/${p.slug}`} className="hover:underline">{p.name}</Link> : p.name}
                    </p>
                    <p className="text-xs text-muted">
                      {p.business_type ? BIZ_TYPE_LABEL[p.business_type] ?? p.business_type : '업종 미입력'}
                      {p.shipments ? ` · 선적 ${num(p.shipments)}건 · 최근 ${dateKo(p.last_shipment_at, { dow: false })}` : ' · 아직 선적 없음'}
                    </p>
                  </div>
                  {p.via_invite ? <Chip tone="ok">초대로 연결{p.linked_at ? ` · ${dateKo(p.linked_at, { dow: false })}` : ''}</Chip> : <Chip>거래 이력</Chip>}
                  <PartnerStatusChip status={p.status} />
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="아직 거래처가 없습니다" body="「내 포워더 초대하기」에서 초대 링크를 만들어 쓰던 포워더에게 보내 보세요." />
          )}
        </Panel>
      </div>
    </>
  );
}
