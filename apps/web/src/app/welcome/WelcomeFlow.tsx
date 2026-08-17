'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { ANIMAL_AVATARS } from '@/lib/avatars';
import { STEPS, WHISPERS, LEVELS } from './data';
import type { CefrLevel } from './data';
import { Glyph } from './Glyph';
import { StepHowItWorks } from './steps/StepHowItWorks';
import { StepIntro } from './steps/StepIntro';
import { StepLearnerProfile } from './steps/StepLearnerProfile';
import { StepWelcome } from './steps/StepWelcome';
import { StepAgent } from './steps/StepAgent';
import { StepVoice } from './steps/StepVoice';
import { StepStorage } from './storage/StepStorage';
import { StepContext } from './steps/StepContext';
import { StepPlacement } from './steps/StepPlacement';
import { StepContextReview } from './steps/StepContextReview';
import { StepCompose } from './steps/StepCompose';
import { StepReady } from './steps/StepReady';
import { OnboardingThemeSwitch } from './OnboardingThemeSwitch';
import t from './theme.module.css';
import type { AgentStatus } from '@/lib/agent-availability';

export interface AgentState {
  provider: string;
  method: 'cli' | 'key' | 'url' | null;
  value: string;
  /** The model a local/custom OpenAI-compatible server serves (AI_MODEL). */
  model: string;
  /** Optional Google/Gemini key that unlocks the Gemini Live translation mode. */
  liveTranslationKey?: string;
  status: 'idle' | 'verifying' | 'connected';
}

export interface VoiceState {
  tts: string;
  stt: string;
  visualCueProvider: 'pexels' | 'off';
  keys: Record<string, string>;
  /** Optional base URLs for keyless local providers (kokoro/local TTS, whisper/local STT). */
  baseUrls: Record<string, string>;
  /** Selected model per TTS provider id (cloud/key-based providers only). */
  ttsModel: Record<string, string>;
  /** Selected model per STT registry provider id (cloud/key-based providers only). */
  sttModel: Record<string, string>;
}

export interface StorageState {
  provider: 'local' | 'r2' | 's3';
  s3Bucket: string;
  s3Region: string;
}

/** One selectable model option surfaced in the wizard. */
export interface ModelOption {
  id: string;
  label: string;
}

/**
 * Registry model lists for the wizard's model pickers, keyed by backend provider
 * id (AI: anthropic/openai; TTS: elevenlabs/openai/cartesia/hume; STT: openai/
 * deepgram/assemblyai/elevenlabs). Sourced server-side from the provider
 * registries in welcome/page.tsx and never hardcoded.
 */
export interface ModelMeta {
  ai: Record<string, ModelOption[]>;
  tts: Record<string, ModelOption[]>;
  stt: Record<string, ModelOption[]>;
}

const EMPTY_MODEL_META: ModelMeta = { ai: {}, tts: {}, stt: {} };

export type ContextItemKind = 'link' | 'book' | 'article' | 'music' | 'topic' | 'file' | 'text';

export interface ContextItem {
  id: string;
  kind: ContextItemKind;
  label: string;
  value: string;
}

export interface FlowState {
  baseLang: string;
  language: string;
}

/** How the wizard should behave, from /api/v1/onboarding/config. */
export interface OnboardingConfig {
  selfHosted: boolean;
  isOwner: boolean;
  /** Changes when the self-hosted owner is recreated by a factory reset. */
  onboardingResumeKey?: string;
  infra?: {
    storageProvider: string | null;
    s3Bucket: string | null;
    s3Region: string | null;
  } | null;
  /**
   * Owner-only: provider keys / storage env vars already present in the server
   * env (presence booleans only, never values). Wizard display ids. Absent for
   * the demo and non-owner learners, where the wizard behaves as before.
   */
  env?: {
    tts: string[];
    stt: string[];
    ai: string[];
    visual: string[];
    storage: Record<string, boolean>;
  } | null;
  agentStatuses?: Record<'claude-code' | 'codex', AgentStatus> | null;
}

interface WelcomeFlowProps {
  initialConfig?: OnboardingConfig;
  modelMeta?: ModelMeta;
}

const SAVE_KEY = 'sotto.onboarding.v1';

