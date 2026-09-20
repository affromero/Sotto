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
import { resolveAi, type KeyPost } from './providerMap';
import { resumeEndpoint, resumeEndpoints } from '@/app/welcome/session/resume-security';
import {
  DEFAULT_AGENT,
  DEFAULT_VOICE,
  DEFAULT_STORAGE,
  clampStep,
  storageFromConfig,
  parseStoredSnapshot,
  toSingleUnderstoodSet,
  type WelcomeSnapshot,
} from '@/app/welcome/session/welcome-snapshot';
import {
  welcomeCredentialDiscovery,
  welcomeCredentialSelections,
} from '@/app/welcome/session/credential-discovery';
import {
  WelcomeCredentialSession,
  WelcomeCredentialContextError,
  type WelcomeCredentialResult,
} from '@/app/welcome/session/credential-session';
import { CredentialReconciliationError } from '@/lib/sidedoor/credentials/config/credential-browser';
import { Button } from '@/components/ui/Button';
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
  localRoot: string;
  endpoint: string;
  bucket: string;
  region: string;
  publicUrl: string;
  accessKeyId: string;
  secretAccessKey: string;
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
    localStorageRoot: string | null;
    objectStorageEndpoint: string | null;
    objectStorageBucket: string | null;
    objectStorageRegion: string | null;
    objectStoragePublicUrl: string | null;
  } | null;
  agentStatuses?: Record<'claude-code' | 'codex', AgentStatus> | null;
}

interface WelcomeFlowProps {
  initialConfig?: OnboardingConfig;
  modelMeta?: ModelMeta;
}

const SAVE_KEY = 'sotto.onboarding.v1';

