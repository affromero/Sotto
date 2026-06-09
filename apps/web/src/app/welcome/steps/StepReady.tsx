'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  LANGUAGES,
  BASE_LANGS,
  PROVIDERS,
  TTS_PROVIDERS,
  STT_PROVIDERS,
  MODULES,
  nextLevel,
  lessonTitle,
} from '../data';
import type { CefrLevel } from '../data';
import type { AgentState, VoiceState, OnboardingConfig } from '../WelcomeFlow';
import { resolveAi, resolveTts, resolveStt, type KeyPost } from '../providerMap';
import { Glyph } from '../Glyph';
import t from '../theme.module.css';
import c from '../components.module.css';

interface Props {
  baseLang: string;
  language: string;
  level: CefrLevel | null;
  sources: Set<string>;
  agent: AgentState;
  voice: VoiceState;
  note: string;
  config: OnboardingConfig;
  onRestart: () => void;
}

export function StepReady({
  baseLang,
  language,
  level,
  sources,
  agent,
  voice,
  note,
  config,
  onRestart,
}: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);

  const lang = LANGUAGES.find((l) => l.code === language) ?? LANGUAGES[0];
  const base = BASE_LANGS.find((b) => b.code === baseLang) ?? BASE_LANGS[0];
  const lvl = level ?? 'A2';
  const prov = PROVIDERS.find((p) => p.id === agent.provider) ?? PROVIDERS[0];
  const agentLabel =
    agent.method === 'cli' && prov.cli ? prov.cli.label : prov.name;
  const ttsName =
    (TTS_PROVIDERS.find((p) => p.id === voice.tts) ?? TTS_PROVIDERS[0]).name;
  const sttName =
    (STT_PROVIDERS.find((p) => p.id === voice.stt) ?? STT_PROVIDERS[0]).name;

  async function postKey(post: KeyPost): Promise<boolean> {
    try {
      const res = await fetch(`/api/settings/${post.endpoint}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: post.provider, apiKey: post.apiKey }),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async function finishOnboarding() {
    setLoading(true);
    setError(null);
    setWarnings([]);

    // Managed showcase (SELF_HOSTED=false): a non-persisting demo — just enter.
    if (!config.selfHosted) {
      router.push('/learn');
      return;
    }

    // Translate the wizard's selections to real backend providers + infra.
    const ai = resolveAi(agent.provider, agent.method, agent.value, agent.model);
    const tts = resolveTts(voice.tts, voice.keys[voice.tts] ?? '', voice.baseUrls[voice.tts] ?? '');
    const stt = resolveStt(voice.stt, voice.keys[voice.stt] ?? '', voice.baseUrls[voice.stt] ?? '');

    // BYOK keys → the validated settings routes. Surface failures (don't swallow)
    // but don't block onboarding — keys are editable later in Settings.
    const failures: string[] = [];
    for (const post of [ai.keyPost, tts.keyPost, stt.keyPost]) {
      if (!post) continue;
      const ok = await postKey(post);
      if (!ok) failures.push(post.provider);
    }
    if (failures.length) {
      setWarnings([
        `Couldn't verify your ${failures.join(', ')} key${failures.length > 1 ? 's' : ''}. Add ${failures.length > 1 ? 'them' : 'it'} later in Settings.`,
      ]);
    }

    // Everything else (course, note, preferences, owner infra) in one call.
    const infra = config.isOwner
      ? { ...ai.infra, ...tts.infra, ...stt.infra }
      : undefined;

    try {
      const res = await fetch('/api/onboarding/save', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          course: { native: baseLang, target: language, ...(level && { level }) },
          ...(note.trim() && { note }),
          preferred: {
            language,
            ...(ai.preferredAiProvider && { aiProvider: ai.preferredAiProvider }),
            ...(ai.preferredAiModel && { aiModel: ai.preferredAiModel }),
            ...(tts.preferredTtsProvider && { ttsProvider: tts.preferredTtsProvider }),
          },
          ...(infra && Object.keys(infra).length > 0 && { infra }),
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(body?.error ?? 'Could not finish setup. Please try again.');
        setLoading(false);
        return;
      }
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
      setLoading(false);
      return;
    }

    router.push('/learn');
  }

  return (
    <div className={t.stepEnter}>
      <div className={t.eyebrow}>
        <span className={t.eyebrowIdx}>06 ·</span> Ready
      </div>
      <h1 className={t.title}>
        Welcome to your <em>{lang.native}</em>.
      </h1>
      <p className={t.lede}>
        Mastery-gated, drawn from your world, running on your keys. Pick up where the agent left
        off — it remembers everything, because the memory is yours.
      </p>

      <div className={c.readyHero}>
        <div className={c.courseCard}>
          <div className={c.courseTop}>
            <div>
              <div className={c.courseLang}>
                {lang.name} <span>· {lang.native}</span>
              </div>
              <div className={c.courseFrom}>from {base.name}</div>
            </div>
            <div className={c.courseBadge}>
              CEFR {lvl} → {nextLevel(lvl)}
            </div>
          </div>
          <div className={c.courseMods}>
            {MODULES.map((m) => (
              <span key={m.id} className={c.mchip}>
                <Glyph name={m.glyph} size={14} />
                {m.name}
              </span>
            ))}
          </div>
          <div className={c.firstLesson}>
            <div className={c.flTag}>First up · drawn from your context</div>
            <div className={c.flTitle}>&ldquo;{lessonTitle(lang.code)}&rdquo;</div>
            <div className={c.flSub}>
              {sources.size} context source{sources.size > 1 ? 's' : ''} woven in · grammar
              gate unlocks at 85% recall
            </div>
          </div>
          <div className={c.courseStack}>
            <span className={c.csLabel}>Your stack</span>
            <span className={c.csItem}>
              <Glyph name="plug" size={13} />
              {agentLabel}
            </span>
            <span className={c.csItem}>
              <Glyph name="wave" size={13} />
              {ttsName}
            </span>
            <span className={c.csItem}>
              <Glyph name="mic" size={13} />
              {sttName}
            </span>
          </div>
        </div>
      </div>

      {warnings.map((w) => (
        <div key={w} className={c.locknote} role="status">
          <Glyph name="shield" size={15} />
          {w}
        </div>
      ))}
      {error && (
        <div className={c.locknote} role="alert">
          <Glyph name="lock" size={15} />
          {error}
        </div>
      )}

      <div className={t.actions}>
        <button className={`${t.btn} ${t.btnBare}`} onClick={onRestart}>
          ↺ Run setup again
        </button>
        <span className={t.spacer} />
        <button
          className={`${t.btn} ${t.btnPrimary}`}
          disabled={loading}
          onClick={finishOnboarding}
          aria-label="Open today's session"
        >
          {loading ? (
            <>
              <span className={c.loadingSpinner} aria-hidden="true" />
              Setting up…
            </>
          ) : (
            <>
              Open today&apos;s session{' '}
              <span className={t.btnArrow}>
                <Glyph name="arrow" size={17} />
              </span>
            </>
          )}
        </button>
      </div>
    </div>
  );
}
