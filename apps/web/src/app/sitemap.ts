import { MetadataRoute } from 'next';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = 'https://sotto.fm';

  const staticPages = [
    '', '/feed', '/voices', '/about', '/join', '/terms',
    '/privacy', '/changelog', '/developers', '/support', '/pricing', '/feedback',
  ].map((path) => ({
    url: `${baseUrl}${path}`,
    lastModified: new Date(),
    changeFrequency: 'weekly' as const,
    priority: path === '' ? 1.0 : 0.8,
  }));

  const podcasts = await prisma.podcast.findMany({
    where: { visibility: 'PUBLIC', status: 'READY' },
    select: { id: true, updatedAt: true },
    orderBy: { updatedAt: 'desc' },
    take: 5000,
  });

  const podcastPages = podcasts.map((p) => ({
    url: `${baseUrl}/podcast/${p.id}`,
    lastModified: p.updatedAt,
    changeFrequency: 'monthly' as const,
    priority: 0.6,
  }));

  const [users, collections] = await Promise.all([
    prisma.user.findMany({
      where: { handle: { not: null } },
      select: { handle: true, updatedAt: true },
      take: 5000,
    }),
    prisma.collection.findMany({
      where: { isPublic: true },
      select: { id: true, updatedAt: true },
      take: 5000,
    }),
  ]);

  const profilePages = users.map((u) => ({
    url: `${baseUrl}/@${u.handle}`,
    lastModified: u.updatedAt,
    changeFrequency: 'weekly' as const,
    priority: 0.5,
  }));

  const collectionPages = collections.map((c) => ({
    url: `${baseUrl}/collections/${c.id}`,
    lastModified: c.updatedAt,
    changeFrequency: 'weekly' as const,
    priority: 0.5,
  }));

  return [...staticPages, ...podcastPages, ...profilePages, ...collectionPages];
}
