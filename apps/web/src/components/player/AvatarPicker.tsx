'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { User, AlertTriangle, Search } from 'lucide-react';
import { estimateAvatarCost, formatAvatarCost } from '@/lib/avatar-cost-estimator';
import type { UnifiedAvatarData } from '@/types/avatar';
import styles from './AvatarPicker.module.css';

interface AvatarPickerProps {
  podcastId: string;
  speakers: string[];
  onConfigured: (data: { videoGenerationId: string; generationStarted: boolean }) => void;
  onCancel: () => void;
  podcastDuration: number;
}

const MAX_DURATION = 600;
const VISIBLE_COUNT = 12;

interface AvatarSelection {
  avatarId: string;
  provider: 'heygen' | 'runway';
  isPreset: boolean;
}

interface AvatarPricing {
  costPerMinute: number;
  includedOnPlatform: boolean;
}

export function AvatarPicker({ podcastId, speakers, onConfigured, onCancel, podcastDuration }: AvatarPickerProps) {
  const [avatars, setAvatars] = useState<UnifiedAvatarData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selections, setSelections] = useState<Record<string, AvatarSelection>>({});
  const [submitting, setSubmitting] = useState(false);
  const [search, setSearch] = useState('');
  const [activeProvider, setActiveProvider] = useState<'heygen' | 'runway'>('heygen');
  const [availableProviders, setAvailableProviders] = useState<{ heygen: boolean; runway: boolean }>({ heygen: false, runway: false });
  const [pricing, setPricing] = useState<AvatarPricing>({ costPerMinute: 0, includedOnPlatform: false });

  const overDuration = podcastDuration > MAX_DURATION;

  useEffect(() => {
    fetch(`/api/podcasts/${podcastId}/video/avatars?provider=${activeProvider}`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error('Failed to load avatars'))))
      .then((data: {
        avatars: UnifiedAvatarData[];
        providers: { heygen: boolean; runway: boolean };
        pricing?: AvatarPricing;
      }) => {
        setAvatars(data.avatars);
        setAvailableProviders(data.providers);
        if (data.pricing) setPricing(data.pricing);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load avatars'))
      .finally(() => setLoading(false));
  }, [podcastId, activeProvider]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = q ? avatars.filter((a) => a.name.toLowerCase().includes(q)) : avatars;
    return list.slice(0, VISIBLE_COUNT);
  }, [avatars, search]);

  const handleSelect = useCallback((speaker: string, avatar: UnifiedAvatarData) => {
    setSelections((prev) => {
      if (prev[speaker]?.avatarId === avatar.id) {
        const next = { ...prev };
        delete next[speaker];
        return next;
      }
      return { ...prev, [speaker]: { avatarId: avatar.id, provider: avatar.provider, isPreset: avatar.isPreset } };
    });
  }, []);

  const handleSubmit = useCallback(async () => {
    const configured = Object.entries(selections).map(([speaker, sel]) => ({
      speaker,
      avatarId: sel.avatarId,
      avatarProvider: sel.provider,
      isPreset: sel.isPreset,
    }));
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
  }, [selections, podcastId, onConfigured]);

  const selectedCount = Object.keys(selections).length;
  const estimatedCost = estimateAvatarCost(podcastDuration, selectedCount, pricing.costPerMinute);

  // Check if any selection uses Runway
  const hasRunwaySelection = Object.values(selections).some((s) => s.provider === 'runway');

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
        {overDuration && (
          <div className={styles.warning}>
            <AlertTriangle size={14} />
            <span>Podcast exceeds {MAX_DURATION / 60}-minute avatar limit</span>
          </div>
        )}
      </div>

      {error && <p className={styles.error}>{error}</p>}

      {availableProviders.runway && (
        <div className={styles.providerTabs}>
          <button
            className={`${styles.providerTab} ${activeProvider === 'heygen' ? styles.providerTabActive : ''}`}
            onClick={() => { setActiveProvider('heygen'); setLoading(true); }}
            type="button"
          >
            HeyGen
          </button>
          <button
            className={`${styles.providerTab} ${activeProvider === 'runway' ? styles.providerTabActive : ''}`}
            onClick={() => { setActiveProvider('runway'); setLoading(true); }}
            type="button"
          >
            Runway
          </button>
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
            <div className={styles.avatarGrid}>
              {filtered.map((avatar) => (
                <button
                  key={avatar.id}
                  className={`${styles.avatarCard} ${selections[speaker]?.avatarId === avatar.id ? styles.avatarCardSelected : ''}`}
                  onClick={() => handleSelect(speaker, avatar)}
                  type="button"
                  aria-pressed={selections[speaker]?.avatarId === avatar.id}
                  disabled={overDuration}
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

      <p className={styles.browseLink}>
        Browse all avatars at{' '}
        {activeProvider === 'runway' ? (
          <a href="https://dev.runwayml.com" target="_blank" rel="noopener noreferrer">
            dev.runwayml.com
          </a>
        ) : (
          <a href="https://www.heygen.com/avatars" target="_blank" rel="noopener noreferrer">
            heygen.com/avatars
          </a>
        )}
      </p>

      {hasRunwaySelection && (
        <p className={styles.runwayNotice}>
          Runway avatars render in real-time (~{Math.ceil(podcastDuration / 60)} min)
        </p>
      )}

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
            disabled={selectedCount === 0 || submitting || overDuration}
            type="button"
          >
            {submitting ? 'Configuring...' : 'Add Avatars'}
          </button>
        </div>
      </div>
    </div>
  );
}