const DEFAULT_AGENT: AgentState = {
  provider: '',
  method: null,
  value: '',
  model: '',
  liveTranslationKey: '',
  status: 'idle',
};

const DEFAULT_VOICE: VoiceState = {
  tts: 'elevenlabs',
  stt: 'whisper',
  visualCueProvider: 'pexels',
  keys: {},
  baseUrls: {},
  ttsModel: {},
  sttModel: {},
};

const DEFAULT_STORAGE: StorageState = {
  provider: 'local',
  s3Bucket: '',
  s3Region: '',
};

interface WelcomeSnapshot {
  onboardingResumeKey?: string;
  step: number;
  profileName: string;
  avatarSlug: string;
  baseLang: string;
  language: string;
  agent: AgentState;
  voice: VoiceState;
  storage: StorageState;
  sources: Set<string>;
  contextItems: ContextItem[];
  understood: Set<CefrLevel>;
}

function clampStep(n: number) {
  return Math.max(0, Math.min(STEPS.length - 1, n));
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}

function isCefrLevel(value: unknown): value is CefrLevel {
  return typeof value === 'string' && LEVELS.includes(value as CefrLevel);
}

function toSingleUnderstoodSet(levels: Iterable<CefrLevel>): Set<CefrLevel> {
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
    value: typeof record.value === 'string' ? record.value : '',
    model: typeof record.model === 'string' ? record.model : '',
    liveTranslationKey:
      typeof record.liveTranslationKey === 'string' ? record.liveTranslationKey : '',
    status:
      record.status === 'idle' || record.status === 'verifying' || record.status === 'connected'
        ? record.status
        : 'idle',
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
    keys: stringRecord(record?.keys),
    baseUrls: stringRecord(record?.baseUrls),
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
    s3Bucket: typeof record?.s3Bucket === 'string' ? record.s3Bucket : '',
    s3Region: typeof record?.s3Region === 'string' ? record.s3Region : '',
  };
}

