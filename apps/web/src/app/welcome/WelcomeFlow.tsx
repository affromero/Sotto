'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { STEPS, WHISPERS, LEVELS } from './data';
import type { CefrLevel } from './data';
import { Glyph } from './Glyph';
import { StepWelcome } from './steps/StepWelcome';
import { StepAgent } from './steps/StepAgent';
import { StepVoice } from './steps/StepVoice';
import { StepContext } from './steps/StepContext';
import { StepPlacement } from './steps/StepPlacement';
import { StepCompose } from './steps/StepCompose';
import { StepReady } from './steps/StepReady';
import t from './theme.module.css';

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
  keys: Record<string, string>;
  /** Optional base URLs for keyless local providers (kokoro/local TTS, whisper/local STT). */
  baseUrls: Record<string, string>;
}

export type ContextItemKind = 'link' | 'text' | 'file';

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
}

interface WelcomeFlowProps {
  initialConfig?: OnboardingConfig;
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
  keys: {},
  baseUrls: {},
};

interface WelcomeSnapshot {
  step: number;
  baseLang: string;
  language: string;
  agent: AgentState;
  voice: VoiceState;
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
  return value === 'link' || value === 'text' || value === 'file';
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

function parseVoice(value: unknown): VoiceState {
  const record = asRecord(value);
  const keys = asRecord(record?.keys) ?? {};
  const baseUrls = asRecord(record?.baseUrls) ?? {};

  return {
    tts: typeof record?.tts === 'string' ? record.tts : DEFAULT_VOICE.tts,
    stt: typeof record?.stt === 'string' ? record.stt : DEFAULT_VOICE.stt,
    keys: Object.fromEntries(
      Object.entries(keys).filter(
        (entry): entry is [string, string] => typeof entry[1] === 'string'
      )
    ),
    baseUrls: Object.fromEntries(
      Object.entries(baseUrls).filter(
        (entry): entry is [string, string] => typeof entry[1] === 'string'
      )
    ),
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
      step: clampStep(storedStep),
      baseLang: typeof record.baseLang === 'string' ? record.baseLang : 'en',
      language: typeof record.language === 'string' ? record.language : '',
      agent: parseAgent(record.agent),
      voice: parseVoice(record.voice),
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
  const language = languageParam || (clamped >= 1 ? 'it' : '');
  return {
    step: clamped,
    baseLang: 'en',
    language,
    agent:
      clamped >= 1
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
    sources: new Set(clamped >= 3 ? ['repos', 'reading', 'notes', 'calendar'] : []),
    contextItems: [],
    understood: new Set<CefrLevel>(clamped >= 4 ? ['B1'] : []),
  };
}

export function WelcomeFlow({ initialConfig }: WelcomeFlowProps) {
  const [step, setStep] = useState(0);
  const [baseLang, setBaseLang] = useState('en');
  const [language, setLanguage] = useState('');
  const [agent, setAgent] = useState<AgentState>({ ...DEFAULT_AGENT });
  const [voice, setVoice] = useState<VoiceState>({ ...DEFAULT_VOICE });
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
        if (active && data) setConfig({ selfHosted: !!data.selfHosted, isOwner: !!data.isOwner });
      })
      .catch(() => {
        // Leave the safe default (demo) if config can't be read.
      });
    return () => {
      active = false;
    };
  }, []);

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
    setBaseLang(snapshot.baseLang);
    setLanguage(snapshot.language);
    setAgent(snapshot.agent);
    setVoice(snapshot.voice);
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
        if (stored) applySnapshot(stored);
      }

      setStorageReady(true);
      hydratedRef.current = true;
    });

    return () => {
      cancelled = true;
    };
  }, [config.selfHosted]);

  useEffect(() => {
    if (!storageReady || !config.selfHosted || deepLinkMode || typeof window === 'undefined') {
      return;
    }

    window.localStorage.setItem(
      SAVE_KEY,
      JSON.stringify({
        step,
        baseLang,
        language,
        agent,
        voice,
        sources: [...sources],
        contextItems,
        understood: [...understood],
      })
    );
  }, [
    agent,
    baseLang,
    config.selfHosted,
    contextItems,
    deepLinkMode,
    language,
    sources,
    step,
    storageReady,
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
            ? !!language
            : step === 1
              ? agent.status === 'connected'
              : step === 2
                ? true
                : step === 3
                  ? sources.size + contextItems.length > 0
                  : step === 4
                    ? !!level
                    : false;

        if (canAdvance && step < 5) {
          e.preventDefault();
          go(step + 1);
        }
      } else if (e.key === 'Escape' && step > 0 && step <= 5) {
        e.preventDefault();
        go(step - 1);
      }
    }

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [agent.status, contextItems.length, go, language, level, sources.size, step]);

  function chooseBaseLang(code: string) {
    setBaseLang(code);
    setLanguage((prev) => (prev === code ? '' : prev));
  }

  function reset() {
    setStep(0);
    setLanguage('');
    setBaseLang('en');
    setAgent({ ...DEFAULT_AGENT });
    setVoice({ ...DEFAULT_VOICE });
    setSources(new Set());
    setContextItems([]);
    setUnderstood(new Set());
    if (typeof window !== 'undefined' && config.selfHosted) {
      window.localStorage.removeItem(SAVE_KEY);
    }
  }

  function toggleSource(id: string) {
    setSources((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleUnderstood(lvl: CefrLevel) {
    setUnderstood((prev) => {
      if (prev.has(lvl)) return new Set();
      return new Set([lvl]);
    });
  }

  const flowState: FlowState = { baseLang, language };
  const demoMode = !config.selfHosted;

  let stepView: React.ReactNode;
  switch (step) {
    case 0:
      stepView = (
        <StepWelcome
          state={flowState}
          demoMode={demoMode}
          setBaseLang={chooseBaseLang}
          setLanguage={setLanguage}
          onNext={() => go(1)}
        />
      );
      break;
    case 1:
      stepView = (
        <StepAgent
          agent={agent}
          demoMode={demoMode}
          setAgent={(updater) => setAgent((prev) => updater(prev))}
          onNext={() => go(2)}
          onBack={() => go(0)}
        />
      );
      break;
    case 2:
      stepView = (
        <StepVoice
          voice={voice}
          demoMode={demoMode}
          setVoice={(updater) => setVoice((prev) => updater(prev))}
          onNext={() => go(3)}
          onBack={() => go(1)}
        />
      );
      break;
    case 3:
      stepView = (
        <StepContext
          sources={sources}
          toggle={toggleSource}
          contextItems={contextItems}
          setContextItems={setContextItems}
          demoMode={demoMode}
          onNext={() => go(4)}
          onBack={() => go(2)}
        />
      );
      break;
    case 4:
      stepView = (
        <StepPlacement
          baseLang={baseLang}
          language={language}
          understood={understood}
          toggleUnderstood={toggleUnderstood}
          level={level}
          demoMode={demoMode}
          onNext={() => go(5)}
          onBack={() => go(3)}
        />
      );
      break;
    case 5:
      stepView = (
        <StepCompose
          level={level}
          voice={voice}
          demoMode={demoMode}
          onDone={() => go(6)}
          onBack={() => go(4)}
        />
      );
      break;
    case 6:
      stepView = (
        <StepReady
          baseLang={baseLang}
          language={language}
          level={level}
          sources={sources}
          contextItems={contextItems}
          agent={agent}
          voice={voice}
          config={config}
          onRestart={reset}
          onJump={go}
        />
      );
      break;
    default:
      stepView = null;
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
            {config.selfHosted ? 'v0 · self-hosted' : 'v0 · hosted demo'}
          </div>
        </Link>

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
