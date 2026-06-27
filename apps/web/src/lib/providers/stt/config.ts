import { infra } from '../../server-config';
import { isValidSttProviderId, type SttProviderId } from '../stt-registry';

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

export function getSttPlatformKey(provider: SttProviderId): string | undefined {
  if (provider === 'local') return process.env.STT_API_KEY?.trim() || 'local';
  return process.env[STT_PLATFORM_ENV[provider]];
}

export function getConfiguredSttProviderId(): SttProviderId {
  const raw = (infra('sttProvider', 'STT_PROVIDER') ?? '').trim();
  return isValidSttProviderId(raw) ? raw : 'openai';
}
