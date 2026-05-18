import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

const mockTranscribe = vi.fn();
vi.mock('@/lib/providers/stt', () => ({
  createSttProvider: () => ({ transcribe: mockTranscribe }),
}));

import { extractVideoUrl, extractTwitterVideoTranscript } from '@/lib/twitter-video';
import type { TwitterTweet, TwitterMedia } from '@/types/twitter';

function makeTweet(overrides: Partial<TwitterTweet> = {}): TwitterTweet {
  return {
    id: 'tweet-1',
    text: '@podbot check this out',
    author_id: 'user-1',
    created_at: '2026-02-26T00:00:00Z',
    ...overrides,
  };
}

function makeMedia(overrides: Partial<TwitterMedia> = {}): TwitterMedia {
  return {
    media_key: 'media-1',
    type: 'video',
    duration_ms: 30000,
    variants: [
      { bit_rate: 832000, content_type: 'video/mp4', url: 'https://video.twimg.com/low.mp4' },
      { bit_rate: 2176000, content_type: 'video/mp4', url: 'https://video.twimg.com/high.mp4' },
      { content_type: 'application/x-mpegURL', url: 'https://video.twimg.com/stream.m3u8' },
    ],
    ...overrides,
  };
}

describe('twitter-video', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('extractVideoUrl', () => {
    it('returns highest bitrate MP4 URL from tweet video attachments', () => {
      const tweet = makeTweet({ attachments: { media_keys: ['media-1'] } });
      const mediaByKey = new Map([['media-1', makeMedia()]]);

      const url = extractVideoUrl(tweet, mediaByKey);
      expect(url).toBe('https://video.twimg.com/high.mp4');
    });

    it('returns null when tweet has no attachments', () => {
      const tweet = makeTweet();
      const url = extractVideoUrl(tweet, new Map());
      expect(url).toBeNull();
    });

    it('returns null when tweet has photo but no video', () => {
      const tweet = makeTweet({ attachments: { media_keys: ['media-1'] } });
      const mediaByKey = new Map([['media-1', makeMedia({ type: 'photo', variants: undefined })]]);

      const url = extractVideoUrl(tweet, mediaByKey);
      expect(url).toBeNull();
    });

    it('returns null when media key is not in the lookup map', () => {
      const tweet = makeTweet({ attachments: { media_keys: ['missing-key'] } });
      const url = extractVideoUrl(tweet, new Map());
      expect(url).toBeNull();
    });

    it('skips videos longer than 30 minutes', () => {
      const tweet = makeTweet({ attachments: { media_keys: ['media-1'] } });
      const mediaByKey = new Map([['media-1', makeMedia({ duration_ms: 31 * 60 * 1000 })]]);

      const url = extractVideoUrl(tweet, mediaByKey);
      expect(url).toBeNull();
    });

    it('returns null when video has no MP4 variants', () => {
      const tweet = makeTweet({ attachments: { media_keys: ['media-1'] } });
      const mediaByKey = new Map([['media-1', makeMedia({
        variants: [{ content_type: 'application/x-mpegURL', url: 'https://stream.m3u8' }],
      })]]);

      const url = extractVideoUrl(tweet, mediaByKey);
      expect(url).toBeNull();
    });

    it('handles animated_gif type as video', () => {
      const tweet = makeTweet({ attachments: { media_keys: ['media-1'] } });
      const mediaByKey = new Map([['media-1', makeMedia({ type: 'animated_gif' })]]);

      const url = extractVideoUrl(tweet, mediaByKey);
      expect(url).toBe('https://video.twimg.com/high.mp4');
    });
  });

  describe('extractTwitterVideoTranscript', () => {
    it('returns null when tweet has no video attachments', async () => {
      const tweet = makeTweet();
      const result = await extractTwitterVideoTranscript(tweet, new Map());
      expect(result).toBeNull();
    });
  });
});
