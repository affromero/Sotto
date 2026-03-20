'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { User, Search, ChevronDown, ChevronUp } from 'lucide-react';
import { estimateAvatarCost, formatAvatarCost } from '@/lib/avatar-cost-estimator';
import type { UnifiedAvatarData } from '@/types/avatar';
import type { SegmentData } from '@/types/podcast';
import type { VoiceTrackSummary } from '@sotto/shared';
import styles from './AvatarPicker.module.css';

export interface ExistingAvatarOverlay {
  speaker: string;
  avatarId: string;
  avatarProvider: 'heygen' | 'runway' | 'fal';
  status: string;
  isPreset?: boolean;
}

interface AvatarPickerProps {
  podcastId: string;
  speakers: string[];
  segments: SegmentData[];
  onConfigured: (data: { videoGenerationId: string; generationStarted: boolean }) => void;
  onCancel: () => void;
  existingOverlays?: ExistingAvatarOverlay[];
}

const VISIBLE_COUNT = 12;

/** Lip-sync models that require a user-uploaded portrait image (from avatar-registry). */
const IMAGE_REQUIRED_MODELS = new Set(['fal-veed-fabric-1.0', 'fal-kling-avatar-v2-pro']);

interface AvatarSelection {
  avatarId: string;
  provider: 'heygen' | 'runway' | 'fal';
  isPreset: boolean;
  imageUrl?: string;
}

interface AvatarPricing {
  costPerMinute: number;
  includedOnPlatform: boolean;
}

interface AvatarModelOption {
  modelId: string;
  displayName: string;
  costPerMinute: number;
  maxDuration: number | null;
}

// Build a lookup of currently-assigned avatar IDs per speaker from existing overlays
function buildCurrentAvatarMap(overlays?: ExistingAvatarOverlay[]): Record<string, string> {
  if (!overlays?.length) return {};
  const map: Record<string, string> = {};
  for (const ov of overlays) {
    map[ov.speaker] = ov.avatarId;
  }
  return map;
}

