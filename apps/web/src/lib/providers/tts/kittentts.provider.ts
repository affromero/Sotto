/**
 * KittenTTS provider — CPU-only open-source TTS sidecar.
 * Calls the internal FastAPI microservice at KITTENTTS_URL.
 * WAV response is converted to MP3 via FFmpeg (already available in workers).
 */
import { spawn } from 'child_process';
import type { TtsProvider, SpeechParams, SfxParams } from '../tts';
import type { TtsProviderId } from '../tts-registry';
import { selectKittenVoicePair } from '../../voice-pool';
import { logger } from '../../logger';

function convertWavToMp3(wavBuffer: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn('ffmpeg', [
      '-i',
      'pipe:0',
      '-f',
      'mp3',
      '-codec:a',
      'libmp3lame',
      '-q:a',
      '2',
      'pipe:1',
    ]);

    const chunks: Buffer[] = [];
    ffmpeg.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
    ffmpeg.stderr.on('data', () => {});
    ffmpeg.on('close', (code) => {
      if (code === 0) {
        resolve(Buffer.concat(chunks));
      } else {
        reject(new Error(`FFmpeg exited with code ${code}`));
      }
    });
    ffmpeg.on('error', reject);

    ffmpeg.stdin.write(wavBuffer);
    ffmpeg.stdin.end();
  });
}

export class KittenTtsProvider implements TtsProvider {
  readonly providerId: TtsProviderId = 'kittentts';

  private get baseUrl(): string {
    return process.env.KITTENTTS_URL ?? 'http://kittentts:8000';
  }

  async generateSpeech(params: SpeechParams): Promise<Buffer> {
    const body = new URLSearchParams({ text: params.text, voice: params.voiceId });

    const res = await fetch(`${this.baseUrl}/synthesize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => res.statusText);
      throw new Error(`KittenTTS synthesis failed (${res.status}): ${detail}`);
    }

    const wavBuffer = Buffer.from(await res.arrayBuffer());

    try {
      return await convertWavToMp3(wavBuffer);
    } catch (err) {
      logger.warn('KittenTTS WAV→MP3 conversion failed, returning raw WAV', {
        error: err instanceof Error ? err.message : String(err),
      });
      return wavBuffer;
    }
  }

  generateSoundEffect(_params: SfxParams): Promise<Buffer> {
    throw new Error('KittenTTS does not support sound effects');
  }

  getVoiceId(speaker: 'HOST' | 'EXPERT', podcastId?: string): string {
    if (!podcastId) {
      return speaker === 'HOST' ? 'bella' : 'jasper';
    }
    const pair = selectKittenVoicePair(podcastId);
    return speaker === 'HOST' ? pair.host : pair.expert;
  }

  getModelId(): string {
    return 'kitten-tts-mini-0.8';
  }
}
