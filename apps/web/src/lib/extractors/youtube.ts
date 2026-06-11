import { logger } from '../logger';
import type { ExtractedContent } from './types';

const YOUTUBE_PATTERNS = [
  /^https?:\/\/(?:www\.)?youtube\.com\/watch\?/,
  /^https?:\/\/youtu\.be\//,
  /^https?:\/\/m\.youtube\.com\/watch\?/,
  /^https?:\/\/(?:www\.)?youtube\.com\/shorts\//,
  /^https?:\/\/(?:www\.)?youtube\.com\/embed\//,
];

const MAX_CONTENT_LENGTH = 50000;

export function isYouTubeUrl(url: string): boolean {
  return YOUTUBE_PATTERNS.some((pattern) => pattern.test(url));
}

export function extractVideoId(url: string): string | null {
  try {
    const parsed = new URL(url);

    // youtube.com/watch?v=ID
    if (parsed.hostname.includes('youtube.com') && parsed.searchParams.has('v')) {
      return parsed.searchParams.get('v');
    }

    // youtu.be/ID
    if (parsed.hostname === 'youtu.be') {
      const id = parsed.pathname.slice(1);
      return id || null;
    }

    // youtube.com/shorts/ID or youtube.com/embed/ID
    const pathMatch = parsed.pathname.match(/^\/(?:shorts|embed)\/([a-zA-Z0-9_-]+)/);
    if (pathMatch) {
      return pathMatch[1];
    }

    return null;
  } catch {
    return null;
  }
}

// Lazy-loaded to avoid crashing CJS workers — the package only exports ESM
 
let clientInstance: any = null;

async function getClient() {
  if (!clientInstance) {
    const { createLinkPreviewClient } = await import('@steipete/summarize-core');
    clientInstance = createLinkPreviewClient({
      openaiApiKey: process.env.OPENAI_API_KEY ?? null,
      ytDlpPath: process.env.YT_DLP_PATH || 'yt-dlp',
      onProgress: (event: { kind: string }) => {
        logger.debug('YouTube extraction progress', { kind: event.kind });
      },
    });
  }
  return clientInstance;
}

export async function extractYouTubeContent(url: string): Promise<ExtractedContent> {
  const videoId = extractVideoId(url);
  if (!videoId) {
    return {
      text: '',
      markdown: '',
      title: null,
      description: 'Invalid YouTube URL — could not extract video ID',
      siteName: 'YouTube',
      author: null,
      publishedDate: null,
      wordCount: 0,
      sourceType: 'youtube',
      extractionMethod: 'summarize-core',
    };
  }

  try {
    const client = await getClient();
    const result = await client.fetchLinkContent(url, {
      youtubeTranscript: 'auto',
      maxCharacters: MAX_CONTENT_LENGTH,
      format: 'text',
    });

    const text = result.content.substring(0, MAX_CONTENT_LENGTH);
    const wordCount = text.split(/\s+/).filter(Boolean).length;

    if (!text || wordCount === 0) {
      logger.warn('YouTube extraction returned empty content', {
        url,
        transcriptSource: result.transcriptSource ?? 'none',
      });
      return {
        text: '',
        markdown: '',
        title: result.title,
        description: 'No transcript available for this video',
        siteName: 'YouTube',
        author: null,
        publishedDate: null,
        wordCount: 0,
        sourceType: 'youtube',
        extractionMethod: 'summarize-core',
      };
    }

    logger.info('YouTube content extracted', {
      url,
      wordCount: String(wordCount),
      transcriptSource: result.transcriptSource ?? 'unknown',
      transcriptionProvider: result.transcriptionProvider ?? 'none',
    });

    return {
      text,
      markdown: text,
      title: result.title,
      description: result.description,
      siteName: result.siteName ?? 'YouTube',
      author: null,
      publishedDate: null,
      wordCount,
      sourceType: 'youtube',
      extractionMethod: 'summarize-core',
    };
  } catch (err) {
    logger.error('YouTube extraction failed', {
      url,
      error: err instanceof Error ? err.message : String(err),
    });

    return {
      text: '',
      markdown: '',
      title: null,
      description: 'No transcript available for this video',
      siteName: 'YouTube',
      author: null,
      publishedDate: null,
      wordCount: 0,
      sourceType: 'youtube',
      extractionMethod: 'summarize-core',
    };
  }
}
