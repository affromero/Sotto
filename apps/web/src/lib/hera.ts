import { logger } from './logger';
import { logUsage } from './usage-logger';

const HERA_BASE_URL = 'https://api.hera.video/v1';
const POLL_INTERVAL_MS = 5_000;
const POLL_TIMEOUT_MS = 10 * 60 * 1_000; // 10 minutes

function getApiKey(): string | null {
  return process.env.HERA_API_KEY ?? null;
}

function headers(): Record<string, string> {
  return {
    'x-api-key': getApiKey()!,
    'Content-Type': 'application/json',
  };
}

export async function createHeraJob(params: {
  prompt: string;
  durationSeconds: number;
  referenceImageUrl?: string;
  aspectRatio?: '16:9' | '9:16' | '1:1';
}): Promise<{ videoId: string } | null> {
  const apiKey = getApiKey();
  if (!apiKey) {
    logger.warn('HERA_API_KEY not set, skipping Hera job creation');
    return null;
  }

  const res = await fetch(`${HERA_BASE_URL}/generations`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({
      prompt: params.prompt,
      duration: params.durationSeconds,
      reference_image_url: params.referenceImageUrl,
      output: {
        format: 'mp4',
        aspect_ratio: params.aspectRatio ?? '16:9',
        fps: '30',
        resolution: '1080p',
      },
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => 'unknown');
    logger.error('Hera job creation failed', { status: res.status, body: text });
    return null;
  }

  const data = (await res.json()) as { id?: string };
  if (!data.id) {
    logger.error('Hera response missing video ID', { data });
    return null;
  }

  return { videoId: data.id };
}

export async function pollHeraJob(videoId: string): Promise<{
  status: 'in-progress' | 'success' | 'failed';
  fileUrl?: string;
  error?: string;
}> {
  const res = await fetch(`${HERA_BASE_URL}/generations/${videoId}`, {
    headers: headers(),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => 'unknown');
    return { status: 'failed', error: `Poll failed (${res.status}): ${text}` };
  }

  const data = (await res.json()) as {
    status?: string;
    output?: { file_url?: string };
    error?: string;
  };

  if (data.status === 'success' || data.status === 'completed') {
    return { status: 'success', fileUrl: data.output?.file_url };
  }

  if (data.status === 'failed' || data.status === 'error') {
    return { status: 'failed', error: data.error ?? 'Generation failed' };
  }

  return { status: 'in-progress' };
}

/**
 * End-to-end Hera motion graphic generation.
 * Creates a job, polls until completion, downloads the result.
 * Returns null when HERA_API_KEY is not set or on any failure (logged, not thrown).
 */
export async function generateHeraMotionGraphic(params: {
  prompt: string;
  durationSeconds: number;
  referenceImageUrl?: string;
  podcastId?: string;
  userId?: string;
}): Promise<Buffer | null> {
  const job = await createHeraJob({
    prompt: params.prompt,
    durationSeconds: params.durationSeconds,
    referenceImageUrl: params.referenceImageUrl,
  });

  if (!job) return null;

  const startTime = Date.now();

  // Poll until success or timeout
  while (Date.now() - startTime < POLL_TIMEOUT_MS) {
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));

    const result = await pollHeraJob(job.videoId);

    if (result.status === 'success') {
      if (!result.fileUrl) {
        logger.error('Hera success but no file URL', { videoId: job.videoId });
        return null;
      }

      // Download the video
      const downloadRes = await fetch(result.fileUrl);
      if (!downloadRes.ok) {
        logger.error('Failed to download Hera video', { fileUrl: result.fileUrl, status: downloadRes.status });
        return null;
      }

      const buffer = Buffer.from(await downloadRes.arrayBuffer());

      // Log usage (cost TBD — placeholder 0)
      logUsage({
        service: 'hera',
        category: 'video_generation',
        totalCost: 0,
        durationMs: Date.now() - startTime,
        podcastId: params.podcastId,
        userId: params.userId,
        metadata: { stage: 'motion_graphic', durationSeconds: params.durationSeconds },
      });

      return buffer;
    }

    if (result.status === 'failed') {
      logger.error('Hera generation failed', { videoId: job.videoId, error: result.error });
      return null;
    }
  }

  logger.error('Hera generation timed out', { videoId: job.videoId, timeoutMs: POLL_TIMEOUT_MS });
  return null;
}
