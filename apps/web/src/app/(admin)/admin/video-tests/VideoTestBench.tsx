'use client';

import { useState, useCallback } from 'react';
import { ChevronDown, Shuffle, Eye } from 'lucide-react';
import type { EnvAvailability, ImageModelInfo, AiProviderInfo } from './page';
import type { MapPresetId } from '@sotto/maps/server';
import styles from './VideoTestBench.module.css';

interface VideoTestBenchProps {
  envAvailability: EnvAvailability;
  mapPresets: MapPresetId[];
  imageModels: ImageModelInfo[];
  aiProviders: AiProviderInfo[];
}

type TestStatus = 'idle' | 'running' | 'pass' | 'fail';

interface TestResult {
  status: TestStatus;
  latencyMs?: number;
  error?: string;
  data?: Record<string, unknown>;
}

interface PreviewState {
  loading: boolean;
  videoBase64?: string;
  latencyMs?: number;
  error?: string;
}

type TestType = 'classify' | 'resolve-place' | 'map-image' | 'ai-illustration' | 'stock-footage';

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

// ── Shared preview helper ──

async function renderClip(
  segment: Record<string, unknown>,
  durationSeconds?: number,
): Promise<{ videoBase64: string; latencyMs: number }> {
  const res = await fetch('/api/admin/test-video-pipeline', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'render-clip', segment, durationSeconds }),
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.error ?? 'Render failed');
  return { videoBase64: data.videoBase64, latencyMs: data.latencyMs };
}

// ── Preview Button Component ──

function PreviewButton({
  preview,
  onPreview,
  label,
}: {
  preview: PreviewState | undefined;
  onPreview: () => void;
  label?: string;
}) {
  return (
    <>
      <button
        type="button"
        className={styles.previewButton}
        onClick={onPreview}
        disabled={preview?.loading}
      >
        <Eye size={14} aria-hidden="true" />
        {preview?.loading ? 'Rendering…' : (label ?? 'Preview as Video Clip')}
      </button>
      {preview?.error && (
        <span className={styles.errorText}>{preview.error}</span>
      )}
      {preview?.videoBase64 && (
        <div className={styles.remotionPreview}>
          <video
            src={preview.videoBase64}
            autoPlay
            loop
            muted
            playsInline
            controls
            className={styles.videoPreview}
          />
          {preview.latencyMs !== undefined && (
            <span className={styles.latencyBadge}>Rendered in {preview.latencyMs}ms via Remotion</span>
          )}
        </div>
      )}
    </>
  );
}

function StatusDot({ status }: { status: TestStatus }) {
  if (status === 'idle') return <span className={styles.dotIdle} aria-label="Idle">●</span>;
  if (status === 'running') return <span className={styles.spinner} aria-label="Running" />;
  if (status === 'pass') return <span className={styles.dotPass} aria-label="Pass">✓</span>;
  return <span className={styles.dotFail} aria-label="Fail">✗</span>;
}

interface SectionShellProps {
  label: string;
  description: string;
  result: TestResult;
  disabled?: boolean;
  disabledMessage?: React.ReactNode;
  children: React.ReactNode;
}

function SectionShell({ label, description, result, disabled, disabledMessage, children }: SectionShellProps) {
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
            <p className={styles.sectionDescription}>{description}</p>
            {children}
          </div>
        )
      )}
    </div>
  );
}

// ── Random data pools ──

