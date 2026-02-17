import { logger } from '../logger';

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
  model: 'whisper-1',
  envVar: 'OPENAI_API_KEY',
  name: 'OpenAI Whisper',
};

const GROQ_WHISPER_CONFIG: WhisperProviderConfig = {
  baseURL: 'https://api.groq.com/openai/v1',
  model: 'whisper-large-v3-turbo',
  envVar: 'GROQ_API_KEY',
  name: 'Groq Whisper',
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

        const text = typeof textResponse === 'string' ? textResponse : String(textResponse);

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

export type { SttProviderId } from '@sotto/shared';
import type { SttProviderId } from '@sotto/shared';

/**
 * Create an STT provider instance
 */
export function createSttProvider(provider?: SttProviderId, apiKey?: string, model?: string): SttProvider {
  const target = provider ?? 'groq';

  switch (target) {
    case 'elevenlabs':
      return new ElevenLabsScribeProvider(apiKey, model);
    case 'groq': {
      const config = model
        ? { ...GROQ_WHISPER_CONFIG, model }
        : GROQ_WHISPER_CONFIG;
      return new OpenAIWhisperProvider(apiKey, config);
    }
    case 'openai':
    default: {
      const config = model
        ? { ...OPENAI_WHISPER_CONFIG, model }
        : OPENAI_WHISPER_CONFIG;
      return new OpenAIWhisperProvider(apiKey, config);
    }
  }
}
