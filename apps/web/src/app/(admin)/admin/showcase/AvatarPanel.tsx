'use client';

import { useState, useCallback, useEffect } from 'react';
import styles from './AvatarPanel.module.css';

interface UnifiedAvatar {
  id: string;
  name: string;
  previewImageUrl: string;
  provider: 'heygen' | 'runway';
  isPreset: boolean;
  premium: boolean;
}

interface AvatarOverlay {
  id: string;
  speaker: string;
  avatarId: string;
  avatarName: string | null;
  previewImageUrl: string | null;
  videoUrl: string | null;
  status: string;
  posX: number;
  posY: number;
  width: number;
  height: number;
  durationSeconds: number | null;
  avatarProvider: string | null;
  maskShape: string | null;
}

interface SpeakerConfig {
  speaker: string;
  avatarId: string;
  avatarProvider: 'heygen' | 'runway';
  posX: number;
  posY: number;
  width: number;
  height: number;
  maskShape: string;
}

const MASK_SHAPES = ['none', 'rounded', 'circle', 'hexagon', 'diamond', 'blob', 'squircle'] as const;

const DEFAULT_POSITION = { posX: 0.02, posY: 0.55, width: 0.25, height: 0.35 };

interface AvatarPanelProps {
  podcastId: string;
  avatarsVisible: boolean;
  onAvatarsVisibleChange: (visible: boolean) => void;
}

