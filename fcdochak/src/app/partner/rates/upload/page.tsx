import { getLocale, getTranslations } from 'next-intl/server';
import { requireViewer } from '@/lib/server/viewer';
import { PageTitle, Panel } from '@/components/ui/core';
import { UploadClient } from './client';

export const metadata = { title: '엑셀로 요금표 올리기' };

export default async function Upload() {
  await requireViewer('partner');
  const t = await getTranslations('p.rates');
  const locale = (await getLocale()) as 'ko' | 'zh';
  const zh = locale === 'zh';
  return (
    <>
      <PageTitle title={t('upload')} sub={t('sub')} />
      <Panel className="mb-4 p-4 text-sm">
        <p className="font-semibold">{zh ? '一行 = 一个区段。同一「运价表编号」的九行合成一张运价表。' : '한 줄 = 한 구간입니다. 같은 「요금표키」의 아홉 줄이 요금표 한 장이 됩니다.'}</p>
        <p className="mt-1 text-muted">{zh ? '九段（提货·仓库作业·出口报关·国际运输·港口杂费·韩国报关行·韩国仓库·FC配送·退仓预留）每一段都必须写「包含/不含」。' : '9구간(집하·창고 작업·수출통관·국제운송·항만·관세사·국내 창고·FC 운송·회송 대비) 모두 「포함/제외」를 적어야 합니다. 빠지면 그 요금표는 올라가지 않습니다.'}</p>
      </Panel>
      <UploadClient locale={locale} />
    </>
  );
}
