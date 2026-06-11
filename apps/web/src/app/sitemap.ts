import { MetadataRoute } from 'next';
import { prisma } from '@/lib/prisma';
import { getAppBaseUrl } from '@/lib/urls';

export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = getAppBaseUrl();

  const staticPages = [
    '',
    '/voices',
    '/about',
    '/join',
    '/terms',
    '/privacy',
    '/changelog',
    '/developers',
    '/support',
    '/feedback',
    '/languages',
  ].map((path) => ({
    url: `${baseUrl}${path}`,
    lastModified: new Date(),
    changeFrequency: 'weekly' as const,
    priority: path === '' ? 1.0 : 0.8,
  }));

  try {
    const podcasts = await prisma.podcast.findMany({
      where: { visibility: 'PUBLIC', status: 'READY' },
      select: { id: true, slug: true, updatedAt: true, user: { select: { handle: true } } },
      orderBy: { updatedAt: 'desc' },
      take: 5000,
    });

    const podcastPages = podcasts.map((p) => ({
      url:
        p.slug && p.user.handle
          ? `${baseUrl}/@${p.user.handle}/${p.slug}`
          : `${baseUrl}/podcast/${p.id}`,
      lastModified: p.updatedAt,
      changeFrequency: 'monthly' as const,
      priority: 0.6,
    }));

    return [...staticPages, ...podcastPages];
  } catch (error) {
    console.error('[sitemap] DB query failed, returning static pages only:', error);
    return staticPages;
  }
}
