import { logger } from '../logger';
import { getSttProviderMeta } from './stt-registry';
import { getAiKey, getByokKey } from '../byok';
import { resolveAutoModel } from '../auto-model-config';

/**
 * Speech-to-text transcription result
 */
export interface TranscriptionResult {
  text: string;
  segments: Array<{
    start: number;
    end: number;
    text: string;
    speaker?: string;
  }>;
  language?: string;
}

/**
 * Speech-to-text provider interface
 */
export interface SttProvider {
  transcribe(audio: Buffer, opts?: { language?: string }): Promise<TranscriptionResult>;
}

/**
 * OpenAI Whisper API provider
 * Uses verbose JSON format to extract word-level timestamps
 */
interface WhisperProviderConfig {
  baseURL?: string;
  model: string;
  envVar: string;
  name: string;
}

const OPENAI_WHISPER_CONFIG: WhisperProviderConfig = {
  model: getSttProviderMeta('openai').defaultModel,
  envVar: 'OPENAI_API_KEY',
  name: 'OpenAI Whisper',
};

const TOGETHER_WHISPER_CONFIG: WhisperProviderConfig = {
  baseURL: 'https://api.together.xyz/v1',
  model: getSttProviderMeta('together').defaultModel,
  envVar: 'TOGETHER_API_KEY',
  name: 'Together AI Whisper',
};

class OpenAIWhisperProvider implements SttProvider {
  private client: any | null = null;
  private initPromise: Promise<void> | null = null;
  private config: WhisperProviderConfig;

  constructor(apiKey?: string, config?: WhisperProviderConfig) {
    this.config = config ?? OPENAI_WHISPER_CONFIG;
    const key = apiKey || process.env[this.config.envVar];
    if (!key) {
      logger.warn(`No API key provided — ${this.config.name} STT will not work`);
      return;
    }

    this.initPromise = this.loadClient(key);
  }