const CLASSIFIER_SAMPLES = [
  {
    title: 'The Fall of Constantinople',
    topic: 'History',
    segments: [
      'Constantinople had been the capital of the Byzantine Empire for over a thousand years, a city of immense wealth and cultural significance.',
      'Sultan Mehmed II assembled an army of over 80,000 soldiers and a fleet of more than 120 ships to besiege the city.',
      'The massive walls of Constantinople, which had repelled invaders for centuries, were finally breached by Ottoman cannons on May 29, 1453.',
      'The fall marked the end of the Roman Empire and shifted the balance of power in the Mediterranean world.',
    ],
  },
  {
    title: 'How CRISPR Changed Medicine',
    topic: 'Science',
    segments: [
      'CRISPR-Cas9 was discovered in bacteria as a natural defense mechanism against viral infections.',
      'Jennifer Doudna and Emmanuelle Charpentier demonstrated that CRISPR could be programmed to cut any DNA sequence.',
      'The first clinical trial using CRISPR to treat sickle cell disease showed remarkable results in patients.',
      'Ethical debates continue about the use of gene editing in human embryos and designer babies.',
    ],
  },
  {
    title: 'The Rise of Electric Vehicles',
    topic: 'Technology',
    segments: [
      'Electric cars were actually invented before gasoline cars, with the first crude electric carriage built in the 1830s.',
      'Tesla Motors revolutionized the industry by proving that electric vehicles could be desirable luxury products.',
      'China has become the world leader in EV adoption, with over 60% of global electric vehicle sales.',
      'The biggest challenge remaining is battery technology — energy density, charging speed, and rare earth mineral sourcing.',
    ],
  },
  {
    title: 'Deep Sea Mysteries',
    topic: 'Nature',
    segments: [
      'More than 80% of the ocean floor remains unmapped and unexplored by humans.',
      'The Mariana Trench reaches nearly 11 kilometers deep, with pressures over 1,000 times atmospheric pressure at sea level.',
      'Bioluminescent creatures in the deep ocean produce their own light through chemical reactions.',
      'Giant squid were considered mythological until a live specimen was finally photographed in 2004.',
    ],
  },
  {
    title: 'The Economics of Coffee',
    topic: 'Business',
    segments: [
      'Coffee is the second most traded commodity in the world after crude oil, supporting over 125 million people.',
      'A single cup of specialty coffee that costs $5 in New York often pays the farmer less than 10 cents.',
      'Climate change is threatening coffee production, with some projections showing 50% less suitable land by 2050.',
      'The third wave coffee movement has transformed coffee from a commodity into an artisanal experience.',
    ],
  },
];

const PLACE_SAMPLES = [
  { query: 'Constantinople', yearHint: '1453' },
  { query: 'Pompeii', yearHint: '79' },
  { query: 'Machu Picchu', yearHint: '1450' },
  { query: 'Alexandria', yearHint: '300' },
  { query: 'Angkor Wat', yearHint: '1150' },
  { query: 'Tenochtitlan', yearHint: '1500' },
  { query: 'Carthage', yearHint: '-200' },
  { query: 'Kyoto', yearHint: '1600' },
  { query: 'Timbuktu', yearHint: '1350' },
  { query: 'Babylon', yearHint: '-600' },
];

const MAP_PLACES = [
  'Rome', 'Tokyo', 'Cairo', 'Petra', 'Athens',
  'Cusco', 'Samarkand', 'Jerusalem', 'Istanbul', 'Varanasi',
  'Great Wall of China', 'Stonehenge', 'Chichen Itza', 'Ephesus',
];

const ILLUSTRATION_PROMPTS = [
  'A medieval scholar studying ancient manuscripts by candlelight in a monastery library',
  'A bustling ancient Roman marketplace with merchants selling spices and silk',
  'A dramatic volcanic eruption seen from a nearby village at sunset',
  'A deep sea exploration scene with a submarine surrounded by bioluminescent creatures',
  'An aerial view of terraced rice paddies in Southeast Asia during golden hour',
  'A futuristic cityscape with flying vehicles and vertical gardens on skyscrapers',
  'A Viking longship navigating through icy fjords under the northern lights',
  'An ancient Egyptian workshop where artisans are painting hieroglyphs on papyrus',
  'A coffee plantation in the Ethiopian highlands with workers harvesting cherries',
  'A cross-section diagram of the ocean showing different depth zones and creatures',
];

const STOCK_QUERIES = [
  'ocean waves', 'city skyline timelapse', 'forest aerial', 'cooking fire',
  'space stars', 'mountain sunrise', 'underwater coral reef', 'busy street market',
  'northern lights', 'rain on window', 'desert sand dunes', 'lightning storm',
  'autumn leaves falling', 'science laboratory', 'ancient ruins',
];

// ── Classifier Section ──

