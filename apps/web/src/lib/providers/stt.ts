import { logger } from '../logger';
import {
  getDefaultSttModelForLanguage,
  getSttProviderMeta,
  supportsSttLanguage,
  type SttProviderId,
} from './stt-registry';
import { infra } from '../server-config';
import type { ProviderRequestRule, ProviderTransport } from 'thesidedoor-core/providers/transport';
import {
  AssemblyAIProvider,
  CartesiaSttProvider,
  DeepgramProvider,
  ElevenLabsScribeProvider,
  GladiaProvider,
  GROQ_WHISPER_CONFIG,
  OPENAI_WHISPER_CONFIG,
  OpenAIWhisperProvider,
  SpeechmaticsProvider,
  TOGETHER_WHISPER_CONFIG,
  type WhisperProviderConfig,
} from './shared/stt-cloud-providers';
import {
  createSottoProviderTransport,
  type SottoProviderExecution,
} from '@/lib/sidedoor/credentials/runtime/provider-execution';
import {
  captureSottoExecutionCredential,
  sottoExecutionCredentialFields,
} from '@/lib/sidedoor/credentials/runtime/credential-execution';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { prismaUnfiltered } from '../prisma';

export type { SttProviderId } from './stt-registry';
export { getConfiguredSttProviderId } from './stt/config';

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
  transcribe(audio: Buffer, opts?: SttTranscriptionOptions): Promise<TranscriptionResult>;
}

export interface SttTranscriptionOptions {
  language?: string;
  signal?: AbortSignal;
  onDispatch?: () => void;
  onSettled?: () => void;
}

/**
 * Create an STT provider instance
 */
export function sttProviderRules(
  provider: SttProviderId,
  localBaseUrl?: string
): ProviderRequestRule[] {
  const transcription = (base: string) => `${base.replace(/\/$/, '')}/audio/transcriptions`;
  switch (provider) {
    case 'openai':
      return [{ method: 'POST', url: transcription('https://api.openai.com/v1') }];
    case 'together':
      return [{ method: 'POST', url: transcription(TOGETHER_WHISPER_CONFIG.baseURL!) }];
    case 'groq':
      return [{ method: 'POST', url: transcription(GROQ_WHISPER_CONFIG.baseURL!) }];
    case 'local':
      if (!localBaseUrl) throw new Error('A saved base URL is required for the local STT provider');
      return [{ method: 'POST', url: transcription(localBaseUrl) }];
    case 'elevenlabs':
      return [{ method: 'POST', url: 'https://api.elevenlabs.io/v1/speech-to-text' }];
    case 'deepgram':
      return [{ method: 'POST', url: 'https://api.deepgram.com/v1/listen', allowQuery: true }];
    case 'assemblyai':
      return [
        { method: 'POST', url: 'https://api.assemblyai.com/v2/upload' },
        { method: 'POST', url: 'https://api.assemblyai.com/v2/transcript' },
        { method: 'GET', url: 'https://api.assemblyai.com/v2/transcript/', descendants: true },
      ];
    case 'cartesia':
      return [{ method: 'POST', url: 'https://api.cartesia.ai/stt' }];
    case 'gladia':
      return [
        { method: 'POST', url: 'https://api.gladia.io/v2/upload' },
        { method: 'POST', url: 'https://api.gladia.io/v2/pre-recorded' },
        { method: 'GET', url: 'https://api.gladia.io/v2/pre-recorded/', descendants: true },
      ];
    case 'speechmatics':
      return [
        { method: 'POST', url: 'https://eu1.asr.api.speechmatics.com/v2/jobs' },
        {
          method: 'GET',
          url: 'https://eu1.asr.api.speechmatics.com/v2/jobs/',
          descendants: true,
          allowQuery: true,
        },
      ];
  }
}

