import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockFetchTranscript = vi.fn();

vi.mock('youtube-transcript', () => ({
  YoutubeTranscript: {
    fetchTranscript: (...args: unknown[]) => mockFetchTranscript(...args),
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
    it('returns transcript text as content', async () => {
      mockFetchTranscript.mockResolvedValue([
        { text: 'Hello everyone.', offset: 0, duration: 2000 },
        { text: 'Welcome to the video.', offset: 2000, duration: 3000 },
      ]);

      const result = await extractYouTubeContent('https://www.youtube.com/watch?v=test123');

      expect(result.text).toBe('Hello everyone. Welcome to the video.');
      expect(result.wordCount).toBe(6);
    });

    it('sets sourceType to youtube', async () => {
      mockFetchTranscript.mockResolvedValue([{ text: 'Content', offset: 0, duration: 1000 }]);

      const result = await extractYouTubeContent('https://www.youtube.com/watch?v=test123');

      expect(result.sourceType).toBe('youtube');
      expect(result.extractionMethod).toBe('youtube-transcript');
      expect(result.siteName).toBe('YouTube');
    });

    it('handles videos without transcript gracefully', async () => {
      mockFetchTranscript.mockRejectedValue(new Error('Transcript is disabled'));

      const result = await extractYouTubeContent('https://www.youtube.com/watch?v=test123');

      expect(result.text).toBe('');
      expect(result.description).toContain('No transcript available');
      expect(result.sourceType).toBe('youtube');
    });

    it('handles network errors', async () => {
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
  });
});