export function AvatarPicker({ podcastId, speakers, segments, onConfigured, onCancel, existingOverlays }: AvatarPickerProps) {
  const currentAvatarMap = useMemo(() => buildCurrentAvatarMap(existingOverlays), [existingOverlays]);
  const [avatars, setAvatars] = useState<UnifiedAvatarData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selections, setSelections] = useState<Record<string, AvatarSelection>>(() => {
    if (!existingOverlays?.length) return {};
    const initial: Record<string, AvatarSelection> = {};
    for (const ov of existingOverlays) {
      initial[ov.speaker] = { avatarId: ov.avatarId, provider: ov.avatarProvider, isPreset: ov.isPreset ?? false };
    }
    return initial;
  });
  const [submitting, setSubmitting] = useState(false);
  const [search, setSearch] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [falModelId, setFalModelId] = useState('');
  // Per-speaker segment enablement: empty = all enabled (default)
  const [enabledSegments, setEnabledSegments] = useState<Record<string, Set<string>>>({});
  const [activeProvider, setActiveProvider] = useState<'heygen' | 'runway' | 'fal' | null>(
    existingOverlays?.some((ov) => ov.avatarProvider === 'fal') ? 'fal'
      : existingOverlays?.some((ov) => ov.avatarProvider === 'runway') ? 'runway'
        : existingOverlays?.some((ov) => ov.avatarProvider === 'heygen') ? 'heygen' : null,
  );
  const [availableProviders, setAvailableProviders] = useState<{ heygen: boolean; runway: boolean; fal: boolean }>({ heygen: false, runway: false, fal: false });
  const [pricing, setPricing] = useState<AvatarPricing>({ costPerMinute: 0, includedOnPlatform: false });
  const [providerModels, setProviderModels] = useState<AvatarModelOption[]>([]);
  const [voiceTracks, setVoiceTracks] = useState<VoiceTrackSummary[]>([]);
  const [voiceTrackSelections, setVoiceTrackSelections] = useState<Record<string, string>>({});
  // Track whether the initial default provider has been resolved from the API
  const defaultResolvedRef = useRef(!!activeProvider);
  const falModelIdRef = useRef(falModelId);
  falModelIdRef.current = falModelId;

  useEffect(() => {
    const providerParam = activeProvider ? `&provider=${activeProvider}` : '';
    fetch(`/api/podcasts/${podcastId}/video/avatars?_=1${providerParam}`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error('Failed to load avatars'))))
      .then((data: {
        avatars: UnifiedAvatarData[];
        providers: { heygen: boolean; runway: boolean; fal: boolean };
        defaultProvider?: 'heygen' | 'runway' | 'fal';
        defaultModel?: string;
        models?: AvatarModelOption[];
        pricing?: AvatarPricing;
      }) => {
        setAvatars(data.avatars);
        setAvailableProviders(data.providers);
        if (data.pricing) setPricing(data.pricing);
        if (data.models) setProviderModels(data.models);
        // On first load, set provider and model from config defaults
        if (!defaultResolvedRef.current && data.defaultProvider) {
          setActiveProvider(data.defaultProvider);
          defaultResolvedRef.current = true;
          if (data.defaultModel) setFalModelId(data.defaultModel);
        }
        // Set fal model default from config if not yet set
        if (!falModelIdRef.current && data.defaultModel) {
          setFalModelId(data.defaultModel);
        }
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load avatars'))
      .finally(() => setLoading(false));
  }, [podcastId, activeProvider]);

  // Fetch ready voice tracks for audio source selection
  useEffect(() => {
    fetch(`/api/podcasts/${podcastId}/voice-tracks`)
      .then((res) => (res.ok ? res.json() : []))
      .then((tracks: VoiceTrackSummary[]) => {
        setVoiceTracks(tracks.filter((t) => t.status === 'READY'));
      })
      .catch(() => {});
  }, [podcastId]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = q ? avatars.filter((a) => a.name.toLowerCase().includes(q)) : avatars;
    return list.slice(0, VISIBLE_COUNT);
  }, [avatars, search]);

  // Group segments by speaker for the advanced settings UI
  const segmentsBySpeaker = useMemo(() => {
    const map: Record<string, SegmentData[]> = {};
    for (const seg of segments) {
      (map[seg.speaker] ??= []).push(seg);
    }
    return map;
  }, [segments]);

  const handleSelect = useCallback((speaker: string, avatar: UnifiedAvatarData) => {
    setSelections((prev) => {
      if (prev[speaker]?.avatarId === avatar.id) {
        const next = { ...prev };
        delete next[speaker];
        return next;
      }
      return { ...prev, [speaker]: { avatarId: avatar.id, provider: avatar.provider, isPreset: avatar.isPreset, imageUrl: avatar.imageUrl } };
    });
  }, []);

  const handleToggleSegment = useCallback((speaker: string, segmentId: string) => {
    setEnabledSegments((prev) => {
      const speakerSegs = segmentsBySpeaker[speaker] ?? [];
      const current = prev[speaker] ?? new Set(speakerSegs.map((s) => s.id));
      const next = new Set(current);
      if (next.has(segmentId)) {
        next.delete(segmentId);
      } else {
        next.add(segmentId);
      }
      return { ...prev, [speaker]: next };
    });
  }, [segmentsBySpeaker]);

  const handleToggleAllSegments = useCallback((speaker: string, enable: boolean) => {
    setEnabledSegments((prev) => {
      const speakerSegs = segmentsBySpeaker[speaker] ?? [];
      return { ...prev, [speaker]: enable ? new Set(speakerSegs.map((s) => s.id)) : new Set() };
    });
  }, [segmentsBySpeaker]);

  const handleSubmit = useCallback(async () => {
    const configured = Object.entries(selections).map(([speaker, sel]) => {
      const speakerSegs = segmentsBySpeaker[speaker] ?? [];
      const enabled = enabledSegments[speaker];
      // Only send enabledSegmentIds if user customized (not all enabled)
      const allEnabled = !enabled || enabled.size === speakerSegs.length;
      return {
        speaker,
        avatarId: sel.avatarId || undefined,
        avatarProvider: sel.provider,
        avatarImageUrl: sel.imageUrl || undefined,
        avatarModelId: sel.provider === 'fal' && falModelId ? falModelId : undefined,
        isPreset: sel.isPreset,
        enabledSegmentIds: allEnabled ? undefined : [...enabled],
        voiceTrackId: voiceTrackSelections[speaker] || undefined,
      };
    });
    if (configured.length === 0) return;

    setSubmitting(true);
    try {
      const res = await fetch(`/api/podcasts/${podcastId}/video/avatars`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ avatars: configured }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        setError(body.error || 'Failed to configure avatars');
        return;
      }
      const data = await res.json() as { videoGenerationId: string; generationStarted: boolean };
      onConfigured({ videoGenerationId: data.videoGenerationId, generationStarted: data.generationStarted });
    } catch {
      setError('Network error');
    } finally {
      setSubmitting(false);
    }
  }, [selections, podcastId, onConfigured, segmentsBySpeaker, enabledSegments, falModelId, voiceTrackSelections]);

  const selectedCount = Object.keys(selections).length;
  const estimatedCost = useMemo(() => {
    let total = 0;
    for (const speaker of Object.keys(selections)) {
      const speakerSegs = segmentsBySpeaker[speaker] ?? [];
      const enabled = enabledSegments[speaker];
      // No custom enablement → all segments for this speaker
      const activeSegs = !enabled ? speakerSegs : speakerSegs.filter((s) => enabled.has(s.id));
      const duration = activeSegs.reduce((sum, s) => sum + (s.duration ?? 0), 0);
      total += estimateAvatarCost(duration, 1, pricing.costPerMinute);
    }
    return total;
  }, [selections, segmentsBySpeaker, enabledSegments, pricing.costPerMinute]);

  if (loading) {
    return (
      <div className={styles.root}>
        <p className={styles.loading}>Loading avatars...</p>
      </div>
    );
  }

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <h3 className={styles.title}>Choose Avatars</h3>
      </div>

      {error && <p className={styles.error}>{error}</p>}

      <div className={styles.providerTabs}>
        {availableProviders.heygen && (
          <button
            className={`${styles.providerTab} ${activeProvider === 'heygen' ? styles.providerTabActive : ''}`}
            onClick={() => { setActiveProvider('heygen'); setLoading(true); }}
            type="button"
          >
            HeyGen
          </button>
        )}
        {availableProviders.fal && (
          <button
            className={`${styles.providerTab} ${activeProvider === 'fal' ? styles.providerTabActive : ''}`}
            onClick={() => { setActiveProvider('fal'); setLoading(true); }}
            type="button"
          >
            Fal Lip-Sync
          </button>
        )}
        {availableProviders.runway && (
          <button
            className={`${styles.providerTab} ${styles.providerTabDisabled}`}
            type="button"
            disabled
            title="Conversational AI only — audio-driven lip sync not available via API"
          >
            Runway <span className={styles.notReadyBadge}>Not Ready</span>
          </button>
        )}
      </div>

      {activeProvider === 'fal' && providerModels.length > 0 && (
        <div className={styles.falModelRow}>
          <label className={styles.falModelLabel}>Lip-sync model</label>
          <select
            className={styles.falModelSelect}
            value={falModelId}
            onChange={(e) => setFalModelId(e.target.value)}
          >
            {providerModels.map((m) => (
              <option key={m.modelId} value={m.modelId}>
                {m.displayName} — ${m.costPerMinute.toFixed(2)}/min
                {m.maxDuration ? `, up to ${Math.round(m.maxDuration / 60)}min` : ''}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className={styles.searchRow}>
        <Search size={14} className={styles.searchIcon} />
        <input
          className={styles.searchInput}
          type="text"
          placeholder={`Search ${avatars.length} avatars...`}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className={styles.speakerColumns}>
        {speakers.map((speaker) => (
          <div key={speaker} className={styles.speakerColumn}>
            <h4 className={styles.speakerLabel}>
              <User size={14} />
              {speaker}
            </h4>
            {voiceTracks.length > 0 && (
              <select
                className={styles.voiceTrackSelect}
                value={voiceTrackSelections[speaker] ?? ''}
                onChange={(e) => setVoiceTrackSelections((prev) => ({ ...prev, [speaker]: e.target.value }))}
                aria-label={`${speaker} audio source`}
              >
                <option value="">Original audio</option>
                {voiceTracks.map((vt) => (
                  <option key={vt.id} value={vt.id}>{vt.name}</option>
                ))}
              </select>
            )}
            <div className={styles.avatarGrid}>
              {filtered.map((avatar) => (
                <button
                  key={avatar.id}
                  className={`${styles.avatarCard} ${selections[speaker]?.avatarId === avatar.id ? styles.avatarCardSelected : ''}`}
                  onClick={() => handleSelect(speaker, avatar)}
                  type="button"
                  aria-pressed={selections[speaker]?.avatarId === avatar.id}
                >
                  {avatar.previewImageUrl ? (
                    <img
                      src={avatar.previewImageUrl}
                      alt={avatar.name}
                      width={80}
                      height={80}
                      className={styles.avatarImage}
                      loading="lazy"
                    />
                  ) : (
                    <div className={styles.avatarPlaceholder}>
                      <User size={24} />
                    </div>
                  )}
                  <span className={styles.avatarName}>{avatar.name}</span>
                  {currentAvatarMap[speaker] === avatar.id && (
                    <span className={styles.currentBadge}>Current</span>
                  )}
                  {avatar.provider === 'runway' && (
                    <span className={styles.providerBadge}>Runway</span>
                  )}
                </button>
              ))}
            </div>
            {filtered.length === 0 && search && (
              <p className={styles.noResults}>No avatars match &ldquo;{search}&rdquo;</p>
            )}
          </div>
        ))}
      </div>

      {activeProvider === 'heygen' && (
        <p className={styles.browseLink}>
          Browse all avatars at{' '}
          <a href="https://www.heygen.com/avatars" target="_blank" rel="noopener noreferrer">
            heygen.com/avatars
          </a>
        </p>
      )}

      {activeProvider === 'fal' && avatars.length === 0 && (
        <p className={styles.runwayNotice}>
          Upload avatar images in <a href="/settings#avatar-images" className={styles.runwayNoticeLink}>Settings &rarr; Avatar Images</a> to get started. Verified users only.
        </p>
      )}

      {activeProvider === 'fal' && falModelId && IMAGE_REQUIRED_MODELS.has(falModelId) && (
        <p className={styles.modelNote}>This model uses your uploaded portrait image</p>
      )}

      <div className={styles.advancedSection}>
        <button
          className={styles.advancedToggle}
          onClick={() => setShowAdvanced(!showAdvanced)}
          type="button"
          aria-expanded={showAdvanced}
        >
          <span>Segment visibility</span>
          {showAdvanced ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
        {showAdvanced && (
          <div className={styles.segmentToggles}>
            <p className={styles.advancedHint}>
              Choose which segments the avatar appears on. Fewer segments = lower cost.
            </p>
            {selectedCount === 0 ? (
              <p className={styles.advancedHint}>Select avatars above to configure per-segment visibility.</p>
            ) : (
              speakers.filter((sp) => selections[sp]).map((speaker) => {
                const speakerSegs = segmentsBySpeaker[speaker] ?? [];
                const enabled = enabledSegments[speaker] ?? new Set(speakerSegs.map((s) => s.id));
                const allOn = enabled.size === speakerSegs.length;
                return (
                  <div key={speaker} className={styles.segmentSpeakerGroup}>
                    <div className={styles.segmentSpeakerHeader}>
                      <span className={styles.segmentSpeakerName}>{speaker}</span>
                      <button
                        className={styles.segmentToggleAll}
                        onClick={() => handleToggleAllSegments(speaker, !allOn)}
                        type="button"
                      >
                        {allOn ? 'Deselect all' : 'Select all'}
                      </button>
                    </div>
                    <div className={styles.segmentList}>
                      {speakerSegs.map((seg) => (
                        <label key={seg.id} className={styles.segmentItem}>
                          <input
                            type="checkbox"
                            checked={enabled.has(seg.id)}
                            onChange={() => handleToggleSegment(speaker, seg.id)}
                            className={styles.segmentCheckbox}
                          />
                          <span className={styles.segmentOrder}>#{seg.order}</span>
                          <span className={styles.segmentText}>
                            {seg.text.length > 60 ? `${seg.text.slice(0, 60)}...` : seg.text}
                          </span>
                          {seg.duration && (
                            <span className={styles.segmentDuration}>
                              {Math.round(seg.duration)}s
                            </span>
                          )}
                        </label>
                      ))}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>

      <div className={styles.footer}>
        <p className={styles.costEstimate}>
          {selectedCount > 0
            ? (
              <>
                {selectedCount} avatar{selectedCount > 1 ? 's' : ''}
                {pricing.includedOnPlatform
                  ? <>, <span className={styles.costLabel}>Included</span> &middot; est. {formatAvatarCost(estimatedCost)} on us</>
                  : <>, est. {formatAvatarCost(estimatedCost)}</>
                }
              </>
            )
            : 'Select avatars for each speaker'}
        </p>
        <div className={styles.footerActions}>
          <button className={styles.cancelBtn} onClick={onCancel} type="button">
            Cancel
          </button>
          <button
            className={styles.submitBtn}
            onClick={handleSubmit}
            disabled={selectedCount === 0 || submitting}
            type="button"
          >
            {submitting ? 'Configuring...' : existingOverlays?.length ? 'Update Avatars' : 'Add Avatars'}
          </button>
        </div>
      </div>
    </div>
  );
}
