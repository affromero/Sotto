/**
 * Suno music provider via sunoapi.org — async generation with polling.
 */
import { logger } from '../../logger';
import { getPublicAppBaseUrl } from '../../urls';
import type { MusicProvider } from '../music';

const BASE_URL = 'https://api.sunoapi.org';

/** Internal model ID → sunoapi.org API model value. */
function getSunoApiModel(model: string): string {
  const map: Record<string, string> = {
    'suno-v4': 'V4',
    'suno-v4.5': 'V4_5',
    'suno-v4.5-plus': 'V4_5PLUS',
    'suno-v4.5-all': 'V4_5ALL',
    'suno-v5': 'V5',
  };
  return map[model] ?? 'V5';
}

interface SunoSubmitResponse {
  code: number;
  msg: string;
  data?: {
    taskId: string;
  };
}

interface SunoStatusResponse {
  code: number;
  msg: string;
  data?: {
    taskId: string;
    status: string;
    response?: {
      taskId?: string;
      sunoData?: Array<{
        id: string;
        audioUrl?: string;
        streamAudioUrl?: string;
        duration?: number;
      }>;
    };
    errorMessage?: string | null;
  };
}

/** Terminal failure statuses from sunoapi.org. */
const FAILED_STATUSES = new Set([
  'CREATE_TASK_FAILED',
  'GENERATE_AUDIO_FAILED',
  'CALLBACK_EXCEPTION',
  'SENSITIVE_WORD_ERROR',
]);

export class SunoMusicProvider implements MusicProvider {
  readonly providerId = 'suno' as const;
  private apiKey: string;
  private model: string;
  private _externalTaskId: string | null = null;

  constructor(apiKey: string, model: string) {
    this.apiKey = apiKey;
    this.model = model;
  }

  getModelId(): string {
    return this.model;
  }

  /** Exposed so the worker can persist taskId for recovery. */
  get externalTaskId(): string | null {
    return this._externalTaskId;
  }

  async generateMusic(params: {
    prompt: string;
    durationSeconds: number;
    instrumental: boolean;
    style?: string;
    title?: string;
  }): Promise<Buffer> {
    const apiModel = getSunoApiModel(this.model);
    logger.info('Submitting Suno music job', { model: this.model, apiModel });

    const submitRes = await fetch(`${BASE_URL}/api/v1/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        prompt: params.prompt,
        customMode: true,
        instrumental: params.instrumental,
        model: apiModel,
        style: params.style || 'ambient',
        title: params.title || 'Background Music',
        callBackUrl: `${getPublicAppBaseUrl()}/api/webhooks/noop`,
      }),
    });

    if (!submitRes.ok) {
      const errorText = await submitRes.text();
      throw new Error(`Suno submit failed (${submitRes.status}): ${errorText}`);
    }

    const submitData = (await submitRes.json()) as SunoSubmitResponse;

    if (submitData.code !== 200 || !submitData.data?.taskId) {
      throw new Error(`Suno submit error: ${submitData.msg ?? 'no taskId in response'}`);
    }

    this._externalTaskId = submitData.data.taskId;
    logger.info('Suno task submitted', { taskId: this._externalTaskId });

    // Poll for completion
    const audioUrl = await this.pollForCompletion(this._externalTaskId);

    // Download audio
    const audioRes = await fetch(audioUrl);
    if (!audioRes.ok) {
      throw new Error(`Failed to download Suno audio (${audioRes.status})`);
    }

    const arrayBuffer = await audioRes.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  private async pollForCompletion(taskId: string): Promise<string> {
    const maxAttempts = 60;
    let delay = 5000; // start at 5s

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, delay));

      const statusRes = await fetch(
        `${BASE_URL}/api/v1/generate/record-info?taskId=${encodeURIComponent(taskId)}`,
        { headers: { Authorization: `Bearer ${this.apiKey}` } }
      );

      if (!statusRes.ok) {
        logger.warn('Suno status check failed', { taskId, status: statusRes.status });
        delay = Math.min(delay * 1.5, 30000);
        continue;
      }

      const statusData = (await statusRes.json()) as SunoStatusResponse;
      const status = statusData.data?.status;

      if (status === 'SUCCESS') {
        const audioUrl = statusData.data?.response?.sunoData?.[0]?.audioUrl;
        if (!audioUrl) {
          throw new Error('Suno completed but no audio URL in response');
        }
        return audioUrl;
      }

      if (status && FAILED_STATUSES.has(status)) {
        const reason = statusData.data?.errorMessage ?? status;
        throw new Error(`Suno music generation failed: ${reason}`);
      }

      // Exponential backoff, cap at 30s
      delay = Math.min(delay * 1.5, 30000);
      logger.debug('Suno polling', { taskId, status, attempt, nextDelay: delay });
    }

    throw new Error(`Suno generation timed out after ${maxAttempts} attempts`);
  }
}
