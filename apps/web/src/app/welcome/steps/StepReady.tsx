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
  SOURCES,
  nextLevel,
  lessonTitle,
} from '../data';
import type { CefrLevel } from '../data';
import type { AgentState, ContextItem, VoiceState, OnboardingConfig } from '../WelcomeFlow';
import {
  resolveAi,
  resolveLiveTranslateKey,
  resolveTts,
  resolveStt,
  sttModelProviderId,
  resolveVisualCue,
  type KeyPost,
} from '../providerMap';
import { SottoSpinner } from '@/components/ui/SottoSpinner';
import { Glyph } from '../Glyph';
import t from '../theme.module.css';
import c from '../components.styles';

const MAX_ONBOARDING_NOTE_CHARS = 4000;
const VISUAL_CUE_KEY_ID = 'visual:pexels';

function contextKindLabel(item: ContextItem) {
  if (item.kind === 'article') return 'article/news';
  if (item.kind === 'music') return 'music/audio';
  if (item.kind === 'text') return 'note';
  return item.kind;
}

function buildContextNote(sources: Set<string>, contextItems: ContextItem[]) {
  const parts: string[] = [];
  const selectedSources = SOURCES.filter((source) => sources.has(source.id));

  if (selectedSources.length > 0) {
    parts.push(
      [
        'Allowed context sources:',
        ...selectedSources.map((source) => `- ${source.label}: ${source.meta}`),
      ].join('\n')
    );
  }

  if (contextItems.length > 0) {
    parts.push(
      [
        'Direct context:',
        ...contextItems.map((item) => `[${contextKindLabel(item)}] ${item.label}\n${item.value}`),
      ].join('\n\n')
    );
  }

  return parts.join('\n\n').trim().slice(0, MAX_ONBOARDING_NOTE_CHARS).trim();
}

interface Props {
  baseLang: string;
  language: string;
  level: CefrLevel | null;
  sources: Set<string>;
  contextItems: ContextItem[];
  agent: AgentState;
  voice: VoiceState;
  config: OnboardingConfig;
  onRestart: () => void;
  onJump: (step: number) => void;
}

