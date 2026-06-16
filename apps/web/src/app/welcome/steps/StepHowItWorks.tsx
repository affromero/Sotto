'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { GlyphName } from '@/components/Glyph';
import { Glyph } from '../Glyph';
import { OnboardingThemeSwitch } from '../OnboardingThemeSwitch';
import styles from './StepHowItWorks.module.css';

interface Props {
  demoMode: boolean;
  onBack: () => void;
  onNext: () => void;
}

interface HowStep {
  n: string;
  phase: number;
  label: string;
  glyph: GlyphName;
  desc: string;
}

const HOW_STEPS: readonly HowStep[] = [
  {
    n: '01',
    phase: 0,
    label: "Who's learning",
    glyph: 'headset',
    desc: 'Create the learner profile. On self hosted, the first learner is the admin.',
  },
  {
    n: '02',
    phase: 0,
    label: 'Languages',
    glyph: 'globe',
    desc: 'Choose the language you know and the one Sotto should teach.',
  },
  {
    n: '03',
    phase: 1,
    label: 'Connect agent',
    glyph: 'plug',
    desc: 'Connect Claude, Codex, a local model, or your own endpoint.',
  },
  {
    n: '04',
    phase: 1,
    label: 'Voice & cues',
    glyph: 'wave',
    desc: 'Choose the voices that speak and listen, plus visual memory cues.',
  },
  {
    n: '05',
    phase: 1,
    label: 'Grant context',
    glyph: 'repo',
    desc: 'Share notes, reading, links, repos, files, or goals.',
  },
  {
    n: '06',
    phase: 2,
    label: 'Placement',
    glyph: 'graph',
    desc: 'Test, upload notes, answer short follow ups, or set a level by hand.',
  },
  {
    n: '07',
    phase: 2,
    label: 'Compose',
    glyph: 'spark',
    desc: 'Sotto writes a private course from your level, context, and stack.',
  },
  {
    n: '08',
    phase: 2,
    label: 'Mastery',
    glyph: 'check',
    desc: 'Skills advance only when mastery is shown.',
  },
];

const STEP_COUNT = HOW_STEPS.length;
const START_DELAY_MS = 760;
const STEP_DELAY_MS = 1900;
const FINAL_DELAY_MS = 700;

function cx(...classes: Array<string | false | undefined>) {
  return classes.filter(Boolean).join(' ');
}

