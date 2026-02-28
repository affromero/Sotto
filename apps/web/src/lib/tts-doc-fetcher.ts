/**
 * TTS provider docs fetcher — fetch formatting documentation from provider URLs,
 * cache in Redis (24h TTL), with graceful fallback on failure.
 */
import { cache } from './redis';
import { logger } from './logger';

const CACHE_TTL = 24 * 60 * 60; // 24 hours
const FETCH_TIMEOUT = 10_000;

/** Strip HTML to plain text, keeping only main content. */
function extractMainContent(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[\s\S]*?<\/nav>/gi, '')
    .replace(/<header[\s\S]*?<\/header>/gi, '')
    .replace(/<footer[\s\S]*?<\/footer>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, 4000);
}

export async function fetchProviderDocs(providerId: string, docsUrl: string): Promise<string | null> {
  const cacheKey = `tts-docs:${providerId}`;

  const cached = await cache.get<string>(cacheKey);
  if (cached) return cached;

  try {
    const res = await fetch(docsUrl, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT),
      headers: { 'User-Agent': 'Sotto/1.0 (TTS docs fetcher)' },
    });
    if (!res.ok) return null;
    const html = await res.text();
    const text = extractMainContent(html);
    if (text.length < 50) return null; // JS-rendered SPA with empty shell
    await cache.set(cacheKey, text, CACHE_TTL);
    return text;
  } catch (err) {
    logger.warn('Failed to fetch TTS provider docs', { providerId, docsUrl, error: String(err) });
    return null;
  }
}
