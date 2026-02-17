/**
 * ElevenLabs TTS provider — premium voice generation.
 * Extracted from ../tts.ts for the multi-provider architecture.
 */
import type { TtsProvider, SpeechParams, SfxParams } from '../tts';
import type { TtsProviderId } from '../tts-registry';
import { VOICE_POOL, selectVoicePair, resolveVoiceId } from '../../voice-pool';

export class ElevenLabsProvider implements TtsProvider {
  readonly providerId: TtsProviderId = 'elevenlabs';
  private clientPromise: Promise<typeof import('../../elevenlabs')> | null = null;
  private byokApiKey: string | undefined;

  constructor(byokApiKey?: string) {
    this.byokApiKey = byokApiKey;
  }

  private async getClient() {
    if (!this.clientPromise) {
      this.clientPromise = import('../../elevenlabs');
    }
    return this.clientPromise;
  }

  async generateSpeech(params: SpeechParams): Promise<Buffer> {
    const el = await this.getClient();
    const apiKeyOverride = params.apiKeyOverride || this.byokApiKey;
    return el.generateSpeech({ ...params, apiKeyOverride });
  }

  async generateSoundEffect(params: SfxParams): Promise<Buffer> {
    const el = await this.getClient();
    return el.generateSoundEffect(params);
  }

  getVoiceId(speaker: 'HOST' | 'EXPERT', podcastId?: string): string {
    if (!podcastId) {
      return speaker === 'HOST' ? VOICE_POOL[0].ids.elevenlabs : VOICE_POOL[8].ids.elevenlabs;
    }
    const pair = selectVoicePair(podcastId);
    const entry = speaker === 'HOST' ? pair.host : pair.expert;
    return resolveVoiceId(entry, 'elevenlabs');
  }

  getModelId(): string {
    return 'eleven_v3';
  }
}
