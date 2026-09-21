import { ANIMAL_AVATARS } from '@/lib/avatars';
import { STEPS, LEVELS, type CefrLevel } from '@/app/welcome/data';
import type {
  AgentState,
  VoiceState,
  StorageState,
  ContextItem,
  ContextItemKind,
  OnboardingConfig,
} from '@/app/welcome/WelcomeFlow';
import { resumeEndpoint, resumeEndpoints } from '@/app/welcome/session/resume-security';

export const DEFAULT_AGENT: AgentState = {
  provider: '',
  method: null,
  value: '',
  model: '',
  liveTranslationKey: '',
  status: 'idle',
};

export const DEFAULT_VOICE: VoiceState = {
  tts: 'elevenlabs',
  stt: 'whisper',
  visualCueProvider: 'pexels',
  keys: {},
  baseUrls: {},
  ttsModel: {},
  sttModel: {},
};

export const DEFAULT_STORAGE: StorageState = {
  provider: 'local',
  localRoot: '.sotto/storage',
  endpoint: '',
  bucket: '',
  region: '',
  publicUrl: '',
  accessKeyId: '',
  secretAccessKey: '',
};

export interface WelcomeSnapshot {
  onboardingResumeKey?: string;
  step: number;
  profileName: string;
  avatarSlug: string;
  timezone: string;
  baseLang: string;
  language: string;
  agent: AgentState;
  voice: VoiceState;
  storage: StorageState;
  sources: Set<string>;
  contextItems: ContextItem[];
  understood: Set<CefrLevel>;
}

export function clampStep(n: number) {
  return Math.max(0, Math.min(STEPS.length - 1, n));
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}

function isCefrLevel(value: unknown): value is CefrLevel {
  return typeof value === 'string' && LEVELS.includes(value as CefrLevel);
}

export function toSingleUnderstoodSet(levels: Iterable<CefrLevel>): Set<CefrLevel> {
  const selected = new Set(levels);
  let best: CefrLevel | null = null;
  for (const level of LEVELS) {
    if (selected.has(level)) best = level;
  }
  return best ? new Set([best]) : new Set();
}

function isContextItemKind(value: unknown): value is ContextItemKind {
  return (
    value === 'link' ||
    value === 'book' ||
    value === 'article' ||
    value === 'music' ||
    value === 'topic' ||
    value === 'file' ||
    value === 'text'
  );
}

function isKnownAvatarSlug(value: unknown): value is string {
  return typeof value === 'string' && ANIMAL_AVATARS.some((avatar) => avatar.slug === value);
}

function parseAgent(value: unknown): AgentState {
  const record = asRecord(value);
  if (!record) return { ...DEFAULT_AGENT };

  return {
    provider: typeof record.provider === 'string' ? record.provider : '',
    method:
      record.method === 'cli' || record.method === 'key' || record.method === 'url'
        ? record.method
        : null,
    value: record.method === 'url' ? resumeEndpoint(record.value) : '',
    model: typeof record.model === 'string' ? record.model : '',
    liveTranslationKey: '',
    status: 'idle',
  };
}

function stringRecord(value: unknown): Record<string, string> {
  const record = asRecord(value) ?? {};
  return Object.fromEntries(
    Object.entries(record).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string'
    )
  );
}

function parseVoice(value: unknown): VoiceState {
  const record = asRecord(value);

  return {
    tts: typeof record?.tts === 'string' ? record.tts : DEFAULT_VOICE.tts,
    stt: typeof record?.stt === 'string' ? record.stt : DEFAULT_VOICE.stt,
    visualCueProvider:
      record?.visualCueProvider === 'off' || record?.visualCueProvider === 'pexels'
        ? record.visualCueProvider
        : DEFAULT_VOICE.visualCueProvider,
    keys: {},
    baseUrls: resumeEndpoints(stringRecord(record?.baseUrls)),
    ttsModel: stringRecord(record?.ttsModel),
    sttModel: stringRecord(record?.sttModel),
  };
}

function parseStorage(value: unknown): StorageState {
  const record = asRecord(value);
  const provider =
    record?.provider === 'r2' || record?.provider === 's3' || record?.provider === 'local'
      ? record.provider
      : DEFAULT_STORAGE.provider;
  return {
    provider,
    localRoot: typeof record?.localRoot === 'string' ? record.localRoot : '.sotto/storage',
    endpoint: typeof record?.endpoint === 'string' ? resumeEndpoint(record.endpoint) : '',
    bucket: typeof record?.bucket === 'string' ? record.bucket : '',
    region: typeof record?.region === 'string' ? record.region : '',
    publicUrl: typeof record?.publicUrl === 'string' ? resumeEndpoint(record.publicUrl) : '',
    accessKeyId: '',
    secretAccessKey: '',
  };
}

export function storageFromConfig(config: OnboardingConfig): StorageState {
  const provider = config.infra?.storageProvider;
  return {
    provider: provider === 'r2' || provider === 's3' || provider === 'local' ? provider : 'local',
    localRoot: config.infra?.localStorageRoot ?? '.sotto/storage',
    endpoint: config.infra?.objectStorageEndpoint ?? '',
    bucket: config.infra?.objectStorageBucket ?? '',
    region: config.infra?.objectStorageRegion ?? '',
    publicUrl: config.infra?.objectStoragePublicUrl ?? '',
    accessKeyId: '',
    secretAccessKey: '',
  };
}

function parseContextItems(value: unknown): ContextItem[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((item, index) => {
    const record = asRecord(item);
    if (!record || !isContextItemKind(record.kind) || typeof record.value !== 'string') {
      return [];
    }

    const trimmed = record.value.trim();
    if (!trimmed) return [];

    return [
      {
        id: typeof record.id === 'string' && record.id ? record.id : `ctx-${record.kind}-${index}`,
        kind: record.kind,
        label:
          typeof record.label === 'string' && record.label.trim()
            ? record.label.trim()
            : record.kind,
        value: trimmed,
      },
    ];
  });
}

export function parseStoredSnapshot(raw: string): WelcomeSnapshot | null {
  try {
    const record = asRecord(JSON.parse(raw));
    if (!record) return null;

    const storedStep = typeof record.step === 'number' ? record.step : 0;
    const sources = Array.isArray(record.sources) ? record.sources.filter(Boolean).map(String) : [];
    const understood = Array.isArray(record.understood)
      ? record.understood.filter(isCefrLevel)
      : [];

    return {
      onboardingResumeKey:
        typeof record.onboardingResumeKey === 'string' ? record.onboardingResumeKey : undefined,
      step: clampStep(storedStep),
      profileName:
        typeof record.profileName === 'string' && record.profileName.trim()
          ? record.profileName
          : 'Learner',
      avatarSlug: isKnownAvatarSlug(record.avatarSlug) ? record.avatarSlug : ANIMAL_AVATARS[0].slug,
      timezone: typeof record.timezone === 'string' ? record.timezone : '',
      baseLang: typeof record.baseLang === 'string' ? record.baseLang : 'en',
      language: typeof record.language === 'string' ? record.language : '',
      agent: parseAgent(record.agent),
      voice: parseVoice(record.voice),
      storage: parseStorage(record.storage),
      sources: new Set(sources),
      contextItems: parseContextItems(record.contextItems),
      understood: toSingleUnderstoodSet(understood),
    };
  } catch {
    return null;
  }
}
