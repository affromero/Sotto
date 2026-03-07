/**
 * MiniMax text-to-video provider via direct API (api.minimax.io).
 * Async 3-step: submit task → poll status → download file.
 */
import { logger } from '../../logger';
import type { VideoProvider } from '../video';

const MINIMAX_API_BASE = 'https://api.minimax.io/v1';

/** Map pricetoken model IDs to MiniMax API model names. */
const MODEL_MAP: Record<string, { apiModel: string; resolution: string }> = {
  'minimax-hailuo02-512p': { apiModel: 'MiniMax-Hailuo-02', resolution: '512P' },
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

  async generateVideo(params: { prompt: string; duration?: number }): Promise<Buffer> {
    const mapping = MODEL_MAP[this.model];
    if (!mapping) throw new Error(`Unknown MiniMax video model: ${this.model}`);

    logger.info('Submitting MiniMax video task', { model: this.model, apiModel: mapping.apiModel, resolution: mapping.resolution });

    const submitRes = await fetch(`${MINIMAX_API_BASE}/video_generation`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: mapping.apiModel,
        prompt: params.prompt,
        prompt_optimizer: true,
        duration: params.duration ?? 6,
        resolution: mapping.resolution,
      }),
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

    return Buffer.from(await res.arrayBuffer());
  }
}
