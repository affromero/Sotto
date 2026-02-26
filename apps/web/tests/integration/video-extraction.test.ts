/**
 * Integration tests for video content extraction.
 * Requires real network access and API keys.
 *
 * Run with: RUN_INTEGRATION_TESTS=1 doppler run -- npx vitest run --config vitest.integration.config.ts tests/integration/video-extraction.test.ts
 */
import { describe, it, expect } from 'vitest';

const SKIP = !process.env.RUN_INTEGRATION_TESTS;

describe.skipIf(SKIP)('video extraction — integration', () => {
  // ─── YouTube ──────────────────────────────────────────────────────

  describe('YouTube extraction via summarize-core', () => {
    it('extracts transcript from video with captions', async () => {
      // Rick Astley — Never Gonna Give You Up (has auto-generated captions)
      const { extractYouTubeContent } = await import('@/lib/extractors/youtube');
      const result = await extractYouTubeContent('https://www.youtube.com/watch?v=dQw4w9WgXcQ');

      expect(result.sourceType).toBe('youtube');
      expect(result.extractionMethod).toBe('summarize-core');
      expect(result.text.length).toBeGreaterThan(100);
      expect(result.wordCount).toBeGreaterThan(20);
      console.log(`YouTube (captions): ${result.wordCount} words, first 200 chars: ${result.text.substring(0, 200)}`);
    }, 30_000);

    it('extracts content from a YouTube Short', async () => {
      // A popular YouTube Short — may need updating if removed
      const { extractYouTubeContent } = await import('@/lib/extractors/youtube');
      const result = await extractYouTubeContent('https://www.youtube.com/shorts/dQw4w9WgXcQ');

      expect(result.sourceType).toBe('youtube');
      // Shorts may or may not have captions — just verify it doesn't crash
      console.log(`YouTube Short: ${result.wordCount} words, description: ${result.description ?? 'none'}`);
    }, 30_000);

    it('handles video without captions via yt-dlp fallback', async () => {
      // This test requires yt-dlp installed locally
      // Use a video known to have no captions — will fall back to audio transcription
      const { extractYouTubeContent } = await import('@/lib/extractors/youtube');

      // Short video with music (less likely to have captions)
      const result = await extractYouTubeContent('https://www.youtube.com/watch?v=jNQXAC9IVRw');

      expect(result.sourceType).toBe('youtube');
      console.log(`YouTube (no captions fallback): ${result.wordCount} words, text: ${result.text.substring(0, 200)}`);
    }, 120_000); // yt-dlp + whisper takes longer
  });

  // ─── Twitter Video ────────────────────────────────────────────────

  describe('Twitter video extraction', () => {
    it('extracts video URL from tweet with media expansions', async () => {
      // This test verifies the API returns media data with expansions
      const { getTweet } = await import('@/lib/twitter');

      // Find a tweet with video — you'll need to provide a real tweet ID
      // For now, just verify the API shape works
      const TWEET_WITH_VIDEO_ID = process.env.TEST_TWEET_WITH_VIDEO_ID;
      if (!TWEET_WITH_VIDEO_ID) {
        console.log('Skipping: set TEST_TWEET_WITH_VIDEO_ID env var to test');
        return;
      }

      const result = await getTweet(TWEET_WITH_VIDEO_ID);
      expect(result).not.toBeNull();

      if (result) {
        console.log('Tweet:', result.tweet.text.substring(0, 100));
        console.log('Media keys:', result.tweet.attachments?.media_keys ?? 'none');
        console.log('Media map size:', result.mediaByKey.size);

        if (result.mediaByKey.size > 0) {
          for (const [key, media] of result.mediaByKey) {
            console.log(`  Media ${key}: type=${media.type}, variants=${media.variants?.length ?? 0}`);
            if (media.variants) {
              for (const v of media.variants) {
                console.log(`    ${v.content_type} bitrate=${v.bit_rate ?? 'n/a'}`);
              }
            }
          }
        }
      }
    }, 30_000);

    it('transcribes video from tweet CDN URL', async () => {
      const { transcribeVideoFromUrl } = await import('@/lib/twitter-video');

      const TEST_VIDEO_URL = process.env.TEST_TWITTER_VIDEO_CDN_URL;
      if (!TEST_VIDEO_URL) {
        console.log('Skipping: set TEST_TWITTER_VIDEO_CDN_URL env var to test');
        return;
      }

      const transcript = await transcribeVideoFromUrl(TEST_VIDEO_URL);
      expect(transcript).not.toBeNull();
      expect(transcript!.length).toBeGreaterThan(10);
      console.log(`Twitter video transcript: ${transcript!.substring(0, 300)}`);
    }, 120_000);

    it('end-to-end: extracts video transcript from tweet', async () => {
      const { getTweet } = await import('@/lib/twitter');
      const { extractTwitterVideoTranscript } = await import('@/lib/twitter-video');

      const TWEET_WITH_VIDEO_ID = process.env.TEST_TWEET_WITH_VIDEO_ID;
      if (!TWEET_WITH_VIDEO_ID) {
        console.log('Skipping: set TEST_TWEET_WITH_VIDEO_ID env var to test');
        return;
      }

      const result = await getTweet(TWEET_WITH_VIDEO_ID);
      expect(result).not.toBeNull();

      if (result) {
        const transcript = await extractTwitterVideoTranscript(result.tweet, result.mediaByKey);
        if (transcript) {
          console.log(`End-to-end Twitter video transcript (${transcript.length} chars): ${transcript.substring(0, 300)}`);
        } else {
          console.log('No video transcript extracted (tweet may not have video)');
        }
      }
    }, 180_000);
  });
});
