import Link from 'next/link';
import { getLocale, getTranslations } from 'next-intl/server';
import { asUser } from '@/lib/db';
import { requireViewer } from '@/lib/server/viewer';
import { myOrgFacts } from '@/lib/server/partner';
import { getReference } from '@/lib/server/reference';
import { PartnerStatusChip } from '@/components/badges';
import { ProfileForm, ThemePicker } from '@/components/settings-forms';
import { Button, PageTitle, Panel, PanelHead } from '@/components/ui/core';
import { PartnerProfileForm } from './form';

export const metadata = { title: '회사 프로필' };

export default async function PartnerProfile() {
  const v = await requireViewer('partner');
  const t = await getTranslations('p.prof');
  const zh = (await getLocale()) === 'zh';
  const [ref, d] = await Promise.all([
    getReference(),
    asUser(v, async (q) => ({
      org: (await q.query<{ intro: string | null; website: string | null; phone: string | null; address: string | null; cargo_insurance: string | null; license_no: string | null; default_locale: 'ko' | 'zh'; slug: string }>('select intro, website, phone, address, cargo_insurance, license_no, default_locale, slug from fcd.orgs where id = $1', [v.org.id]))[0],
      facts: await myOrgFacts(q, v.org.id),
      me: (await q.query<{ phone: string | null }>('select phone from fcd.profiles where id = $1', [v.id]))[0],
      members: await q.query<{ name: string; email: string; role: string; locale: string }>(`select p.name, p.email, m.role, p.locale from fcd.memberships m join fcd.profiles p on p.id = m.user_id where m.org_id = $1`, [v.org.id]),
    })),
  ]);
  return (
    <>
      <PageTitle title={t('title')} sub={t('sub')} actions={<><PartnerStatusChip status={v.org.status} zh={zh} /><Button asChild variant="secondary"><Link href={`/p/${d.org.slug}`}>{zh ? '查看公开页面' : '공개 페이지 보기'}</Link></Button></>} />
      <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
        <Panel><PanelHead title={v.org.name} sub={v.org.name_zh ?? undefined} /><div className="p-4">
          <PartnerProfileForm
            init={{ intro: d.org.intro ?? '', website: d.org.website ?? '', phone: d.org.phone ?? '', address: d.org.address ?? '', insurance: d.org.cargo_insurance ?? '', licenseNo: d.org.license_no ?? '', locale: d.org.default_locale, hubs: d.facts.hubs, modes: d.facts.modes, caps: d.facts.caps }}
            hubs={ref.hubs.map((h) => ({ code: h.code, name: zh ? h.name_zh : h.name_ko }))}
            modes={ref.modes.map((m) => ({ code: m.code, name: zh ? m.name_zh : m.name_ko }))}
            traits={ref.traits.map((x) => ({ code: x.code, name: zh ? x.name_zh : x.name_ko }))}
            zh={zh}
            canEdit={v.org.role === 'partner_admin'}
          />
        </div></Panel>
        <div className="grid content-start gap-6">
          <Panel><PanelHead title={t('members')} />
            <ul>{d.members.map((m) => <li key={m.email} className="border-b border-line-2 px-4 py-2.5 text-sm last:border-0"><b>{m.name}</b> <span className="text-xs text-muted">{m.email} · {m.role === 'partner_admin' ? (zh ? '管理员' : '관리자') : zh ? '成员' : '담당'}</span></li>)}</ul>
          </Panel>
          <Panel><PanelHead title={zh ? '我的信息' : '내 정보'} /><div className="p-4"><ProfileForm name={v.name} phone={d.me?.phone ?? null} email={v.email} zh={zh} /></div></Panel>
          <Panel><PanelHead title={zh ? '界面' : '화면'} /><div className="p-4"><ThemePicker zh={zh} /></div></Panel>
        </div>
      </div>
    </>
  );
}
