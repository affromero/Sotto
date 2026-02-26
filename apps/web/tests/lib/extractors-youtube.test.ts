import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockFetchLinkContent = vi.fn();

vi.mock('@steipete/summarize-core', () => ({
  createLinkPreviewClient: () => ({
    fetchLinkContent: (...args: unknown[]) => mockFetchLinkContent(...args),
  }),
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
    it('returns transcript text from summarize-core', async () => {
      mockFetchLinkContent.mockResolvedValue({
        content: 'Hello everyone. Welcome to the video.',
        title: 'Test Video',
        description: 'A test video',
        siteName: 'YouTube',
        transcriptSource: 'youtubei',
        transcriptionProvider: null,
        wordCount: 6,
      });

      const result = await extractYouTubeContent('https://www.youtube.com/watch?v=test123');

      expect(result.text).toBe('Hello everyone. Welcome to the video.');
      expect(result.wordCount).toBe(6);
      expect(result.title).toBe('Test Video');
    });

    it('sets sourceType to youtube with summarize-core method', async () => {
      mockFetchLinkContent.mockResolvedValue({
        content: 'Content',
        title: null,
        description: null,
        siteName: 'YouTube',
        transcriptSource: 'captionTracks',
        transcriptionProvider: null,
        wordCount: 1,
      });

      const result = await extractYouTubeContent('https://www.youtube.com/watch?v=test123');

      expect(result.sourceType).toBe('youtube');
      expect(result.extractionMethod).toBe('summarize-core');
      expect(result.siteName).toBe('YouTube');
    });

    it('handles videos without transcript gracefully', async () => {
      mockFetchLinkContent.mockResolvedValue({
        content: '',
        title: null,
        description: null,
        siteName: 'YouTube',
        transcriptSource: null,
        transcriptionProvider: null,
        wordCount: 0,
      });

      const result = await extractYouTubeContent('https://www.youtube.com/watch?v=test123');

      expect(result.text).toBe('');
      expect(result.description).toContain('No transcript available');
      expect(result.sourceType).toBe('youtube');
    });

    it('handles extraction errors', async () => {
      mockFetchLinkContent.mockRejectedValue(new Error('Network error'));

      const result = await extractYouTubeContent('https://www.youtube.com/watch?v=test123');

      expect(result.text).toBe('');
      expect(result.description).toContain('No transcript available');
    });

    it('returns empty content for invalid video ID', async () => {
      const result = await extractYouTubeContent('https://www.youtube.com/');

      expect(result.text).toBe('');
      expect(result.description).toContain('Invalid YouTube URL');
      expect(mockFetchLinkContent).not.toHaveBeenCalled();
    });

    it('passes auto mode and max characters to summarize-core', async () => {
      mockFetchLinkContent.mockResolvedValue({
        content: 'Transcribed content',
        title: null,
        description: null,
        siteName: 'YouTube',
        transcriptSource: 'yt-dlp',
        transcriptionProvider: 'groq',
        wordCount: 2,
      });

      await extractYouTubeContent('https://www.youtube.com/watch?v=test123');

      expect(mockFetchLinkContent).toHaveBeenCalledWith(
        'https://www.youtube.com/watch?v=test123',
        expect.objectContaining({
          youtubeTranscript: 'auto',
          maxCharacters: 50000,
          format: 'text',
        })
      );
    });
  });
});
