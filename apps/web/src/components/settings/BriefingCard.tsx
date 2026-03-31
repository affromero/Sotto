'use client';

import { useState } from 'react';
import { BriefingForm, DEPTH_OPTIONS, DURATION_OPTIONS } from './BriefingForm';
import type { BriefingFormData } from './BriefingForm';
import styles from './BriefingCard.module.css';

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function formatDays(bitmask: number): string {
  if (bitmask === 127) return 'Every day';
  if (bitmask === 31) return 'Weekdays';
  if (bitmask === 96) return 'Weekends';
  const active: string[] = [];
  for (let i = 0; i < 7; i++) {
    const bit = i === 6 ? 64 : (1 << i);
    if ((bitmask & bit) !== 0) active.push(DAY_LABELS[i]);
  }
  return active.join(', ');
}

export interface BriefingData {
  id: string;
  name: string;
  enabled: boolean;
  time: string;
  timezone: string;
  days: number;
  nextRunAt: string | null;
  prompt: string | null;
  depth: string | null;
  tone: string | null;
  audienceLevel: string | null;
  duration: number | null;
  format: number;
  aiModel: string | null;
  ttsProvider: string | null;
  ttsModel: string | null;
  hostVoiceId: string | null;
  expertVoiceId: string | null;
  continuousLearning: boolean;
  contextEpisodes: number;
  visibility: string;
  useByokKeys: boolean;
  lastGeneratedAt: string | null;
  createdAt: string;
}

interface BriefingCardProps {
  briefing: BriefingData;
  hasByokKeys: boolean;
  aiModelOptions: Array<{ id: string; displayName: string; tier: string; group?: string }>;
  ttsOptions: Array<{ id: string; displayName: string; badge?: string; group?: string }>;
  onRefresh: () => void;
}

