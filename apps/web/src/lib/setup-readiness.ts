export type SetupCapabilityId =
  | 'database'
  | 'queue'
  | 'storage'
  | 'generation'
  | 'tts'
  | 'agent-ingestion'
  | 'stt';

export type SetupCapabilityStatus = 'ready' | 'action_required' | 'optional';

export interface ProviderStatus {
  provider: string;
  isValid: boolean;
}

export interface SetupCapability {
  id: SetupCapabilityId;
  label: string;
  description: string;
  status: SetupCapabilityStatus;
  actionLabel?: string;
  actionHref?: string;
  detail: string;
  required?: boolean;
}

export interface SetupReadiness {
  ready: boolean;
  readyCount: number;
  totalCount: number;
  nextAction: SetupCapability | null;
  capabilities: SetupCapability[];
}

interface BuildSetupReadinessInput {
  hasDatabase: boolean;
  hasQueue: boolean;
  storageProvider?: string | null;
  aiProviders: ProviderStatus[];
  ttsProviders: ProviderStatus[];
  sttProviders: ProviderStatus[];
  selectedAiProvider?: string | null;
  selectedTtsProvider?: string | null;
  selectedSttProvider?: string | null;
  claudeCodeAvailable?: boolean;
  env?: Record<string, string | undefined>;
}

const AI_PLATFORM_KEYS: Record<string, string[]> = {
  anthropic: ['ANTHROPIC_API_KEY'],
  openai: ['OPENAI_API_KEY'],
  google: ['GOOGLE_GENERATIVE_AI_API_KEY', 'GEMINI_API_KEY'],
  together: ['TOGETHER_API_KEY'],
};

const TTS_PLATFORM_KEYS: Record<string, string[]> = {
  elevenlabs: ['ELEVENLABS_API_KEY'],
  openai: ['OPENAI_API_KEY'],
  cartesia: ['CARTESIA_API_KEY'],
  hume: ['HUME_API_KEY'],
  fal: ['FAL_KEY', 'FAL_API_KEY'],
  replicate: ['REPLICATE_API_TOKEN'],
  minimax: ['MINIMAX_API_KEY'],
  mistral: ['MISTRAL_API_KEY'],
};

const STT_PLATFORM_KEYS: Record<string, string[]> = {
  openai: ['OPENAI_API_KEY'],
  elevenlabs: ['ELEVENLABS_API_KEY'],
  together: ['TOGETHER_API_KEY'],
  deepgram: ['DEEPGRAM_API_KEY'],
  assemblyai: ['ASSEMBLYAI_API_KEY'],
};

const STT_AI_KEY_PROVIDERS = new Set(['openai', 'together', 'deepgram', 'assemblyai']);
const STT_TTS_KEY_PROVIDERS = new Set(['elevenlabs']);

export function buildSttProviderStatuses(
  aiProviders: ProviderStatus[],
  ttsProviders: ProviderStatus[]
): ProviderStatus[] {
  return [
    ...aiProviders.filter((provider) => STT_AI_KEY_PROVIDERS.has(provider.provider)),
    ...ttsProviders.filter((provider) => STT_TTS_KEY_PROVIDERS.has(provider.provider)),
  ];
}

function hasEnv(env: Record<string, string | undefined>, keys: string[]): boolean {
  return keys.some((key) => Boolean(env[key]?.trim()));
}

function hasValidProvider(providers: ProviderStatus[], selectedProvider?: string | null): boolean {
  if (selectedProvider) {
    return providers.some((provider) => provider.provider === selectedProvider && provider.isValid);
  }
  return providers.some((provider) => provider.isValid);
}

function hasPlatformProvider(
  env: Record<string, string | undefined>,
  providerKeys: Record<string, string[]>,
  selectedProvider?: string | null
): boolean {
  if (selectedProvider) {
    return hasEnv(env, providerKeys[selectedProvider] ?? []);
  }
  return Object.values(providerKeys).some((keys) => hasEnv(env, keys));
}

function normalizeAiProvider(value?: string | null): string | null {
  if (!value) return null;
  if (value.startsWith('claude-code')) return 'claude-code';
  if (value.startsWith('gpt-') || value.startsWith('o1') || value.startsWith('o3')) return 'openai';
  if (value.startsWith('claude-')) return 'anthropic';
  if (value.startsWith('gemini-')) return 'google';
  return value;
}

function isKnownStorageProvider(value: string): value is 'local' | 'r2' | 's3' {
  return value === 'local' || value === 'r2' || value === 's3';
}

