import { getAiProviderMeta, isValidAiProviderId } from '@/lib/providers/ai-registry';
import { aiModelProviderId } from '@/app/welcome/providerMap';

/**
 * Which wizard provider pills already have a platform key in the server env
 * (Doppler/.env), so the welcome wizard can show them as configured instead of
 * asking the owner to re-paste keys. Presence booleans only — values never
 * leave the server. Keys are WIZARD display ids (see app/welcome/data.ts);
 * keyless/local ids (kokoro, local, whisper) are deliberately absent — their
 * cards have their own local-endpoint UI.
 *
 * Env names mirror the runtime readers: providers/tts.ts + tts-generation.ts
 * for TTS, providers/stt/config.ts STT_PLATFORM_ENV for STT, and
 * providers/storage.ts for storage.
 */
export interface OnboardingEnvPresence {
  tts: string[];
  stt: string[];
  ai: string[];
  visual: string[];
  storage: Record<string, boolean>;
}

const TTS_ENV: Record<string, string[]> = {
  elevenlabs: ['ELEVENLABS_API_KEY'],
  hume: ['HUME_API_KEY'],
  openai: ['OPENAI_API_KEY'],
  cartesia: ['CARTESIA_API_KEY'],
  deepgram: ['DEEPGRAM_API_KEY'],
  rime: ['RIME_API_KEY'],
  playht: ['PLAYHT_API_KEY'],
};

const STT_ENV: Record<string, string[]> = {
  deepgram: ['DEEPGRAM_API_KEY'],
  elevenlabs: ['ELEVENLABS_API_KEY'],
  assembly: ['ASSEMBLYAI_API_KEY'],
  openai: ['OPENAI_API_KEY'],
  groq: ['GROQ_API_KEY'],
  cartesia: ['CARTESIA_API_KEY'],
  gladia: ['GLADIA_API_KEY'],
  speechmatics: ['SPEECHMATICS_API_KEY'],
};

// Mirrors the runtime fallback in lib/learning-targets.ts.
const VISUAL_ENV: Record<string, string[]> = {
  pexels: ['PEXELS_API_KEY'],
};

const AI_WIZARD_IDS = ['claude', 'codex', 'xai', 'deepseek', 'mistral', 'groq', 'nvidia'];

export const STORAGE_ENV_VARS = [
  'R2_ACCOUNT_ID',
  'R2_ACCESS_KEY_ID',
  'R2_SECRET_ACCESS_KEY',
  'R2_BUCKET_NAME',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_S3_BUCKET',
  'LOCAL_STORAGE_DIR',
] as const;

function envSet(name: string): boolean {
  return Boolean(process.env[name]?.trim());
}

function detectedIds(table: Record<string, string[]>): string[] {
  return Object.keys(table).filter((id) => table[id].some(envSet));
}

export function buildEnvPresence(): OnboardingEnvPresence {
  const ai = AI_WIZARD_IDS.filter((wizardId) => {
    const registryId = aiModelProviderId(wizardId);
    if (!registryId || !isValidAiProviderId(registryId)) return false;
    const envName = getAiProviderMeta(registryId)?.platformEnvKey;
    return envName ? envSet(envName) : false;
  });

  return {
    tts: detectedIds(TTS_ENV),
    stt: detectedIds(STT_ENV),
    ai,
    visual: detectedIds(VISUAL_ENV),
    storage: Object.fromEntries(STORAGE_ENV_VARS.map((name) => [name, envSet(name)])),
  };
}
