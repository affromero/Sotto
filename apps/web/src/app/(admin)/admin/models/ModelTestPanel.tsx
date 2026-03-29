'use client';

import { useState, useCallback } from 'react';
import { ChevronDown } from 'lucide-react';
import type { TestableProvider } from './page';
import { KittenHealthBanner } from './KittenHealthBanner';
import styles from './ModelTestPanel.module.css';

interface ModelTestPanelProps {
  aiProviders: TestableProvider[];
  ttsProviders: TestableProvider[];
  sttProviders: TestableProvider[];
  imageProviders: TestableProvider[];
  videoProviders: TestableProvider[];
  avatarProviders: TestableProvider[];
  musicProviders: TestableProvider[];
  kittenConfigured: boolean;
}

type TestStatus = 'idle' | 'running' | 'pass' | 'fail';

interface TestResult {
  status: TestStatus;
  latencyMs?: number;
  response?: string;
  audioData?: string;
  imageData?: string;
  videoUrl?: string;
  avatarCount?: number;
  transcript?: string;
  ttsSource?: string;
  error?: string;
}

function makeKey(p: TestableProvider): string {
  return `${p.category}::${p.providerId}::${p.modelId}`;
}

interface TestResponse {
  success: boolean;
  latencyMs: number;
  response?: string;
  audioData?: string;
  imageData?: string;
  videoUrl?: string;
  avatarCount?: number;
  transcript?: string;
  ttsSource?: string;
  error?: string;
}

async function runTest(p: TestableProvider): Promise<TestResponse> {
  const keySource = p.hasPlatformKey ? 'platform' : 'byok';
  const res = await fetch('/api/admin/test-model', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: p.category, provider: p.providerId, model: p.modelId, keySource }),
  });
  return res.json() as Promise<TestResponse>;
}

function StatusDot({ status }: { status: TestStatus }) {
  if (status === 'idle') return <span className={styles.dotIdle} aria-label="Idle">●</span>;
  if (status === 'running') return <span className={styles.spinner} aria-label="Running" />;
  if (status === 'pass') return <span className={styles.dotPass} aria-label="Pass">✓</span>;
  return <span className={styles.dotFail} aria-label="Fail">✗</span>;
}

function KeyBadges({ p }: { p: TestableProvider }) {
  return (
    <div className={styles.keyCell}>
      {p.hasPlatformKey && <span className={styles.badgePlatform}>Platform</span>}
      {p.hasByokKey && <span className={styles.badgeByok}>BYOK</span>}
    </div>
  );
}

function ResultCell({ provider, result }: { provider: TestableProvider; result: TestResult }) {
  if (result.status === 'fail' && result.error) {
    return <span className={styles.errorText}>{result.error}</span>;
  }
  if (result.status === 'pass') {
    if (provider.category === 'tts' && result.audioData) {
      return (
        <audio controls src={result.audioData} className={styles.audioPlayer} />
      );
    }
    if (provider.category === 'ai' && result.response) {
      return <span className={styles.responseText}>{result.response}</span>;
    }
    if (provider.category === 'stt') {
      return (
        <span className={styles.responseText}>
          {result.transcript || '(empty transcript)'}
          {result.ttsSource && (
            <span className={styles.ttsSourceLabel}> via {result.ttsSource}</span>
          )}
        </span>
      );
    }
    if (provider.category === 'image' && result.imageData) {
      return <img src={result.imageData} alt="Generated test image" className={styles.testImage} />;
    }
    if (provider.category === 'video' && result.videoUrl) {
      return <video controls src={result.videoUrl} className={styles.testVideo} />;
    }
    if (provider.category === 'avatar') {
      if (result.videoUrl) {
        return (
          <span className={styles.responseText}>
            <video controls src={result.videoUrl} className={styles.testVideo} />
            {result.response && <span> {result.response}</span>}
          </span>
        );
      }
      if (result.imageData) {
        return (
          <span className={styles.responseText}>
            <img src={result.imageData} alt="Generated test" className={styles.testImage} />
            {result.response && <span> {result.response}</span>}
          </span>
        );
      }
      if (result.avatarCount !== undefined) {
        return <span className={styles.responseText}>{result.avatarCount} avatars available</span>;
      }
    }
    if (result.response) {
      return <span className={styles.responseText}>{result.response}</span>;
    }
  }
  return null;
}

interface SectionProps {
  label: string;
  providers: TestableProvider[];
  results: Record<string, TestResult>;
  onTest: (p: TestableProvider) => void;
  onTestAll: (providers: TestableProvider[]) => void;
}

