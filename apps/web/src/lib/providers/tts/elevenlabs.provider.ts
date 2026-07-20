/**
 * ElevenLabs TTS provider — premium voice generation.
 * Extracted from ../tts.ts for the multi-provider architecture.
 *
 * Expression support:
 *   - v3 audio tags: 1,450+ inline tags ([laughs], [excited], [sarcastic], etc.)
 *   - stability: 0.0 Creative (most expressive), 0.5 Natural, 1.0 Robust (disables tag responsiveness)
 *   - style: keep at 0.0 per ElevenLabs recommendation (reduces latency)
 *   - sustainedDelivery: re-injects the audio tag before every sentence so the
 *     delivery style persists across the whole segment, not just the opening words
 *
 * @tts-research-date 2026-03-12 — inline tag injection, context params, output quality
 */
import type { WordTiming } from '@sotto/shared';
import type { TtsProvider, SpeechParams, SfxParams } from '../tts';
import { getProviderMeta, type TtsProviderId } from '../tts-registry';
import {
  VOICE_POOL,
  selectVoicePair,
  resolveVoiceId,
  type VoiceMatchMetadata,
} from '../../voice-pool';
import { mapDirectionToExpression } from '../../tts-expression-mapper';
import { applyPronunciationAliases } from '../../pronunciation-dictionary';

// Speakers that use the "host" voice slot; all others use "expert" slot.
// HOST/GUEST are at even indices (0, 2); EXPERT/SKEPTIC at odd (1, 3).
const SPEAKER_VOICE_HOST_SET = new Set(['HOST', 'GUEST']);

/**
 * Re-injects an audio tag before every sentence so a sustained delivery style
 * (e.g. "[excited]") persists across the whole segment, not just the first words.
 * Splits on sentence-ending punctuation followed by whitespace + capital letter.
 */
function injectTagAtSentenceBoundaries(text: string, tag: string): string {
  const parts = text.split(/(?<=[.!?]) +(?=[A-Z])/);
  return parts.length > 1 ? parts.map((s) => tag + s).join(' ') : tag + text;
}

export class ElevenLabsProvider implements TtsProvider {
  readonly providerId: TtsProviderId = 'elevenlabs';
  private clientPromise: Promise<typeof import('../../elevenlabs')> | null = null;
  private byokApiKey: string | undefined;
  private model: string;
  private lastRequestId: string | null = null;

  constructor(byokApiKey?: string, model?: string) {
    this.byokApiKey = byokApiKey;
    this.model = model ?? getProviderMeta('elevenlabs').defaultModel;
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
    const meta = getProviderMeta('elevenlabs');
    const skipTextContext = meta.modelsWithoutTextContext.includes(modelId);

    // Map direction to ElevenLabs expression params
    const expression = mapDirectionToExpression(params.direction, params.speaker, 'elevenlabs');
    const elExpr = expression.elevenlabs;

    // Apply pronunciation aliases before audio tag injection
    const cleanText = applyPronunciationAliases(params.text);

    // Apply audio tag: re-inject before every sentence for sustained delivery styles,
    // or prepend once for one-shot sound events (laughs, gasps, sighs).
    const prefix = elExpr?.audioTagPrefix;
    const text = prefix
      ? elExpr.sustainedDelivery
        ? injectTagAtSentenceBoundaries(cleanText, prefix)
        : prefix + cleanText
      : cleanText;

    const { audio, requestId } = await el.generateSpeech({
      text,
      voiceId: params.voiceId,
      modelId,
      apiKeyOverride,
      previousText: skipTextContext ? undefined : params.previousText,
      nextText: skipTextContext ? undefined : params.nextText,
      previousRequestIds: params.continuityIds?.slice(-3),
      stability: elExpr?.stability ?? params.stability,
      similarityBoost: params.similarityBoost,
      // style: 0.0 per ElevenLabs recommendation — higher values add latency and instability
      style: 0.0,
      speed: elExpr?.speed,
      seed: params.seed,
      language: params.language,
    });

    this.lastRequestId = requestId;
    return audio;
  }

  async generateSpeechWithTimestamps(
    params: SpeechParams
  ): Promise<{ audio: Buffer; wordTimings: WordTiming[] }> {
    const el = await this.getClient();
    const apiKeyOverride = params.apiKeyOverride || this.byokApiKey;
    const modelId = params.modelId ?? this.model;
    const meta = getProviderMeta('elevenlabs');
    const skipTextContext = meta.modelsWithoutTextContext.includes(modelId);

    // Map direction to ElevenLabs expression params
    const expression = mapDirectionToExpression(params.direction, params.speaker, 'elevenlabs');
    const elExpr = expression.elevenlabs;

    // Apply pronunciation aliases before audio tag injection
    const cleanText = applyPronunciationAliases(params.text);

    // Apply audio tag
    const prefix = elExpr?.audioTagPrefix;
    const text = prefix
      ? elExpr.sustainedDelivery
        ? injectTagAtSentenceBoundaries(cleanText, prefix)
        : prefix + cleanText
      : cleanText;

    const { audio, wordTimings, requestId } = await el.generateSpeechWithTimestamps({
      text,
      voiceId: params.voiceId,
      modelId,
      apiKeyOverride,
      previousText: skipTextContext ? undefined : params.previousText,
      nextText: skipTextContext ? undefined : params.nextText,
      previousRequestIds: params.continuityIds?.slice(-3),
      stability: elExpr?.stability ?? params.stability,
      similarityBoost: params.similarityBoost,
      style: 0.0,
      speed: elExpr?.speed,
      seed: params.seed,
      language: params.language,
    });

    this.lastRequestId = requestId;
    return { audio, wordTimings };
  }

  getLastContinuityId(): string | null {
    return this.lastRequestId;
  }

  async generateSoundEffect(params: SfxParams): Promise<Buffer> {
    const el = await this.getClient();
    return el.generateSoundEffect(params);
  }

  getVoiceId(
    speaker: string,
    episodeId?: string,
    metadata?: VoiceMatchMetadata,
    _language?: string
  ): string {
    const isHostVoice = SPEAKER_VOICE_HOST_SET.has(speaker.toUpperCase());
    if (!episodeId) {
      return isHostVoice ? VOICE_POOL[0].ids.elevenlabs : VOICE_POOL[8].ids.elevenlabs;
    }
    const pair = selectVoicePair(episodeId, metadata);
    const entry = isHostVoice ? pair.host : pair.expert;
    return resolveVoiceId(entry, 'elevenlabs');
  }

  getModelId(): string {
    return this.model;
  }
}