export function createSttProvider(
  provider?: SttProviderId,
  apiKey?: string,
  model?: string,
  transport?: ProviderTransport
): SttProvider {
  const target = provider ?? 'openai';
  if (!transport) throw new Error('STT provider requires a captured Sidedoor transport');
  const key = apiKey ?? '';

  switch (target) {
    case 'elevenlabs':
      return new ElevenLabsScribeProvider(key, transport, model);
    case 'together': {
      const config = model ? { ...TOGETHER_WHISPER_CONFIG, model } : TOGETHER_WHISPER_CONFIG;
      return new OpenAIWhisperProvider(key, transport, config);
    }
    case 'deepgram':
      return new DeepgramProvider(key, transport, model);
    case 'assemblyai':
      return new AssemblyAIProvider(key, transport, model);
    case 'cartesia':
      return new CartesiaSttProvider(key, transport, model);
    case 'groq': {
      const config = model ? { ...GROQ_WHISPER_CONFIG, model } : GROQ_WHISPER_CONFIG;
      return new OpenAIWhisperProvider(key, transport, config);
    }
    case 'gladia':
      return new GladiaProvider(key, transport, model);
    case 'speechmatics':
      return new SpeechmaticsProvider(key, transport, model);
    case 'openai': {
      const config = model ? { ...OPENAI_WHISPER_CONFIG, model } : OPENAI_WHISPER_CONFIG;
      return new OpenAIWhisperProvider(key, transport, config);
    }
    case 'local': {
      const baseURL = infra('sttBaseUrl');
      if (!baseURL) {
        throw new Error(
          'Save a base URL for the local STT provider. Point it at an OpenAI-compatible Whisper server, such as http://localhost:8000/v1 for faster-whisper-server or Speaches.'
        );
      }
      const config: WhisperProviderConfig = {
        baseURL,
        model: infra('sttModel') || model || getSttProviderMeta('local').defaultModel,
        name: 'Local Whisper',
      };
      // Keyless: local servers ignore the key but the SDK needs a non-empty string.
      return new OpenAIWhisperProvider(key || 'local', transport, config);
    }
    default:
      throw new Error(`Unknown STT provider: "${target}"`);
  }
}

// ---------------------------------------------------------------------------
// Centralized STT provider resolution (mirrors resolveTtsProvider pattern)
// ---------------------------------------------------------------------------

export interface ResolvedSttProvider {
  providerId: SttProviderId;
  apiKey: string;
  model: string;
  source: 'credential' | 'local';
}

export interface CapturedSttProvider extends ResolvedSttProvider {
  provider: SttProvider;
}

/** Capture the selected personal credential and transport binding in the worker admission transaction. */
export async function resolveCapturedSttProvider(context: {
  userId: string;
  execution: Omit<SottoProviderExecution, 'userId' | 'credential'>;
  requestedProvider?: SttProviderId;
  requestedModel?: string;
  language?: string | null;
}): Promise<CapturedSttProvider> {
  if (!context.requestedProvider)
    throw new Error('STT provider is required. Choose a provider before transcribing audio.');
  const requestedProvider = context.requestedProvider;
  const credential = await sottoTransaction(prismaUnfiltered, (database) =>
    captureSottoExecutionCredential(
      database,
      context.execution.authorize,
      'stt',
      requestedProvider,
      true,
      context.execution.signal
    )
  );
  if (credential && credential.recipient.userId !== context.userId)
    throw new Error('The selected STT credential recipient changed');
  const execution: SottoProviderExecution = {
    ...context.execution,
    userId: context.userId,
    credential,
  };
  const resolved = credential
    ? await resolveSttSelection(
        { ...context, requestedProvider },
        sottoExecutionCredentialFields(credential).apiKey,
        'credential'
      )
    : await resolveSttSelection({ ...context, requestedProvider }, '', 'local');
  if (!resolved.apiKey && requestedProvider !== 'local')
    throw new Error(
      `No credential is available for STT provider "${requestedProvider}". Add one in Settings.`
    );
  const transport = await createSottoProviderTransport(
    execution,
    sttProviderRules(requestedProvider, infra('sttBaseUrl'))
  );
  return {
    ...resolved,
    provider: createSttProvider(resolved.providerId, resolved.apiKey, resolved.model, transport),
  };
}

async function resolveSttSelection(
  context: {
    requestedProvider: SttProviderId;
    requestedModel?: string;
    language?: string | null;
  },
  apiKey: string,
  source: ResolvedSttProvider['source']
): Promise<ResolvedSttProvider> {
  const model = compatibleSttModel(
    context.requestedProvider,
    context.requestedModel,
    context.language
  );
  return { providerId: context.requestedProvider, apiKey, model, source };
}

function compatibleSttModel(
  provider: SttProviderId,
  requestedModel?: string,
  language?: string | null
): string {
  let model = requestedModel ?? getSttProviderMeta(provider).defaultModel;
  if (language && !supportsSttLanguage(provider, model, language)) {
    const replacement = getDefaultSttModelForLanguage(provider, language, model);
    if (!replacement)
      throw new Error(
        `STT provider "${provider}" does not support language "${language}" with any configured model.`
      );
    logger.info('Language-aware STT model swap', {
      providerId: provider,
      from: model,
      to: replacement,
      language,
    });
    model = replacement;
  }
  return model;
}
