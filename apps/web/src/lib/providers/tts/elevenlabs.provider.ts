/**
 * ElevenLabs TTS provider — premium voice generation.
 * Extracted from ../tts.ts for the multi-provider architecture.
 *
 * Expression support:
 *   - v3 audio tags: 1,450+ inline tags ([laughs], [excited], [sarcastic], etc.)
 *   - stability: 0.0 Creative (most expressive), 0.5 Natural, 1.0 Robust
 *   - style: keep at 0.0 per ElevenLabs recommendation (reduces latency)
 *   - Audio tags affect ~4-5 words after the tag before delivery normalizes
 *
 * @tts-research-date 2026-02-27 — v3 audio tags, voice_settings, SSML, prosody context
 */
import type { TtsProvider, SpeechParams, SfxParams } from '../tts';
import type { TtsProviderId } from '../tts-registry';
import { VOICE_POOL, selectVoicePair, resolveVoiceId, type VoiceMatchMetadata } from '../../voice-pool';
import { mapDirectionToExpression } from '../../tts-expression-mapper';

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
    const modelId = params.modelId ?? this.model;

    // Map direction to ElevenLabs expression params
    const expression = mapDirectionToExpression(params.direction, params.speaker, 'elevenlabs');
    const elExpr = expression.elevenlabs;

    // Prepend audio tag if the mapper provided one (e.g. "[excited] ")
    const text = elExpr?.audioTagPrefix ? elExpr.audioTagPrefix + params.text : params.text;

    return el.generateSpeech({
      text,
      voiceId: params.voiceId,
      modelId,
      apiKeyOverride,
      previousText: params.previousText,
      nextText: params.nextText,
      stability: elExpr?.stability ?? params.stability,
      similarityBoost: params.similarityBoost,
      // style: 0.0 per ElevenLabs recommendation — higher values add latency and instability
      style: 0.0,
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