function ClassifierSection({
  result,
  onTest,
  disabled,
  aiProviders,
  segmentsText,
  onSegmentsTextChange,
  onPreviewAll,
  previewAllState,
}: {
  result: TestResult;
  onTest: (body: Record<string, unknown>) => void;
  disabled: boolean;
  aiProviders: AiProviderInfo[];
  segmentsText: string;
  onSegmentsTextChange: (text: string) => void;
  onPreviewAll: () => void;
  previewAllState: PreviewAllState;
}) {
  const [title, setTitle] = useState('');
  const [topic, setTopic] = useState('');
  const [provider, setProvider] = useState('');
  const [model, setModel] = useState('');

  const selectedProvider = aiProviders.find((p) => p.id === provider);
  const availableModels = selectedProvider?.models ?? [];

  function fillRandom() {
    const sample = pick(CLASSIFIER_SAMPLES);
    setTitle(sample.title);
    setTopic(sample.topic);
    onSegmentsTextChange(sample.segments.join('\n'));
  }

  function handleTest() {
    const segments = segmentsText.split('\n').map((s) => s.trim()).filter(Boolean);
    if (!title || !topic || segments.length === 0) return;
    const body: Record<string, unknown> = { type: 'classify', title, topic, segments };
    if (provider) body.provider = provider;
    if (model) body.model = model;
    onTest(body);
  }

  const classifications = result.data?.result as Array<{
    segmentId: string;
    order: number;
    subVisuals: Array<{
      subOrder: number;
      visualType: string;
      prompt: string | null;
      durationFraction: number;
      metadata?: Record<string, unknown>;
    }>;
  }> | undefined;
  const usedModel = result.data?.model as string | undefined;
  const tokens = result.data?.tokens as { input: number; output: number } | undefined;

  return (
    <SectionShell
      label="Visual Classifier"
      description="Tests the AI that decides which visual type each podcast segment gets (map, illustration, stock footage, text card, etc). Feed it a title, topic, and segment texts to see what visuals it picks."
      result={result}
      disabled={disabled}
      disabledMessage={<>Requires at least one AI provider key (e.g. <code>ANTHROPIC_API_KEY</code>)</>}
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
            onChange={(e) => onSegmentsTextChange(e.target.value)}
            placeholder="Enter segment text, one per line..."
            rows={4}
          />
        </div>
        <div className={styles.formGridRow}>
          <div>
            <label className={styles.fieldLabel}>AI Provider</label>
            <select
              className={styles.fieldSelect}
              value={provider}
              onChange={(e) => { setProvider(e.target.value); setModel(''); }}
            >
              <option value="">Default</option>
              {aiProviders.map((p) => (
                <option key={p.id} value={p.id}>{p.displayName}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={styles.fieldLabel}>Model</label>
            <select
              className={styles.fieldSelect}
              value={model}
              onChange={(e) => setModel(e.target.value)}
              disabled={!provider}
            >
              <option value="">Default</option>
              {availableModels.map((m) => (
                <option key={m.id} value={m.id}>{m.displayName}</option>
              ))}
            </select>
          </div>
        </div>
      </div>
      <div className={styles.buttonRow}>
        <button
          type="button"
          className={styles.testButton}
          onClick={handleTest}
          disabled={result.status === 'running' || !title || !topic || !segmentsText.trim()}
        >
          {result.status === 'running' ? 'Analyzing…' : 'Run Classification'}
        </button>
        <button type="button" className={styles.randomizeButton} onClick={fillRandom}>
          <Shuffle size={14} aria-hidden="true" />
          Randomize
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
            {usedModel && (
              <span className={styles.latencyBadge}>{usedModel}</span>
            )}
            {tokens && (
              <span className={styles.latencyBadge}>{tokens.input + tokens.output} tokens</span>
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

          {/* Preview All Segments */}
          <div className={styles.previewAllSection}>
            <button
              type="button"
              className={styles.testButton}
              onClick={onPreviewAll}
              disabled={previewAllState.loading}
            >
              <Eye size={14} aria-hidden="true" />
              {previewAllState.loading
                ? `Rendering ${previewAllState.completed}/${previewAllState.total} segments…`
                : 'Preview All Segments'}
            </button>
            {previewAllState.error && (
              <span className={styles.errorText}>{previewAllState.error}</span>
            )}
            {previewAllState.segments.length > 0 && (
              <div className={styles.previewAllStrip}>
                {previewAllState.segments.map((seg) => (
                  <div key={seg.index} className={styles.previewAllItem}>
                    {seg.videoBase64 ? (
                      <video
                        src={seg.videoBase64}
                        autoPlay
                        loop
                        muted
                        playsInline
                        controls
                        className={styles.previewAllVideo}
                      />
                    ) : seg.error ? (
                      <div className={styles.previewAllPlaceholder}>
                        <span className={styles.errorText}>{seg.error}</span>
                      </div>
                    ) : (
                      <div className={styles.previewAllPlaceholder}>
                        <span className={styles.spinner} />
                      </div>
                    )}
                    <div className={styles.previewAllMeta}>
                      <span className={styles.visualTypeBadge}>{seg.visualType}</span>
                      <span className={styles.previewAllText}>
                        {seg.text.slice(0, 50)}{seg.text.length > 50 ? '…' : ''}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
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
  preview,
  onPreview,
}: {
  result: TestResult;
  onTest: (body: Record<string, unknown>) => void;
  preview: PreviewState | undefined;
  onPreview: () => void;
}) {
  const [query, setQuery] = useState('');
  const [yearHint, setYearHint] = useState('');

  function fillRandom() {
    const sample = pick(PLACE_SAMPLES);
    setQuery(sample.query);
    setYearHint(sample.yearHint);
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
    <SectionShell
      label="Place Resolver"
      description="Tests geographic lookup — converts a place name (optionally with a historical year) into coordinates and metadata. Used to position map overlays in videos."
      result={result}
    >
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
          {result.status === 'running' ? 'Resolving…' : 'Resolve Place'}
        </button>
        <button type="button" className={styles.randomizeButton} onClick={fillRandom}>
          <Shuffle size={14} aria-hidden="true" />
          Randomize
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
            <>
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
              <div className={styles.buttonRow} style={{ marginTop: 'var(--spacing-sm)' }}>
                <PreviewButton
                  preview={preview}
                  onPreview={onPreview}
                  label="Preview as Map"
                />
              </div>
            </>
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
  preview,
  onPreview,
}: {
  result: TestResult;
  onTest: (body: Record<string, unknown>) => void;
  disabled: boolean;
  mapPresets: MapPresetId[];
  preview: PreviewState | undefined;
  onPreview: (preset: string) => void;
}) {
  const [place, setPlace] = useState('');
  const [preset, setPreset] = useState<MapPresetId>('vintage');
  const [width, setWidth] = useState('800');
  const [height, setHeight] = useState('600');

  function fillRandom() {
    setPlace(pick(MAP_PLACES));
    setPreset(pick(mapPresets));
  }

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
  const resolvedPlace = result.data?.resolvedPlace as {
    name: string;
    coordinates: [number, number];
    historicalContext?: Array<{ periodName: string }>;
  } | undefined;

  return (
    <SectionShell
      label="Map Image"
      description="Generates a styled map image for a place. Resolves the place name to coordinates, then renders using the selected visual preset (vintage, satellite, etc)."
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
        <button type="button" className={styles.randomizeButton} onClick={fillRandom}>
          <Shuffle size={14} aria-hidden="true" />
          Randomize
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

          <div className={styles.buttonRow} style={{ marginTop: 'var(--spacing-sm)' }}>
            <PreviewButton preview={preview} onPreview={() => onPreview(preset)} />
          </div>
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
  preview,
  onPreview,
}: {
  result: TestResult;
  onTest: (body: Record<string, unknown>) => void;
  disabled: boolean;
  imageModels: ImageModelInfo[];
  preview: PreviewState | undefined;
  onPreview: () => void;
}) {
  const [prompt, setPrompt] = useState('');
  const [model, setModel] = useState('');

  const groupedModels = {
    standard: imageModels.filter((m) => m.tier === 'standard'),
    high: imageModels.filter((m) => m.tier === 'high'),
    best: imageModels.filter((m) => m.tier === 'best'),
  };

  function fillRandom() {
    setPrompt(pick(ILLUSTRATION_PROMPTS));
  }

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
      description="Generates an AI image from a text prompt using Fal. Choose a model tier (standard is fastest, best is highest quality) to test different providers."
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
        <button type="button" className={styles.randomizeButton} onClick={fillRandom}>
          <Shuffle size={14} aria-hidden="true" />
          Randomize
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
          <div className={styles.buttonRow} style={{ marginTop: 'var(--spacing-sm)' }}>
            <PreviewButton preview={preview} onPreview={onPreview} />
          </div>
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
  preview,
  onPreview,
}: {
  result: TestResult;
  onTest: (body: Record<string, unknown>) => void;
  disabled: boolean;
  preview: PreviewState | undefined;
  onPreview: () => void;
}) {
  const [query, setQuery] = useState('');

  function fillRandom() {
    setQuery(pick(STOCK_QUERIES));
  }

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
      description="Searches Pexels for royalty-free video clips matching a query. Returns the top result with thumbnail, duration, and source link."
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
          {result.status === 'running' ? 'Searching…' : 'Search Videos'}
        </button>
        <button type="button" className={styles.randomizeButton} onClick={fillRandom}>
          <Shuffle size={14} aria-hidden="true" />
          Randomize
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
            <>
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
              <div className={styles.buttonRow} style={{ marginTop: 'var(--spacing-sm)' }}>
                <PreviewButton preview={preview} onPreview={onPreview} />
              </div>
            </>
          ) : (
            <span className={styles.errorText}>No results found for this query</span>
          )}
        </div>
      )}
    </SectionShell>
  );
}

// ── Preview All State ──

interface PreviewAllSegment {
  index: number;
  visualType: string;
  text: string;
  videoBase64?: string;
  error?: string;
}

interface PreviewAllState {
  loading: boolean;
  total: number;
  completed: number;
  error?: string;
  segments: PreviewAllSegment[];
}

const INITIAL_PREVIEW_ALL: PreviewAllState = {
  loading: false,
  total: 0,
  completed: 0,
  segments: [],
};

// ── Main Component ──

export function VideoTestBench({ envAvailability, mapPresets, imageModels, aiProviders }: VideoTestBenchProps) {
  const [results, setResults] = useState<Record<TestType, TestResult>>({
    'classify': { status: 'idle' },
    'resolve-place': { status: 'idle' },
    'map-image': { status: 'idle' },
    'ai-illustration': { status: 'idle' },
    'stock-footage': { status: 'idle' },
  });
  const [previews, setPreviews] = useState<Record<string, PreviewState>>({});
  const [previewAll, setPreviewAll] = useState<PreviewAllState>(INITIAL_PREVIEW_ALL);
  const [segmentsText, setSegmentsText] = useState('');

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

  // ── Per-section preview handlers ──

  const previewMapImage = useCallback(async (preset: string) => {
    const mapResult = results['map-image'];
    const mapImageBase64 = mapResult.data?.imageBase64 as string | undefined;
    const resolvedPlace = mapResult.data?.resolvedPlace as { name: string } | undefined;
    if (!mapImageBase64 || !resolvedPlace) return;

    setPreviews((prev) => ({ ...prev, 'map-image': { loading: true } }));
    try {
      const result = await renderClip({
        visualType: 'MAP_OVERLAY',
        text: resolvedPlace.name,
        assetUrl: mapImageBase64,
        metadata: { places: [resolvedPlace], preset },
      });
      setPreviews((prev) => ({ ...prev, 'map-image': { loading: false, ...result } }));
    } catch (err) {
      setPreviews((prev) => ({
        ...prev,
        'map-image': { loading: false, error: err instanceof Error ? err.message : 'Preview failed' },
      }));
    }
  }, [results]);

  const previewAiIllustration = useCallback(async () => {
    const aiResult = results['ai-illustration'];
    const aiImageBase64 = aiResult.data?.imageBase64 as string | undefined;
    if (!aiImageBase64) return;

    setPreviews((prev) => ({ ...prev, 'ai-illustration': { loading: true } }));
    try {
      const result = await renderClip({
        visualType: 'AI_ILLUSTRATION',
        text: 'AI Illustration',
        assetUrl: aiImageBase64,
        prompt: 'test',
      });
      setPreviews((prev) => ({ ...prev, 'ai-illustration': { loading: false, ...result } }));
    } catch (err) {
      setPreviews((prev) => ({
        ...prev,
        'ai-illustration': { loading: false, error: err instanceof Error ? err.message : 'Preview failed' },
      }));
    }
  }, [results]);

  const previewStockFootage = useCallback(async () => {
    const stockResult = results['stock-footage'];
    const stock = stockResult.data?.result as { url: string; thumbnailUrl: string; photographer: string } | null | undefined;
    if (!stock) return;

    setPreviews((prev) => ({ ...prev, 'stock-footage': { loading: true } }));
    try {
      // Use thumbnailUrl (image) instead of url (video) — ImageSlide uses Remotion Img which only loads images
      const result = await renderClip({
        visualType: 'STOCK_FOOTAGE',
        text: 'Stock Footage',
        assetUrl: stock.thumbnailUrl,
        metadata: { photographer: stock.photographer },
      });
      setPreviews((prev) => ({ ...prev, 'stock-footage': { loading: false, ...result } }));
    } catch (err) {
      setPreviews((prev) => ({
        ...prev,
        'stock-footage': { loading: false, error: err instanceof Error ? err.message : 'Preview failed' },
      }));
    }
  }, [results]);

  const previewPlaceAsMap = useCallback(async () => {
    const placeResult = results['resolve-place'];
    const place = placeResult.data?.result as { name: string; coordinates: [number, number] } | null | undefined;
    if (!place) return;

    setPreviews((prev) => ({ ...prev, 'resolve-place': { loading: true } }));
    try {
      // Step 1: Generate map image
      const mapRes = await fetch('/api/admin/test-video-pipeline', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'map-image', place: place.name, preset: 'vintage', width: 1280, height: 720 }),
      });
      const mapData = await mapRes.json();
      if (!mapData.success) throw new Error(mapData.error ?? 'Map generation failed');

      // Step 2: Render through Remotion
      const result = await renderClip({
        visualType: 'MAP_OVERLAY',
        text: place.name,
        assetUrl: mapData.imageBase64,
        metadata: { places: [place], preset: 'vintage' },
      });
      setPreviews((prev) => ({ ...prev, 'resolve-place': { loading: false, ...result } }));
    } catch (err) {
      setPreviews((prev) => ({
        ...prev,
        'resolve-place': { loading: false, error: err instanceof Error ? err.message : 'Preview failed' },
      }));
    }
  }, [results]);

  // ── Preview All handler (Phase 5) ──

  const handlePreviewAll = useCallback(async () => {
    const classifyResult = results['classify'];
    const classifications = classifyResult.data?.result as Array<{
      segmentId: string;
      order: number;
      subVisuals: Array<{
        subOrder: number;
        visualType: string;
        prompt: string | null;
        metadata?: Record<string, unknown>;
      }>;
    }> | undefined;
    if (!classifications) return;

    const segments = segmentsText.split('\n').map((s) => s.trim()).filter(Boolean);
    const previewSegments: PreviewAllSegment[] = classifications.map((seg, i) => {
      const sv = seg.subVisuals[0];
      return {
        index: i,
        visualType: sv?.visualType ?? 'TEXT_CARD',
        text: segments[i] ?? `Segment ${i}`,
      };
    });

    setPreviewAll({
      loading: true,
      total: previewSegments.length,
      completed: 0,
      segments: previewSegments,
    });

    // Process with concurrency limit of 3
    const queue = [...classifications.entries()];
    let completed = 0;
    let remotionError = false;

    async function processOne(segIdx: number, seg: NonNullable<typeof classifications>[number]) {
      const sv = seg.subVisuals[0];
      if (!sv) return;

      const text = segments[segIdx] ?? `Segment ${segIdx}`;
      const segmentInput: Record<string, unknown> = {
        visualType: sv.visualType,
        text,
        duration: 10,
      };

      try {
        // Programmatic types (TEXT_CARD, QUOTE, DATA_CHART, etc.) render from metadata alone
        if (sv.prompt) segmentInput.prompt = sv.prompt;
        if (sv.metadata) segmentInput.metadata = sv.metadata;

        // Types needing external assets — generate them first
        if (sv.visualType === 'AI_ILLUSTRATION' && sv.prompt && envAvailability.fal) {
          const imgRes = await fetch('/api/admin/test-video-pipeline', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: 'ai-illustration', prompt: sv.prompt }),
          });
          const imgData = await imgRes.json();
          if (imgData.success) segmentInput.assetUrl = imgData.imageBase64;
        } else if (sv.visualType === 'STOCK_FOOTAGE' && sv.prompt && envAvailability.pexels) {
          const stockRes = await fetch('/api/admin/test-video-pipeline', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: 'stock-footage', query: sv.prompt }),
          });
          const stockData = await stockRes.json();
          if (stockData.success && stockData.result?.thumbnailUrl) {
            segmentInput.assetUrl = stockData.result.thumbnailUrl;
          }
        } else if (sv.visualType === 'MAP_OVERLAY' && envAvailability.mapbox) {
          // Extract place name from prompt or text
          const placeName = sv.prompt ?? text.slice(0, 50);
          const mapRes = await fetch('/api/admin/test-video-pipeline', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: 'map-image', place: placeName, preset: 'vintage', width: 1280, height: 720 }),
          });
          const mapData = await mapRes.json();
          if (mapData.success) {
            segmentInput.assetUrl = mapData.imageBase64;
            if (mapData.resolvedPlace) {
              segmentInput.metadata = { places: [mapData.resolvedPlace], preset: 'vintage' };
            }
          }
        }

        if (remotionError) {
          throw new Error('Remotion unreachable');
        }

        const result = await renderClip(segmentInput);
        setPreviewAll((prev) => ({
          ...prev,
          completed: ++completed,
          segments: prev.segments.map((s) =>
            s.index === segIdx ? { ...s, videoBase64: result.videoBase64 } : s,
          ),
        }));
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Failed';
        if (msg.includes('REMOTION_URL') || msg.includes('ECONNREFUSED') || msg.includes('fetch failed')) {
          remotionError = true;
        }
        setPreviewAll((prev) => ({
          ...prev,
          completed: ++completed,
          segments: prev.segments.map((s) =>
            s.index === segIdx ? { ...s, error: msg } : s,
          ),
          ...(remotionError ? { error: 'Remotion sidecar unreachable' } : {}),
        }));
      }
    }

    // Concurrency-limited execution (3 at a time)
    const pending: Promise<void>[] = [];
    for (const [idx, seg] of queue) {
      const p = processOne(idx, seg);
      pending.push(p);
      if (pending.length >= 3) {
        await Promise.race(pending);
        // Remove settled promises
        for (let i = pending.length - 1; i >= 0; i--) {
          const status = await Promise.race([pending[i].then(() => 'done'), Promise.resolve('pending')]);
          if (status === 'done') pending.splice(i, 1);
        }
      }
      if (remotionError) break;
    }
    await Promise.allSettled(pending);

    setPreviewAll((prev) => ({ ...prev, loading: false }));
  }, [results, segmentsText, envAvailability]);

  return (
    <div className={styles.panel}>
      <ClassifierSection
        result={results['classify']}
        onTest={runTest}
        disabled={aiProviders.length === 0}
        aiProviders={aiProviders}
        segmentsText={segmentsText}
        onSegmentsTextChange={setSegmentsText}
        onPreviewAll={handlePreviewAll}
        previewAllState={previewAll}
      />
      <PlaceResolverSection
        result={results['resolve-place']}
        onTest={runTest}
        preview={previews['resolve-place']}
        onPreview={previewPlaceAsMap}
      />
      <MapImageSection
        result={results['map-image']}
        onTest={runTest}
        disabled={!envAvailability.mapbox}
        mapPresets={mapPresets}
        preview={previews['map-image']}
        onPreview={previewMapImage}
      />
      <AIIllustrationSection
        result={results['ai-illustration']}
        onTest={runTest}
        disabled={!envAvailability.fal}
        imageModels={imageModels}
        preview={previews['ai-illustration']}
        onPreview={previewAiIllustration}
      />
      <StockFootageSection
        result={results['stock-footage']}
        onTest={runTest}
        disabled={!envAvailability.pexels}
        preview={previews['stock-footage']}
        onPreview={previewStockFootage}
      />
    </div>
  );
}
