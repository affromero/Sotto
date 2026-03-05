/**
 * Stock footage client — searches Pexels Video API for short clips.
 * Falls back gracefully when PEXELS_API_KEY is not configured.
 */
import { logger } from './logger';

export interface StockVideoResult {
  url: string;
  thumbnailUrl: string;
  duration: number;
  source: 'pexels';
}

interface PexelsVideoFile {
  id: number;
  quality: string;
  file_type: string;
  width: number;
  height: number;
  link: string;
}

interface PexelsVideo {
  id: number;
  url: string;
  image: string;
  duration: number;
  video_files: PexelsVideoFile[];
}

interface PexelsSearchResponse {
  videos: PexelsVideo[];
  total_results: number;
}

/**
 * Search Pexels for a short stock video matching the query.
 * Returns null if no results or API key is not configured.
 */
export async function searchStockVideo(query: string): Promise<StockVideoResult | null> {
  const apiKey = process.env.PEXELS_API_KEY;
  if (!apiKey) {
    logger.warn('PEXELS_API_KEY not set — stock footage unavailable');
    return null;
  }

  try {
    const params = new URLSearchParams({
      query,
      per_page: '5',
      orientation: 'landscape',
      size: 'medium',
    });

    const response = await fetch(`https://api.pexels.com/videos/search?${params}`, {
      headers: { Authorization: apiKey },
    });

    if (!response.ok) {
      logger.warn('Pexels API error', { status: String(response.status) });
      return null;
    }

    const data = (await response.json()) as PexelsSearchResponse;
    if (!data.videos?.length) {
      logger.info('No Pexels results for query', { query });
      return null;
    }

    // Pick the first video with an HD or SD mp4 file
    for (const video of data.videos) {
      const file = video.video_files
        .filter((f) => f.file_type === 'video/mp4' && f.width >= 720)
        .sort((a, b) => a.width - b.width)[0]; // smallest HD file

      if (file) {
        return {
          url: file.link,
          thumbnailUrl: video.image,
          duration: video.duration,
          source: 'pexels',
        };
      }
    }

    return null;
  } catch (err) {
    logger.error('Stock footage search failed', {
      query,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/**
 * Download a stock video/image asset from a URL.
 * Returns the raw buffer for R2 upload.
 */
export async function downloadStockAsset(url: string): Promise<Buffer> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download stock asset: ${response.status}`);
  }
  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}