function storageFromConfig(config: OnboardingConfig): StorageState {
  const provider = config.infra?.storageProvider;
  return {
    provider: provider === 'r2' || provider === 's3' || provider === 'local' ? provider : 'local',
    s3Bucket: config.infra?.s3Bucket ?? '',
    s3Region: config.infra?.s3Region ?? '',
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

function parseStoredSnapshot(raw: string): WelcomeSnapshot | null {
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

function designSnapshotForStep(step: number, languageParam: string | null): WelcomeSnapshot {
  const clamped = clampStep(step);
  const language = languageParam || (clamped >= 3 ? 'it' : '');
  return {
    onboardingResumeKey: undefined,
    step: clamped,
    profileName: 'Learner',
    avatarSlug: ANIMAL_AVATARS[0].slug,
    baseLang: 'en',
    language,
    agent:
      clamped >= 4
        ? {
            provider: 'claude',
            method: 'cli',
            value: '',
            model: '',
            liveTranslationKey: '',
            status: 'connected',
          }
        : { ...DEFAULT_AGENT },
    voice: { ...DEFAULT_VOICE },
    storage: { ...DEFAULT_STORAGE },
    sources: new Set(),
    contextItems:
      clamped >= 6
        ? [
            {
              id: 'ctx-demo-link',
              kind: 'link',
              label: 'example.com',
              value: 'https://example.com/paper',
            },
            {
              id: 'ctx-demo-book',
              kind: 'book',
              label: 'Invisible Cities',
              value: 'Invisible Cities by Italo Calvino',
            },
          ]
        : [],
    understood: new Set<CefrLevel>(clamped >= 7 ? ['B1'] : []),
  };
}

export function WelcomeFlow({ initialConfig, modelMeta = EMPTY_MODEL_META }: WelcomeFlowProps) {
  const [step, setStep] = useState(0);
  const [profileName, setProfileName] = useState('Learner');
  const [avatarSlug, setAvatarSlug] = useState(ANIMAL_AVATARS[0].slug);
  const [baseLang, setBaseLang] = useState('en');
  const [language, setLanguage] = useState('');
  const [agent, setAgent] = useState<AgentState>({ ...DEFAULT_AGENT });
  const [voice, setVoice] = useState<VoiceState>({ ...DEFAULT_VOICE });
  const [storage, setStorage] = useState<StorageState>({ ...DEFAULT_STORAGE });
  const [sources, setSources] = useState<Set<string>>(new Set());
  const [contextItems, setContextItems] = useState<ContextItem[]>([]);
  const [understood, setUnderstood] = useState<Set<CefrLevel>>(new Set());
  const [storageReady, setStorageReady] = useState(false);
  const [deepLinkMode, setDeepLinkMode] = useState(false);
  const hydratedRef = useRef(false);
  const [config, setConfig] = useState<OnboardingConfig>(
    initialConfig ?? { selfHosted: false, isOwner: false }
  );

  useEffect(() => {
    let active = true;
    fetch('/api/v1/onboarding/config', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: OnboardingConfig | null) => {
        if (active && data) {
          const nextConfig = {
            selfHosted: !!data.selfHosted,
            isOwner: !!data.isOwner,
            onboardingResumeKey: data.onboardingResumeKey ?? initialConfig?.onboardingResumeKey,
            infra: data.infra ?? null,
            env: data.env ?? null,
            agentStatuses: data.agentStatuses ?? null,
          };
          setConfig(nextConfig);
          if (!hydratedRef.current) setStorage(storageFromConfig(nextConfig));
        }
      })
      .catch(() => {
        // Leave the safe default (demo) if config can't be read.
      });
    return () => {
      active = false;
    };
  }, [initialConfig?.onboardingResumeKey]);

  const level = useMemo<CefrLevel | null>(() => {
    let best: CefrLevel | null = null;
    for (const l of LEVELS) {
      if (understood.has(l)) best = l;
    }
    return best;
  }, [understood]);

  const go = useCallback((n: number) => {
    setStep(clampStep(n));
  }, []);

  function applySnapshot(snapshot: WelcomeSnapshot) {
    setStep(snapshot.step);
    setProfileName(snapshot.profileName);
    setAvatarSlug(snapshot.avatarSlug);
    setBaseLang(snapshot.baseLang);
    setLanguage(snapshot.language);
    setAgent(snapshot.agent);
    setVoice(snapshot.voice);
    setStorage(snapshot.storage);
    setSources(snapshot.sources);
    setContextItems(snapshot.contextItems);
    setUnderstood(toSingleUnderstoodSet(snapshot.understood));
  }

  useEffect(() => {
    if (typeof window === 'undefined' || hydratedRef.current) return;

    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled || hydratedRef.current) return;

      const params = new URLSearchParams(window.location.search);
      if (params.has('reset')) {
        window.localStorage.removeItem(SAVE_KEY);
        window.history.replaceState({}, '', '/welcome');
        setStorageReady(true);
        hydratedRef.current = true;
        return;
      }

      if (params.has('step')) {
        const requestedStep = Number.parseInt(params.get('step') ?? '0', 10);
        applySnapshot(
          designSnapshotForStep(
            Number.isFinite(requestedStep) ? requestedStep : 0,
            params.get('lang')
          )
        );
        setDeepLinkMode(true);
        setStorageReady(true);
        hydratedRef.current = true;
        return;
      }

      if (config.selfHosted) {
        const raw = window.localStorage.getItem(SAVE_KEY);
        const stored = raw ? parseStoredSnapshot(raw) : null;
        const belongsToCurrentInstall =
          typeof config.onboardingResumeKey === 'string' &&
          stored?.onboardingResumeKey === config.onboardingResumeKey;
        if (stored && belongsToCurrentInstall) {
          applySnapshot(stored);
        } else if (raw) {
          window.localStorage.removeItem(SAVE_KEY);
        }
      }

      setStorageReady(true);
      hydratedRef.current = true;
    });

    return () => {
      cancelled = true;
    };
  }, [config.selfHosted, config.onboardingResumeKey]);

  useEffect(() => {
    if (!storageReady || !config.selfHosted || deepLinkMode || typeof window === 'undefined') {
      return;
    }

    window.localStorage.setItem(
      SAVE_KEY,
      JSON.stringify({
        onboardingResumeKey: config.onboardingResumeKey,
        step,
        profileName,
        avatarSlug,
        baseLang,
        language,
        agent,
        voice,
        storage,
        sources: [...sources],
        contextItems,
        understood: [...understood],
      })
    );
  }, [
    agent,
    avatarSlug,
    baseLang,
    config.selfHosted,
    config.onboardingResumeKey,
    contextItems,
    deepLinkMode,
    language,
    profileName,
    sources,
    step,
    storageReady,
    storage,
    understood,
    voice,
  ]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = document.activeElement?.tagName ?? '';
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      if (e.key === 'Enter') {
        const canAdvance =
          step === 0
            ? false
            : step === 1
              ? false
              : step === 2
                ? false
                : step === 3
                  ? !!language
                  : step === 4
                    ? agent.status === 'connected'
                    : step === 5
                      ? true
                      : step === 6
                        ? true
                        : step === 7
                          ? contextItems.length > 0
                          : step === 8
                            ? !!level
                            : step === 9
                              ? contextItems.length > 0 && !!level
                              : false;

        if (canAdvance && step < 11) {
          e.preventDefault();
          go(step + 1);
        }
      } else if (e.key === 'Escape' && step > 1 && step <= 11) {
        e.preventDefault();
        go(step - 1);
      }
    }

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [agent.status, contextItems.length, go, language, level, step]);

  function chooseBaseLang(code: string) {
    setBaseLang(code);
    setLanguage((prev) => (prev === code ? '' : prev));
  }

  function reset() {
    setStep(0);
    setProfileName('Learner');
    setAvatarSlug(ANIMAL_AVATARS[0].slug);
    setLanguage('');
    setBaseLang('en');
    setAgent({ ...DEFAULT_AGENT });
    setVoice({ ...DEFAULT_VOICE });
    setStorage(storageFromConfig(config));
    setSources(new Set());
    setContextItems([]);
    setUnderstood(new Set());
    if (typeof window !== 'undefined' && config.selfHosted) {
      window.localStorage.removeItem(SAVE_KEY);
    }
  }

  function toggleUnderstood(lvl: CefrLevel) {
    setUnderstood((prev) => {
      if (prev.has(lvl)) return new Set();
      return new Set([lvl]);
    });
  }

  function selectPlacementLevel(lvl: CefrLevel) {
    setUnderstood(new Set([lvl]));
  }

  function addContextItems(items: Array<Omit<ContextItem, 'id'>>) {
    if (!items.length) return;
    const stamp = Date.now();
    setContextItems((prev) => [
      ...prev,
      ...items.map((item, index) => ({
        ...item,
        id: `ctx-${item.kind}-${stamp}-${prev.length + index}`,
      })),
    ]);
  }

  const flowState: FlowState = { baseLang, language };
  const demoMode = !config.selfHosted;

  let stepView: React.ReactNode;
  switch (step) {
    case 0:
      stepView = <StepIntro demoMode={demoMode} onNext={() => go(1)} />;
      break;
    case 1:
      stepView = <StepHowItWorks demoMode={demoMode} onBack={() => go(0)} onNext={() => go(2)} />;
      break;
    case 2:
      stepView = (
        <StepLearnerProfile
          name={profileName}
          avatarSlug={avatarSlug}
          demoMode={demoMode}
          setName={setProfileName}
          setAvatarSlug={setAvatarSlug}
          onNext={() => go(3)}
          onBack={() => go(1)}
        />
      );
      break;
    case 3:
      stepView = (
        <StepWelcome
          state={flowState}
          demoMode={demoMode}
          setBaseLang={chooseBaseLang}
          setLanguage={setLanguage}
          onNext={() => go(4)}
          onBack={() => go(2)}
        />
      );
      break;
    case 4:
      stepView = (
        <StepAgent
          agent={agent}
          demoMode={demoMode}
          envDetected={config.env?.ai ?? []}
          agentStatuses={config.agentStatuses ?? undefined}
          aiModels={modelMeta.ai}
          setAgent={(updater) => setAgent((prev) => updater(prev))}
          onNext={() => go(5)}
          onBack={() => go(3)}
        />
      );
      break;
    case 5:
      stepView = (
        <StepVoice
          voice={voice}
          demoMode={demoMode}
          envDetectedTts={config.env?.tts ?? []}
          envDetectedStt={config.env?.stt ?? []}
          envDetectedVisual={config.env?.visual ?? []}
          ttsModels={modelMeta.tts}
          sttModels={modelMeta.stt}
          language={language}
          setVoice={(updater) => setVoice((prev) => updater(prev))}
          onNext={() => go(6)}
          onBack={() => go(4)}
        />
      );
      break;
    case 6:
      stepView = (
        <StepStorage
          storage={storage}
          config={config}
          demoMode={demoMode}
          setStorage={(updater) => setStorage((prev) => updater(prev))}
          onNext={() => go(7)}
          onBack={() => go(5)}
        />
      );
      break;
    case 7:
      stepView = (
        <StepContext
          contextItems={contextItems}
          setContextItems={setContextItems}
          demoMode={demoMode}
          onNext={() => go(8)}
          onBack={() => go(6)}
        />
      );
      break;
    case 8:
      stepView = (
        <StepPlacement
          baseLang={baseLang}
          language={language}
          understood={understood}
          toggleUnderstood={toggleUnderstood}
          selectPlacementLevel={selectPlacementLevel}
          onAddContextItems={addContextItems}
          level={level}
          demoMode={demoMode}
          onNext={() => go(9)}
          onBack={() => go(7)}
        />
      );
      break;
    case 9:
      stepView = (
        <StepContextReview
          baseLang={baseLang}
          language={language}
          level={level}
          contextItems={contextItems}
          onNext={() => go(10)}
          onBack={() => go(8)}
        />
      );
      break;
    case 10:
      stepView = (
        <StepCompose
          level={level}
          voice={voice}
          demoMode={demoMode}
          onDone={() => go(11)}
          onBack={() => go(9)}
        />
      );
      break;
    case 11:
      stepView = (
        <StepReady
          baseLang={baseLang}
          language={language}
          level={level}
          sources={sources}
          contextItems={contextItems}
          agent={agent}
          voice={voice}
          storage={storage}
          config={config}
          onRestart={reset}
          onJump={go}
        />
      );
      break;
    default:
      stepView = null;
  }

  if (step === 0 || step === 1) {
    return <>{stepView}</>;
  }

  return (
    <div className={t.root}>
      {/* Voice rail */}
      <aside className={t.voice}>
        <div className={t.voiceGlow} aria-hidden="true" />
        <Link href="/" className={t.brand} aria-label="Go to Sotto home">
          <div className={t.wordmark}>
            <Image
              src="/brand/sotto-mark.svg"
              alt=""
              width={30}
              height={30}
              className={t.wordmarkMark}
              priority
              unoptimized
            />
            sotto
          </div>
          <div className={t.wordmarkSub}>
            {config.selfHosted ? 'v0 · self hosted' : 'v0 · hosted demo'}
          </div>
        </Link>

        <OnboardingThemeSwitch className={t.railThemeSwitch} />

        <nav className={t.stepper} aria-label="Setup progress">
          {STEPS.map((s, i) => {
            const isActive = i === step;
            const isDone = i < step;
            const stepClass = [t.stepItem, isDone ? t.done : '', isActive ? t.active : '']
              .filter(Boolean)
              .join(' ');
            return (
              <div
                key={s}
                className={stepClass}
                onClick={() => isDone && go(i)}
                style={{ cursor: isDone ? 'pointer' : 'default' }}
                role={isDone ? 'button' : undefined}
                tabIndex={isDone ? 0 : undefined}
                aria-label={isDone ? `Go back to ${s}` : undefined}
                onKeyDown={(e) => {
                  if (isDone && (e.key === 'Enter' || e.key === ' ')) go(i);
                }}
              >
                <span className={t.stepNum}>
                  {isDone ? <Glyph name="check" size={12} /> : String(i).padStart(2, '0')}
                </span>
                <span className={t.stepLabel}>{s}</span>
              </div>
            );
          })}
        </nav>

        <div className={t.whisper} key={step}>
          <div className={t.whisperTag}>private course</div>
          <p className={t.whisperText}>{WHISPERS[step]}</p>
        </div>
      </aside>

      {/* Stage */}
      <main className={t.stage}>
        <div className={t.stageInner} key={step}>
          {stepView}
        </div>
      </main>
    </div>
  );
}
