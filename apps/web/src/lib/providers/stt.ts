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
class OpenAIWhisperProvider implements SttProvider {
  private client: any | null = null;
  private isAvailable = false;

  constructor(apiKey?: string) {
    const key = apiKey || process.env.OPENAI_API_KEY;
    if (!key) {
      logger.warn('No OpenAI API key provided — Whisper STT will not work');
      return;
    }

    this.loadClient(key);
  }

  private async loadClient(apiKey: string): Promise<void> {
    try {
      const { default: OpenAI } = await import('openai');
      this.client = new OpenAI({ apiKey });
      this.isAvailable = true;
      logger.info('OpenAI Whisper STT provider initialized');
    } catch (err) {
      logger.warn('OpenAI SDK not installed — STT transcription unavailable', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async transcribe(audio: Buffer, opts?: { language?: string }): Promise<TranscriptionResult> {
    if (!this.client || !this.isAvailable) {
      throw new Error('OpenAI Whisper provider not initialized — set OPENAI_API_KEY');
    }

    const startTime = Date.now();
    const uint8Array = new Uint8Array(audio);
    const file = new File([uint8Array], 'audio.mp3', { type: 'audio/mpeg' });

    try {
      const response = await this.client.audio.transcriptions.create({
        file,
        model: 'whisper-1',
        response_format: 'verbose_json',
        language: opts?.language,
        timestamp_granularities: ['segment'],
      });

      const durationMs = Date.now() - startTime;

      logger.info('Whisper transcription complete', {
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
        logger.warn('Whisper verbose_json format failed, falling back to text-only', {
          error: err.message,
        });

        const textResponse = await this.client.audio.transcriptions.create({
          file,
          model: 'whisper-1',
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

  constructor(apiKey?: string) {
    const key = apiKey || process.env.ELEVENLABS_API_KEY;
    if (!key) {
      throw new Error('No ElevenLabs API key provided — Scribe STT will not work');
    }
    this.apiKey = key;
    logger.info('ElevenLabs Scribe STT provider initialized');
  }

  async transcribe(audio: Buffer, opts?: { language?: string }): Promise<TranscriptionResult> {
    const startTime = Date.now();

    const formData = new FormData();
    const blob = new Blob([audio], { type: 'audio/mpeg' });
    formData.append('file', blob, 'audio.mp3');
    formData.append('model_id', 'scribe_v1');
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

export type SttProviderId = 'openai' | 'elevenlabs';

/**
 * Create an STT provider instance
 */
export function createSttProvider(provider?: SttProviderId, apiKey?: string): SttProvider {
  const target = provider ?? 'openai';

  switch (target) {
    case 'elevenlabs':
      return new ElevenLabsScribeProvider(apiKey);
    case 'openai':
    default:
      return new OpenAIWhisperProvider(apiKey);
  }
}
