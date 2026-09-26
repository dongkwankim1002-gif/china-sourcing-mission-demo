import { asUser } from '@/lib/db';
import { requireViewer } from '@/lib/server/viewer';
import { OrgForm, ProfileForm, ThemePicker } from '@/components/settings-forms';
import { PageTitle, Panel, PanelHead } from '@/components/ui/core';
import { dateKo } from '@/lib/format';

export const metadata = { title: '설정' };

const ROLE: Record<string, string> = { shipper_admin: '관리자', shipper_member: '담당', partner_admin: '관리자', partner_member: '담당', platform_admin: '운영자' };

export default async function Settings() {
  const v = await requireViewer('app');
  const d = await asUser(v, async (q) => ({
    me: (await q.query<{ phone: string | null }>('select phone from fcd.profiles where id = $1', [v.id]))[0],
    org: (await q.query<{ biz_reg_no: string | null; address: string | null; phone: string | null; created_at: string }>('select biz_reg_no, address, phone, created_at from fcd.orgs where id = $1', [v.org.id]))[0],
    members: await q.query<{ name: string; email: string; role: string }>(
      `select p.name, p.email, m.role from fcd.memberships m join fcd.profiles p on p.id = m.user_id where m.org_id = $1 order by m.role, p.name`,
      [v.org.id],
    ),
  }));
  return (
    <>
      <PageTitle title="설정" sub={`${v.org.name} · ${dateKo(d.org.created_at, { dow: false })} 가입`} />
      <div className="grid gap-6 lg:grid-cols-2">
        <Panel><PanelHead title="내 정보" /><div className="p-4"><ProfileForm name={v.name} phone={d.me?.phone ?? null} email={v.email} /></div></Panel>
        <Panel><PanelHead title="회사 정보" /><div className="p-4"><OrgForm bizRegNo={d.org.biz_reg_no} address={d.org.address} phone={d.org.phone} canEdit={v.org.role.endsWith('admin')} /></div></Panel>
        <Panel>
          <PanelHead title="구성원" sub="초대는 운영팀에 요청해 주세요(1차)" />
          <ul>
            {d.members.map((m) => (
              <li key={m.email} className="flex items-center justify-between border-b border-line-2 px-4 py-2.5 text-sm last:border-0">
                <span><b>{m.name}</b> <span className="text-xs text-muted">{m.email}</span></span>
                <span className="text-xs text-muted">{ROLE[m.role] ?? m.role}</span>
              </li>
            ))}
          </ul>
        </Panel>
        <Panel><PanelHead title="화면" /><div className="p-4"><ThemePicker /></div></Panel>
      </div>
    </>
  );
}
