import { cookies } from 'next/headers';
import { getRequestConfig } from 'next-intl/server';

/**
 * 물류사 콘솔만 한국어/중국어(간체)를 바꾼다. 화주·공개·운영 화면은 한국어.
 * 언어는 쿠키(fcd_locale) → 없으면 한국어.
 */
export default getRequestConfig(async () => {
  const jar = await cookies();
  const locale = jar.get('fcd_locale')?.value === 'zh' ? 'zh' : 'ko';
  return {
    locale,
    messages: (await import(`./messages/${locale}.json`)).default,
    timeZone: 'Asia/Seoul',
  };
});