export function AvatarPanel({ podcastId, avatarsVisible, onAvatarsVisibleChange }: AvatarPanelProps) {
  const [avatars, setAvatars] = useState<UnifiedAvatar[]>([]);
  const [overlays, setOverlays] = useState<AvatarOverlay[]>([]);
  const [provider, setProvider] = useState<'heygen' | 'runway'>('heygen');
  const [providers, setProviders] = useState<{ heygen: boolean; runway: boolean }>({ heygen: false, runway: false });
  const [speakers, setSpeakers] = useState<string[]>([]);
  const [configs, setConfigs] = useState<Record<string, SpeakerConfig>>({});
  const [status, setStatus] = useState<'idle' | 'loading' | 'saving' | 'error'>('idle');
  const [message, setMessage] = useState('');

  // Fetch available avatars
  const fetchAvatars = useCallback(async (prov: 'heygen' | 'runway') => {
    setStatus('loading');
    try {
      const res = await fetch(`/api/podcasts/${podcastId}/video/avatars?provider=${prov}`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error ?? `Failed to load avatars (${res.status})`);
      }
      const data = await res.json();
      setAvatars(data.avatars ?? []);
      setProviders(data.providers ?? { heygen: false, runway: false });
      setStatus('idle');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Failed to load avatars');
      setStatus('error');
    }
  }, [podcastId]);

  // Fetch existing overlays from video generation
  const fetchOverlays = useCallback(async () => {
    try {
      const res = await fetch(`/api/podcasts/${podcastId}/video`);
      if (!res.ok) return;
      const data = await res.json();
      if (data.avatarOverlays?.length) {
        setOverlays(data.avatarOverlays);
        // Populate configs from existing overlays
        const existing: Record<string, SpeakerConfig> = {};
        for (const ov of data.avatarOverlays) {
          existing[ov.speaker] = {
            speaker: ov.speaker,
            avatarId: ov.avatarId,
            avatarProvider: (ov.avatarProvider as 'heygen' | 'runway') ?? 'heygen',
            posX: ov.posX,
            posY: ov.posY,
            width: ov.width,
            height: ov.height,
            maskShape: ov.maskShape ?? 'none',
          };
        }
        setConfigs(existing);
      }
    } catch {
      // Non-critical — overlays just won't be pre-populated
    }
  }, [podcastId]);

  // Fetch speakers from segments
  const fetchSpeakers = useCallback(async () => {
    try {
      const res = await fetch(`/api/admin/showcase/${podcastId}/segments`);
      if (!res.ok) return;
      const data = await res.json();
      const segs = data.segments ?? [];
      const unique = [...new Set<string>(segs.map((s: { speaker: string }) => s.speaker))];
      setSpeakers(unique);
    } catch {
      // Fallback — speakers will be empty
    }
  }, [podcastId]);

  useEffect(() => {
    fetchAvatars(provider);
    fetchOverlays();
    fetchSpeakers();
  }, [fetchAvatars, fetchOverlays, fetchSpeakers, provider]);

  // Select an avatar for a speaker
  const selectAvatar = useCallback((speaker: string, avatar: UnifiedAvatar) => {
    setConfigs((prev) => ({
      ...prev,
      [speaker]: {
        ...(prev[speaker] ?? { ...DEFAULT_POSITION, maskShape: 'none' }),
        speaker,
        avatarId: avatar.id,
        avatarProvider: avatar.provider,
      },
    }));
  }, []);

  // Update position for a speaker
  const updatePosition = useCallback((speaker: string, field: keyof SpeakerConfig, value: number | string) => {
    setConfigs((prev) => ({
      ...prev,
      [speaker]: {
        ...(prev[speaker] ?? { speaker, avatarId: '', avatarProvider: 'heygen' as const, ...DEFAULT_POSITION, maskShape: 'none' }),
        [field]: value,
      },
    }));
  }, []);

  // Save avatar configuration
  const saveAvatars = useCallback(async () => {
    const configured = Object.values(configs).filter((c) => c.avatarId);
    if (configured.length === 0) {
      setMessage('Select at least one avatar');
      setStatus('error');
      return;
    }

    setStatus('saving');
    setMessage('');
    try {
      // Save avatar assignments
      const res = await fetch(`/api/podcasts/${podcastId}/video/avatars`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          avatars: configured.map((c) => ({
            speaker: c.speaker,
            avatarId: c.avatarId,
            avatarProvider: c.avatarProvider,
          })),
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error ?? 'Save failed');
      }

      // Save positions
      const posRes = await fetch(`/api/podcasts/${podcastId}/video/avatars/positions`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          positions: configured.map((c) => ({
            speaker: c.speaker,
            posX: c.posX,
            posY: c.posY,
            width: c.width,
            height: c.height,
            maskShape: c.maskShape,
          })),
        }),
      });
      if (!posRes.ok) {
        const data = await posRes.json().catch(() => ({}));
        throw new Error(data?.error ?? 'Position save failed');
      }

      setMessage(`Saved ${configured.length} avatar(s)`);
      setStatus('idle');
      await fetchOverlays();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Save failed');
      setStatus('error');
    }
  }, [configs, podcastId, fetchOverlays]);

  // Delete all avatars
  const deleteAvatars = useCallback(async () => {
    setStatus('saving');
    try {
      const res = await fetch(`/api/podcasts/${podcastId}/video/avatars`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Delete failed');
      setOverlays([]);
      setConfigs({});
      setMessage('Avatars removed');
      setStatus('idle');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Delete failed');
      setStatus('error');
    }
  }, [podcastId]);

  // Toggle avatars visible
  const toggleVisible = useCallback(async () => {
    const newVal = !avatarsVisible;
    try {
      const res = await fetch(`/api/podcasts/${podcastId}/video`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ avatarsVisible: newVal }),
      });
      if (!res.ok) throw new Error('Toggle failed');
      onAvatarsVisibleChange(newVal);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Toggle failed');
      setStatus('error');
    }
  }, [podcastId, avatarsVisible, onAvatarsVisibleChange]);

  const activeSpeaker = speakers.length > 0 ? speakers : ['Host', 'Expert'];

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <h3 className={styles.title}>Avatar Configuration</h3>
        <div className={styles.headerControls}>
          <label className={styles.visibilityToggle}>
            <input
              type="checkbox"
              checked={avatarsVisible}
              onChange={toggleVisible}
            />
            Show avatars in video
          </label>
          {overlays.length > 0 && (
            <button
              type="button"
              className={styles.btnDanger}
              onClick={deleteAvatars}
              disabled={status === 'saving'}
            >
              Remove All
            </button>
          )}
        </div>
      </div>

      {/* Provider selector */}
      <div className={styles.providerRow}>
        <span className={styles.providerLabel}>Provider:</span>
        {(['heygen', 'runway'] as const).map((prov) => (
          <button
            key={prov}
            type="button"
            className={styles.providerBtn}
            data-active={provider === prov}
            data-available={providers[prov]}
            onClick={() => { setProvider(prov); fetchAvatars(prov); }}
            disabled={!providers[prov]}
          >
            {prov === 'heygen' ? 'HeyGen' : 'Runway'}
          </button>
        ))}
      </div>

      {/* Per-speaker configuration */}
      {activeSpeaker.map((speaker) => {
        const config = configs[speaker];
        const existingOverlay = overlays.find((o) => o.speaker === speaker);

        return (
          <fieldset key={speaker} className={styles.speakerSection}>
            <legend className={styles.speakerLegend}>
              {speaker}
              {existingOverlay && (
                <span className={styles.overlayStatus} data-status={existingOverlay.status}>
                  {existingOverlay.status}
                </span>
              )}
            </legend>

            {/* Avatar grid */}
            <div className={styles.avatarGrid}>
              {status === 'loading' && avatars.length === 0 && (
                <p className={styles.loadingText}>Loading avatars...</p>
              )}
              {avatars.map((av) => (
                <button
                  key={av.id}
                  type="button"
                  className={styles.avatarCard}
                  data-selected={config?.avatarId === av.id}
                  onClick={() => selectAvatar(speaker, av)}
                  title={av.name}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={av.previewImageUrl}
                    alt={av.name}
                    className={styles.avatarImg}
                    loading="lazy"
                  />
                  <span className={styles.avatarName}>{av.name}</span>
                </button>
              ))}
            </div>

            {/* Position & mask controls */}
            {config?.avatarId && (
              <div className={styles.positionControls}>
                <div className={styles.sliderGroup}>
                  <label className={styles.sliderLabel}>
                    X: {(config.posX * 100).toFixed(0)}%
                  </label>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.01}
                    value={config.posX}
                    onChange={(e) => updatePosition(speaker, 'posX', Number(e.target.value))}
                    className={styles.slider}
                  />
                </div>
                <div className={styles.sliderGroup}>
                  <label className={styles.sliderLabel}>
                    Y: {(config.posY * 100).toFixed(0)}%
                  </label>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.01}
                    value={config.posY}
                    onChange={(e) => updatePosition(speaker, 'posY', Number(e.target.value))}
                    className={styles.slider}
                  />
                </div>
                <div className={styles.sliderGroup}>
                  <label className={styles.sliderLabel}>
                    Width: {(config.width * 100).toFixed(0)}%
                  </label>
                  <input
                    type="range"
                    min={0.05}
                    max={0.8}
                    step={0.01}
                    value={config.width}
                    onChange={(e) => updatePosition(speaker, 'width', Number(e.target.value))}
                    className={styles.slider}
                  />
                </div>
                <div className={styles.sliderGroup}>
                  <label className={styles.sliderLabel}>
                    Height: {(config.height * 100).toFixed(0)}%
                  </label>
                  <input
                    type="range"
                    min={0.05}
                    max={0.8}
                    step={0.01}
                    value={config.height}
                    onChange={(e) => updatePosition(speaker, 'height', Number(e.target.value))}
                    className={styles.slider}
                  />
                </div>
                <div className={styles.sliderGroup}>
                  <label className={styles.sliderLabel}>Mask Shape</label>
                  <select
                    className={styles.maskSelect}
                    value={config.maskShape}
                    onChange={(e) => updatePosition(speaker, 'maskShape', e.target.value)}
                  >
                    {MASK_SHAPES.map((shape) => (
                      <option key={shape} value={shape}>{shape}</option>
                    ))}
                  </select>
                </div>

                {/* Position preview */}
                <div className={styles.previewBox} aria-label={`${speaker} avatar position preview`}>
                  <div
                    className={styles.previewAvatar}
                    data-mask={config.maskShape}
                    style={{
                      left: `${config.posX * 100}%`,
                      top: `${config.posY * 100}%`,
                      width: `${config.width * 100}%`,
                      height: `${config.height * 100}%`,
                    }}
                  />
                </div>
              </div>
            )}
          </fieldset>
        );
      })}

      {/* Actions */}
      <div className={styles.actions}>
        <button
          type="button"
          className={styles.btnPrimary}
          onClick={saveAvatars}
          disabled={status === 'saving' || Object.values(configs).filter((c) => c.avatarId).length === 0}
        >
          {status === 'saving' ? 'Saving...' : 'Save Avatars'}
        </button>
      </div>

      {message && (
        <div
          className={styles.banner}
          data-variant={status === 'error' ? 'error' : 'success'}
          role="alert"
        >
          {message}
        </div>
      )}
    </div>
  );
}
