'use client';

import { useState, useCallback } from 'react';
import { ChevronDown } from 'lucide-react';
import type { EnvAvailability, ImageModelInfo } from './page';
import type { MapPresetId } from '@sotto/maps/server';
import styles from './VideoTestBench.module.css';

interface VideoTestBenchProps {
  envAvailability: EnvAvailability;
  mapPresets: MapPresetId[];
  imageModels: ImageModelInfo[];
}

type TestStatus = 'idle' | 'running' | 'pass' | 'fail';

interface TestResult {
  status: TestStatus;
  latencyMs?: number;
  error?: string;
  data?: Record<string, unknown>;
}

type TestType = 'classify' | 'resolve-place' | 'map-image' | 'ai-illustration' | 'stock-footage';

function StatusDot({ status }: { status: TestStatus }) {
  if (status === 'idle') return <span className={styles.dotIdle} aria-label="Idle">●</span>;
  if (status === 'running') return <span className={styles.spinner} aria-label="Running" />;
  if (status === 'pass') return <span className={styles.dotPass} aria-label="Pass">✓</span>;
  return <span className={styles.dotFail} aria-label="Fail">✗</span>;
}

interface SectionShellProps {
  label: string;
  result: TestResult;
  disabled?: boolean;
  disabledMessage?: React.ReactNode;
  children: React.ReactNode;
}

function SectionShell({ label, result, disabled, disabledMessage, children }: SectionShellProps) {
  const [open, setOpen] = useState(true);

  return (
    <div className={styles.section}>
      <div className={styles.sectionHeader}>
        <button
          type="button"
          className={styles.sectionToggle}
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
        >
          <ChevronDown
            className={`${styles.chevron} ${open ? styles.chevronOpen : ''}`}
            size={16}
            aria-hidden="true"
          />
          <span className={styles.sectionLabel}>{label}</span>
        </button>
        <StatusDot status={result.status} />
      </div>

      {open && (
        disabled ? (
          <div className={styles.disabledSection}>
            {disabledMessage}
          </div>
        ) : (
          <div className={styles.sectionBody}>
            {children}
          </div>
        )
      )}
    </div>
  );
}

// ── Classifier Section ──

