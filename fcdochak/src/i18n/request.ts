import { cookies } from 'next/headers';
import { getRequestConfig } from 'next-intl/server';
import { getViewer } from '@/lib/server/viewer';

/**
 * 물류사 콘솔만 한국어/중국어(간체)를 바꾼다. 화주·공개·운영 화면은 한국어.
 * 언어: 쿠키(fcd_locale, 머리 띠에서 바꿈) → 없으면 내 계정 언어 → 한국어.
 */
export default getRequestConfig(async () => {
  const jar = await cookies();
  let locale = jar.get('fcd_locale')?.value;
  if (locale !== 'zh' && locale !== 'ko') locale = (await getViewer())?.locale ?? 'ko';
  return {
    locale,
    messages: (await import(`./messages/${locale}.json`)).default,
    timeZone: 'Asia/Seoul',
  };
});
