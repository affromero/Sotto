/**
 * ElevenLabs TTS provider — premium voice generation.
 * Extracted from ../tts.ts for the multi-provider architecture.
 */
import type { TtsProvider, SpeechParams, SfxParams } from '../tts';
import type { TtsProviderId } from '../tts-registry';
import { VOICE_POOL, selectVoicePair, resolveVoiceId, type VoiceMatchMetadata } from '../../voice-pool';

// Speakers that use the "host" voice slot; all others use "expert" slot.
// HOST/GUEST are at even indices (0, 2); EXPERT/SKEPTIC at odd (1, 3).
const SPEAKER_VOICE_HOST_SET = new Set(['HOST', 'GUEST']);

export class ElevenLabsProvider implements TtsProvider {
  readonly providerId: TtsProviderId = 'elevenlabs';
  private clientPromise: Promise<typeof import('../../elevenlabs')> | null = null;
  private byokApiKey: string | undefined;
  private model: string;

  constructor(byokApiKey?: string, model?: string) {
    this.byokApiKey = byokApiKey;
    this.model = model ?? 'eleven_v3';
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
    return el.generateSpeech({
      ...params,
      modelId: params.modelId ?? this.model,
      apiKeyOverride,
      previousText: params.previousText,
      nextText: params.nextText,
    });
  }

  async generateSoundEffect(params: SfxParams): Promise<Buffer> {
    const el = await this.getClient();
    return el.generateSoundEffect(params);
  }

  getVoiceId(speaker: string, podcastId?: string, metadata?: VoiceMatchMetadata): string {
    const isHostVoice = SPEAKER_VOICE_HOST_SET.has(speaker.toUpperCase());
    if (!podcastId) {
      return isHostVoice ? VOICE_POOL[0].ids.elevenlabs : VOICE_POOL[8].ids.elevenlabs;
    }
    const pair = selectVoicePair(podcastId, metadata);
    const entry = isHostVoice ? pair.host : pair.expert;
    return resolveVoiceId(entry, 'elevenlabs');
  }

  getModelId(): string {
    return this.model;
  }
}