function supportsReducedMotion() {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

export function StepHowItWorks({ demoMode, onBack, onNext }: Props) {
  const [lit, setLit] = useState(() => (supportsReducedMotion() ? STEP_COUNT : 0));
  const [current, setCurrent] = useState(() => (supportsReducedMotion() ? -1 : -1));
  const [settled, setSettled] = useState(() => supportsReducedMotion());
  const [hovered, setHovered] = useState<number | null>(null);
  const [run, setRun] = useState(0);
  const activeIndex = hovered ?? current;
  const activeStep = activeIndex >= 0 ? HOW_STEPS[activeIndex] : null;

  const progressClass = useMemo(() => {
    if (settled) return styles.progressDone;
    return styles[`progress${lit}`] ?? styles.progress0;
  }, [lit, settled]);

  const settle = useCallback(() => {
    setLit(STEP_COUNT);
    setCurrent(-1);
    setSettled(true);
  }, []);

  const replay = useCallback(() => {
    setLit(0);
    setCurrent(-1);
    setHovered(null);
    setSettled(false);
    setRun((value) => value + 1);
  }, []);

  const advance = useCallback(() => {
    if (settled) onNext();
    else settle();
  }, [onNext, settle, settled]);

  useEffect(() => {
    if (settled) return;

    const timers: number[] = [];
    if (supportsReducedMotion()) {
      timers.push(window.setTimeout(settle, 0));
      return () => timers.forEach(window.clearTimeout);
    }

    for (let i = 0; i < STEP_COUNT; i += 1) {
      timers.push(
        window.setTimeout(
          () => {
            setCurrent(i);
            setLit(i + 1);
          },
          START_DELAY_MS + i * STEP_DELAY_MS
        )
      );
    }
    timers.push(
      window.setTimeout(settle, START_DELAY_MS + STEP_COUNT * STEP_DELAY_MS + FINAL_DELAY_MS)
    );

    return () => timers.forEach(window.clearTimeout);
  }, [run, settle, settled]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        advance();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        settle();
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [advance, settle]);

  return (
    <div className={styles.root} aria-label="How Sotto works">
      <div className={styles.glow} aria-hidden="true" />

      <header className={styles.top}>
        <div className={styles.mark}>
          <span className={styles.bead} aria-hidden="true">
            <span className={styles.beadGlare} />
            <span className={styles.beadSpec} />
          </span>
          sotto
        </div>
        <div className={styles.topRight}>
          <OnboardingThemeSwitch />
          <div className={styles.kicker}>{demoMode ? 'Hosted preview' : 'Before you begin'}</div>
          <div className={styles.navControls} aria-label="How it works controls">
            <button className={styles.navButton} type="button" onClick={onBack}>
              <Glyph name="back" size={13} />
              Back
            </button>
            {!settled ? (
              <button className={styles.navButton} type="button" onClick={settle}>
                Skip animation
              </button>
            ) : null}
          </div>
        </div>
      </header>

      <section className={styles.corner} aria-label="Setup overview">
        <div className={styles.eyebrow}>How Sotto works</div>
        <p className={styles.lede}>
          Sotto isn&apos;t a model or a service. It&apos;s the scaffolding. Bring an agent and a
          little of your world, and it composes a language course only you could have. This is the
          whole path, before you take the first step.
        </p>
      </section>

      <main className={styles.stage}>
        <div className={cx(styles.orbit, progressClass)}>
          <div className={styles.ring} aria-hidden="true">
            <span className={styles.track} />
            <span className={styles.progress} />
          </div>

          {HOW_STEPS.map((step, index) => {
            const isOn = index < lit;
            const isActive = index === activeIndex;
            return (
              <button
                className={cx(
                  styles.nodeWrap,
                  styles[`node${index}`],
                  isOn && styles.on,
                  isActive && styles.active
                )}
                key={step.n}
                type="button"
                aria-label={`${step.n}: ${step.label}. ${step.desc}`}
                aria-pressed={isActive}
                onMouseEnter={() => setHovered(index)}
                onMouseLeave={() => setHovered(null)}
                onFocus={() => setHovered(index)}
                onBlur={() => setHovered(null)}
                onClick={(event) => {
                  event.stopPropagation();
                  setHovered((value) => (value === index ? null : index));
                  settle();
                }}
              >
                <span className={styles.node}>
                  <span className={styles.nodeGlyph}>
                    <Glyph name={step.glyph} size={22} />
                  </span>
                  <span className={styles.nodeNum}>{step.n}</span>
                </span>
                <span className={styles.nodeLabel}>{step.label}</span>
              </button>
            );
          })}

          <div className={styles.hub}>
            <span className={cx(styles.bead, styles.hubBead)} aria-hidden="true">
              <span className={styles.beadGlare} />
              <span className={styles.beadSpec} />
            </span>
            <div className={styles.hubBody} key={activeStep?.n ?? 'concept'}>
              {activeStep ? (
                <>
                  <div className={styles.hubEyebrow}>Step {activeStep.n}</div>
                  <h1 className={styles.hubTitle}>{activeStep.label}</h1>
                  <p className={styles.hubDesc}>{activeStep.desc}</p>
                </>
              ) : (
                <>
                  <div className={styles.hubEyebrow}>A private course</div>
                  <h1 className={styles.hubTitle}>
                    Composed by <em>you</em>, on your machine.
                  </h1>
                  <p className={styles.hubDesc}>Eight steps from here to your first lesson.</p>
                </>
              )}
            </div>
          </div>
        </div>
      </main>

      <footer className={styles.foot}>
        <button
          className={cx(styles.cta, !settled && styles.pending)}
          type="button"
          disabled={!settled}
          onClick={onNext}
        >
          Get started
          <Glyph name="arrow" size={17} />
        </button>
        <button
          className={cx(styles.replay, !settled && styles.pending)}
          type="button"
          disabled={!settled}
          onClick={replay}
        >
          <Glyph name="retry" size={13} />
          Replay
        </button>
      </footer>
    </div>
  );
}
