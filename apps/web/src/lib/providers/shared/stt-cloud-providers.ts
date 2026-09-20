import { setTimeout as delay } from 'node:timers/promises';
import { providerCompatibleConnection } from 'thesidedoor-core/providers/catalog';
import type { ProviderTransport } from 'thesidedoor-core/providers/transport';
import { logger } from '../../logger';
import { detectAudioFormat } from '../../audio-format';
import { getSttProviderMeta } from '../stt-registry';
import {
  fromSttProviderLanguageCode,
  normalizeSottoLanguageCode,
  toSttProviderLanguageCode,
} from '../../speech-language-support';
import type { SttProvider, SttTranscriptionOptions, TranscriptionResult } from '../stt';

function settleSynchronousResponse(onSettled?: () => void) {
  return ({ status }: { status: number }) => {
    if (status < 500) onSettled?.();
  };
}

/**
 * OpenAI Whisper API provider
 * Uses verbose JSON format to extract word-level timestamps
 */
export interface WhisperProviderConfig {
  baseURL?: string;
  model: string;
  name: string;
}

export const OPENAI_WHISPER_CONFIG: WhisperProviderConfig = {
  model: getSttProviderMeta('openai').defaultModel,
  name: 'OpenAI Whisper',
};

function compatibleWhisperConfig(
  provider: 'together' | 'groq',
  name: string
): WhisperProviderConfig {
  const connection = providerCompatibleConnection(provider);
  if (!connection) throw new Error(`Missing compatible connection metadata for ${provider}`);
  return {
    baseURL: connection.baseURL,
    model: getSttProviderMeta(provider).defaultModel,
    name,
  };
}

export const TOGETHER_WHISPER_CONFIG = compatibleWhisperConfig('together', 'Together AI Whisper');

// Groq is OpenAI-compatible at /openai/v1 — reuse the Whisper provider.
export const GROQ_WHISPER_CONFIG = compatibleWhisperConfig('groq', 'Groq Whisper');

export class OpenAIWhisperProvider implements SttProvider {
  private config: WhisperProviderConfig;
  private apiKey: string;

  constructor(
    apiKey: string,
    private readonly transport: ProviderTransport,
    config?: WhisperProviderConfig
  ) {
    this.config = config ?? OPENAI_WHISPER_CONFIG;
    if (!apiKey.trim())
      throw new Error(`No API key provided — ${this.config.name} STT will not work`);
    this.apiKey = apiKey;
  }

