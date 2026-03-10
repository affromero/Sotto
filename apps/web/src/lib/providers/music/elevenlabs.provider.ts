/**
 * ElevenLabs music provider — synchronous streaming music composition.
 * Reuses existing ELEVENLABS_API_KEY / BYOK infrastructure.
 */
import { logger } from '../../logger';
import type { MusicProvider } from '../music';

export class ElevenLabsMusicProvider implements MusicProvider {
  readonly providerId = 'elevenlabs' as const;
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
    logger.info('Generating ElevenLabs music', { model: this.model });

    const res = await fetch('https://api.elevenlabs.io/v1/music/compose', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'xi-api-key': this.apiKey,
      },
      body: JSON.stringify({
        prompt: params.prompt,
        duration_seconds: Math.min(params.durationSeconds, 300), // ElevenLabs max ~5min
        mode: 'instrumental',
      }),
    });

    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(`ElevenLabs music compose failed (${res.status}): ${errorText}`);
    }

    // Response is a streaming audio body
    const chunks: Uint8Array[] = [];
    const reader = res.body?.getReader();
    if (!reader) {
      throw new Error('ElevenLabs returned empty response body');
    }

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }

    const totalLength = chunks.reduce((acc, c) => acc + c.length, 0);
    const result = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      result.set(chunk, offset);
      offset += chunk.length;
    }

    logger.info('ElevenLabs music generated', { bytes: totalLength });
    return Buffer.from(result);
  }
}
