/**
 * Fal.ai video provider — text-to-video via async queue API.
 * Wraps the existing fal-video.ts logic in the VideoProvider interface.
 */
import { getFalVideoEndpoint, getFalFrameParams } from '../fal-endpoints';
import { logger } from '../../logger';
import type { VideoProvider } from '../video';

export class FalVideoProvider implements VideoProvider {
  readonly providerId = 'fal' as const;
  private apiKey: string;
  private model: string;

  constructor(apiKey: string, model: string) {
    this.apiKey = apiKey;
    this.model = model;
  }

  getModelId(): string {
    return this.model;
  }

  async generateVideo(params: { prompt: string; duration?: number; firstFrameImage?: string; lastFrameImage?: string }): Promise<Buffer> {
    const endpoint = getFalVideoEndpoint(this.model);
    if (!endpoint) throw new Error(`No Fal endpoint for video model: ${this.model}`);

    const url = `https://queue.fal.run/${endpoint}`;
    const frameParams = getFalFrameParams(this.model);

    logger.info('Submitting fal video job', { model: this.model, endpoint });

    // Build frame parameters dynamically based on model
    const frameBody: Record<string, string> = {};
    if (params.firstFrameImage) {
      frameBody[frameParams.firstFrameParam] = params.firstFrameImage;
    }
    if (params.lastFrameImage && frameParams.lastFrameParam) {
      frameBody[frameParams.lastFrameParam] = params.lastFrameImage;
    }

    const submitRes = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Key ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        prompt: params.prompt,
        duration: params.duration ? String(params.duration) : undefined,
        aspect_ratio: '16:9',
        ...frameBody,
      }),
    });

    if (!submitRes.ok) {
      const text = await submitRes.text().catch(() => 'unknown');
      throw new Error(`Fal video submission failed (${submitRes.status}): ${text}`);
    }

    // Use status_url/response_url from submit response when available (URL format varies per model)
    const submitData = (await submitRes.json()) as {
      request_id: string;
      status_url?: string;
      response_url?: string;
    };
    const { request_id } = submitData;
    const fallbackBase = `https://queue.fal.run/${endpoint}/requests/${request_id}`;
    const statusUrl = submitData.status_url ?? `${fallbackBase}/status`;
    // Derive result URL: prefer response_url, then strip /status from status_url, then fallback
    const resultUrl =
      submitData.response_url ??
      (submitData.status_url ? submitData.status_url.replace(/\/status$/, '') : fallbackBase);

    logger.info('Fal video job submitted', { request_id, statusUrl });

    for (let i = 0; i < 120; i++) {
      await new Promise((r) => setTimeout(r, 5000));

      const statusRes = await fetch(statusUrl, {
        headers: { Authorization: `Key ${this.apiKey}` },
      });

      if (!statusRes.ok) {
        logger.warn('Fal status poll failed', { status: statusRes.status, attempt: i });
        continue;
      }

      const status = (await statusRes.json()) as { status: string; error?: string };

      if (status.status === 'COMPLETED') {
        const resultRes = await fetch(resultUrl, {
          headers: { Authorization: `Key ${this.apiKey}` },
        });
        if (!resultRes.ok) {
          const text = await resultRes.text().catch(() => 'unknown');
          throw new Error(`Fal result fetch failed (${resultRes.status}): ${text}`);
        }
        const result = (await resultRes.json()) as { video?: { url: string } };
        const videoUrl = result.video?.url;
        if (!videoUrl) throw new Error('Fal returned no video URL');
        const videoRes = await fetch(videoUrl);
        return Buffer.from(await videoRes.arrayBuffer());
      }

      if (status.status === 'FAILED') {
        throw new Error(`Fal video generation failed: ${status.error || 'unknown'}`);
      }
    }

    throw new Error('Fal video generation timed out after 10 minutes');
  }
}
