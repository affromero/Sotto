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

  constructor() {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      logger.warn('OPENAI_API_KEY not set — STT transcription will not work');
      return;
    }

    this.loadClient(apiKey);
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
 * Create an STT provider instance
 * Currently only supports OpenAI Whisper
 */
export function createSttProvider(): SttProvider {
  return new OpenAIWhisperProvider();
}
