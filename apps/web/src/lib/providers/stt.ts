import { logger } from '../logger';
import {
  getDefaultSttModelForLanguage,
  getSttProviderMeta,
  isValidSttProviderId,
  supportsSttLanguage,
  type SttProviderId,
} from './stt-registry';
import { getSharedAiKey, getSharedByokKey } from '../byok';
import { infra } from '../server-config';
import { detectAudioFormat } from '../audio-format';
import {
  fromSttProviderLanguageCode,
  normalizeSottoLanguageCode,
  toSttProviderLanguageCode,
} from '../speech-language-support';

export type { SttProviderId } from './stt-registry';

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
  words?: Array<{ word: string; start: number; end: number }>;
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

// Groq is OpenAI-compatible at /openai/v1 — reuse the Whisper provider.
const GROQ_WHISPER_CONFIG: WhisperProviderConfig = {
  baseURL: 'https://api.groq.com/openai/v1',
  model: getSttProviderMeta('groq').defaultModel,
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
    const { ext, mime } = detectAudioFormat(audio);
    const file = new File([uint8Array], `audio.${ext}`, { type: mime });
    const language = normalizeSottoLanguageCode(opts?.language) ?? undefined;

    try {
      const response = await this.client.audio.transcriptions.create({
        file,
        model: this.config.model,
        response_format: 'verbose_json',
        language,
        timestamp_granularities: ['word', 'segment'],
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
        words?: Array<{
          word: string;
          start: number;
          end: number;
        }>;
      };

      const segments =
        verboseResponse.segments?.map((seg) => ({
          start: seg.start,
          end: seg.end,
          text: seg.text.trim(),
        })) ?? [];

      const words = verboseResponse.words?.map((w) => ({
        word: w.word,
        start: w.start,
        end: w.end,
      }));

      return {
        text: verboseResponse.text,
        segments,
        words,
        language: normalizeSottoLanguageCode(verboseResponse.language) ?? verboseResponse.language,
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
          language,
        });

        const text =
          typeof textResponse === 'string' ? textResponse : (textResponse as { text: string }).text;

        return {
          text,
          segments: [{ start: 0, end: 0, text }],
          language,
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
    const { ext, mime } = detectAudioFormat(audio);
    const blob = new Blob([uint8Array], { type: mime });
    formData.append('file', blob, `audio.${ext}`);
    formData.append('model_id', this.model);
    formData.append('tag_audio_events', 'false');
    formData.append('diarize', 'false');
    const language = toSttProviderLanguageCode('elevenlabs', opts?.language);

    if (language) {
      formData.append('language_code', language);
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

    // Pass through word-level timestamps
    const words = data.words
      ?.filter((w) => !w.type || w.type === 'word')
      .map((w) => ({ word: w.text, start: w.start, end: w.end }));

    logger.info('Scribe transcription complete', {
      language: data.language_code,
      wordCount: String(data.words?.length ?? 0),
      segments: String(segments.length),
      durationMs: String(durationMs),
    });

    return {
      text: data.text,
      segments,
      words,
      language: fromSttProviderLanguageCode('elevenlabs', data.language_code),
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
          text: currentWords
            .map((w) => w.text)
            .join(' ')
            .trim(),
        });
        currentWords = [];
      }
    }

    // Flush remaining words as a final segment
    if (currentWords.length > 0) {
      segments.push({
        start: currentWords[0].start,
        end: currentWords[currentWords.length - 1].end,
        text: currentWords
          .map((w) => w.text)
          .join(' ')
          .trim(),
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
    const language = toSttProviderLanguageCode('deepgram', opts?.language);
    if (language) params.set('language', language);

    const response = await fetch(`https://api.deepgram.com/v1/listen?${params.toString()}`, {
      method: 'POST',
      headers: {
        Authorization: `Token ${this.apiKey}`,
        'Content-Type': detectAudioFormat(audio).mime,
      },
      body: new Uint8Array(audio),
    });

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

    // Pass through word-level timestamps
    const words = alt?.words?.map((w) => ({
      word: w.punctuated_word ?? w.word,
      start: w.start,
      end: w.end,
    }));

    logger.info('Deepgram transcription complete', {
      model: this.model,
      language: data.metadata?.language,
      segments: String(segments.length),
      durationMs: String(durationMs),
    });

    return {
      text,
      segments,
      words,
      language: fromSttProviderLanguageCode('deepgram', data.metadata?.language),
    };
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

    const language = toSttProviderLanguageCode('assemblyai', opts?.language);
    if (language) {
      submitBody.language_code = language;
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

        const segments =
          result.utterances?.map((u) => ({
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

        return {
          text,
          segments,
          language: fromSttProviderLanguageCode('assemblyai', result.language_code),
        };
      }
    }

    throw new Error('AssemblyAI transcription timed out after 10 minutes');
  }
}

/**
 * Cartesia Ink STT provider — synchronous batch /stt with the ink-whisper family.
 * Word-level timestamps; 99+ languages. The key lives in the TTS/BYOK store.
 */
class CartesiaSttProvider implements SttProvider {
  private apiKey: string;
  private model: string;

  constructor(apiKey?: string, model?: string) {
    const key = apiKey || process.env.CARTESIA_API_KEY;
    if (!key) throw new Error('No Cartesia API key provided — Cartesia STT will not work');
    this.apiKey = key;
    this.model = model ?? 'ink-whisper';
    logger.info('Cartesia STT provider initialized', { model: this.model });
  }

  async transcribe(audio: Buffer, opts?: { language?: string }): Promise<TranscriptionResult> {
    const startTime = Date.now();
    const { ext, mime } = detectAudioFormat(audio);
    const form = new FormData();
    form.append('file', new File([new Uint8Array(audio)], `audio.${ext}`, { type: mime }));
    form.append('model', this.model);
    form.append('timestamp_granularities[]', 'word');
    const language = toSttProviderLanguageCode('cartesia', opts?.language);
    if (language) form.append('language', language);

    const response = await fetch('https://api.cartesia.ai/stt', {
      method: 'POST',
      headers: { 'X-API-Key': this.apiKey, 'Cartesia-Version': '2026-03-01' },
      body: form,
    });
    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      throw new Error(`Cartesia STT error (${response.status}): ${errorText}`);
    }

    const data = (await response.json()) as {
      text: string;
      language?: string;
      duration?: number;
      words?: Array<{ word: string; start: number; end: number }>;
    };
    const text = data.text ?? '';
    const words = data.words?.map((w) => ({ word: w.word, start: w.start, end: w.end }));
    const lastEnd = words?.length ? words[words.length - 1].end : (data.duration ?? 0);
    const segments = text ? [{ start: words?.[0]?.start ?? 0, end: lastEnd, text }] : [];

    logger.info('Cartesia transcription complete', {
      model: this.model,
      language: data.language,
      segments: String(segments.length),
      durationMs: String(Date.now() - startTime),
    });
    return {
      text,
      segments,
      words,
      language: fromSttProviderLanguageCode('cartesia', data.language),
    };
  }
}

/**
 * Gladia STT provider — async: upload → submit pre-recorded job → poll for result.
 * Word timestamps via accurate_words_timestamps; 140 languages.
 */
class GladiaProvider implements SttProvider {
  private apiKey: string;
  private model: string;

  constructor(apiKey?: string, model?: string) {
    const key = apiKey || process.env.GLADIA_API_KEY;
    if (!key) throw new Error('No Gladia API key provided — Gladia STT will not work');
    this.apiKey = key;
    this.model = model ?? 'solaria-1';
  }

  async transcribe(audio: Buffer, opts?: { language?: string }): Promise<TranscriptionResult> {
    const startTime = Date.now();
    const { ext, mime } = detectAudioFormat(audio);
    const language = toSttProviderLanguageCode('gladia', opts?.language);

    const uploadForm = new FormData();
    uploadForm.append('audio', new File([new Uint8Array(audio)], `audio.${ext}`, { type: mime }));
    const uploadRes = await fetch('https://api.gladia.io/v2/upload', {
      method: 'POST',
      headers: { 'x-gladia-key': this.apiKey },
      body: uploadForm,
    });
    if (!uploadRes.ok) {
      throw new Error(
        `Gladia upload error (${uploadRes.status}): ${await uploadRes.text().catch(() => '')}`
      );
    }
    const { audio_url } = (await uploadRes.json()) as { audio_url: string };

    const submitRes = await fetch('https://api.gladia.io/v2/pre-recorded', {
      method: 'POST',
      headers: { 'x-gladia-key': this.apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        audio_url,
        model: this.model,
        accurate_words_timestamps: true,
        ...(language && { language_config: { languages: [language] } }),
      }),
    });
    if (!submitRes.ok) {
      throw new Error(
        `Gladia submit error (${submitRes.status}): ${await submitRes.text().catch(() => '')}`
      );
    }
    const submit = (await submitRes.json()) as { id: string; result_url?: string };
    const pollUrl = submit.result_url ?? `https://api.gladia.io/v2/pre-recorded/${submit.id}`;

    const deadline = Date.now() + 300_000;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 3_000));
      const pollRes = await fetch(pollUrl, { headers: { 'x-gladia-key': this.apiKey } });
      if (!pollRes.ok) throw new Error(`Gladia poll error (${pollRes.status})`);
      const data = (await pollRes.json()) as {
        status: string;
        result?: {
          transcription?: {
            full_transcript?: string;
            languages?: string[];
            utterances?: Array<{
              text: string;
              start: number;
              end: number;
              words?: Array<{ word: string; start: number; end: number }>;
            }>;
          };
        };
      };
      if (data.status === 'error') throw new Error('Gladia transcription failed');
      if (data.status === 'done') {
        const tr = data.result?.transcription;
        const text = tr?.full_transcript ?? '';
        const segments =
          tr?.utterances?.map((u) => ({ start: u.start, end: u.end, text: u.text })) ??
          (text ? [{ start: 0, end: 0, text }] : []);
        const words = tr?.utterances
          ?.flatMap((u) => u.words ?? [])
          .map((w) => ({ word: w.word, start: w.start, end: w.end }));
        logger.info('Gladia transcription complete', {
          model: this.model,
          segments: String(segments.length),
          durationMs: String(Date.now() - startTime),
        });
        return {
          text,
          segments,
          words: words?.length ? words : undefined,
          language: fromSttProviderLanguageCode('gladia', tr?.languages?.[0]),
        };
      }
    }
    throw new Error('Gladia transcription timed out after 5 minutes');
  }
}

