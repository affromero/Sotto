import { getServerInfra, infra } from '@/lib/server-config';
import { abortable } from 'thesidedoor-core/runtime/stream';
import {
  getLocalTtsVoicePool,
  KOKORO_VOICE_POOL,
  type ProviderVoice,
} from '@/lib/providers/tts-voices';

export interface LocalTtsConnection {
  endpoint: string;
  apiKey?: string;
  model: string;
  voices: readonly ProviderVoice[];
}

/** Capture the sidecar configuration before importing or constructing its client. */
export async function captureLocalTtsConnection(
  provider: 'local' | 'kokoro',
  model?: string,
  apiKey?: string,
  signal?: AbortSignal
): Promise<LocalTtsConnection> {
  signal?.throwIfAborted();
  const configuration = getServerInfra();
  if (signal) await abortable(configuration, signal);
  else await configuration;
  signal?.throwIfAborted();
  const baseURL = infra('ttsBaseUrl');
  if (!baseURL) throw new Error(`A saved base URL is required for the ${provider} TTS provider.`);
  return {
    endpoint: `${baseURL.replace(/\/+$/, '')}/tts`,
    apiKey: apiKey?.trim() || undefined,
    voices: structuredClone(provider === 'local' ? getLocalTtsVoicePool() : KOKORO_VOICE_POOL),
    model: provider === 'kokoro' ? (model ?? 'kokoro') : model?.trim() || 'local',
  };
}