export function BriefingCard({
  briefing,
  hasByokKeys,
  aiModelOptions,
  ttsOptions,
  onRefresh,
}: BriefingCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [enabled, setEnabled] = useState(briefing.enabled);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [generatedPodcastId, setGeneratedPodcastId] = useState<string | null>(null);
  const [generateError, setGenerateError] = useState<string | null>(null);

  const depthLabel = DEPTH_OPTIONS.find((o) => o.value === briefing.depth)?.label ?? 'Quick Overview';
  const durationLabel = DURATION_OPTIONS.find((o) => o.value === briefing.duration)?.label ?? '6 min';

  const toggleEnabled = async () => {
    const next = !enabled;
    setEnabled(next);
    const res = await fetch(`/api/briefings/${briefing.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: next }),
    });
    if (!res.ok) {
      setEnabled(!next);
      return;
    }
    onRefresh();
  };

  const handleDelete = async () => {
    setDeleting(true);
    await fetch(`/api/briefings/${briefing.id}`, { method: 'DELETE' });
    onRefresh();
  };

  const handleGenerate = async () => {
    setGenerating(true);
    setGeneratedPodcastId(null);
    setGenerateError(null);
    try {
      const res = await fetch(`/api/briefings/${briefing.id}/generate`, { method: 'POST' });
      const data = await res.json();
      if (res.ok) {
        if (data.podcastId) setGeneratedPodcastId(data.podcastId);
      } else {
        setGenerateError(typeof data.error === 'string' ? data.error : 'Generation failed. Try again later.');
      }
      onRefresh();
    } catch {
      setGenerateError('Network error. Check your connection and try again.');
    } finally {
      setGenerating(false);
    }
  };

  const initial: Partial<BriefingFormData> = {
    name: briefing.name,
    time: briefing.time,
    timezone: briefing.timezone,
    days: briefing.days,
    prompt: briefing.prompt,
    depth: briefing.depth,
    tone: briefing.tone,
    audienceLevel: briefing.audienceLevel,
    duration: briefing.duration,
    format: briefing.format,
    aiModel: briefing.aiModel,
    ttsProvider: briefing.ttsProvider,
    ttsModel: briefing.ttsModel,
    hostVoiceId: briefing.hostVoiceId,
    expertVoiceId: briefing.expertVoiceId,
    continuousLearning: briefing.continuousLearning,
    contextEpisodes: briefing.contextEpisodes,
    visibility: briefing.visibility,
    useByokKeys: briefing.useByokKeys,
  };

  return (
    <div className={styles.card} data-enabled={enabled || undefined}>
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <span className={styles.indicator} data-active={enabled || undefined} />
          <span className={styles.name}>{briefing.name}</span>
        </div>
        <div className={styles.headerRight}>
          <button
            type="button"
            className={styles.toggleBtn}
            onClick={toggleEnabled}
            aria-label={enabled ? 'Disable briefing' : 'Enable briefing'}
          >
            {enabled ? 'ON' : 'OFF'}
          </button>
        </div>
      </div>

      <div className={styles.summary}>
        <div>
          <span className={styles.summaryText}>
            {formatDays(briefing.days)} at {briefing.time} &middot; {depthLabel} &middot; {durationLabel}
          </span>
          {briefing.lastGeneratedAt && (
            <div className={styles.lastGenerated}>
              Last generated {new Date(briefing.lastGeneratedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}
            </div>
          )}
        </div>
        <div className={styles.summaryActions}>
          <button
            type="button"
            className={styles.editBtn}
            onClick={() => setExpanded(!expanded)}
            aria-expanded={expanded}
            aria-label={expanded ? 'Collapse settings' : 'Edit settings'}
          >
            {expanded ? 'Close' : 'Edit'}
          </button>
          {!expanded && !confirmDelete && (
            <button
              type="button"
              className={styles.deleteBtnSubtle}
              onClick={() => setConfirmDelete(true)}
              aria-label="Delete briefing"
            >
              Delete
            </button>
          )}
        </div>
      </div>

      {/* Inline delete confirmation (collapsed state) */}
      {!expanded && confirmDelete && (
        <div className={styles.confirmRow}>
          <span className={styles.confirmText}>Delete this briefing?</span>
          <button
            type="button"
            className={styles.deleteBtn}
            onClick={handleDelete}
            disabled={deleting}
            aria-label="Confirm delete"
          >
            {deleting ? 'Deleting...' : 'Yes, delete'}
          </button>
          <button
            type="button"
            className={styles.editBtn}
            onClick={() => setConfirmDelete(false)}
            aria-label="Cancel delete"
          >
            Cancel
          </button>
        </div>
      )}

      {/* Generation status */}
      {generating && (
        <div className={styles.statusBanner}>
          Generating your podcast...
        </div>
      )}
      {generatedPodcastId && !generating && (
        <div className={styles.statusBanner}>
          Podcast created.{' '}
          <a href={`/podcast/${generatedPodcastId}`} className={styles.statusLink}>
            View progress
          </a>
        </div>
      )}
      {generateError && !generating && (
        <div className={styles.errorBanner}>
          {generateError}
        </div>
      )}

      {expanded && (
        <div className={styles.expandedContent}>
          <BriefingForm
            mode="edit"
            briefingId={briefing.id}
            initial={initial}
            hasByokKeys={hasByokKeys}
            aiModelOptions={aiModelOptions}
            ttsOptions={ttsOptions}
            onSaved={onRefresh}
          />

          <div className={styles.cardActions}>
            {generatedPodcastId && !generating ? (
              <a
                href={`/podcast/${generatedPodcastId}`}
                className={styles.generateBtnSuccess}
                aria-label="View generated podcast"
              >
                View Podcast
              </a>
            ) : (
              <button
                type="button"
                className={styles.generateBtn}
                onClick={handleGenerate}
                disabled={generating}
                aria-label="Generate briefing now"
              >
                {generating ? 'Generating...' : 'Generate Now'}
              </button>
            )}

            {!confirmDelete ? (
              <button
                type="button"
                className={styles.deleteBtn}
                onClick={() => setConfirmDelete(true)}
                aria-label="Delete briefing"
              >
                Delete
              </button>
            ) : (
              <span className={styles.confirmRow}>
                <span className={styles.confirmText}>Delete this briefing?</span>
                <button
                  type="button"
                  className={styles.deleteBtn}
                  onClick={handleDelete}
                  disabled={deleting}
                  aria-label="Confirm delete"
                >
                  {deleting ? 'Deleting...' : 'Yes, delete'}
                </button>
                <button
                  type="button"
                  className={styles.editBtn}
                  onClick={() => setConfirmDelete(false)}
                  aria-label="Cancel delete"
                >
                  Cancel
                </button>
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
