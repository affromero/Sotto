import * as os from 'os';
import * as path from 'path';
import * as crypto from 'crypto';
import { writeFile, mkdir, rm, readFile } from 'fs/promises';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { createSttProvider } from './providers/stt';
import { logger } from './logger';
import type { TwitterTweet, TwitterMedia } from '@/types/twitter';

const execFileAsync = promisify(execFile);

const MAX_VIDEO_DURATION_MS = 30 * 60 * 1000; // 30 minutes

/**
 * Extract the highest-bitrate MP4 video URL from a tweet's media attachments.
 * Returns null if the tweet has no video attachments.
 */
export function extractVideoUrl(
  tweet: TwitterTweet,
  mediaByKey: Map<string, TwitterMedia>
): string | null {
  const mediaKeys = tweet.attachments?.media_keys;
  if (!mediaKeys || mediaKeys.length === 0) return null;

  for (const key of mediaKeys) {
    const media = mediaByKey.get(key);
    if (!media) continue;

    if (media.type !== 'video' && media.type !== 'animated_gif') continue;

    // Skip videos longer than 30 minutes
    if (media.duration_ms && media.duration_ms > MAX_VIDEO_DURATION_MS) {
      logger.warn('Skipping video — exceeds 30 minute limit', {
        mediaKey: key,
        durationMs: String(media.duration_ms),
      });
      continue;
    }

    if (!media.variants || media.variants.length === 0) continue;

    // Pick the highest bitrate MP4 variant
    const mp4Variants = media.variants
      .filter((v) => v.content_type === 'video/mp4' && v.bit_rate !== undefined)
      .sort((a, b) => (b.bit_rate ?? 0) - (a.bit_rate ?? 0));

    if (mp4Variants.length > 0) {
      return mp4Variants[0].url;
    }
  }

  return null;
}

/**
 * Download a video from a URL, extract audio with FFmpeg, and transcribe with OpenAI Whisper.
 * Returns the transcript text, or null if transcription fails.
 */
export async function transcribeVideoFromUrl(videoUrl: string): Promise<string | null> {
  const tmpDir = path.join(os.tmpdir(), `sotto-video-${crypto.randomBytes(8).toString('hex')}`);
  const videoPath = path.join(tmpDir, 'video.mp4');
  const audioPath = path.join(tmpDir, 'audio.mp3');

  try {
    await mkdir(tmpDir, { recursive: true });

    // Download video from CDN
    logger.info('Downloading video for transcription', { url: videoUrl.substring(0, 100) });
    const response = await fetch(videoUrl);
    if (!response.ok) {
      logger.error('Failed to download video', { status: String(response.status) });
      return null;
    }

    // Size cap: reject videos over 100MB to prevent memory/cost abuse
    const MAX_VIDEO_BYTES = 100 * 1024 * 1024;
    const contentLength = parseInt(response.headers.get('content-length') || '0', 10);
    if (contentLength > MAX_VIDEO_BYTES) {
      logger.warn('Video too large for transcription', { bytes: String(contentLength), max: String(MAX_VIDEO_BYTES) });
      return null;
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.byteLength > MAX_VIDEO_BYTES) {
      logger.warn('Video too large for transcription (post-download)', { bytes: String(buffer.byteLength) });
      return null;
    }
    await writeFile(videoPath, buffer);

    // Extract audio with FFmpeg
    logger.info('Extracting audio from video');
    await execFileAsync('ffmpeg', [
      '-i', videoPath,
      '-vn',
      '-acodec', 'libmp3lame',
      '-q:a', '2',
      '-y',
      audioPath,
    ]);

    // Transcribe with OpenAI Whisper
    const audioBuffer = await readFile(audioPath);
    const stt = createSttProvider('openai');
    const result = await stt.transcribe(audioBuffer);

    logger.info('Video transcription complete', {
      textLength: String(result.text.length),
      language: result.language ?? 'unknown',
    });

    return result.text || null;
  } catch (err) {
    logger.error('Video transcription failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  } finally {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Fallback: use yt-dlp to download video from a tweet URL and transcribe it.
 * Used when the Twitter API v2 doesn't return video variants.
 */
export async function transcribeVideoWithYtDlp(tweetUrl: string): Promise<string | null> {
  const ytDlpPath = process.env.YT_DLP_PATH || 'yt-dlp';
  const tmpDir = path.join(os.tmpdir(), `sotto-ytdlp-${crypto.randomBytes(8).toString('hex')}`);
  const audioPath = path.join(tmpDir, 'audio.mp3');

  try {
    await mkdir(tmpDir, { recursive: true });

    logger.info('Downloading video with yt-dlp', { url: tweetUrl });
    await execFileAsync(ytDlpPath, [
      '--extract-audio',
      '--audio-format', 'mp3',
      '-o', audioPath,
      '--no-playlist',
      tweetUrl,
    ], { timeout: 120_000 });

    const audioBuffer = await readFile(audioPath);
    const stt = createSttProvider('openai');
    const result = await stt.transcribe(audioBuffer);

    logger.info('yt-dlp video transcription complete', {
      textLength: String(result.text.length),
    });

    return result.text || null;
  } catch (err) {
    logger.error('yt-dlp video transcription failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  } finally {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Orchestrator: extract video transcript from a tweet.
 * 1. Try direct MP4 download from Twitter CDN (via API media expansions)
 * 2. Fall back to yt-dlp if no variants available
 * Returns the transcript text, or null if no video or transcription fails.
 */
export async function extractTwitterVideoTranscript(
  tweet: TwitterTweet,
  mediaByKey: Map<string, TwitterMedia>
): Promise<string | null> {
  const videoUrl = extractVideoUrl(tweet, mediaByKey);

  if (videoUrl) {
    const transcript = await transcribeVideoFromUrl(videoUrl);
    if (transcript) return transcript;

    // API URL failed — fall through to yt-dlp
    logger.warn('Direct video download failed, trying yt-dlp fallback');
  }

  // Check if the tweet even has video attachments worth trying yt-dlp for
  const hasVideoAttachment = tweet.attachments?.media_keys?.some((key) => {
    const media = mediaByKey.get(key);
    return media && (media.type === 'video' || media.type === 'animated_gif');
  });

  if (!hasVideoAttachment && !videoUrl) {
    return null; // No video content to transcribe
  }

  // yt-dlp fallback
  const tweetUrl = `https://x.com/i/status/${tweet.id}`;
  return transcribeVideoWithYtDlp(tweetUrl);
}
