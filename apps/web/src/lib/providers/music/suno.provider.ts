/**
 * Suno music provider via Kie.ai API — async generation with polling.
 */
import { logger } from '../../logger';
import type { MusicProvider } from '../music';

/** Suno model ID → Kie.ai API model name. */
function getSunoApiModel(model: string): string {
  if (model === 'suno-v4.5') return 'V4.5';
  return 'V5'; // default
}

interface KieTaskResponse {
  data: {
    taskId: string;
  };
}

interface KieStatusResponse {
  data: {
    status: string; // 'pending' | 'processing' | 'completed' | 'failed'
    response?: {
      audioUrl?: string;
      sunoData?: Array<{ audio_url?: string }>;
    };
  };
}

export class SunoMusicProvider implements MusicProvider {
  readonly providerId = 'suno' as const;
  private apiKey: string;
  private model: string;

  constructor(apiKey: string, model: string) {
    this.apiKey = apiKey;
    this.model = model;
  }

  getModelId(): string {
    return this.model;
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

    // Submit generation
    const submitRes = await fetch('https://api.kie.ai/api/v1/generate', {
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
      }),
    });

    if (!submitRes.ok) {
      const errorText = await submitRes.text();
      throw new Error(`Suno submit failed (${submitRes.status}): ${errorText}`);
    }

    const submitData = (await submitRes.json()) as KieTaskResponse;
    const taskId = submitData.data.taskId;
    logger.info('Suno task submitted', { taskId });

    // Poll for completion with exponential backoff
    const audioUrl = await this.pollForCompletion(taskId);

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

      const statusRes = await fetch(`https://api.kie.ai/api/v1/status/${taskId}`, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
      });

      if (!statusRes.ok) {
        logger.warn('Suno status check failed', { taskId, status: statusRes.status });
        delay = Math.min(delay * 1.5, 30000);
        continue;
      }

      const statusData = (await statusRes.json()) as KieStatusResponse;
      const status = statusData.data.status;

      if (status === 'completed') {
        const audioUrl =
          statusData.data.response?.audioUrl ||
          statusData.data.response?.sunoData?.[0]?.audio_url;

        if (!audioUrl) {
          throw new Error('Suno completed but no audio URL returned');
        }
        return audioUrl;
      }

      if (status === 'failed') {
        throw new Error('Suno music generation failed');
      }

      // Exponential backoff, cap at 30s
      delay = Math.min(delay * 1.5, 30000);
      logger.debug('Suno polling', { taskId, status, attempt, nextDelay: delay });
    }

    throw new Error(`Suno generation timed out after ${maxAttempts} attempts`);
  }
}
