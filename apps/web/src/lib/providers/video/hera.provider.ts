/**
 * Hera text-to-video provider via api.hera.video.
 * Wraps the existing hera.ts client to conform to the VideoProvider interface.
 */
import { logger } from '../../logger';
import { createHeraJob, pollHeraJob } from '../../hera';
import type { VideoProvider } from '../video';
import type { VideoProviderId } from '../video-registry';

const POLL_INTERVAL_MS = 5_000;
const POLL_TIMEOUT_MS = 10 * 60 * 1_000; // 10 minutes

export class HeraVideoProvider implements VideoProvider {
  readonly providerId: VideoProviderId = 'hera';
  private modelId: string;

  constructor(modelId: string) {
    this.modelId = modelId;
  }

  getModelId(): string {
    return this.modelId;
  }

  async generateVideo(params: {
    prompt: string;
    duration?: number;
    firstFrameImage?: string;
    lastFrameImage?: string;
  }): Promise<Buffer> {
    const durationSeconds = Math.max(1, Math.min(60, Math.round(params.duration ?? 5)));

    logger.info('Hera video generation starting', {
      modelId: this.modelId,
      durationSeconds: String(durationSeconds),
      hasReference: !!params.firstFrameImage,
    });

    const job = await createHeraJob({
      prompt: params.prompt,
      durationSeconds,
      referenceImageUrl: params.firstFrameImage,
    });

    if (!job) {
      throw new Error('Hera job creation failed (check HERA_API_KEY)');
    }

    const startTime = Date.now();

    while (Date.now() - startTime < POLL_TIMEOUT_MS) {
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      const result = await pollHeraJob(job.videoId);

      if (result.status === 'success') {
        if (!result.fileUrl) {
          throw new Error('Hera success but no file URL returned');
        }
        const downloadRes = await fetch(result.fileUrl);
        if (!downloadRes.ok) {
          throw new Error(`Failed to download Hera video: ${downloadRes.status}`);
        }
        return Buffer.from(await downloadRes.arrayBuffer());
      }

      if (result.status === 'failed') {
        throw new Error(`Hera generation failed: ${result.error ?? 'unknown error'}`);
      }
    }

    throw new Error(`Hera generation timed out after ${POLL_TIMEOUT_MS / 1000}s`);
  }
}
