'use client';

/**
 * ListeningSection — the audio player + comprehension module from the design
 * bundle (`class-listening.jsx`), wired to a real <audio> element fed by the
 * section's `episode.audioUrl`. Waveform bars are driven from `timeupdate`
 * progress (a fixed pseudo-amplitude envelope — we have no precomputed peaks).
 *
 * Adaptation: our class `episode` carries no transcript array, so the design's
 * transcript toggle is omitted; the player + MCQ are the live surface.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { ClassGlyph } from './ClassGlyph';
import { ContinueBar, MasteryMeter } from './ClassWidgets';
import { fmtClock, type ClassQuestion, type ClassSectionEpisode } from './classTypes';
import styles from './ListeningSection.module.css';

const BAR_COUNT = 56;
const SPEEDS = [0.75, 1, 1.25] as const;

/** Deterministic pseudo-waveform heights (0..1) with a speech-like envelope. */
function genWave(n: number, seed = 13): number[] {
  const out: number[] = [];
  let s = seed;
  for (let i = 0; i < n; i++) {
    s = (s * 9301 + 49297) % 233280;
    const r = s / 233280;
    const env = 0.45 + 0.55 * Math.sin((i / n) * Math.PI);
    out.push(Math.max(0.12, Math.min(1, (0.35 + r * 0.65) * env)));
  }
  return out;
}

interface ListeningSectionProps {
  episode: ClassSectionEpisode | null;
  questions: ClassQuestion[];
  gate: number; // 0..100
  nextName: string | null;
  onAnswer: (questionId: string, selectedIndex: number) => void;
  onScore: (score: number) => void;
  onContinue: () => void;
}

export function ListeningSection({
  episode,
  questions,
  gate,
  nextName,
  onAnswer,
  onScore,
  onContinue,
}: ListeningSectionProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const wave = useMemo(() => genWave(BAR_COUNT), []);

  const [playing, setPlaying] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [duration, setDuration] = useState(0);
  const [speed, setSpeed] = useState<number>(1);
  // picked[questionId] = selected option index
  const [picked, setPicked] = useState<Record<string, number>>({});

  const total = questions.length;
  const answered = questions.filter((q) => picked[q.id] !== undefined).length;
  const correctCount = questions.reduce((n, q) => {
    const sel = picked[q.id];
    if (sel === undefined || q.correctIndex === undefined) return n;
    return n + (sel === q.correctIndex ? 1 : 0);
  }, 0);
  const score = total > 0 ? Math.round((correctCount / total) * 100) : 0;
  const allDone = answered === total;
  const passed = allDone && score >= gate;

  useEffect(() => {
    onScore(score);
  }, [score, onScore]);

  // Keep playback rate synced to the speed control.
  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = speed;
  }, [speed]);

  function togglePlay() {
    const el = audioRef.current;
    if (!el) return;
    if (el.paused) {
      void el.play();
    } else {
      el.pause();
    }
  }

  function pick(questionId: string, optIndex: number) {
    if (picked[questionId] !== undefined) return;
    setPicked((prev) => ({ ...prev, [questionId]: optIndex }));
    onAnswer(questionId, optIndex);
  }

  const playedTo = duration > 0 ? elapsed / duration : 0;
  const hasAudio = !!episode?.audioUrl;

  return (
    <div className={styles.root}>
      <div className={styles.segEnter}>
        <div className={styles.eyebrow}>
          <span className={styles.eyebrowIdx}>02 ·</span> Listening
        </div>
        <h1 className={styles.title}>A scene, at your pace.</h1>
        <p className={styles.modLede}>
          Synthesized in the voice you chose, slowed to where you can follow. Listen first — then
          answer the comprehension questions below.
        </p>

        <div className={styles.player}>
          <div className={styles.playerTop}>
            <div className={styles.playerMeta}>
              <div className={styles.playerTitle}>{episode?.title ?? 'Lesson audio'}</div>
              <div className={styles.playerGloss}>
                {hasAudio ? 'adaptive speed' : 'audio still generating'}
              </div>
            </div>
            <div className={styles.playerSpeed} role="group" aria-label="Playback speed">
              {SPEEDS.map((s) => (
                <button
                  key={s}
                  type="button"
                  className={speed === s ? styles.playerSpeedOn : undefined}
                  aria-pressed={speed === s}
                  onClick={() => setSpeed(s)}
                >
                  {s}×
                </button>
              ))}
            </div>
          </div>

          <div className={styles.playerRow}>
            <button
              type="button"
              className={styles.playBtn}
              onClick={togglePlay}
              disabled={!hasAudio}
              aria-label={playing ? 'Pause audio' : 'Play audio'}
            >
              <ClassGlyph name={playing ? 'pause' : 'play'} size={22} />
            </button>
            <div className={styles.waveform} aria-hidden="true">
              {wave.map((h, i) => (
                <div
                  key={i}
                  className={`${styles.wfBar} ${i / wave.length <= playedTo ? styles.wfBarPlayed : ''}`}
                  style={{ height: `${18 + h * 26}px` }}
                />
              ))}
            </div>
            <div className={styles.wfTime}>
              {fmtClock(elapsed)} / {duration > 0 ? fmtClock(duration) : '–:––'}
            </div>
          </div>

          {hasAudio && episode?.audioUrl && (
            <audio
              ref={audioRef}
              src={episode.audioUrl}
              preload="metadata"
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
              onEnded={() => setPlaying(false)}
              onTimeUpdate={(e) => setElapsed(e.currentTarget.currentTime)}
              onLoadedMetadata={(e) => {
                const d = e.currentTarget.duration;
                if (Number.isFinite(d)) setDuration(d);
              }}
              aria-label="Lesson audio"
            />
          )}

          {!hasAudio && (
            <p className={styles.audioNotice} role="status">
              Audio is still generating — your comprehension questions are ready below.
            </p>
          )}
        </div>

        <MasteryMeter value={score} gate={gate} label="Comprehension" />

        <div className={styles.listenQs}>
          {questions.map((q) => {
            const sel = picked[q.id];
            return (
              <div className={styles.lq} key={q.id}>
                <div className={styles.lqQ}>{q.question}</div>
                <div
                  className={styles.lqOpts}
                  role="group"
                  aria-label={`Options for: ${q.question}`}
                >
                  {q.options.map((opt, oi) => {
                    let cls = styles.lqOpt;
                    let mark: 'check' | 'x' | 'dot' = 'dot';
                    if (sel !== undefined) {
                      if (q.correctIndex === oi) {
                        cls += ` ${styles.lqOptCorrect}`;
                        mark = 'check';
                      } else if (sel === oi) {
                        cls += ` ${styles.lqOptWrong}`;
                        mark = 'x';
                      } else {
                        cls += ` ${styles.lqOptDim}`;
                      }
                    }
                    const showMark = sel !== undefined && (q.correctIndex === oi || sel === oi);
                    return (
                      <button
                        key={oi}
                        type="button"
                        className={cls}
                        disabled={sel !== undefined}
                        aria-pressed={sel === oi}
                        aria-label={`Option ${oi + 1}: ${opt}`}
                        onClick={() => pick(q.id, oi)}
                      >
                        <span className={styles.lqMark}>
                          <ClassGlyph name={showMark ? mark : 'dot'} size={showMark ? 15 : 7} />
                        </span>
                        {opt}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        <ContinueBar
          passed={passed}
          gate={gate}
          score={score}
          nextName={nextName}
          onContinue={onContinue}
        />
      </div>
    </div>
  );
}