export function StepReady({
  baseLang,
  language,
  level,
  sources,
  contextItems,
  agent,
  voice,
  config,
  onRestart,
  onJump,
}: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [demoComplete, setDemoComplete] = useState(false);

  const lang = LANGUAGES.find((l) => l.code === language) ?? LANGUAGES[0];
  const base = BASE_LANGS.find((b) => b.code === baseLang) ?? BASE_LANGS[0];
  const lvl = level ?? 'A2';
  const prov = PROVIDERS.find((p) => p.id === agent.provider) ?? PROVIDERS[0];
  const agentLabel = agent.method === 'cli' && prov.cli ? prov.cli.label : prov.name;
  const ttsName = (TTS_PROVIDERS.find((p) => p.id === voice.tts) ?? TTS_PROVIDERS[0]).name;
  const sttName = (STT_PROVIDERS.find((p) => p.id === voice.stt) ?? STT_PROVIDERS[0]).name;
  const visualCueName = voice.visualCueProvider === 'pexels' ? 'Pexels cues' : 'Image cues off';
  const contextSignalCount = sources.size + contextItems.length;

  function goHome() {
    router.push('/');
  }

  async function postKey(post: KeyPost): Promise<boolean> {
    try {
      const res = await fetch(`/api/v1/settings/${post.endpoint}`, {
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
    setDemoComplete(false);

    // Managed showcase (SELF_HOSTED=false): a non-persisting demo. Stop before
    // the authenticated learning app; no profile, course, key, or setting is saved.
    if (!config.selfHosted) {
      setLoading(false);
      setDemoComplete(true);
      return;
    }

    // Translate the wizard's selections to real backend providers + infra.
    const ai = resolveAi(agent.provider, agent.method, agent.value, agent.model);
    const liveTranslateKey = resolveLiveTranslateKey(agent.liveTranslationKey ?? '');
    const tts = resolveTts(
      voice.tts,
      voice.keys[voice.tts] ?? '',
      voice.baseUrls[voice.tts] ?? '',
      voice.ttsModel[voice.tts] ?? ''
    );
    const stt = resolveStt(
      voice.stt,
      voice.keys[voice.stt] ?? '',
      voice.baseUrls[voice.stt] ?? '',
      voice.sttModel[sttModelProviderId(voice.stt)] ?? ''
    );
    const visualCue = resolveVisualCue(
      voice.visualCueProvider,
      voice.keys[VISUAL_CUE_KEY_ID] ?? ''
    );

    // BYOK keys → the validated key routes. Surface failures (don't swallow)
    // but don't block onboarding. Keys are editable later in Admin Providers.
    const failures: string[] = [];
    const postedKeys = new Set<string>();
    for (const post of [
      ai.keyPost,
      liveTranslateKey,
      tts.keyPost,
      stt.keyPost,
      visualCue.keyPost,
    ]) {
      if (!post) continue;
      const postId = `${post.endpoint}:${post.provider}`;
      if (postedKeys.has(postId)) continue;
      postedKeys.add(postId);
      const ok = await postKey(post);
      if (!ok) failures.push(post.provider);
    }
    if (failures.length) {
      setWarnings([
        `Couldn't verify your ${failures.join(', ')} key${failures.length > 1 ? 's' : ''}. Add ${failures.length > 1 ? 'them' : 'it'} later in Admin Providers.`,
      ]);
    }

    // Everything else (course, preferences, owner infra) in one call.
    const infra = config.isOwner ? { ...ai.infra, ...tts.infra, ...stt.infra } : undefined;
    const note = buildContextNote(sources, contextItems);

    try {
      const res = await fetch('/api/v1/onboarding/save', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          course: { native: baseLang, target: language, ...(level && { level }) },
          ...(note && { note }),
          preferred: {
            language,
            ...(ai.preferredAiProvider && { aiProvider: ai.preferredAiProvider }),
            ...(ai.preferredAiModel && { aiModel: ai.preferredAiModel }),
            ...(tts.preferredTtsProvider && { ttsProvider: tts.preferredTtsProvider }),
            ...(tts.preferredTtsModel && { ttsModel: tts.preferredTtsModel }),
            ...(stt.preferredSttProvider && { sttProvider: stt.preferredSttProvider }),
            ...(stt.preferredSttModel && { sttModel: stt.preferredSttModel }),
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
        <span className={t.eyebrowIdx}>09 ·</span> Ready
      </div>
      <h1 className={t.title}>
        Welcome to your <em>{lang.native}</em>.
      </h1>
      <p className={t.lede}>
        {config.selfHosted
          ? 'Gated by mastery, drawn from your world, running on your keys. Pick up where the agent left off. It remembers everything because the memory is yours.'
          : 'This is the hosted preview of a course drawn from mock context and gated by mastery. No profile, source connection, key, or course record is created.'}
      </p>

      <div className={c.readyHero}>
        <div className={c.courseCard}>
          <div className={c.courseTop}>
            <button
              className={`${c.courseLang} ${c.courseJump}`}
              onClick={() => onJump(3)}
              title="Change language"
              type="button"
            >
              {lang.name} <span>· {lang.native}</span>
              <div className={c.courseFrom}>from {base.name}</div>
            </button>
            <button
              className={`${c.courseBadge} ${c.courseJump}`}
              onClick={() => onJump(7)}
              title="Retake placement"
              type="button"
            >
              CEFR {lvl} → {nextLevel(lvl)}
            </button>
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
              {contextSignalCount} context signal{contextSignalCount === 1 ? '' : 's'} woven in ·
              grammar gate unlocks at 85% recall
            </div>
          </div>
          <div className={c.courseStack}>
            <span className={c.csLabel}>{config.selfHosted ? 'Your stack' : 'Preview stack'}</span>
            <button
              className={`${c.csItem} ${c.csJump}`}
              onClick={() => onJump(4)}
              title="Change agent"
              type="button"
            >
              <Glyph name="plug" size={13} />
              {agentLabel}
            </button>
            <button
              className={`${c.csItem} ${c.csJump}`}
              onClick={() => onJump(5)}
              title="Change pronunciation audio"
              type="button"
            >
              <Glyph name="wave" size={13} />
              {ttsName}
            </button>
            <button
              className={`${c.csItem} ${c.csJump}`}
              onClick={() => onJump(5)}
              title="Change voice"
              type="button"
            >
              <Glyph name="mic" size={13} />
              {sttName}
            </button>
            <button
              className={`${c.csItem} ${c.csJump}`}
              onClick={() => onJump(5)}
              title="Change visual cue provider"
              type="button"
            >
              <Glyph name="spark" size={13} />
              {visualCueName}
            </button>
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
      {demoComplete && (
        <div className={c.locknote} role="status">
          <Glyph name="shield" size={15} />
          Hosted demo complete. No profile was created, no credentials were requested, and nothing
          was saved.
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
          onClick={demoComplete ? goHome : finishOnboarding}
          aria-label={
            demoComplete
              ? 'Return home'
              : config.selfHosted
                ? "Open today's session"
                : 'Finish demo'
          }
        >
          {loading ? (
            <>
              <SottoSpinner size="small" color="white" ariaLabel="Setting up" />
              Setting up…
            </>
          ) : demoComplete ? (
            <>
              Back to home{' '}
              <span className={t.btnArrow}>
                <Glyph name="arrow" size={17} />
              </span>
            </>
          ) : (
            <>
              {config.selfHosted ? "Open today's session" : 'Finish demo'}{' '}
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
