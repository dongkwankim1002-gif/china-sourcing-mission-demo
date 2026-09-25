import type { MetadataRoute } from 'next';
import { env } from '@/lib/env';
import { laneStats, listPartners } from '@/lib/server/public';

export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [lanes, partners] = await Promise.all([laneStats(), listPartners()]);
  const base = env.siteUrl;
  const now = new Date();
  return [
    { url: `${base}/`, lastModified: now, changeFrequency: 'hourly', priority: 1 },
    { url: `${base}/lanes`, lastModified: now, changeFrequency: 'hourly', priority: 0.9 },
    { url: `${base}/tools/pnl`, changeFrequency: 'weekly', priority: 0.7 },
    { url: `${base}/partners`, lastModified: now, changeFrequency: 'daily', priority: 0.7 },
    { url: `${base}/faq`, changeFrequency: 'monthly', priority: 0.4 },
    { url: `${base}/policy`, changeFrequency: 'monthly', priority: 0.3 },
    { url: `${base}/join/shipper`, changeFrequency: 'monthly', priority: 0.5 },
    { url: `${base}/join/partner`, changeFrequency: 'monthly', priority: 0.5 },
    ...lanes.map((l) => ({ url: `${base}/lanes/${l.slug}`, lastModified: l.updatedAt ? new Date(l.updatedAt) : now, changeFrequency: 'daily' as const, priority: 0.8 })),
    ...partners.map((p) => ({ url: `${base}/p/${p.slug}`, changeFrequency: 'weekly' as const, priority: p.status === 'official' ? 0.6 : 0.3 })),
  ];
}