export function buildSetupReadiness(input: BuildSetupReadinessInput): SetupReadiness {
  const env = input.env ?? process.env;
  const storageProvider = input.storageProvider || env.STORAGE_PROVIDER || 'local';
  const storageProviderKnown = isKnownStorageProvider(storageProvider);
  const selectedAiProvider = normalizeAiProvider(input.selectedAiProvider || env.AI_PROVIDER);
  const selectedTtsProvider = input.selectedTtsProvider || env.TTS_PROVIDER || null;
  const selectedSttProvider = input.selectedSttProvider || env.STT_PROVIDER || null;
  const claudeCodeSelected = selectedAiProvider === 'claude-code';
  const aiReady =
    (claudeCodeSelected && input.claudeCodeAvailable === true) ||
    hasValidProvider(input.aiProviders, selectedAiProvider) ||
    hasPlatformProvider(env, AI_PLATFORM_KEYS, selectedAiProvider);
  const ttsReady =
    hasValidProvider(input.ttsProviders, selectedTtsProvider) ||
    hasPlatformProvider(env, TTS_PLATFORM_KEYS, selectedTtsProvider);
  const sttProviderKnown = selectedSttProvider ? selectedSttProvider in STT_PLATFORM_KEYS : false;
  const sttReady =
    sttProviderKnown &&
    (hasValidProvider(input.sttProviders, selectedSttProvider) ||
      hasPlatformProvider(env, STT_PLATFORM_KEYS, selectedSttProvider));
  const storageReady =
    storageProviderKnown &&
    (storageProvider === 'local' ||
      hasEnv(env, ['S3_BUCKET', 'S3_ENDPOINT', 'R2_BUCKET', 'R2_ENDPOINT', 'AWS_BUCKET_NAME']));
  const privateSourceIngestionReady =
    input.hasDatabase && input.hasQueue && storageReady && aiReady && ttsReady;

  const capabilities: SetupCapability[] = [
    {
      id: 'database',
      label: 'Database',
      description: 'Stores your private library, settings, and sources.',
      status: input.hasDatabase ? 'ready' : 'action_required',
      detail: input.hasDatabase ? 'Connected' : 'Database connection is not available.',
    },
    {
      id: 'queue',
      label: 'Queue',
      description: 'Runs generation, transcription, and audio work outside API requests.',
      status: input.hasQueue ? 'ready' : 'action_required',
      actionLabel: 'Check Redis',
      detail: input.hasQueue ? 'Redis configured' : 'Set REDIS_URL and start Redis.',
    },
    {
      id: 'storage',
      label: 'Storage',
      description: 'Keeps generated audio available for app playback.',
      status: storageReady ? 'ready' : 'action_required',
      actionLabel: 'Open setup guide',
      actionHref: '/settings',
      detail: storageReady
        ? `${storageProvider} storage selected`
        : storageProviderKnown
          ? 'Select local or hosted storage.'
          : `Unknown storage provider: ${storageProvider}`,
    },
    {
      id: 'generation',
      label: 'Generation',
      description: 'Uses an explicit LLM provider or local agent for scripts and Q&A.',
      status: aiReady ? 'ready' : 'action_required',
      actionLabel: 'Add generation provider',
      actionHref: '/settings',
      detail: aiReady
        ? selectedAiProvider
          ? `${selectedAiProvider} selected`
          : 'Generation provider configured'
        : claudeCodeSelected
          ? "Install and authenticate the 'claude' CLI for Claude Code."
          : 'Add an AI key or choose a local agent.',
    },
    {
      id: 'tts',
      label: 'Text-to-speech',
      description: 'Generates the final audio with your selected voice provider.',
      status: ttsReady ? 'ready' : 'action_required',
      actionLabel: 'Add voice provider',
      actionHref: '/settings',
      detail: ttsReady
        ? selectedTtsProvider
          ? `${selectedTtsProvider} selected`
          : 'Voice provider configured'
        : 'Add a TTS provider key.',
    },
    {
      id: 'agent-ingestion',
      label: 'Agent inbox',
      description: 'Accepts private outputs from local agents through API keys and MCP.',
      status: privateSourceIngestionReady ? 'ready' : 'action_required',
      detail: privateSourceIngestionReady
        ? 'Agent ingestion endpoint ready'
        : 'Complete database, queue, storage, generation, and text-to-speech first.',
    },
    {
      id: 'stt',
      label: 'Speech-to-text',
      description: 'Optional transcription for raw meeting audio and imports without transcripts.',
      status: sttReady ? 'ready' : selectedSttProvider ? 'action_required' : 'optional',
      actionLabel: 'Add optional transcription provider',
      actionHref: '/settings',
      detail: sttReady
        ? `${selectedSttProvider} selected`
        : selectedSttProvider
          ? sttProviderKnown
            ? `Add the ${selectedSttProvider} STT key.`
            : `Unknown STT provider: ${selectedSttProvider}`
          : 'Transcript ingestion works without STT. Add STT only for raw meeting audio.',
      required: false,
    },
  ];

  const requiredCapabilities = capabilities.filter((capability) => capability.required !== false);
  const readyCount = requiredCapabilities.filter(
    (capability) => capability.status === 'ready'
  ).length;
  const nextAction =
    requiredCapabilities.find((capability) => capability.status === 'action_required') ?? null;

  return {
    ready: readyCount === requiredCapabilities.length,
    readyCount,
    totalCount: requiredCapabilities.length,
    nextAction,
    capabilities,
  };
}
