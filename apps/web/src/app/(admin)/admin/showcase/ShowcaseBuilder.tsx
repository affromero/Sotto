'use client';

import { useState, useCallback, useEffect } from 'react';
import styles from './ShowcaseBuilder.module.css';

interface ProviderModel {
  id: string;
  displayName: string;
}

interface ProviderInfo {
  id: string;
  displayName: string;
  qualityTier: string;
  defaultModel: string;
  models: ProviderModel[];
}

interface PodcastOption {
  id: string;
  title: string;
  status: string;
  ttsProvider: string | null;
  segmentCount: number;
  updatedAt: string;
}

interface SegmentData {
  id: string;
  order: number;
  speaker: string;
  text: string;
  audioUrl: string | null;
  duration: number | null;
  ttsProvider: string | null;
  ttsModel: string | null;
  ttsVoiceId: string | null;
}

interface CatalogVoice {
  id: string;
  name: string;
  gender?: string;
  age?: string;
  accent?: string;
  description?: string;
}

interface Boundary {
  afterSegmentId: string;
  beforeSegmentId: string;
  afterOrder: number;
  beforeOrder: number;
  fromProvider: string | null;
  toProvider: string | null;
}

type Status = 'idle' | 'loading' | 'saving' | 'generating' | 'success' | 'error';

const PROVIDER_COLORS: Record<string, string> = {
  elevenlabs: '#6366f1',
  openai: '#10a37f',
  cartesia: '#e11d48',
  hume: '#f59e0b',
  fal: '#8b5cf6',
  replicate: '#3b82f6',
  minimax: '#ec4899',
  kittentts: '#6b7280',
};

interface ShowcaseBuilderProps {
  providers: ProviderInfo[];
}

