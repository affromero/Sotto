export type SetupCapabilityId =
  'database' | 'queue' | 'storage' | 'generation' | 'tts' | 'agent-ingestion' | 'stt';

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
  aiBaseUrl?: string | null;
  ttsBaseUrl?: string | null;
  sttBaseUrl?: string | null;
  storageConfigured?: boolean;
  claudeCodeAvailable?: boolean;
  codexAvailable?: boolean;
}

const STT_PROVIDERS = new Set([
  'openai',
  'elevenlabs',
  'together',
  'deepgram',
  'assemblyai',
  'local',
]);

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

function hasValidProvider(providers: ProviderStatus[], selectedProvider?: string | null): boolean {
  if (selectedProvider) {
    return providers.some((provider) => provider.provider === selectedProvider && provider.isValid);
  }
  return providers.some((provider) => provider.isValid);
}

function normalizeAiProvider(value?: string | null): string | null {
  if (!value) return null;
  if (value.startsWith('claude-code')) return 'claude-code';
  if (value.startsWith('codex')) return 'codex';
  if (value.startsWith('gpt-') || value.startsWith('o1') || value.startsWith('o3')) return 'openai';
  if (value.startsWith('claude-')) return 'anthropic';
  if (value.startsWith('gemini-')) return 'google';
  return value;
}

function isKnownStorageProvider(value: string): value is 'local' | 'r2' | 's3' {
  return value === 'local' || value === 'r2' || value === 's3';
}

export function buildSetupReadiness(input: BuildSetupReadinessInput): SetupReadiness {
  const storageProvider = input.storageProvider || 'local';
  const storageProviderKnown = isKnownStorageProvider(storageProvider);
  const selectedAiProvider = normalizeAiProvider(input.selectedAiProvider);
  const selectedTtsProvider = input.selectedTtsProvider || null;
  const selectedSttProvider = input.selectedSttProvider || null;
  const claudeCodeSelected = selectedAiProvider === 'claude-code';
  const codexSelected = selectedAiProvider === 'codex';
  const localAiSelected = selectedAiProvider === 'local';
  const localTtsSelected = selectedTtsProvider === 'kokoro' || selectedTtsProvider === 'local';
  const localSttSelected = selectedSttProvider === 'local';
  const aiReady =
    (claudeCodeSelected && input.claudeCodeAvailable === true) ||
    (codexSelected && input.codexAvailable === true) ||
    (localAiSelected && Boolean(input.aiBaseUrl?.trim())) ||
    hasValidProvider(input.aiProviders, selectedAiProvider);
  const ttsReady =
    (localTtsSelected && Boolean(input.ttsBaseUrl?.trim())) ||
    hasValidProvider(input.ttsProviders, selectedTtsProvider);
  const sttProviderKnown = selectedSttProvider ? STT_PROVIDERS.has(selectedSttProvider) : false;
  const sttReady =
    sttProviderKnown &&
    ((localSttSelected && Boolean(input.sttBaseUrl?.trim())) ||
      hasValidProvider(input.sttProviders, selectedSttProvider));
  const storageReady =
    storageProviderKnown && (storageProvider === 'local' || input.storageConfigured === true);
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
          : localAiSelected
            ? 'Save the base URL for the local OpenAI-compatible server.'
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
        : localTtsSelected
          ? 'Save the base URL for the local TTS sidecar.'
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
      description:
        'Optional transcription for speaking-practice scoring and audio imports without transcripts.',
      status: sttReady ? 'ready' : selectedSttProvider ? 'action_required' : 'optional',
      actionLabel: 'Add optional transcription provider',
      actionHref: '/settings',
      detail: sttReady
        ? `${selectedSttProvider} selected`
        : selectedSttProvider
          ? sttProviderKnown
            ? localSttSelected
              ? 'Save the base URL for the local Whisper-compatible server.'
              : `Add the ${selectedSttProvider} STT key.`
            : `Unknown STT provider: ${selectedSttProvider}`
          : 'Transcript ingestion works without STT. Add STT only for speaking-practice scoring or raw audio imports.',
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
