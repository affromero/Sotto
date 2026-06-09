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
import type { AgentState, VoiceState } from '../WelcomeFlow';
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
  onRestart,
}: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

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

  async function finishOnboarding() {
    setLoading(true);
    let courseId: string | null = null;
    try {
      // 1. Create course
      const res = await fetch('/api/courses', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ native: baseLang, target: language }),
      });
      if (res.ok) {
        const data = (await res.json()) as { course?: { id?: string } };
        courseId = data.course?.id ?? null;
      }
    } catch {
      // Non-fatal — proceed regardless
    }

    // 1b. Best-effort persist the learner's context note for this course
    if (courseId && note.trim()) {
      try {
        await fetch(`/api/courses/${courseId}/notes`, {
          method: 'PUT',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ body: note }),
        });
      } catch {
        // Swallow — editable later
      }
    }

    // 2. Best-effort persist AI key
    if (agent.method === 'key' && agent.value.trim()) {
      const aiProvider = agent.provider === 'claude' ? 'anthropic' : 'openai';
      try {
        await fetch('/api/settings/ai-keys', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ provider: aiProvider, apiKey: agent.value }),
        });
      } catch {
        // Swallow — editable in settings
      }
    }

    // 3. Best-effort persist voice keys
    const voiceKeyEntries = Object.entries(voice.keys);
    for (const [providerId, apiKey] of voiceKeyEntries) {
      if (!apiKey.trim()) continue;
      try {
        await fetch('/api/settings/byok', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ provider: providerId, apiKey }),
        });
      } catch {
        // Swallow — editable in settings
      }
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
