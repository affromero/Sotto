/**
 * MiniMax text-to-video provider via direct API (api.minimax.io).
 * Async 3-step: submit task → poll status → download file.
 */
import { logger } from '../../logger';
import type { VideoProvider } from '../video';

const MINIMAX_API_BASE = 'https://api.minimax.io/v1';

/** Map pricetoken model IDs to MiniMax API model names. */
const MODEL_MAP: Record<string, { apiModel: string; resolution: string; requiresFirstFrame?: boolean }> = {
  'minimax-hailuo02-512p': { apiModel: 'MiniMax-Hailuo-02', resolution: '512P', requiresFirstFrame: true },
  'minimax-hailuo02-768p': { apiModel: 'MiniMax-Hailuo-02', resolution: '768P' },
  'minimax-hailuo02-pro-1080p': { apiModel: 'MiniMax-Hailuo-02', resolution: '1080P' },
  'minimax-hailuo23-fast-1080p': { apiModel: 'MiniMax-Hailuo-2.3', resolution: '1080P' },
  'minimax-hailuo23-fast-768p': { apiModel: 'MiniMax-Hailuo-2.3', resolution: '768P' },
};

interface MiniMaxBaseResp {
  base_resp: { status_code: number; status_msg: string };
}

interface MiniMaxSubmitResponse extends MiniMaxBaseResp {
  task_id: string;
}

interface MiniMaxStatusResponse extends MiniMaxBaseResp {
  task_id: string;
  status: 'Preparing' | 'Queueing' | 'Processing' | 'Success' | 'Fail';
  file_id?: string;
}

export class MiniMaxVideoProvider implements VideoProvider {
  readonly providerId = 'minimax' as const;
  private apiKey: string;
  private model: string;

  constructor(apiKey: string, model: string) {
    this.apiKey = apiKey;
    this.model = model;
  }

  getModelId(): string {
    return this.model;
  }

  async generateVideo(params: { prompt: string; duration?: number; firstFrameImage?: string }): Promise<Buffer> {
    const mapping = MODEL_MAP[this.model];
    if (!mapping) throw new Error(`Unknown MiniMax video model: ${this.model}`);

    if (mapping.requiresFirstFrame && !params.firstFrameImage) {
      throw new Error(`MiniMax model ${this.model} requires a first-frame image (resolution ${mapping.resolution} is image-to-video only)`);
    }

    logger.info('Submitting MiniMax video task', {
      model: this.model,
      apiModel: mapping.apiModel,
      resolution: mapping.resolution,
      hasFirstFrame: !!params.firstFrameImage,
    });

    const body: Record<string, unknown> = {
      model: mapping.apiModel,
      prompt: params.prompt,
      prompt_optimizer: true,
      duration: params.duration ?? 6,
      resolution: mapping.resolution,
    };

    if (params.firstFrameImage) {
      body.first_frame_image = params.firstFrameImage;
    }

    const submitRes = await fetch(`${MINIMAX_API_BASE}/video_generation`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!submitRes.ok) {
      const text = await submitRes.text().catch(() => 'unknown');
      throw new Error(`MiniMax video submission failed (${submitRes.status}): ${text}`);
    }

    const submitBody = (await submitRes.json()) as MiniMaxSubmitResponse;
    if (submitBody.base_resp.status_code !== 0) {
      throw new Error(`MiniMax submit error: ${submitBody.base_resp.status_msg}`);
    }

    const taskId = submitBody.task_id;

    // Poll for completion (up to 10 minutes at 10s intervals)
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 10000));

      const statusRes = await fetch(
        `${MINIMAX_API_BASE}/query/video_generation?task_id=${taskId}`,
        { headers: { Authorization: `Bearer ${this.apiKey}` } },
      );

      if (!statusRes.ok) {
        logger.warn('MiniMax poll request failed', { status: statusRes.status, attempt: i });
        continue;
      }

      const status = (await statusRes.json()) as MiniMaxStatusResponse;

      if (status.status === 'Success' && status.file_id) {
        return this.downloadFile(status.file_id);
      }

      if (status.status === 'Fail') {
        throw new Error(`MiniMax video generation failed: ${status.base_resp.status_msg}`);
      }
    }

    throw new Error('MiniMax video generation timed out after 10 minutes');
  }

  private async downloadFile(fileId: string): Promise<Buffer> {
    const res = await fetch(
      `${MINIMAX_API_BASE}/files/retrieve?file_id=${fileId}`,
      { headers: { Authorization: `Bearer ${this.apiKey}` } },
    );

    if (!res.ok) {
      throw new Error(`MiniMax file download failed (${res.status})`);
    }

    // The /files/retrieve endpoint returns JSON with a download_url, not the raw binary
    const body = (await res.json()) as {
      file: { download_url: string };
      base_resp: { status_code: number; status_msg: string };
    };

    if (body.base_resp.status_code !== 0) {
      throw new Error(`MiniMax file retrieve error: ${body.base_resp.status_msg}`);
    }

    if (!body.file?.download_url) {
      throw new Error('MiniMax file retrieve returned no download_url');
    }

    const videoRes = await fetch(body.file.download_url);
    if (!videoRes.ok) {
      throw new Error(`MiniMax video download failed (${videoRes.status}) from CDN`);
    }

    return Buffer.from(await videoRes.arrayBuffer());
  }
}