function designSnapshotForStep(step: number, languageParam: string | null): WelcomeSnapshot {
  const clamped = clampStep(step);
  const language = languageParam || (clamped >= 3 ? 'it' : '');
  return {
    onboardingResumeKey: undefined,
    step: clamped,
    profileName: 'Learner',
    avatarSlug: ANIMAL_AVATARS[0].slug,
    timezone: '',
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
  const [timezone, setTimezone] = useState('');
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
  const [credentialSession] = useState(() => new WelcomeCredentialSession());
  const credentialLifetime = useRef<AbortController | null>(null);
  const credentialLock = useRef(false);
  const [credentialBusy, setCredentialBusy] = useState(false);
  const [credentialReady, setCredentialReady] = useState(false);
  const [credentialFeedback, setCredentialFeedback] = useState<WelcomeCredentialResult | null>(
    null
  );
  const pendingCredentialPosts = useRef<readonly KeyPost[]>([]);
  const clearCredentialSecrets = useCallback(() => {
    setAgent((previous) => ({ ...previous, value: '', liveTranslationKey: '', status: 'idle' }));
    setVoice((previous) => ({ ...previous, keys: {} }));
    setStorage((previous) => ({ ...previous, accessKeyId: '', secretAccessKey: '' }));
    pendingCredentialPosts.current = [];
    setCredentialReady(false);
  }, []);

  const loadCredentials = useCallback(
    async (signal: AbortSignal) => {
      credentialLock.current = true;
      setCredentialBusy(true);
      try {
        await credentialSession.load(signal);
        signal.throwIfAborted();
        setCredentialReady(true);
        setCredentialFeedback(null);
      } catch (error) {
        if (!signal.aborted && error instanceof WelcomeCredentialContextError)
          clearCredentialSecrets();
        if (!signal.aborted)
          setCredentialFeedback({
            status: 'review',
            message: error instanceof Error ? error.message : 'Could not load credential settings.',
          });
      } finally {
        if (!signal.aborted) {
          credentialLock.current = false;
          setCredentialBusy(false);
        }
      }
    },
    [credentialSession, clearCredentialSecrets]
  );

  useEffect(() => {
    if (!config.selfHosted) return;
    const lifetime = new AbortController();
    credentialLifetime.current = lifetime;
    void loadCredentials(lifetime.signal);
    return () => lifetime.abort();
  }, [config.selfHosted, loadCredentials]);

  async function saveCredentials(posts: readonly KeyPost[], consentOperationId?: string) {
    if (!config.selfHosted) return true;
    const signal = credentialLifetime.current?.signal;
    if (!signal || signal.aborted || credentialLock.current || !credentialReady) return false;
    credentialLock.current = true;
    setCredentialBusy(true);
    pendingCredentialPosts.current = structuredClone(posts);
    try {
      const result = await credentialSession.save(posts, signal, consentOperationId);
      if (result.status === 'ready')
        await credentialSession.verifySelections(welcomeCredentialSelections(agent, voice), signal);
      signal.throwIfAborted();
      if (result.status !== 'ready' && result.clearSecrets) clearCredentialSecrets();
      setCredentialFeedback(result.status === 'ready' ? null : result);
      return result.status === 'ready';
    } catch (error) {
      if (!signal.aborted && error instanceof WelcomeCredentialContextError)
        clearCredentialSecrets();
      if (!signal.aborted)
        setCredentialFeedback({
          status: error instanceof CredentialReconciliationError ? 'uncertain' : 'review',
          message:
            error instanceof Error
              ? error.message
              : 'Could not save credentials. Review them before continuing.',
        });
      return false;
    } finally {
      if (!signal.aborted) {
        credentialLock.current = false;
        setCredentialBusy(false);
      }
    }
  }

  async function submitSetup(payload: Record<string, unknown>): Promise<Response | null> {
    const signal = credentialLifetime.current?.signal;
    if (!signal || signal.aborted || credentialLock.current || !credentialReady) return null;
    credentialLock.current = true;
    setCredentialBusy(true);
    try {
      const credentials = credentialSession.captureSelections(
        welcomeCredentialSelections(agent, voice)
      );
      const response = await fetch('/api/v1/onboarding/save', {
        method: 'POST',
        credentials: 'include',
        signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, credentials }),
      });
      const body = await response.text();
      signal.throwIfAborted();
      return new Response(body, { status: response.status, headers: response.headers });
    } catch (error) {
      if (signal.aborted) return null;
      throw error;
    } finally {
      if (!signal.aborted) {
        credentialLock.current = false;
        setCredentialBusy(false);
      }
    }
  }

  function credentialFieldsChanged() {
    credentialSession.invalidateConfirmations();
    if (credentialFeedback?.status === 'confirmation') setCredentialFeedback(null);
  }

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
    if (credentialLock.current) return;
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
    setTimezone(snapshot.timezone);
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

      // Default the timezone to the browser's detected zone unless a stored
      // snapshot already carries a pick.
      setTimezone((prev) => prev || Intl.DateTimeFormat().resolvedOptions().timeZone);
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
        timezone,
        baseLang,
        language,
        agent: {
          ...agent,
          value: agent.method === 'url' ? resumeEndpoint(agent.value) : '',
          liveTranslationKey: '',
        },
        voice: { ...voice, keys: {}, baseUrls: resumeEndpoints(voice.baseUrls) },
        storage: { ...storage, accessKeyId: '', secretAccessKey: '' },
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
    timezone,
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
    if (credentialLock.current) return;
    setStep(0);
    setProfileName('Learner');
    setAvatarSlug(ANIMAL_AVATARS[0].slug);
    setTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone);
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

  async function persistAgentSelection() {
    if (!config.selfHosted) return true;
    if (agent.method === 'url' && !config.isOwner) {
      setCredentialFeedback({
        status: 'review',
        message: 'Only the owner can save a server endpoint. Ask the owner to configure it.',
      });
      return false;
    }
    const ai = resolveAi(agent.provider, agent.method, agent.value, agent.model);
    if (!(await saveCredentials(ai.keyPost ? [ai.keyPost] : []))) return false;
    if (!config.isOwner || Object.keys(ai.infra).length === 0) return true;
    const signal = credentialLifetime.current?.signal;
    if (!signal || signal.aborted || credentialLock.current) return false;
    credentialLock.current = true;
    setCredentialBusy(true);
    try {
      const response = await fetch('/api/v1/admin/site-config', {
        method: 'PATCH',
        credentials: 'include',
        signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(ai.infra),
      });
      signal.throwIfAborted();
      if (!response.ok)
        throw new Error(
          'Could not save the selected AI configuration. Review it and continue again.'
        );
      return true;
    } catch (error) {
      if (!signal.aborted)
        setCredentialFeedback({
          status: 'review',
          message: error instanceof Error ? error.message : 'Could not save AI configuration.',
        });
      return false;
    } finally {
      if (!signal.aborted) {
        credentialLock.current = false;
        setCredentialBusy(false);
      }
    }
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
          timezone={timezone}
          demoMode={demoMode}
          setName={setProfileName}
          setAvatarSlug={setAvatarSlug}
          setTimezone={setTimezone}
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
          savedDetected={welcomeCredentialDiscovery(credentialSession, 'saved').ai}
          savedOutcome={(() => {
            const post = resolveAi(agent.provider, agent.method, agent.value, agent.model).keyPost;
            return post ? credentialSession.receiptStatus(post) : null;
          })()}
          agentStatuses={config.agentStatuses ?? undefined}
          aiModels={modelMeta.ai}
          setAgent={setAgent}
          onCredentialEdit={credentialFieldsChanged}
          onSave={async () => {
            if (!(await persistAgentSelection())) return null;
            if (agent.method === 'url') return 'configured';
            const provider = resolveAi(
              agent.provider,
              agent.method,
              agent.value,
              agent.model
            ).preferredAiProvider;
            return provider ? credentialSession.savedStatus('ai-keys', provider) : null;
          }}
          onNext={async () => {
            if (await persistAgentSelection()) go(5);
          }}
          onBack={() => go(3)}
        />
      );
      break;
    case 5:
      stepView = (
        <StepVoice
          voice={voice}
          demoMode={demoMode}
          savedDetectedTts={welcomeCredentialDiscovery(credentialSession, 'saved').tts}
          savedDetectedStt={welcomeCredentialDiscovery(credentialSession, 'saved').stt}
          savedDetectedVisual={welcomeCredentialDiscovery(credentialSession, 'saved').visual}
          ttsModels={modelMeta.tts}
          sttModels={modelMeta.stt}
          language={language}
          setVoice={(updater) => {
            credentialFieldsChanged();
            setVoice((prev) => updater(prev));
          }}
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
          saveCredentials={saveCredentials}
          submitSetup={submitSetup}
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
          {config.selfHosted && credentialFeedback && credentialFeedback.status !== 'ready' && (
            <div role="status">
              <p>{credentialFeedback.message}</p>
              <Button
                disabled={credentialBusy}
                onClick={() => {
                  if (credentialFeedback.status === 'review') {
                    const signal = credentialLifetime.current?.signal;
                    if (signal) void loadCredentials(signal);
                  } else {
                    void saveCredentials(
                      pendingCredentialPosts.current,
                      credentialFeedback.status === 'confirmation'
                        ? credentialFeedback.operationId
                        : undefined
                    );
                  }
                }}
              >
                {credentialFeedback.status === 'confirmation'
                  ? 'Save without verification'
                  : credentialFeedback.status === 'uncertain'
                    ? 'Check status'
                    : 'Reload credentials'}
              </Button>
            </div>
          )}
          <fieldset
            className={t.credentialBoundary}
            disabled={
              config.selfHosted &&
              step >= 4 &&
              (credentialBusy || !credentialReady || credentialFeedback?.status === 'uncertain')
            }
          >
            {stepView}
          </fieldset>
        </div>
      </main>
    </div>
  );
}