  private async loadClient(apiKey: string): Promise<void> {
    try {
      const { default: OpenAI } = await import('openai');
      this.client = new OpenAI({
        apiKey,
        ...(this.config.baseURL ? { baseURL: this.config.baseURL } : {}),
      } as { apiKey: string });
      logger.info(`${this.config.name} STT provider initialized`);
    } catch (err) {
      logger.warn('OpenAI SDK not installed — STT transcription unavailable', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async transcribe(audio: Buffer, opts?: { language?: string }): Promise<TranscriptionResult> {
    await this.initPromise;
    if (!this.client) {
      throw new Error(`${this.config.name} provider not initialized — set ${this.config.envVar}`);
    }

    const startTime = Date.now();
    const uint8Array = new Uint8Array(audio);
    const file = new File([uint8Array], 'audio.mp3', { type: 'audio/mpeg' });

    try {
      const response = await this.client.audio.transcriptions.create({
        file,
        model: this.config.model,
        response_format: 'verbose_json',
        language: opts?.language,
        timestamp_granularities: ['segment'],
      });

      const durationMs = Date.now() - startTime;

      logger.info(`${this.config.name} transcription complete`, {
        language: response.language,
        duration: response.duration,
        segments: String((response as { segments?: unknown[] }).segments?.length ?? 0),
        durationMs: String(durationMs),
      });

      const verboseResponse = response as {
        text: string;
        language?: string;
        segments?: Array<{
          start: number;
          end: number;
          text: string;
        }>;
      };

      const segments =
        verboseResponse.segments?.map((seg) => ({
          start: seg.start,
          end: seg.end,
          text: seg.text.trim(),
        })) ?? [];

      return {
        text: verboseResponse.text,
        segments,
        language: verboseResponse.language,
      };
    } catch (err) {
      if (err instanceof Error && err.message.includes('verbose_json')) {
        logger.warn(`${this.config.name} verbose_json format failed, falling back to text-only`, {
          error: err.message,
        });

        const textResponse = await this.client.audio.transcriptions.create({
          file,
          model: this.config.model,
          response_format: 'text',
          language: opts?.language,
        });

        const text = typeof textResponse === 'string'
          ? textResponse
          : (textResponse as { text: string }).text;

        return {
          text,
          segments: [{ start: 0, end: 0, text }],
          language: opts?.language,
        };
      }

      throw err;
    }
  }
}

/**
 * ElevenLabs Scribe STT provider
 * Uses the speech-to-text endpoint with scribe_v1 model
 */
class ElevenLabsScribeProvider implements SttProvider {
  private apiKey: string;
  private model: string;

  constructor(apiKey?: string, model?: string) {
    const key = apiKey || process.env.ELEVENLABS_API_KEY;
    if (!key) {
      throw new Error('No ElevenLabs API key provided — Scribe STT will not work');
    }
    this.apiKey = key;
    this.model = model ?? 'scribe_v1';
    logger.info('ElevenLabs Scribe STT provider initialized');
  }

  async transcribe(audio: Buffer, opts?: { language?: string }): Promise<TranscriptionResult> {
    const startTime = Date.now();

    const formData = new FormData();
    const uint8Array = new Uint8Array(audio);
    const blob = new Blob([uint8Array], { type: 'audio/mpeg' });
    formData.append('file', blob, 'audio.mp3');
    formData.append('model_id', this.model);
    formData.append('tag_audio_events', 'false');
    formData.append('diarize', 'false');

    if (opts?.language) {
      formData.append('language_code', opts.language);
    }

    const response = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
      method: 'POST',
      headers: {
        'xi-api-key': this.apiKey,
      },
      body: formData,
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      throw new Error(`ElevenLabs Scribe API error (${response.status}): ${errorText}`);
    }

    const data = (await response.json()) as {
      text: string;
      words?: Array<{
        text: string;
        start: number;
        end: number;
        type?: string;
        speaker_id?: string;
      }>;
      language_code?: string;
    };

    const durationMs = Date.now() - startTime;

    // Group words into segments by sentence boundaries
    const segments = this.groupWordsIntoSegments(data.words ?? [], data.text);

    logger.info('Scribe transcription complete', {
      language: data.language_code,
      wordCount: String(data.words?.length ?? 0),
      segments: String(segments.length),
      durationMs: String(durationMs),
    });

    return {
      text: data.text,
      segments,
      language: data.language_code,
    };
  }

  /**
   * Group word-level timestamps into sentence-level segments.
   * Splits on sentence-ending punctuation (. ! ?) to produce
   * segments similar to Whisper's segment output.
   */
  private groupWordsIntoSegments(
    words: Array<{ text: string; start: number; end: number; type?: string }>,
    fullText: string
  ): Array<{ start: number; end: number; text: string }> {
    if (words.length === 0) {
      return fullText ? [{ start: 0, end: 0, text: fullText }] : [];
    }

    const segments: Array<{ start: number; end: number; text: string }> = [];
    let currentWords: typeof words = [];

    for (const word of words) {
      // Skip non-word tokens (spacing, punctuation-only)
      if (word.type && word.type !== 'word') continue;

      currentWords.push(word);

      // Check if the word ends with sentence-ending punctuation
      const trimmed = word.text.trim();
      if (/[.!?]$/.test(trimmed) && currentWords.length > 0) {
        segments.push({
          start: currentWords[0].start,
          end: word.end,
          text: currentWords.map((w) => w.text).join(' ').trim(),
        });
        currentWords = [];
      }
    }

    // Flush remaining words as a final segment
    if (currentWords.length > 0) {
      segments.push({
        start: currentWords[0].start,
        end: currentWords[currentWords.length - 1].end,
        text: currentWords.map((w) => w.text).join(' ').trim(),
      });
    }

    return segments;
  }
}

/**
 * Deepgram STT provider
 * Uses Nova-3/Nova-2 via REST API with raw binary body
 */
class DeepgramProvider implements SttProvider {
  private apiKey: string;
  private model: string;

  constructor(apiKey?: string, model?: string) {
    const key = apiKey || process.env.DEEPGRAM_API_KEY;
    if (!key) {
      throw new Error('No Deepgram API key provided — Deepgram STT will not work');
    }
    this.apiKey = key;
    this.model = model ?? 'nova-3';
    logger.info('Deepgram STT provider initialized', { model: this.model });
  }

  async transcribe(audio: Buffer, opts?: { language?: string }): Promise<TranscriptionResult> {
    const startTime = Date.now();

    const params = new URLSearchParams({
      model: this.model,
      smart_format: 'true',
      utterances: 'true',
      punctuate: 'true',
    });
    if (opts?.language) params.set('language', opts.language);

    const response = await fetch(
      `https://api.deepgram.com/v1/listen?${params.toString()}`,
      {
        method: 'POST',
        headers: {
          Authorization: `Token ${this.apiKey}`,
          'Content-Type': 'audio/mpeg',
        },
        body: new Uint8Array(audio),
      }
    );

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      throw new Error(`Deepgram API error (${response.status}): ${errorText}`);
    }

    const data = (await response.json()) as {
      results: {
        channels: Array<{
          alternatives: Array<{
            transcript: string;
            words?: Array<{
              word: string;
              start: number;
              end: number;
              punctuated_word?: string;
            }>;
            paragraphs?: {
              paragraphs: Array<{
                sentences: Array<{
                  text: string;
                  start: number;
                  end: number;
                }>;
              }>;
            };
          }>;
        }>;
        utterances?: Array<{
          transcript: string;
          start: number;
          end: number;
          speaker: number;
        }>;
      };
      metadata?: { language?: string };
    };

    const durationMs = Date.now() - startTime;
    const alt = data.results.channels[0]?.alternatives[0];
    const text = alt?.transcript ?? '';

    // Prefer utterances (speaker-diarized segments), fall back to paragraphs → words
    let segments: Array<{ start: number; end: number; text: string; speaker?: string }>;

    if (data.results.utterances && data.results.utterances.length > 0) {
      segments = data.results.utterances.map((u) => ({
        start: u.start,
        end: u.end,
        text: u.transcript,
        speaker: `Speaker ${u.speaker}`,
      }));
    } else if (alt?.paragraphs?.paragraphs) {
      segments = alt.paragraphs.paragraphs.flatMap((p) =>
        p.sentences.map((s) => ({
          start: s.start,
          end: s.end,
          text: s.text,
        }))
      );
    } else {
      segments = text ? [{ start: 0, end: 0, text }] : [];
    }

    logger.info('Deepgram transcription complete', {
      model: this.model,
      language: data.metadata?.language,
      segments: String(segments.length),
      durationMs: String(durationMs),
    });

    return { text, segments, language: data.metadata?.language };
  }
}

/**
 * AssemblyAI STT provider
 * Async polling: upload audio → submit transcript → poll until complete
 */
class AssemblyAIProvider implements SttProvider {
  private apiKey: string;
  private speechModel: string;