export function ShowcaseBuilder({ providers }: ShowcaseBuilderProps) {
  const [podcasts, setPodcasts] = useState<PodcastOption[]>([]);
  const [selectedPodcastId, setSelectedPodcastId] = useState<string>('');
  const [segments, setSegments] = useState<SegmentData[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [voiceCache, setVoiceCache] = useState<Record<string, CatalogVoice[]>>({});
  const [boundaries, setBoundaries] = useState<Boundary[]>([]);
  const [status, setStatus] = useState<Status>('idle');
  const [message, setMessage] = useState('');

  // Fetch eligible podcasts on mount
  useEffect(() => {
    fetch('/api/admin/showcase')
      .then((r) => r.json())
      .then((d) => setPodcasts(d.podcasts ?? []))
      .catch(() => setMessage('Failed to load podcasts'));
  }, []);

  // Load segments when podcast is selected
  const loadSegments = useCallback(async (podcastId: string) => {
    setSelectedPodcastId(podcastId);
    setSelected(new Set());
    setBoundaries([]);
    if (!podcastId) {
      setSegments([]);
      return;
    }
    setStatus('loading');
    try {
      const res = await fetch(`/api/admin/showcase/${podcastId}/segments`);
      const data = await res.json();
      setSegments(data.segments ?? []);
      setStatus('idle');
    } catch {
      setMessage('Failed to load segments');
      setStatus('error');
    }
  }, []);

  // Fetch voice catalog for a provider (cached)
  const getVoices = useCallback(async (providerId: string): Promise<CatalogVoice[]> => {
    if (voiceCache[providerId]) return voiceCache[providerId];
    try {
      const res = await fetch(`/api/admin/showcase/voices?provider=${providerId}`);
      const data = await res.json();
      const voices = data.voices ?? [];
      setVoiceCache((prev) => ({ ...prev, [providerId]: voices }));
      return voices;
    } catch {
      return [];
    }
  }, [voiceCache]);

  // Update a single segment's assignment
  const updateSegment = useCallback((segmentId: string, field: string, value: string | null) => {
    setSegments((prev) =>
      prev.map((s) => (s.id === segmentId ? { ...s, [field]: value } : s))
    );
  }, []);

  // Handle provider change for a segment — load voices
  const handleProviderChange = useCallback(async (segmentId: string, providerId: string) => {
    updateSegment(segmentId, 'ttsProvider', providerId || null);
    updateSegment(segmentId, 'ttsModel', null);
    updateSegment(segmentId, 'ttsVoiceId', null);
    if (providerId) {
      await getVoices(providerId);
    }
  }, [updateSegment, getVoices]);

  // Toggle segment selection
  const toggleSelect = useCallback((segmentId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(segmentId)) next.delete(segmentId);
      else next.add(segmentId);
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    if (selected.size === segments.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(segments.map((s) => s.id)));
    }
  }, [selected.size, segments]);

  // Bulk assign provider to selected segments
  const bulkAssign = useCallback(async (providerId: string) => {
    if (!providerId || selected.size === 0) return;
    await getVoices(providerId);
    setSegments((prev) =>
      prev.map((s) =>
        selected.has(s.id)
          ? { ...s, ttsProvider: providerId, ttsModel: null, ttsVoiceId: null }
          : s
      )
    );
  }, [selected, getVoices]);

  // Save assignments
  const saveAssignments = useCallback(async () => {
    if (!selectedPodcastId) return;
    setStatus('saving');
    setMessage('');
    try {
      const assignments = segments
        .filter((s) => s.ttsProvider)
        .map((s) => ({
          segmentId: s.id,
          ttsProvider: s.ttsProvider!,
          ttsModel: s.ttsModel ?? undefined,
          ttsVoiceId: s.ttsVoiceId ?? undefined,
        }));

      const res = await fetch(`/api/admin/showcase/${selectedPodcastId}/segments`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assignments }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error ?? 'Save failed');
      }
      setMessage(`Saved ${assignments.length} assignments`);
      setStatus('success');

      // Refresh boundaries
      const bRes = await fetch(`/api/admin/showcase/${selectedPodcastId}/boundaries`);
      const bData = await bRes.json();
      setBoundaries(bData.boundaries ?? []);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Save failed');
      setStatus('error');
    }
  }, [selectedPodcastId, segments]);

  // Generate audio
  const generateAudio = useCallback(async () => {
    if (!selectedPodcastId) return;
    setStatus('generating');
    setMessage('');
    try {
      const res = await fetch(`/api/admin/showcase/${selectedPodcastId}/generate`, {
        method: 'POST',
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error ?? 'Generate failed');
      }
      const data = await res.json();
      setMessage(`Queued ${data.queued} segments for audio generation`);
      setStatus('success');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Generate failed');
      setStatus('error');
    }
  }, [selectedPodcastId]);

  // Generate video with transitions at provider boundaries
  const generateVideo = useCallback(async () => {
    if (!selectedPodcastId) return;
    setStatus('generating');
    setMessage('');
    try {
      const res = await fetch(`/api/admin/showcase/${selectedPodcastId}/video`, {
        method: 'POST',
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error ?? 'Video trigger failed');
      }
      const data = await res.json();
      setMessage(`Video pipeline started — ${data.transitionsCreated} provider transition(s) created`);
      setStatus('success');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Video trigger failed');
      setStatus('error');
    }
  }, [selectedPodcastId]);

  const providerMap = Object.fromEntries(providers.map((p) => [p.id, p]));

  // Find boundary after a segment
  const getBoundaryAfter = (segmentId: string) =>
    boundaries.find((b) => b.afterSegmentId === segmentId);

  return (
    <div className={styles.root}>
      {/* Podcast selector */}
      <fieldset className={styles.fieldset}>
        <legend className={styles.legend}>Select Podcast</legend>
        <select
          className={styles.select}
          value={selectedPodcastId}
          onChange={(e) => loadSegments(e.target.value)}
          aria-label="Select a podcast"
        >
          <option value="">— Choose a podcast —</option>
          {podcasts.map((p) => (
            <option key={p.id} value={p.id}>
              {p.title} ({p.segmentCount} segments, {p.status})
            </option>
          ))}
        </select>
      </fieldset>

      {segments.length > 0 && (
        <>
          {/* Range assignment toolbar */}
          <div className={styles.toolbar}>
            <label className={styles.toolbarLabel}>
              <input
                type="checkbox"
                checked={selected.size === segments.length && segments.length > 0}
                onChange={selectAll}
                aria-label="Select all segments"
              />
              {selected.size > 0 ? `${selected.size} selected` : 'Select all'}
            </label>
            {selected.size > 0 && (
              <select
                className={styles.selectSmall}
                defaultValue=""
                onChange={(e) => {
                  bulkAssign(e.target.value);
                  e.target.value = '';
                }}
                aria-label="Assign provider to selected segments"
              >
                <option value="" disabled>Assign provider…</option>
                {providers.map((p) => (
                  <option key={p.id} value={p.id}>{p.displayName}</option>
                ))}
              </select>
            )}
          </div>

          {/* Segment list */}
          <div className={styles.segmentList} role="list" aria-label="Podcast segments">
            {segments.map((seg) => {
              const boundary = getBoundaryAfter(seg.id);
              return (
                <div key={seg.id}>
                  <div
                    className={styles.segmentCard}
                    role="listitem"
                    data-has-provider={!!seg.ttsProvider}
                  >
                    <div className={styles.segmentHeader}>
                      <input
                        type="checkbox"
                        checked={selected.has(seg.id)}
                        onChange={() => toggleSelect(seg.id)}
                        aria-label={`Select segment ${seg.order}`}
                      />
                      <span className={styles.segmentOrder}>#{seg.order}</span>
                      <span className={styles.segmentSpeaker}>{seg.speaker}</span>
                      {seg.ttsProvider && (
                        <span
                          className={styles.providerBadge}
                          style={{ backgroundColor: PROVIDER_COLORS[seg.ttsProvider] ?? '#6b7280' }}
                        >
                          {providerMap[seg.ttsProvider]?.displayName ?? seg.ttsProvider}
                        </span>
                      )}
                      {seg.audioUrl && (
                        <span className={styles.audioBadge}>Has Audio</span>
                      )}
                    </div>

                    <p className={styles.segmentText}>
                      {seg.text.length > 150 ? `${seg.text.slice(0, 150)}…` : seg.text}
                    </p>

                    <div className={styles.segmentControls}>
                      <select
                        className={styles.selectSmall}
                        value={seg.ttsProvider ?? ''}
                        onChange={(e) => handleProviderChange(seg.id, e.target.value)}
                        aria-label={`Provider for segment ${seg.order}`}
                      >
                        <option value="">— Provider —</option>
                        {providers.map((p) => (
                          <option key={p.id} value={p.id}>{p.displayName}</option>
                        ))}
                      </select>

                      {seg.ttsProvider && providerMap[seg.ttsProvider] && (
                        <select
                          className={styles.selectSmall}
                          value={seg.ttsModel ?? ''}
                          onChange={(e) => updateSegment(seg.id, 'ttsModel', e.target.value || null)}
                          aria-label={`Model for segment ${seg.order}`}
                        >
                          <option value="">Default model</option>
                          {providerMap[seg.ttsProvider].models.map((m) => (
                            <option key={m.id} value={m.id}>{m.displayName}</option>
                          ))}
                        </select>
                      )}

                      {seg.ttsProvider && voiceCache[seg.ttsProvider] && (
                        <select
                          className={styles.selectSmall}
                          value={seg.ttsVoiceId ?? ''}
                          onChange={(e) => updateSegment(seg.id, 'ttsVoiceId', e.target.value || null)}
                          aria-label={`Voice for segment ${seg.order}`}
                        >
                          <option value="">Auto-assign voice</option>
                          {voiceCache[seg.ttsProvider].map((v) => (
                            <option key={v.id} value={v.id}>
                              {v.name}{v.gender ? ` (${v.gender})` : ''}
                            </option>
                          ))}
                        </select>
                      )}
                    </div>
                  </div>

                  {/* Provider boundary indicator */}
                  {boundary && (
                    <div className={styles.boundary} aria-label="Provider transition boundary">
                      <span
                        className={styles.boundaryDot}
                        style={{ backgroundColor: PROVIDER_COLORS[boundary.fromProvider ?? ''] ?? '#6b7280' }}
                      />
                      <span className={styles.boundaryLine} />
                      <span className={styles.boundaryLabel}>
                        {providerMap[boundary.fromProvider ?? '']?.displayName ?? boundary.fromProvider}
                        {' → '}
                        {providerMap[boundary.toProvider ?? '']?.displayName ?? boundary.toProvider}
                      </span>
                      <span className={styles.boundaryLine} />
                      <span
                        className={styles.boundaryDot}
                        style={{ backgroundColor: PROVIDER_COLORS[boundary.toProvider ?? ''] ?? '#6b7280' }}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Actions bar */}
          <div className={styles.actions}>
            <button
              type="button"
              className={styles.btnPrimary}
              onClick={saveAssignments}
              disabled={status === 'saving' || status === 'generating'}
            >
              {status === 'saving' ? 'Saving…' : 'Save Assignments'}
            </button>
            <button
              type="button"
              className={styles.btnSecondary}
              onClick={generateAudio}
              disabled={status === 'saving' || status === 'generating'}
            >
              {status === 'generating' ? 'Generating…' : 'Generate Audio'}
            </button>
            <button
              type="button"
              className={styles.btnSecondary}
              onClick={generateVideo}
              disabled={status === 'saving' || status === 'generating'}
            >
              Generate Video
            </button>
          </div>

          {/* Status banner */}
          {message && (
            <div
              className={styles.banner}
              data-variant={status === 'error' ? 'error' : 'success'}
              role="alert"
            >
              {message}
            </div>
          )}
        </>
      )}
    </div>
  );
}