  async transcribe(
    audio: Buffer,
    opts: SttTranscriptionOptions = {}
  ): Promise<TranscriptionResult> {
    const { default: OpenAI } = await import('openai');
    const client = new OpenAI({
      apiKey: this.apiKey,
      ...(this.config.baseURL ? { baseURL: this.config.baseURL } : {}),
      fetch: (input: RequestInfo | URL, init?: RequestInit) =>
        this.transport.authenticatedFetch(
          input,
          { ...init, signal: opts.signal },
          {
            onDispatch: opts.onDispatch ?? (() => {}),
            onConsumed: settleSynchronousResponse(opts.onSettled),
          }
        ),
    });
    logger.info(`${this.config.name} STT provider initialized`);

    const startTime = Date.now();
    const uint8Array = new Uint8Array(audio);
    const { ext, mime } = detectAudioFormat(audio);
    const file = new File([uint8Array], `audio.${ext}`, { type: mime });
    const language = normalizeSottoLanguageCode(opts?.language) ?? undefined;

    const response = await client.audio.transcriptions.create({
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
  }
}

/**
 * ElevenLabs Scribe STT provider
 * Uses the speech-to-text endpoint with scribe_v1 model
 */
export class ElevenLabsScribeProvider implements SttProvider {
  private apiKey: string;
  private model: string;

  constructor(
    apiKey: string,
    private readonly transport: ProviderTransport,
    model?: string
  ) {
    if (!apiKey.trim()) {
      throw new Error('No ElevenLabs API key provided — Scribe STT will not work');
    }
    this.apiKey = apiKey;
    this.model = model ?? 'scribe_v1';
    logger.info('ElevenLabs Scribe STT provider initialized');
  }

  async transcribe(
    audio: Buffer,
    opts: SttTranscriptionOptions = {}
  ): Promise<TranscriptionResult> {
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

    const response = await this.transport.authenticatedFetch(
      'https://api.elevenlabs.io/v1/speech-to-text',
      {
        method: 'POST',
        signal: opts.signal,
        headers: {
          'xi-api-key': this.apiKey,
        },
        body: formData,
      },
      {
        onDispatch: opts.onDispatch ?? (() => {}),
        onConsumed: settleSynchronousResponse(opts.onSettled),
      }
    );

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
export class DeepgramProvider implements SttProvider {
  private apiKey: string;
  private model: string;

  constructor(
    apiKey: string,
    private readonly transport: ProviderTransport,
    model?: string
  ) {
    if (!apiKey.trim()) {
      throw new Error('No Deepgram API key provided — Deepgram STT will not work');
    }
    this.apiKey = apiKey;
    this.model = model ?? 'nova-3';
    logger.info('Deepgram STT provider initialized', { model: this.model });
  }

  async transcribe(
    audio: Buffer,
    opts: SttTranscriptionOptions = {}
  ): Promise<TranscriptionResult> {
    const startTime = Date.now();

    const params = new URLSearchParams({
      model: this.model,
      smart_format: 'true',
      utterances: 'true',
      punctuate: 'true',
    });
    const language = toSttProviderLanguageCode('deepgram', opts?.language);
    if (language) params.set('language', language);

    const response = await this.transport.authenticatedFetch(
      `https://api.deepgram.com/v1/listen?${params.toString()}`,
      {
        method: 'POST',
        signal: opts.signal,
        headers: {
          Authorization: `Token ${this.apiKey}`,
          'Content-Type': detectAudioFormat(audio).mime,
        },
        body: new Uint8Array(audio),
      },
      {
        onDispatch: opts.onDispatch ?? (() => {}),
        onConsumed: settleSynchronousResponse(opts.onSettled),
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
export class AssemblyAIProvider implements SttProvider {
  private apiKey: string;
  private speechModel: string;

  constructor(
    apiKey: string,
    private readonly transport: ProviderTransport,
    model?: string
  ) {
    if (!apiKey.trim()) {
      throw new Error('No AssemblyAI API key provided — AssemblyAI STT will not work');
    }
    this.apiKey = apiKey;
    this.speechModel = model ?? 'best';
    logger.info('AssemblyAI STT provider initialized', { model: this.speechModel });
  }

  async transcribe(
    audio: Buffer,
    opts: SttTranscriptionOptions = {}
  ): Promise<TranscriptionResult> {
    const startTime = Date.now();
    const headers = { authorization: this.apiKey, 'content-type': 'application/json' };

    // Step 1: Upload audio
    const uploadRes = await this.transport.authenticatedFetch(
      'https://api.assemblyai.com/v2/upload',
      {
        method: 'POST',
        signal: opts.signal,
        headers: { authorization: this.apiKey, 'content-type': 'application/octet-stream' },
        body: new Uint8Array(audio),
      },
      { onDispatch: () => {} }
    );

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

    const submitRes = await this.transport.authenticatedFetch(
      'https://api.assemblyai.com/v2/transcript',
      {
        method: 'POST',
        signal: opts.signal,
        headers,
        body: JSON.stringify(submitBody),
      },
      { onDispatch: opts.onDispatch ?? (() => {}) }
    );

    if (!submitRes.ok) {
      const errorText = await submitRes.text();
      if (submitRes.status >= 400 && submitRes.status < 500) opts.onSettled?.();
      throw new Error(`AssemblyAI submit error (${submitRes.status}): ${errorText}`);
    }

    const { id: transcriptId } = (await submitRes.json()) as { id: string; status: string };

    // Step 3: Poll until complete (3s interval, 10 min max)
    const maxWait = 600_000;
    const pollInterval = 3_000;
    const deadline = Date.now() + maxWait;

    while (Date.now() < deadline) {
      await delay(pollInterval, undefined, { signal: opts.signal });

      const pollRes = await this.transport.authenticatedFetch(
        `https://api.assemblyai.com/v2/transcript/${transcriptId}`,
        {
          headers: { authorization: this.apiKey },
          signal: opts.signal,
        },
        { onDispatch: () => {} }
      );

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
        opts.onSettled?.();
        throw new Error(`AssemblyAI transcription failed: ${result.error ?? 'unknown error'}`);
      }

      if (result.status === 'completed') {
        opts.onSettled?.();
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
export class CartesiaSttProvider implements SttProvider {
  private apiKey: string;
  private model: string;

  constructor(
    apiKey: string,
    private readonly transport: ProviderTransport,
    model?: string
  ) {
    if (!apiKey.trim())
      throw new Error('No Cartesia API key provided — Cartesia STT will not work');
    this.apiKey = apiKey;
    this.model = model ?? 'ink-whisper';
    logger.info('Cartesia STT provider initialized', { model: this.model });
  }

  async transcribe(
    audio: Buffer,
    opts: SttTranscriptionOptions = {}
  ): Promise<TranscriptionResult> {
    const startTime = Date.now();
    const { ext, mime } = detectAudioFormat(audio);
    const form = new FormData();
    form.append('file', new File([new Uint8Array(audio)], `audio.${ext}`, { type: mime }));
    form.append('model', this.model);
    form.append('timestamp_granularities[]', 'word');
    const language = toSttProviderLanguageCode('cartesia', opts?.language);
    if (language) form.append('language', language);

    const response = await this.transport.authenticatedFetch(
      'https://api.cartesia.ai/stt',
      {
        method: 'POST',
        signal: opts.signal,
        headers: { 'X-API-Key': this.apiKey, 'Cartesia-Version': '2026-03-01' },
        body: form,
      },
      {
        onDispatch: opts.onDispatch ?? (() => {}),
        onConsumed: settleSynchronousResponse(opts.onSettled),
      }
    );
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
export class GladiaProvider implements SttProvider {
  private apiKey: string;
  private model: string;

  constructor(
    apiKey: string,
    private readonly transport: ProviderTransport,
    model?: string
  ) {
    if (!apiKey.trim()) throw new Error('No Gladia API key provided — Gladia STT will not work');
    this.apiKey = apiKey;
    this.model = model ?? 'solaria-1';
  }

  async transcribe(
    audio: Buffer,
    opts: SttTranscriptionOptions = {}
  ): Promise<TranscriptionResult> {
    const startTime = Date.now();
    const { ext, mime } = detectAudioFormat(audio);
    const language = toSttProviderLanguageCode('gladia', opts?.language);

    const uploadForm = new FormData();
    uploadForm.append('audio', new File([new Uint8Array(audio)], `audio.${ext}`, { type: mime }));
    const uploadRes = await this.transport.authenticatedFetch(
      'https://api.gladia.io/v2/upload',
      {
        method: 'POST',
        signal: opts.signal,
        headers: { 'x-gladia-key': this.apiKey },
        body: uploadForm,
      },
      { onDispatch: () => {} }
    );
    if (!uploadRes.ok) {
      throw new Error(
        `Gladia upload error (${uploadRes.status}): ${await uploadRes.text().catch(() => '')}`
      );
    }
    const { audio_url } = (await uploadRes.json()) as { audio_url: string };

    const submitRes = await this.transport.authenticatedFetch(
      'https://api.gladia.io/v2/pre-recorded',
      {
        method: 'POST',
        signal: opts.signal,
        headers: { 'x-gladia-key': this.apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          audio_url,
          model: this.model,
          accurate_words_timestamps: true,
          ...(language && { language_config: { languages: [language] } }),
        }),
      },
      { onDispatch: opts.onDispatch ?? (() => {}) }
    );
    if (!submitRes.ok) {
      const errorText = await submitRes.text();
      if (submitRes.status >= 400 && submitRes.status < 500) opts.onSettled?.();
      throw new Error(`Gladia submit error (${submitRes.status}): ${errorText}`);
    }
    const submit = (await submitRes.json()) as { id: string; result_url?: string };
    const pollUrl = submit.result_url ?? `https://api.gladia.io/v2/pre-recorded/${submit.id}`;

    const deadline = Date.now() + 300_000;
    while (Date.now() < deadline) {
      await delay(3_000, undefined, { signal: opts.signal });
      const pollRes = await this.transport.authenticatedFetch(
        pollUrl,
        {
          headers: { 'x-gladia-key': this.apiKey },
          signal: opts.signal,
        },
        { onDispatch: () => {} }
      );
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
      if (data.status === 'error') {
        opts.onSettled?.();
        throw new Error('Gladia transcription failed');
      }
      if (data.status === 'done') {
        opts.onSettled?.();
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
export class SpeechmaticsProvider implements SttProvider {
  private apiKey: string;
  private model: string;
  private base = 'https://eu1.asr.api.speechmatics.com/v2';

  constructor(
    apiKey: string,
    private readonly transport: ProviderTransport,
    model?: string
  ) {
    if (!apiKey.trim())
      throw new Error('No Speechmatics API key provided — Speechmatics STT will not work');
    this.apiKey = apiKey;
    this.model = model ?? 'enhanced';
  }

  async transcribe(
    audio: Buffer,
    opts: SttTranscriptionOptions = {}
  ): Promise<TranscriptionResult> {
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

    const submitRes = await this.transport.authenticatedFetch(
      `${this.base}/jobs`,
      {
        method: 'POST',
        signal: opts.signal,
        headers: { Authorization: `Bearer ${this.apiKey}` },
        body: form,
      },
      { onDispatch: opts.onDispatch ?? (() => {}) }
    );
    if (!submitRes.ok) {
      const errorText = await submitRes.text();
      if (submitRes.status >= 400 && submitRes.status < 500) opts.onSettled?.();
      throw new Error(`Speechmatics submit error (${submitRes.status}): ${errorText}`);
    }
    const { id } = (await submitRes.json()) as { id: string };

    const deadline = Date.now() + 300_000;
    while (Date.now() < deadline) {
      await delay(3_000, undefined, { signal: opts.signal });
      const statusRes = await this.transport.authenticatedFetch(
        `${this.base}/jobs/${id}`,
        {
          headers: { Authorization: `Bearer ${this.apiKey}` },
          signal: opts.signal,
        },
        { onDispatch: () => {} }
      );
      if (!statusRes.ok) throw new Error(`Speechmatics poll error (${statusRes.status})`);
      const status = ((await statusRes.json()) as { job?: { status?: string } }).job?.status;
      if (status === 'rejected') {
        opts.onSettled?.();
        throw new Error('Speechmatics transcription rejected');
      }
      if (status === 'done') {
        const trRes = await this.transport.authenticatedFetch(
          `${this.base}/jobs/${id}/transcript?format=json`,
          {
            headers: { Authorization: `Bearer ${this.apiKey}` },
            signal: opts.signal,
          },
          { onDispatch: () => {} }
        );
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
        opts.onSettled?.();
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