  constructor(apiKey?: string, model?: string) {
    const key = apiKey || process.env.ASSEMBLYAI_API_KEY;
    if (!key) {
      throw new Error('No AssemblyAI API key provided — AssemblyAI STT will not work');
    }
    this.apiKey = key;
    this.speechModel = model ?? 'best';
    logger.info('AssemblyAI STT provider initialized', { model: this.speechModel });
  }

  async transcribe(audio: Buffer, opts?: { language?: string }): Promise<TranscriptionResult> {
    const startTime = Date.now();
    const headers = { authorization: this.apiKey, 'content-type': 'application/json' };

    // Step 1: Upload audio
    const uploadRes = await fetch('https://api.assemblyai.com/v2/upload', {
      method: 'POST',
      headers: { authorization: this.apiKey, 'content-type': 'application/octet-stream' },
      body: new Uint8Array(audio),
    });

    if (!uploadRes.ok) {
      const errorText = await uploadRes.text().catch(() => 'Unknown error');
      throw new Error(`AssemblyAI upload error (${uploadRes.status}): ${errorText}`);
    }

    const { upload_url } = (await uploadRes.json()) as { upload_url: string };

    // Step 2: Submit transcript job
    const submitBody: Record<string, unknown> = {
      audio_url: upload_url,
      speaker_labels: true,
    };

    // Map model to speech_model param
    if (this.speechModel === 'nano') {
      submitBody.speech_model = 'nano';
    } else if (this.speechModel === 'universal-3-pro') {
      submitBody.speech_model = 'conformer-2';
    }

    if (opts?.language) {
      submitBody.language_code = opts.language;
    }

    const submitRes = await fetch('https://api.assemblyai.com/v2/transcript', {
      method: 'POST',
      headers,
      body: JSON.stringify(submitBody),
    });

    if (!submitRes.ok) {
      const errorText = await submitRes.text().catch(() => 'Unknown error');
      throw new Error(`AssemblyAI submit error (${submitRes.status}): ${errorText}`);
    }

    const { id: transcriptId } = (await submitRes.json()) as { id: string; status: string };

    // Step 3: Poll until complete (3s interval, 10 min max)
    const maxWait = 600_000;
    const pollInterval = 3_000;
    const deadline = Date.now() + maxWait;

    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, pollInterval));

      const pollRes = await fetch(`https://api.assemblyai.com/v2/transcript/${transcriptId}`, {
        headers: { authorization: this.apiKey },
      });

      if (!pollRes.ok) {
        throw new Error(`AssemblyAI poll error (${pollRes.status})`);
      }

      const result = (await pollRes.json()) as {
        status: string;
        text?: string;
        error?: string;
        utterances?: Array<{
          text: string;
          start: number;
          end: number;
          speaker: string;
        }>;
        language_code?: string;
      };

      if (result.status === 'error') {
        throw new Error(`AssemblyAI transcription failed: ${result.error ?? 'unknown error'}`);
      }

      if (result.status === 'completed') {
        const durationMs = Date.now() - startTime;
        const text = result.text ?? '';

        const segments = result.utterances?.map((u) => ({
          start: u.start / 1000,
          end: u.end / 1000,
          text: u.text,
          speaker: u.speaker,
        })) ?? (text ? [{ start: 0, end: 0, text }] : []);

        logger.info('AssemblyAI transcription complete', {
          model: this.speechModel,
          language: result.language_code,
          segments: String(segments.length),
          durationMs: String(durationMs),
        });

        return { text, segments, language: result.language_code };
      }
    }

    throw new Error('AssemblyAI transcription timed out after 10 minutes');
  }
}