/**
 * Speechmatics STT provider — async: submit job → poll status → fetch transcript.
 * Word timestamps are always present; reconstruct text from the results array.
 */
class SpeechmaticsProvider implements SttProvider {
  private apiKey: string;
  private model: string;
  private base = 'https://eu1.asr.api.speechmatics.com/v2';

  constructor(apiKey?: string, model?: string) {
    const key = apiKey || process.env.SPEECHMATICS_API_KEY;
    if (!key) throw new Error('No Speechmatics API key provided — Speechmatics STT will not work');
    this.apiKey = key;
    this.model = model ?? 'enhanced';
  }

  async transcribe(audio: Buffer, opts?: { language?: string }): Promise<TranscriptionResult> {
    const startTime = Date.now();
    const { ext, mime } = detectAudioFormat(audio);
    const language = toSttProviderLanguageCode('speechmatics', opts?.language) ?? 'en';
    const config = {
      type: 'transcription',
      transcription_config: { language, operating_point: this.model },
    };
    const form = new FormData();
    form.append('data_file', new File([new Uint8Array(audio)], `audio.${ext}`, { type: mime }));
    form.append('config', JSON.stringify(config));

    const submitRes = await fetch(`${this.base}/jobs`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiKey}` },
      body: form,
    });
    if (!submitRes.ok) {
      throw new Error(
        `Speechmatics submit error (${submitRes.status}): ${await submitRes.text().catch(() => '')}`
      );
    }
    const { id } = (await submitRes.json()) as { id: string };

    const deadline = Date.now() + 300_000;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 3_000));
      const statusRes = await fetch(`${this.base}/jobs/${id}`, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
      });
      if (!statusRes.ok) throw new Error(`Speechmatics poll error (${statusRes.status})`);
      const status = ((await statusRes.json()) as { job?: { status?: string } }).job?.status;
      if (status === 'rejected') throw new Error('Speechmatics transcription rejected');
      if (status === 'done') {
        const trRes = await fetch(`${this.base}/jobs/${id}/transcript?format=json`, {
          headers: { Authorization: `Bearer ${this.apiKey}` },
        });
        if (!trRes.ok) throw new Error(`Speechmatics transcript error (${trRes.status})`);
        const tr = (await trRes.json()) as {
          results?: Array<{
            type?: string;
            start_time?: number;
            end_time?: number;
            alternatives?: Array<{ content?: string }>;
          }>;
          metadata?: { transcription_config?: { language?: string } };
        };
        const results = tr.results ?? [];
        const words = results
          .filter((r) => r.type === 'word')
          .map((r) => ({
            word: r.alternatives?.[0]?.content ?? '',
            start: r.start_time ?? 0,
            end: r.end_time ?? 0,
          }));
        let text = '';
        for (const r of results) {
          const c = r.alternatives?.[0]?.content ?? '';
          if (!c) continue;
          text += r.type === 'punctuation' ? c : (text ? ' ' : '') + c;
        }
        const segments = text
          ? [{ start: words[0]?.start ?? 0, end: words[words.length - 1]?.end ?? 0, text }]
          : [];
        logger.info('Speechmatics transcription complete', {
          model: this.model,
          segments: String(segments.length),
          durationMs: String(Date.now() - startTime),
        });
        return {
          text,
          segments,
          words: words.length ? words : undefined,
          language: fromSttProviderLanguageCode(
            'speechmatics',
            tr.metadata?.transcription_config?.language
          ),
        };
      }
    }
    throw new Error('Speechmatics transcription timed out after 5 minutes');
  }
}

/**
 * Create an STT provider instance
 */
export function createSttProvider(
  provider?: SttProviderId,
  apiKey?: string,
  model?: string
): SttProvider {
  const target = provider ?? 'openai';

  switch (target) {
    case 'elevenlabs':
      return new ElevenLabsScribeProvider(apiKey, model);
    case 'together': {
      const config = model ? { ...TOGETHER_WHISPER_CONFIG, model } : TOGETHER_WHISPER_CONFIG;
      return new OpenAIWhisperProvider(apiKey, config);
    }
    case 'deepgram':
      return new DeepgramProvider(apiKey, model);
    case 'assemblyai':
      return new AssemblyAIProvider(apiKey, model);
    case 'cartesia':
      return new CartesiaSttProvider(apiKey, model);
    case 'groq': {
      const config = model ? { ...GROQ_WHISPER_CONFIG, model } : GROQ_WHISPER_CONFIG;
      return new OpenAIWhisperProvider(apiKey, config);
    }
    case 'gladia':
      return new GladiaProvider(apiKey, model);
    case 'speechmatics':
      return new SpeechmaticsProvider(apiKey, model);
    case 'openai': {
      const config = model ? { ...OPENAI_WHISPER_CONFIG, model } : OPENAI_WHISPER_CONFIG;
      return new OpenAIWhisperProvider(apiKey, config);
    }
    case 'local': {
      const baseURL = infra('sttBaseUrl', 'STT_BASE_URL');
      if (!baseURL) {
        throw new Error(
          'STT_BASE_URL is required for STT_PROVIDER=local. Point it at your local OpenAI-compatible Whisper server (e.g. http://localhost:8000/v1 for faster-whisper-server / Speaches).'
        );
      }
      const config: WhisperProviderConfig = {
        baseURL,
        model: infra('sttModel', 'STT_MODEL') || model || getSttProviderMeta('local').defaultModel,
        envVar: 'STT_API_KEY',
        name: 'Local Whisper',
      };
      // Keyless: local servers ignore the key but the SDK needs a non-empty string.
      return new OpenAIWhisperProvider(apiKey || 'local', config);
    }
    default:
      throw new Error(`Unknown STT provider: "${target}"`);
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
  cartesia: 'CARTESIA_API_KEY',
  groq: 'GROQ_API_KEY',
  gladia: 'GLADIA_API_KEY',
  speechmatics: 'SPEECHMATICS_API_KEY',
  local: 'STT_API_KEY',
};

/**
 * Get the platform API key for a given STT provider.
 * The local provider is keyless — it returns a placeholder so the resolver does
 * not reject it (the local server ignores the key; STT_API_KEY overrides it only
 * when a local server sits behind auth).
 */
export function getSttPlatformKey(provider: SttProviderId): string | undefined {
  if (provider === 'local') return process.env.STT_API_KEY?.trim() || 'local';
  return process.env[STT_PLATFORM_ENV[provider]];
}

/**
 * Resolve the server-configured STT provider from STT_PROVIDER (validated),
 * defaulting to 'openai'. Used by workers that transcribe with the instance's
 * configured provider rather than a per-request choice — so STT_PROVIDER=local
 * routes transcription to a local Whisper server.
 */
export function getConfiguredSttProviderId(): SttProviderId {
  const raw = (infra('sttProvider', 'STT_PROVIDER') ?? '').trim();
  return isValidSttProviderId(raw) ? raw : 'openai';
}

// ---------------------------------------------------------------------------
// Centralized STT provider resolution (mirrors resolveTtsProvider pattern)
// ---------------------------------------------------------------------------

export interface ResolvedSttProvider {
  providerId: SttProviderId;
  apiKey: string;
  model: string;
  source: 'byok' | 'platform';
}

/**
 * Resolve the STT provider, API key, and model for a user.
 *
 * Resolution order:
 *   1. If `requestedProvider` given → BYOK key → platform key. Throws if neither.
 *
 * Missing providers are rejected so transcription cannot silently switch providers.
 */
export async function resolveSttProvider(context: {
  userId: string;
  requestedProvider?: SttProviderId;
  requestedModel?: string;
  /** ISO 639-1 language code — validates provider/model compatibility when set. */
  language?: string | null;
}): Promise<ResolvedSttProvider> {
  const { userId, requestedProvider, requestedModel, language } = context;

  if (!requestedProvider) {
    throw new Error('STT provider is required. Choose a provider before transcribing audio.');
  }

  const key = await resolveKeyForProvider(userId, requestedProvider);
  if (!key) {
    throw new Error(
      `No API key available for STT provider "${requestedProvider}". ` +
        'Add a key in Settings or configure a platform key.'
    );
  }

  const defaultModel = getSttProviderMeta(requestedProvider).defaultModel;
  let model = requestedModel ?? defaultModel;

  if (language && !supportsSttLanguage(requestedProvider, model, language)) {
    const fallback = getDefaultSttModelForLanguage(requestedProvider, language, model);
    if (!fallback) {
      throw new Error(
        `STT provider "${requestedProvider}" does not support language "${language}" with any configured model.`
      );
    }
    logger.info('Language-aware STT model swap', {
      providerId: requestedProvider,
      from: model,
      to: fallback,
      language,
    });
    model = fallback;
  }

  return {
    providerId: requestedProvider,
    apiKey: key,
    model,
    source: key === getSttPlatformKey(requestedProvider) ? 'platform' : 'byok',
  };
}

/**
 * Try BYOK key first, then fall back to platform env var.
 */
async function resolveKeyForProvider(
  userId: string,
  provider: SttProviderId
): Promise<string | undefined> {
  // ElevenLabs and Cartesia keys are stored in UserTtsKey, others in UserAiKey.
  if (provider === 'elevenlabs' || provider === 'cartesia') {
    const byokKey = await getSharedByokKey(userId, provider);
    return byokKey?.apiKey ?? getSttPlatformKey(provider) ?? undefined;
  }

  const byokKey = await getSharedAiKey(userId, provider);
  return byokKey?.apiKey ?? getSttPlatformKey(provider) ?? undefined;
}
