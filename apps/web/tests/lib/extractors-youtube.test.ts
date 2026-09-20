import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockFetchTranscript = vi.fn();

vi.mock('youtube-transcript-ts', () => ({
  YouTubeTranscriptApi: class {
    fetchTranscript(...args: unknown[]) {
      return mockFetchTranscript(...args);
    }
  },
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import { isYouTubeUrl, extractVideoId, extractYouTubeContent } from '@/lib/extractors/youtube';

function transcriptResult(text: string, generated = false) {
  return {
    transcript: {
      snippets: text ? [{ text, start: 0, duration: 1 }] : [],
      videoId: 'test123',
      language: 'English',
      languageCode: 'en',
      isGenerated: generated,
    },
    metadata: {
      id: 'test123',
      title: 'Test Video',
      description: 'A test video',
      author: 'Test Author',
      channelId: 'channel',
      lengthSeconds: 10,
      viewCount: 1,
      isPrivate: false,
      isLiveContent: false,
      publishDate: '2026-09-01',
    },
  };
}

describe('youtube extractor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('isYouTubeUrl', () => {
    it('matches youtube.com/watch?v=xxx', () => {
      expect(isYouTubeUrl('https://www.youtube.com/watch?v=abc123')).toBe(true);
    });

    it('matches youtu.be/xxx', () => {
      expect(isYouTubeUrl('https://youtu.be/abc123')).toBe(true);
    });

    it('matches m.youtube.com/watch?v=xxx', () => {
      expect(isYouTubeUrl('https://m.youtube.com/watch?v=abc123')).toBe(true);
    });

    it('matches youtube.com/shorts/xxx', () => {
      expect(isYouTubeUrl('https://www.youtube.com/shorts/abc123')).toBe(true);
    });

    it('rejects non-YouTube URLs', () => {
      expect(isYouTubeUrl('https://example.com/video')).toBe(false);
      expect(isYouTubeUrl('https://vimeo.com/123')).toBe(false);
    });
  });

  describe('extractVideoId', () => {
    it('extracts ID from standard watch URL', () => {
      expect(extractVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    });

    it('extracts ID from short URL', () => {
      expect(extractVideoId('https://youtu.be/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    });

    it('extracts ID from embed URL', () => {
      expect(extractVideoId('https://www.youtube.com/embed/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    });

    it('extracts ID from shorts URL', () => {
      expect(extractVideoId('https://www.youtube.com/shorts/abc123')).toBe('abc123');
    });

    it('returns null for invalid URL', () => {
      expect(extractVideoId('not a url')).toBeNull();
    });

    it('returns null for YouTube URL without video ID', () => {
      expect(extractVideoId('https://www.youtube.com/')).toBeNull();
    });
  });

  describe('extractYouTubeContent', () => {
    it('returns transcript text and video metadata', async () => {
      mockFetchTranscript.mockResolvedValue(
        transcriptResult('Hello everyone. Welcome to the video.')
      );

      const result = await extractYouTubeContent('https://www.youtube.com/watch?v=test123');

      expect(result.text).toBe('Hello everyone. Welcome to the video.');
      expect(result.wordCount).toBe(6);
      expect(result.title).toBe('Test Video');
    });

    it('sets sourceType to youtube with the transcript method', async () => {
      mockFetchTranscript.mockResolvedValue(transcriptResult('Content'));

      const result = await extractYouTubeContent('https://www.youtube.com/watch?v=test123');

      expect(result.sourceType).toBe('youtube');
      expect(result.extractionMethod).toBe('youtube-transcript');
      expect(result.siteName).toBe('YouTube');
    });

    it('handles videos without transcript gracefully', async () => {
      mockFetchTranscript.mockResolvedValue(transcriptResult(''));

      const result = await extractYouTubeContent('https://www.youtube.com/watch?v=test123');

      expect(result.text).toBe('');
      expect(result.description).toContain('No transcript available');
      expect(result.sourceType).toBe('youtube');
    });

    it('handles extraction errors', async () => {
      mockFetchTranscript.mockRejectedValue(new Error('Network error'));

      const result = await extractYouTubeContent('https://www.youtube.com/watch?v=test123');

      expect(result.text).toBe('');
      expect(result.description).toContain('No transcript available');
    });

    it('returns empty content for invalid video ID', async () => {
      const result = await extractYouTubeContent('https://www.youtube.com/');

      expect(result.text).toBe('');
      expect(result.description).toContain('Invalid YouTube URL');
      expect(mockFetchTranscript).not.toHaveBeenCalled();
    });

    it('requests every supported course language without formatting', async () => {
      mockFetchTranscript.mockResolvedValue(transcriptResult('Transcribed content'));

      await extractYouTubeContent('https://www.youtube.com/watch?v=test123');

      expect(mockFetchTranscript).toHaveBeenCalledWith(
        'https://www.youtube.com/watch?v=test123',
        expect.objectContaining({
          languages: expect.arrayContaining(['en', 'de', 'es', 'fr', 'ja']),
          preserveFormatting: false,
          formatter: 'text',
        })
      );
    });
  });
});