export type { SttProviderId } from '@sotto/shared';
import type { SttProviderId } from '@sotto/shared';

/**
 * Create an STT provider instance
 */
export function createSttProvider(provider?: SttProviderId, apiKey?: string, model?: string): SttProvider {
  const target = provider ?? 'openai';

  switch (target) {
    case 'elevenlabs':
      return new ElevenLabsScribeProvider(apiKey, model);
    case 'together': {
      const config = model
        ? { ...TOGETHER_WHISPER_CONFIG, model }
        : TOGETHER_WHISPER_CONFIG;
      return new OpenAIWhisperProvider(apiKey, config);
    }
    case 'deepgram':
      return new DeepgramProvider(apiKey, model);
    case 'assemblyai':
      return new AssemblyAIProvider(apiKey, model);
    case 'openai':
    default: {
      const config = model
        ? { ...OPENAI_WHISPER_CONFIG, model }
        : OPENAI_WHISPER_CONFIG;
      return new OpenAIWhisperProvider(apiKey, config);
    }
  }
}

// ---------------------------------------------------------------------------
// Platform key mapping — maps STT provider ID → env var value
// ---------------------------------------------------------------------------

const STT_PLATFORM_ENV: Record<SttProviderId, string> = {
  openai: 'OPENAI_API_KEY',
  together: 'TOGETHER_API_KEY',
  deepgram: 'DEEPGRAM_API_KEY',
  assemblyai: 'ASSEMBLYAI_API_KEY',
  elevenlabs: 'ELEVENLABS_API_KEY',
};

/**
 * Get the platform API key for a given STT provider.
 */
export function getSttPlatformKey(provider: SttProviderId): string | undefined {
  return process.env[STT_PLATFORM_ENV[provider]];
}

// ---------------------------------------------------------------------------
// Centralized STT provider resolution (mirrors resolveTtsProvider pattern)
// ---------------------------------------------------------------------------

export interface ResolvedSttProvider {
  providerId: SttProviderId;
  apiKey: string;
  model: string;
  source: 'byok' | 'platform' | 'auto';
}

/**
 * Resolve the STT provider, API key, and model for a user.
 *
 * Resolution order:
 *   1. If `requestedProvider` given → BYOK key → platform key. Throws if neither.
 *   2. Otherwise → DB-configured provider via `resolveAutoModel(plan)` → BYOK → platform. Throws if no key.
 *
 * Always returns `model` from either `requestedModel` or the DB config's sttModel.
 */
export async function resolveSttProvider(context: {
  userId: string;
  requestedProvider?: SttProviderId;
  requestedModel?: string;
  plan?: 'FREE' | 'PRO';
}): Promise<ResolvedSttProvider> {
  const { userId, requestedProvider, requestedModel } = context;

  if (requestedProvider) {
    // Explicit provider — try BYOK then platform
    const key = await resolveKeyForProvider(userId, requestedProvider);
    if (!key) {
      throw new Error(
        `No API key available for STT provider "${requestedProvider}". ` +
        'Add a key in Settings or configure a platform key.'
      );
    }
    const model = requestedModel ?? getSttProviderMeta(requestedProvider).defaultModel;
    return { providerId: requestedProvider, apiKey: key, model, source: key === getSttPlatformKey(requestedProvider) ? 'platform' : 'byok' };
  }

  // Auto-resolve from DB config
  const autoConfig = await resolveAutoModel(context.plan ?? 'FREE');
  const provider = autoConfig.sttProvider as SttProviderId;
  const model = requestedModel ?? autoConfig.sttModel;

  const key = await resolveKeyForProvider(userId, provider);
  if (!key) {
    throw new Error(
      `No API key available for auto-configured STT provider "${provider}". ` +
      'Add a key in Settings or configure a platform key.'
    );
  }

  return { providerId: provider, apiKey: key, model, source: 'auto' };
}

/**
 * Try BYOK key first, then fall back to platform env var.
 */
async function resolveKeyForProvider(
  userId: string,
  provider: SttProviderId
): Promise<string | undefined> {
  // ElevenLabs keys are stored in UserTtsKey, others in UserAiKey
  if (provider === 'elevenlabs') {
    const byokKey = await getByokKey(userId, 'elevenlabs');
    return byokKey ?? getSttPlatformKey(provider) ?? undefined;
  }

  const byokKey = await getAiKey(userId, provider);
  return byokKey?.apiKey ?? getSttPlatformKey(provider) ?? undefined;
}