function Section({ label, providers, results, onTest, onTestAll }: SectionProps) {
  const [open, setOpen] = useState(false);

  const tested = providers.filter((p) => {
    const r = results[makeKey(p)];
    return r?.status === 'pass' || r?.status === 'fail';
  });
  const passed = tested.filter((p) => results[makeKey(p)]?.status === 'pass');
  const anyRunning = providers.some((p) => results[makeKey(p)]?.status === 'running');
  const allDone = tested.length === providers.length && tested.length > 0;
  const anyFail = allDone && passed.length < tested.length;

  // Show content when manually opened OR when tests have been triggered
  const hasActivity = providers.some((p) => {
    const s = results[makeKey(p)]?.status;
    return s === 'running' || s === 'pass' || s === 'fail';
  });
  const isOpen = open || hasActivity;

  return (
    <div className={styles.section}>
      <div className={styles.sectionHeader}>
        <button
          type="button"
          className={`${styles.sectionToggle} ${anyFail ? styles.sectionToggleFail : ''}`}
          onClick={() => setOpen((o) => !o)}
          aria-expanded={isOpen}
        >
          <ChevronDown
            className={`${styles.chevron} ${isOpen ? styles.chevronOpen : ''}`}
            size={16}
            aria-hidden="true"
          />
          <span className={styles.sectionLabel}>{label}</span>
          <span className={styles.countBadge}>{providers.length}</span>
          {allDone && (
            <span className={`${styles.badge} ${anyFail ? styles.badgeFail : styles.badgePass}`}>
              {passed.length} / {tested.length} passed
            </span>
          )}
        </button>

        <button
          type="button"
          className={styles.testAllButton}
          onClick={() => { setOpen(true); onTestAll(providers); }}
          disabled={anyRunning}
        >
          Test All
        </button>
      </div>

      {isOpen && (
        <div className={styles.tableWrapper}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th className={styles.th}>Provider</th>
                <th className={styles.th}>Model</th>
                <th className={styles.th}>Tier</th>
                <th className={styles.th}>Key</th>
                <th className={styles.th}>Status</th>
                <th className={styles.th}>Latency</th>
                <th className={styles.th}>Result</th>
                <th className={styles.th}>Action</th>
              </tr>
            </thead>
            <tbody>
              {providers.map((p) => {
                const key = makeKey(p);
                const result = results[key] ?? { status: 'idle' as TestStatus };
                const isRunning = result.status === 'running';
                return (
                  <tr key={key} className={styles.row}>
                    <td className={styles.td}>
                      {p.providerName}
                      {p.disabled && (
                        <span className={styles.disabledBadge} title={p.disabledReason}>
                          Disabled
                        </span>
                      )}
                    </td>
                    <td className={styles.tdMono}>{p.modelId}</td>
                    <td className={styles.td}>
                      <span className={`${styles.tier} ${styles[`tier_${p.tier.replace('-', '_')}`]}`}>
                        {p.tier}
                      </span>
                    </td>
                    <td className={styles.td}>
                      <KeyBadges p={p} />
                    </td>
                    <td className={styles.td}>
                      <StatusDot status={result.status} />
                    </td>
                    <td className={styles.td}>
                      {result.latencyMs !== undefined ? `${result.latencyMs}ms` : '—'}
                    </td>
                    <td className={styles.tdResult}>
                      <ResultCell provider={p} result={result} />
                    </td>
                    <td className={styles.td}>
                      <button
                        type="button"
                        className={styles.testButton}
                        onClick={() => onTest(p)}
                        disabled={isRunning}
                      >
                        {isRunning ? 'Testing…' : 'Test'}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function ModelTestPanel({
  aiProviders,
  ttsProviders,
  sttProviders,
  imageProviders,
  videoProviders,
  avatarProviders,
  musicProviders,
  kittenConfigured,
}: ModelTestPanelProps) {
  const [results, setResults] = useState<Record<string, TestResult>>({});

  const setResult = useCallback((key: string, result: TestResult) => {
    setResults((prev) => ({ ...prev, [key]: result }));
  }, []);

  const runSingle = useCallback(
    async (p: TestableProvider) => {
      const key = makeKey(p);
      setResult(key, { status: 'running' });
      try {
        const data = await runTest(p);
        setResult(key, {
          status: data.success ? 'pass' : 'fail',
          latencyMs: data.latencyMs,
          response: data.response,
          audioData: data.audioData,
          imageData: data.imageData,
          videoUrl: data.videoUrl,
          avatarCount: data.avatarCount,
          transcript: data.transcript,
          ttsSource: data.ttsSource,
          error: data.error,
        });
      } catch (err) {
        setResult(key, {
          status: 'fail',
          error: err instanceof Error ? err.message : 'Unknown error',
        });
      }
    },
    [setResult]
  );

  const runAll = useCallback(
    (providers: TestableProvider[]) => {
      providers.forEach((p) => {
        setResult(makeKey(p), { status: 'running' });
      });
      providers.forEach((p) => {
        const key = makeKey(p);
        runTest(p)
          .then((data) => {
            setResult(key, {
              status: data.success ? 'pass' : 'fail',
              latencyMs: data.latencyMs,
              response: data.response,
              audioData: data.audioData,
              imageData: data.imageData,
              videoUrl: data.videoUrl,
              avatarCount: data.avatarCount,
              transcript: data.transcript,
              ttsSource: data.ttsSource,
              error: data.error,
            });
          })
          .catch((err) => {
            setResult(key, {
              status: 'fail',
              error: err instanceof Error ? err.message : 'Unknown error',
            });
          });
      });
    },
    [setResult]
  );

  return (
    <div className={styles.panel}>
      {kittenConfigured && <KittenHealthBanner />}
      <Section
        label="AI (LLM)"
        providers={aiProviders}
        results={results}
        onTest={runSingle}
        onTestAll={runAll}
      />
      <Section
        label="TTS (Text-to-Speech)"
        providers={ttsProviders}
        results={results}
        onTest={runSingle}
        onTestAll={runAll}
      />
      <Section
        label="STT (Speech-to-Text)"
        providers={sttProviders}
        results={results}
        onTest={runSingle}
        onTestAll={runAll}
      />
      <Section
        label="Image"
        providers={imageProviders}
        results={results}
        onTest={runSingle}
        onTestAll={runAll}
      />
      <Section
        label="Video"
        providers={videoProviders}
        results={results}
        onTest={runSingle}
        onTestAll={runAll}
      />
      <Section
        label="Avatar"
        providers={avatarProviders}
        results={results}
        onTest={runSingle}
        onTestAll={runAll}
      />
      <Section
        label="Music"
        providers={musicProviders}
        results={results}
        onTest={runSingle}
        onTestAll={runAll}
      />
    </div>
  );
}
