'use client';

import { useState, useMemo } from 'react';
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
  status: 'idle' | 'verifying' | 'connected';
}

export interface VoiceState {
  tts: string;
  stt: string;
  keys: Record<string, string>;
}

export interface FlowState {
  baseLang: string;
  language: string;
}

export function WelcomeFlow() {
  const [step, setStep] = useState(0);
  const [baseLang, setBaseLang] = useState('en');
  const [language, setLanguage] = useState('');
  const [agent, setAgent] = useState<AgentState>({
    provider: '',
    method: null,
    value: '',
    status: 'idle',
  });
  const [voice, setVoice] = useState<VoiceState>({
    tts: 'elevenlabs',
    stt: 'whisper',
    keys: {},
  });
  const [sources, setSources] = useState<Set<string>>(new Set());
  const [understood, setUnderstood] = useState<Set<CefrLevel>>(new Set());

  const level = useMemo<CefrLevel | null>(() => {
    let best: CefrLevel | null = null;
    for (const l of LEVELS) {
      if (understood.has(l)) best = l;
    }
    return best;
  }, [understood]);

  function go(n: number) {
    setStep(Math.max(0, Math.min(STEPS.length - 1, n)));
  }

  function reset() {
    setStep(0);
    setLanguage('');
    setBaseLang('en');
    setAgent({ provider: '', method: null, value: '', status: 'idle' });
    setVoice({ tts: 'elevenlabs', stt: 'whisper', keys: {} });
    setSources(new Set());
    setUnderstood(new Set());
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
      const next = new Set(prev);
      if (next.has(lvl)) next.delete(lvl);
      else next.add(lvl);
      return next;
    });
  }

  const flowState: FlowState = { baseLang, language };

  let stepView: React.ReactNode;
  switch (step) {
    case 0:
      stepView = (
        <StepWelcome
          state={flowState}
          setBaseLang={setBaseLang}
          setLanguage={setLanguage}
          onNext={() => go(1)}
        />
      );
      break;
    case 1:
      stepView = (
        <StepAgent
          agent={agent}
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
          onNext={() => go(5)}
          onBack={() => go(3)}
        />
      );
      break;
    case 5:
      stepView = (
        <StepCompose level={level} voice={voice} onDone={() => go(6)} onBack={() => go(4)} />
      );
      break;
    case 6:
      stepView = (
        <StepReady
          baseLang={baseLang}
          language={language}
          level={level}
          sources={sources}
          agent={agent}
          voice={voice}
          onRestart={reset}
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
        <div className={t.brand}>
          <div className={t.wordmark}>
            <span className={t.wordmarkDot} />
            sotto
          </div>
          <div className={t.wordmarkSub}>v0 · self-hosted</div>
        </div>

        <nav className={t.stepper} aria-label="Setup progress">
          {STEPS.map((s, i) => {
            const isActive = i === step;
            const isDone = i < step;
            const stepClass = [
              t.stepItem,
              isDone ? t.done : '',
              isActive ? t.active : '',
            ]
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
          <div className={t.whisperTag}>sotto voce</div>
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
