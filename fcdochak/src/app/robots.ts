import type { MetadataRoute } from 'next';
import { env } from '@/lib/env';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: '*', allow: '/', disallow: ['/app$', '/app/', '/partner$', '/partner/', '/admin$', '/admin/', '/api/', '/styleguide', '/forbidden', '/interview/', '/lab'] }],
    sitemap: `${env.siteUrl}/sitemap.xml`,
  };
}
