'use client';

import { useRef, useState } from 'react';
import styles from './InlineModelTest.module.css';

interface Props {
  type: 'ai' | 'tts' | 'stt';
  provider: string;
  model: string;
}

interface TestResult {
  success: boolean;
  latencyMs?: number;
  response?: string;
  audioData?: string;
  transcript?: string;
  error?: string;
}

/**
 * Test the selection sitting right above this button.
 *
 * The caller keys this on the selection, so changing provider or model mounts a
 * fresh instance and any previous result disappears with it. That is deliberate:
 * a result describes one selection, and a green tick left sitting under a model
 * nobody tested is worse than no tick at all.
 *
 * The Test tab already exercises every provider, but that answers "which of
 * these could work", not "does the one I just picked work" — and a provider that
 * needs a key, a CLI login, or a running local server fails in ways the picker
 * cannot show. Testing in place turns choosing a model into something you can
 * confirm before leaving the page.
 */
export function InlineModelTest({ type, provider, model }: Props) {
  const [result, setResult] = useState<TestResult | null>(null);
  const [running, setRunning] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  async function runTest() {
    setRunning(true);
    setResult(null);
    try {
      const res = await fetch('/api/v1/admin/test-model', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, provider, model: model || provider }),
      });
      const body = (await res.json()) as TestResult;
      setResult(body);
      if (body.audioData && audioRef.current) {
        audioRef.current.src = body.audioData;
        void audioRef.current.play().catch(() => {
          // Autoplay refused — the control is visible, so it can be played by hand.
        });
      }
    } catch {
      setResult({ success: false, error: 'Could not reach the server.' });
    }
    setRunning(false);
  }

  const detail = result?.success
    ? result.response || result.transcript || (result.audioData ? 'Audio generated' : 'Working')
    : result?.error;

  return (
    <div className={styles.root}>
      <button
        type="button"
        className={styles.button}
        onClick={() => void runTest()}
        disabled={running || !provider}
      >
        {running ? 'Testing…' : 'Test this model'}
      </button>

      {result && (
        <span
          className={result.success ? styles.pass : styles.fail}
          role="status"
          aria-live="polite"
        >
          <span className={styles.mark}>{result.success ? '✓' : '✕'}</span>
          {result.success && result.latencyMs !== undefined && (
            <span className={styles.latency}>{result.latencyMs} ms</span>
          )}
          {detail && <span className={styles.detail}>{detail}</span>}
        </span>
      )}

      {/* Kept mounted so a TTS result can play the moment it arrives. */}
      {type === 'tts' && (
        <audio
          ref={audioRef}
          className={result?.audioData ? styles.audio : styles.audioHidden}
          controls
        />
      )}
    </div>
  );
}
