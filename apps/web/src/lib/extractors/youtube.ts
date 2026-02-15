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

  const { YoutubeTranscript } = await import('youtube-transcript');

  try {
    const transcript = await YoutubeTranscript.fetchTranscript(videoId);
    const text = transcript
      .map((entry: { text: string }) => entry.text)
      .join(' ')
      .substring(0, MAX_CONTENT_LENGTH);

    const wordCount = text.split(/\s+/).filter(Boolean).length;

    return {
      text,
      markdown: text,
      title: null,
      description: null,
      siteName: 'YouTube',
      author: null,
      publishedDate: null,
      wordCount,
      sourceType: 'youtube',
      extractionMethod: 'youtube-transcript',
    };
  } catch {
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
