import { MetadataRoute } from 'next';
import { getAppBaseUrl } from '@/lib/urls';

export const revalidate = 3600;

export default function sitemap(): MetadataRoute.Sitemap {
  const baseUrl = getAppBaseUrl();

  return [
    '',
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
}