function ClassifierSection({
  result,
  onTest,
  disabled,
}: {
  result: TestResult;
  onTest: (body: Record<string, unknown>) => void;
  disabled: boolean;
}) {
  const [title, setTitle] = useState('');
  const [topic, setTopic] = useState('');
  const [segmentsText, setSegmentsText] = useState('');

  function fillSample() {
    setTitle('The Fall of Constantinople');
    setTopic('History');
    setSegmentsText(
      'Constantinople had been the capital of the Byzantine Empire for over a thousand years, a city of immense wealth and cultural significance.\n' +
      'Sultan Mehmed II assembled an army of over 80,000 soldiers and a fleet of more than 120 ships to besiege the city.\n' +
      'The massive walls of Constantinople, which had repelled invaders for centuries, were finally breached by Ottoman cannons on May 29, 1453.\n' +
      'The fall marked the end of the Roman Empire and shifted the balance of power in the Mediterranean world.'
    );
  }

  function handleTest() {
    const segments = segmentsText.split('\n').map((s) => s.trim()).filter(Boolean);
    if (!title || !topic || segments.length === 0) return;
    onTest({ type: 'classify', title, topic, segments });
  }

  const classifications = result.data?.result as Array<{
    segmentId: string;
    order: number;
    subVisuals: Array<{
      subOrder: number;
      visualType: string;
      prompt: string | null;
      durationFraction: number;
    }>;
  }> | undefined;

  return (
    <SectionShell
      label="Visual Classifier"

      result={result}
      disabled={disabled}
      disabledMessage={<>Requires <code>ANTHROPIC_API_KEY</code></>}
    >
      <div className={styles.formGrid}>
        <div className={styles.formGridRow}>
          <div>
            <label className={styles.fieldLabel}>Title</label>
            <input
              className={styles.fieldInput}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Podcast title"
            />
          </div>
          <div>
            <label className={styles.fieldLabel}>Topic</label>
            <input
              className={styles.fieldInput}
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="Podcast topic"
            />
          </div>
        </div>
        <div>
          <label className={styles.fieldLabel}>Segments (one per line)</label>
          <textarea
            className={styles.fieldTextarea}
            value={segmentsText}
            onChange={(e) => setSegmentsText(e.target.value)}
            placeholder="Enter segment text, one per line..."
            rows={4}
          />
        </div>
      </div>
      <div className={styles.buttonRow}>
        <button
          type="button"
          className={styles.testButton}
          onClick={handleTest}
          disabled={result.status === 'running' || !title || !topic || !segmentsText.trim()}
        >
          {result.status === 'running' ? 'Classifying…' : 'Classify'}
        </button>
        <button type="button" className={styles.sampleButton} onClick={fillSample}>
          Sample Data
        </button>
      </div>

      {result.status === 'fail' && result.error && (
        <div className={styles.resultArea}>
          <span className={styles.errorText}>{result.error}</span>
        </div>
      )}

      {result.status === 'pass' && classifications && (
        <div className={styles.resultArea}>
          <div className={styles.resultHeader}>
            <span className={styles.resultLabel}>Classification Results</span>
            {result.latencyMs !== undefined && (
              <span className={styles.latencyBadge}>{result.latencyMs}ms</span>
            )}
          </div>
          <div className={styles.tableWrapper}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th className={styles.th}>#</th>
                  <th className={styles.th}>Visual Types</th>
                  <th className={styles.th}>Sub-Visuals</th>
                </tr>
              </thead>
              <tbody>
                {classifications.map((seg) => (
                  <tr key={seg.segmentId} className={styles.row}>
                    <td className={styles.td}>{seg.order}</td>
                    <td className={styles.td}>
                      {seg.subVisuals.map((sv) => (
                        <span key={sv.subOrder} className={styles.visualTypeBadge} style={{ marginRight: 4 }}>
                          {sv.visualType}
                        </span>
                      ))}
                    </td>
                    <td className={styles.td}>
                      <ul className={styles.subVisualList}>
                        {seg.subVisuals.map((sv) => (
                          <li key={sv.subOrder} className={styles.subVisualItem}>
                            [{(sv.durationFraction * 100).toFixed(0)}%] {sv.visualType}
                            {sv.prompt && ` — ${sv.prompt.slice(0, 80)}${sv.prompt.length > 80 ? '…' : ''}`}
                          </li>
                        ))}
                      </ul>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </SectionShell>
  );
}

// ── Place Resolver Section ──

function PlaceResolverSection({
  result,
  onTest,
}: {
  result: TestResult;
  onTest: (body: Record<string, unknown>) => void;
}) {
  const [query, setQuery] = useState('');
  const [yearHint, setYearHint] = useState('');

  function fillSample() {
    setQuery('Constantinople');
    setYearHint('1453');
  }

  function handleTest() {
    if (!query) return;
    const body: Record<string, unknown> = { type: 'resolve-place', query };
    if (yearHint) body.yearHint = parseInt(yearHint, 10);
    onTest(body);
  }

  const place = result.data?.result as {
    name: string;
    coordinates: [number, number];
    modernRegion: string;
    source: string;
    confidence: number;
    aliases?: string[];
  } | null | undefined;

  return (
    <SectionShell label="Place Resolver" result={result}>
      <div className={styles.formGrid}>
        <div className={styles.formGridRow}>
          <div>
            <label className={styles.fieldLabel}>Place Query</label>
            <input
              className={styles.fieldInput}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="e.g. Constantinople"
            />
          </div>
          <div>
            <label className={styles.fieldLabel}>Year Hint (optional)</label>
            <input
              className={styles.fieldInput}
              type="number"
              value={yearHint}
              onChange={(e) => setYearHint(e.target.value)}
              placeholder="e.g. 1453"
            />
          </div>
        </div>
      </div>
      <div className={styles.buttonRow}>
        <button
          type="button"
          className={styles.testButton}
          onClick={handleTest}
          disabled={result.status === 'running' || !query}
        >
          {result.status === 'running' ? 'Resolving…' : 'Resolve'}
        </button>
        <button type="button" className={styles.sampleButton} onClick={fillSample}>
          Sample Data
        </button>
      </div>

      {result.status === 'fail' && result.error && (
        <div className={styles.resultArea}>
          <span className={styles.errorText}>{result.error}</span>
        </div>
      )}

      {result.status === 'pass' && (
        <div className={styles.resultArea}>
          <div className={styles.resultHeader}>
            <span className={styles.resultLabel}>Resolved Place</span>
            {result.latencyMs !== undefined && (
              <span className={styles.latencyBadge}>{result.latencyMs}ms</span>
            )}
          </div>
          {place ? (
            <div className={styles.metadataGrid}>
              <span className={styles.metadataLabel}>Name</span>
              <span className={styles.metadataValue}>{place.name}</span>
              <span className={styles.metadataLabel}>Coordinates</span>
              <span className={styles.metadataValue}>[{place.coordinates[0]}, {place.coordinates[1]}]</span>
              <span className={styles.metadataLabel}>Region</span>
              <span className={styles.metadataValue}>{place.modernRegion}</span>
              <span className={styles.metadataLabel}>Source</span>
              <span className={styles.metadataValue}>{place.source}</span>
              <span className={styles.metadataLabel}>Confidence</span>
              <span className={styles.metadataValue}>{(place.confidence * 100).toFixed(0)}%</span>
              {place.aliases && place.aliases.length > 0 && (
                <>
                  <span className={styles.metadataLabel}>Aliases</span>
                  <span className={styles.metadataValue}>{place.aliases.join(', ')}</span>
                </>
              )}
            </div>
          ) : (
            <span className={styles.errorText}>No place found for this query</span>
          )}
        </div>
      )}
    </SectionShell>
  );
}

// ── Map Image Section ──

function MapImageSection({
  result,
  onTest,
  disabled,
  mapPresets,
}: {
  result: TestResult;
  onTest: (body: Record<string, unknown>) => void;
  disabled: boolean;
  mapPresets: MapPresetId[];
}) {
  const [place, setPlace] = useState('');
  const [preset, setPreset] = useState<MapPresetId>('vintage');
  const [width, setWidth] = useState('800');
  const [height, setHeight] = useState('600');

  function handleTest() {
    if (!place) return;
    onTest({
      type: 'map-image',
      place,
      preset,
      width: parseInt(width, 10) || 800,
      height: parseInt(height, 10) || 600,
    });
  }

  const imageBase64 = result.data?.imageBase64 as string | undefined;
  const resolvedPlace = result.data?.resolvedPlace as { name: string; coordinates: [number, number] } | undefined;

  return (
    <SectionShell
      label="Map Image"
      result={result}
      disabled={disabled}
      disabledMessage={<>Requires <code>MAPBOX_ACCESS_TOKEN</code></>}
    >
      <div className={styles.formGrid}>
        <div className={styles.formGridRow}>
          <div>
            <label className={styles.fieldLabel}>Place</label>
            <input
              className={styles.fieldInput}
              value={place}
              onChange={(e) => setPlace(e.target.value)}
              placeholder="e.g. Rome"
            />
          </div>
          <div>
            <label className={styles.fieldLabel}>Preset</label>
            <select
              className={styles.fieldSelect}
              value={preset}
              onChange={(e) => setPreset(e.target.value as MapPresetId)}
            >
              {mapPresets.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </div>
        </div>
        <div className={styles.formGridRow}>
          <div>
            <label className={styles.fieldLabel}>Width</label>
            <input
              className={styles.fieldInput}
              type="number"
              value={width}
              onChange={(e) => setWidth(e.target.value)}
            />
          </div>
          <div>
            <label className={styles.fieldLabel}>Height</label>
            <input
              className={styles.fieldInput}
              type="number"
              value={height}
              onChange={(e) => setHeight(e.target.value)}
            />
          </div>
        </div>
      </div>
      <div className={styles.buttonRow}>
        <button
          type="button"
          className={styles.testButton}
          onClick={handleTest}
          disabled={result.status === 'running' || !place}
        >
          {result.status === 'running' ? 'Generating…' : 'Generate Map'}
        </button>
      </div>

      {result.status === 'fail' && result.error && (
        <div className={styles.resultArea}>
          <span className={styles.errorText}>{result.error}</span>
        </div>
      )}

      {result.status === 'pass' && imageBase64 && (
        <div className={styles.resultArea}>
          <div className={styles.resultHeader}>
            <span className={styles.resultLabel}>Map Image</span>
            {result.latencyMs !== undefined && (
              <span className={styles.latencyBadge}>{result.latencyMs}ms</span>
            )}
            {resolvedPlace && (
              <span className={styles.latencyBadge}>
                {resolvedPlace.name} [{resolvedPlace.coordinates[0]}, {resolvedPlace.coordinates[1]}]
              </span>
            )}
          </div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={imageBase64} alt="Generated map" className={styles.imagePreview} />
        </div>
      )}
    </SectionShell>
  );
}

// ── AI Illustration Section ──

function AIIllustrationSection({
  result,
  onTest,
  disabled,
  imageModels,
}: {
  result: TestResult;
  onTest: (body: Record<string, unknown>) => void;
  disabled: boolean;
  imageModels: ImageModelInfo[];
}) {
  const [prompt, setPrompt] = useState('');
  const [model, setModel] = useState('');

  const groupedModels = {
    standard: imageModels.filter((m) => m.tier === 'standard'),
    high: imageModels.filter((m) => m.tier === 'high'),
    best: imageModels.filter((m) => m.tier === 'best'),
  };

  function handleTest() {
    if (!prompt) return;
    const body: Record<string, unknown> = { type: 'ai-illustration', prompt };
    if (model) body.model = model;
    onTest(body);
  }

  const imageBase64 = result.data?.imageBase64 as string | undefined;
  const usedModel = result.data?.model as string | undefined;

  return (
    <SectionShell
      label="AI Illustration"
      result={result}
      disabled={disabled}
      disabledMessage={<>Requires <code>FAL_KEY</code></>}
    >
      <div className={styles.formGrid}>
        <div>
          <label className={styles.fieldLabel}>Prompt</label>
          <textarea
            className={styles.fieldTextarea}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Describe the image to generate..."
            rows={3}
          />
        </div>
        <div>
          <label className={styles.fieldLabel}>Model (optional — defaults to FLUX.1 Schnell)</label>
          <select
            className={styles.fieldSelect}
            value={model}
            onChange={(e) => setModel(e.target.value)}
          >
            <option value="">Default</option>
            {(['standard', 'high', 'best'] as const).map((tier) => (
              <optgroup key={tier} label={tier.charAt(0).toUpperCase() + tier.slice(1)} className={styles.optgroupLabel}>
                {groupedModels[tier].map((m) => (
                  <option key={m.id} value={m.id}>{m.displayName}</option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>
      </div>
      <div className={styles.buttonRow}>
        <button
          type="button"
          className={styles.testButton}
          onClick={handleTest}
          disabled={result.status === 'running' || !prompt}
        >
          {result.status === 'running' ? 'Generating…' : 'Generate Image'}
        </button>
      </div>

      {result.status === 'fail' && result.error && (
        <div className={styles.resultArea}>
          <span className={styles.errorText}>{result.error}</span>
        </div>
      )}

      {result.status === 'pass' && imageBase64 && (
        <div className={styles.resultArea}>
          <div className={styles.resultHeader}>
            <span className={styles.resultLabel}>Generated Image</span>
            {result.latencyMs !== undefined && (
              <span className={styles.latencyBadge}>{result.latencyMs}ms</span>
            )}
            {usedModel && (
              <span className={styles.latencyBadge}>{usedModel}</span>
            )}
          </div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={imageBase64} alt="AI generated illustration" className={styles.imagePreview} />
        </div>
      )}
    </SectionShell>
  );
}

// ── Stock Footage Section ──

function StockFootageSection({
  result,
  onTest,
  disabled,
}: {
  result: TestResult;
  onTest: (body: Record<string, unknown>) => void;
  disabled: boolean;
}) {
  const [query, setQuery] = useState('');

  function handleTest() {
    if (!query) return;
    onTest({ type: 'stock-footage', query });
  }

  const stockResult = result.data?.result as {
    url: string;
    thumbnailUrl: string;
    duration: number;
    photographer: string;
    photographerUrl: string;
    pexelsVideoUrl: string;
  } | null | undefined;

  return (
    <SectionShell
      label="Stock Footage"
      result={result}
      disabled={disabled}
      disabledMessage={<>Requires <code>PEXELS_API_KEY</code></>}
    >
      <div className={styles.formGrid}>
        <div>
          <label className={styles.fieldLabel}>Search Query</label>
          <input
            className={styles.fieldInput}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="e.g. ocean waves"
          />
        </div>
      </div>
      <div className={styles.buttonRow}>
        <button
          type="button"
          className={styles.testButton}
          onClick={handleTest}
          disabled={result.status === 'running' || !query}
        >
          {result.status === 'running' ? 'Searching…' : 'Search'}
        </button>
      </div>

      {result.status === 'fail' && result.error && (
        <div className={styles.resultArea}>
          <span className={styles.errorText}>{result.error}</span>
        </div>
      )}

      {result.status === 'pass' && (
        <div className={styles.resultArea}>
          <div className={styles.resultHeader}>
            <span className={styles.resultLabel}>Stock Footage Result</span>
            {result.latencyMs !== undefined && (
              <span className={styles.latencyBadge}>{result.latencyMs}ms</span>
            )}
          </div>
          {stockResult ? (
            <div className={styles.stockResult}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={stockResult.thumbnailUrl} alt="Video thumbnail" className={styles.stockThumbnail} />
              <div className={styles.stockMeta}>
                <span><strong>Duration:</strong> {stockResult.duration}s</span>
                <span><strong>Photographer:</strong> {stockResult.photographer}</span>
                <a
                  href={stockResult.pexelsVideoUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={styles.stockLink}
                >
                  View on Pexels
                </a>
              </div>
            </div>
          ) : (
            <span className={styles.errorText}>No results found for this query</span>
          )}
        </div>
      )}
    </SectionShell>
  );
}

// ── Main Component ──

export function VideoTestBench({ envAvailability, mapPresets, imageModels }: VideoTestBenchProps) {
  const [results, setResults] = useState<Record<TestType, TestResult>>({
    'classify': { status: 'idle' },
    'resolve-place': { status: 'idle' },
    'map-image': { status: 'idle' },
    'ai-illustration': { status: 'idle' },
    'stock-footage': { status: 'idle' },
  });

  const runTest = useCallback(async (body: Record<string, unknown>) => {
    const testType = body.type as TestType;
    setResults((prev) => ({ ...prev, [testType]: { status: 'running' } }));

    try {
      const res = await fetch('/api/admin/test-video-pipeline', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();

      setResults((prev) => ({
        ...prev,
        [testType]: {
          status: data.success ? 'pass' : 'fail',
          latencyMs: data.latencyMs,
          error: data.error,
          data,
        },
      }));
    } catch (err) {
      setResults((prev) => ({
        ...prev,
        [testType]: {
          status: 'fail',
          error: err instanceof Error ? err.message : 'Unknown error',
        },
      }));
    }
  }, []);

  return (
    <div className={styles.panel}>
      <ClassifierSection
        result={results['classify']}
        onTest={runTest}
        disabled={!envAvailability.anthropic}
      />
      <PlaceResolverSection
        result={results['resolve-place']}
        onTest={runTest}
      />
      <MapImageSection
        result={results['map-image']}
        onTest={runTest}
        disabled={!envAvailability.mapbox}
        mapPresets={mapPresets}
      />
      <AIIllustrationSection
        result={results['ai-illustration']}
        onTest={runTest}
        disabled={!envAvailability.fal}
        imageModels={imageModels}
      />
      <StockFootageSection
        result={results['stock-footage']}
        onTest={runTest}
        disabled={!envAvailability.pexels}
      />
    </div>
  );
}
