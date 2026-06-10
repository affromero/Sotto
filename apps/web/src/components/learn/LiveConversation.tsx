'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useLiveAudio } from '@/lib/hooks/useLiveAudio';
import { openLiveSession, type LiveSessionHandle, type LiveTokenPayload } from '@/lib/live-session';
import styles from './LiveConversation.module.css';

type Direction = 'native_to_target' | 'target_to_native';
type Phase = 'idle' | 'connecting' | 'live' | 'error';
type Line = { id: number; role: 'you' | 'translation'; text: string; done: boolean };

interface Props {
  courseId: string;
  nativeLabel: string;
  targetLabel: string;
  level: string;
}

const MAX_LINES = 60;

export function LiveConversation({ courseId, nativeLabel, targetLabel, level }: Props) {
  const audio = useLiveAudio();
  const sessionRef = useRef<LiveSessionHandle | null>(null);
  const lineId = useRef(0);
  const captionsRef = useRef<HTMLDivElement | null>(null);
  // Accumulates the whole session's transcript so we can feed new vocab to the
  // memory graph on stop. Spans direction toggles; cleared only when we end.
  const allTextRef = useRef('');

  const [direction, setDirection] = useState<Direction>('native_to_target');
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [saved, setSaved] = useState<number | null>(null);

  const speakLabel = direction === 'native_to_target' ? nativeLabel : targetLabel;
  const hearLabel = direction === 'native_to_target' ? targetLabel : nativeLabel;

  const appendLine = useCallback((role: Line['role'], text: string, finished: boolean) => {
    allTextRef.current += `${text} `;
    setLines((prev) => {
      const next = prev.slice(-MAX_LINES);
      let idx = -1;
      for (let i = next.length - 1; i >= 0; i--) {
        if (next[i].role === role) {
          idx = i;
          break;
        }
      }
      if (idx >= 0 && !next[idx].done) {
        next[idx] = { ...next[idx], text: next[idx].text + text, done: finished };
        return [...next];
      }
      return [...next, { id: lineId.current++, role, text, done: finished }];
    });
  }, []);

  const teardown = useCallback(() => {
    sessionRef.current?.close();
    sessionRef.current = null;
    audio.stop();
  }, [audio]);

  const connect = useCallback(
    async (dir: Direction) => {
      setError(null);
      setPhase('connecting');
      try {
        const res = await fetch('/api/live-translate/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ courseId, direction: dir }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: unknown };
          setError(
            typeof body.error === 'string'
              ? body.error
              : 'Could not start a live session. Check your Google key in Settings.',
          );
          setPhase('error');
          return;
        }
        const payload = (await res.json()) as LiveTokenPayload;
        const handle = await openLiveSession(payload, {
          onAudio: (b64) => audio.enqueue(b64),
          onInputTranscript: (t, fin) => appendLine('you', t, fin),
          onOutputTranscript: (t, fin) => appendLine('translation', t, fin),
          onInterrupted: () => audio.flush(),
          onError: (m) => {
            setError(m);
            setPhase('error');
          },
        });
        sessionRef.current = handle;
        await audio.start((b64) => sessionRef.current?.sendAudio(b64));
        setPhase('live');
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : String(err));
        setPhase('error');
      }
    },
    [courseId, audio, appendLine],
  );

  const stop = useCallback(() => {
    teardown();
    setPhase('idle');
    // Feed the session's new target-language vocab into the memory graph.
    const transcript = allTextRef.current.trim();
    allTextRef.current = '';
    if (transcript) {
      void fetch('/api/live-translate/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ courseId, transcript }),
      })
        .then((r) => (r.ok ? r.json() : null))
        .then((d: { added?: number } | null) => {
          if (d && typeof d.added === 'number' && d.added > 0) setSaved(d.added);
        })
        .catch(() => undefined);
    }
  }, [teardown, courseId]);

  const toggleDirection = useCallback(async () => {
    const next: Direction = direction === 'native_to_target' ? 'target_to_native' : 'native_to_target';
    setDirection(next);
    if (phase === 'live' || phase === 'connecting') {
      teardown();
      await connect(next);
    }
  }, [direction, phase, teardown, connect]);

  // Tear the session down if the learner leaves the page mid-conversation.
  useEffect(() => () => teardown(), [teardown]);

  // Keep the latest caption in view.
  useEffect(() => {
    const el = captionsRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines]);

  const denied = audio.status === 'denied';
  const unsupported = audio.status === 'unsupported';
  const isLive = phase === 'live';
  const isConnecting = phase === 'connecting';

  return (
    <section className={styles.root}>
      <header className={styles.head}>
        <div className={styles.eyebrow}>Live conversation</div>
        <h1 className={styles.title}>
          Speak and hear the <em>live translation</em>.
        </h1>
        <p className={styles.sub}>
          {targetLabel} · {level}. A translation practice aid: speak naturally and hear it back.
          It will not chat or interrupt you, and new words you hit go into your review.
        </p>
      </header>

      <button
        type="button"
        className={styles.direction}
        onClick={toggleDirection}
        disabled={isConnecting}
        aria-label={`Switch direction. Currently speaking ${speakLabel}, hearing ${hearLabel}.`}
      >
        <span className={styles.dirLang}>{speakLabel}</span>
        <span className={styles.dirArrow} aria-hidden="true">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
            <path d="M7 7h11M14 3l4 4-4 4M17 17H6M10 21l-4-4 4-4" />
          </svg>
        </span>
        <span className={styles.dirLang}>{hearLabel}</span>
      </button>

      {unsupported ? (
        <p className={styles.notice} role="alert">
          This browser does not support the live audio pipeline. Try a recent Chrome, Edge, or Safari.
        </p>
      ) : denied ? (
        <p className={styles.notice} role="alert">
          Microphone access was blocked. Allow the microphone in your browser, then start again.
        </p>
      ) : phase === 'error' && error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}

      <div className={styles.stage}>
        <div
          className={`${styles.orb} ${isLive ? styles.orbLive : ''}`}
          style={{ ['--level' as string]: String(Math.min(1, audio.inputLevel * 2.2)) }}
          aria-hidden="true"
        >
          <span className={styles.orbCore} />
        </div>

        {!isLive ? (
          <button
            type="button"
            className={styles.primary}
            onClick={() => connect(direction)}
            disabled={isConnecting || unsupported}
          >
            {isConnecting ? 'Connecting…' : 'Start talking'}
          </button>
        ) : (
          <button type="button" className={styles.stopBtn} onClick={stop}>
            End conversation
          </button>
        )}
      </div>

      {saved !== null && (
        <p className={styles.saved} role="status">
          Added {saved} new {saved === 1 ? 'word' : 'words'} to your review.
        </p>
      )}

      <div className={styles.captions} ref={captionsRef} aria-live="polite">
        {lines.length === 0 ? (
          <p className={styles.empty}>
            Your words and their translation will appear here as you speak.
          </p>
        ) : (
          <ul className={styles.lineList} role="list">
            {lines.map((line) => (
              <li
                key={line.id}
                className={`${styles.line} ${line.role === 'translation' ? styles.lineTranslation : styles.lineYou}`}
              >
                <span className={styles.lineRole}>
                  {line.role === 'translation' ? hearLabel : speakLabel}
                </span>
                <span className={styles.lineText}>{line.text}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
