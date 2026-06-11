import type { MetadataRoute } from 'next';
import { getAppBaseUrl } from '@/lib/urls';

const AI_CRAWLERS = [
  'GPTBot',
  'ChatGPT-User',
  'OAI-SearchBot',
  'ClaudeBot',
  'anthropic-ai',
  'Claude-Web',
  'Google-Extended',
  'GoogleOther',
  'Meta-ExternalAgent',
  'Meta-ExternalFetcher',
  'FacebookBot',
  'Applebot-Extended',
  'PerplexityBot',
  'Bytespider',
  'Amazonbot',
  'CCBot',
  'Diffbot',
  'cohere-ai',
  'AI2Bot',
  'Ai2Bot-Dolma',
  'Timpibot',
  'VelenPublicWebCrawler',
  'Webzio-Extended',
  'iaskspider',
  'YouBot',
  'PanguBot',
  'ICC-Crawler',
  'Nicecrawler',
  'MistralAI-User',
  'Seekr',
  'omgili',
  'omgilibot',
  'img2dataset',
  'ImagesiftBot',
  'DataForSeoBot',
  'SemrushBot-OCOB',
];

const DISALLOWED_PATHS = [
  '/api/',
  '/admin',
  '/auth/',
  '/dashboard',
  '/create',
  '/settings',
  '/welcome',
  '/team',
  '/pitch',
  '/_next/',
];

export default function robots(): MetadataRoute.Robots {
  const appUrl = getAppBaseUrl();

  return {
    rules: [
      {
        userAgent: '*',
        disallow: DISALLOWED_PATHS,
      },
      ...AI_CRAWLERS.map((bot) => ({
        userAgent: bot,
        disallow: ['/'],
      })),
    ],
    sitemap: `${appUrl}/sitemap.xml`,
  };
}
