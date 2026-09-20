import { logger } from '../logger';
import { LANG_LABELS } from '../languages';
import type { ExtractedContent } from './types';
import { YouTubeTranscriptApi } from 'youtube-transcript-ts';

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

const client = new YouTubeTranscriptApi({
  cache: { enabled: true, maxAge: 60 * 60 * 1000, maxSize: 100 },
});
const TRANSCRIPT_LANGUAGES = Object.freeze(Object.keys(LANG_LABELS));

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
      extractionMethod: 'youtube-transcript',
    };
  }

  try {
    const result = await client.fetchTranscript(url, {
      languages: [...TRANSCRIPT_LANGUAGES],
      preserveFormatting: false,
      formatter: 'text',
    });

    const text = result.transcript.snippets
      .map((snippet) => snippet.text.trim())
      .filter(Boolean)
      .join(' ')
      .substring(0, MAX_CONTENT_LENGTH);
    const wordCount = text.split(/\s+/).filter(Boolean).length;

    if (!text || wordCount === 0) {
      logger.warn('YouTube extraction returned empty content', {
        url,
        transcriptSource: result.transcript.isGenerated ? 'generated' : 'creator',
      });
      return {
        text: '',
        markdown: '',
        title: result.metadata.title || null,
        description: 'No transcript available for this video',
        siteName: 'YouTube',
        author: null,
        publishedDate: null,
        wordCount: 0,
        sourceType: 'youtube',
        extractionMethod: 'youtube-transcript',
      };
    }

    logger.info('YouTube content extracted', {
      url,
      wordCount: String(wordCount),
      transcriptSource: result.transcript.isGenerated ? 'generated' : 'creator',
      language: result.transcript.languageCode,
    });

    return {
      text,
      markdown: text,
      title: result.metadata.title || null,
      description: result.metadata.description || null,
      siteName: 'YouTube',
      author: result.metadata.author || null,
      publishedDate: result.metadata.publishDate || null,
      wordCount,
      sourceType: 'youtube',
      extractionMethod: 'youtube-transcript',
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
      extractionMethod: 'youtube-transcript',
    };
  }
}
