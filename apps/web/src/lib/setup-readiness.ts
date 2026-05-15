export type SetupCapabilityId = 'database' | 'queue' | 'storage' | 'generation' | 'tts' | 'private-rss';

export type SetupCapabilityStatus = 'ready' | 'action_required';

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
  privateFeedTokenCount: number;
  selectedAiProvider?: string | null;
  selectedTtsProvider?: string | null;
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

export function buildSetupReadiness(input: BuildSetupReadinessInput): SetupReadiness {
  const env = input.env ?? process.env;
  const storageProvider = input.storageProvider || env.STORAGE_PROVIDER || 'local';
  const selectedAiProvider = normalizeAiProvider(input.selectedAiProvider || env.AI_PROVIDER);
  const selectedTtsProvider = input.selectedTtsProvider || env.TTS_PROVIDER || null;
  const aiReady =
    selectedAiProvider === 'claude-code' ||
    hasValidProvider(input.aiProviders, selectedAiProvider) ||
    hasPlatformProvider(env, AI_PLATFORM_KEYS, selectedAiProvider);
  const ttsReady =
    hasValidProvider(input.ttsProviders, selectedTtsProvider) ||
    hasPlatformProvider(env, TTS_PLATFORM_KEYS, selectedTtsProvider);
  const storageReady =
    storageProvider === 'local' ||
    hasEnv(env, ['S3_BUCKET', 'S3_ENDPOINT', 'R2_BUCKET', 'R2_ENDPOINT', 'AWS_BUCKET_NAME']);

  const capabilities: SetupCapability[] = [
    {
      id: 'database',
      label: 'Database',
      description: 'Stores your private library, settings, sources, and RSS tokens.',
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
      description: 'Keeps generated audio available for app playback and private RSS.',
      status: storageReady ? 'ready' : 'action_required',
      actionLabel: 'Open setup guide',
      actionHref: '/settings',
      detail: storageReady ? `${storageProvider} storage selected` : 'Select local or hosted storage.',
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
      id: 'private-rss',
      label: 'Private RSS',
      description: 'Lets you subscribe from any podcast app with a revocable private URL.',
      status: input.privateFeedTokenCount > 0 ? 'ready' : 'action_required',
      actionLabel: 'Create RSS token',
      actionHref: '/settings',
      detail:
        input.privateFeedTokenCount > 0
          ? `${input.privateFeedTokenCount} private feed URL${input.privateFeedTokenCount === 1 ? '' : 's'}`
          : 'Create a private RSS token.',
    },
  ];

  const readyCount = capabilities.filter((capability) => capability.status === 'ready').length;
  const nextAction = capabilities.find((capability) => capability.status === 'action_required') ?? null;

  return {
    ready: readyCount === capabilities.length,
    readyCount,
    totalCount: capabilities.length,
    nextAction,
    capabilities,
  };
}
