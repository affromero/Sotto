'use client';

import { useState, useEffect, useCallback } from 'react';
import type { LandingShowcaseData } from '@/lib/showcase';
import { AudioClipPlayer } from '@/components/landing/chapters/AudioClipPlayer';
import { ScriptEditorMock } from '@/components/landing/chapters/ScriptEditorMock';
import styles from './LandingShowcaseDashboard.module.css';

interface Config {
  podcastId: string;
  scriptTurnStart: number;
  scriptTurnCount: number;
  audioClipStart: number;
  audioClipEnd: number | null;
  videoSegmentStart: number;
  videoSegmentCount: number;
  showAvatar: boolean;
  showVideo: boolean;
  twitterHandle: string;
  twitterName: string;
  telegramTopic: string | null;
}

interface SearchResult {
  id: string;
  title: string;
  duration: number | null;
  creator: string;
}

interface SegmentTiming {
  order: number;
  speaker: string;
  startTime: number | null;
  duration: number | null;
}

const COLOR_CYCLE = ['purple', 'amber', 'navy', 'green'] as const;

function secondsToSegment(seconds: number, segments: SegmentTiming[]): number {
  if (segments.length === 0) return 0;
  let best = 0;
  let bestDist = Infinity;
  for (const seg of segments) {
    if (seg.startTime == null) continue;
    const dist = Math.abs(seg.startTime - seconds);
    if (dist < bestDist) {
      bestDist = dist;
      best = seg.order;
    }
  }
  return best;
}

function segmentToSeconds(order: number, segments: SegmentTiming[]): number | null {
  const seg = segments.find((s) => s.order === order);
  return seg?.startTime ?? null;
}

function segmentEndSeconds(order: number, segments: SegmentTiming[]): number | null {
  const seg = segments.find((s) => s.order === order);
  if (!seg || seg.startTime == null) return null;
  return seg.startTime + (seg.duration ?? 30);
}

export function LandingShowcaseDashboard() {
  const [config, setConfig] = useState<Config | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  // Search state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedTitle, setSelectedTitle] = useState('');

  // Segment timing data (for segment# ↔ seconds conversion)
  const [segments, setSegments] = useState<SegmentTiming[]>([]);

  // Preview state
  const [preview, setPreview] = useState<LandingShowcaseData | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState('');

  // Form state
  const [form, setForm] = useState<Config>({
    podcastId: '',
    scriptTurnStart: 0,
    scriptTurnCount: 2,
    audioClipStart: 0,
    audioClipEnd: null,
    videoSegmentStart: 0,
    videoSegmentCount: 4,
    showAvatar: false,
    showVideo: false,
    twitterHandle: 'andres',
    twitterName: 'Andres',
    telegramTopic: null,
  });

  const fetchSegments = useCallback(async (podcastId: string) => {
    try {
      const res = await fetch(`/api/admin/landing-showcase/segments?podcastId=${encodeURIComponent(podcastId)}`);
      if (res.ok) {
        const data = await res.json();
        setSegments(data.segments ?? []);
      }
    } catch {
      setSegments([]);
    }
  }, []);

  useEffect(() => {
    fetch('/api/admin/landing-showcase')
      .then((r) => r.json())
      .then((data) => {
        if (data.config) {
          setConfig(data.config);
          setForm(data.config);
          fetchSegments(data.config.podcastId);
        }
      })
      .finally(() => setLoading(false));
  }, [fetchSegments]);

  const handleSearch = useCallback(async (q: string) => {
    setSearchQuery(q);
    if (q.length < 2) {
      setSearchResults([]);
      return;
    }
    setSearching(true);
    try {
      const res = await fetch(`/api/admin/landing-showcase/search?q=${encodeURIComponent(q)}`);
      const data = await res.json();
      setSearchResults(data.results ?? []);
    } finally {
      setSearching(false);
    }
  }, []);

  const selectPodcast = useCallback((result: SearchResult) => {
    setForm((prev) => ({ ...prev, podcastId: result.id }));
    setSelectedTitle(result.title);
    setSearchResults([]);
    setSearchQuery('');
    fetchSegments(result.id);
  }, [fetchSegments]);

  const handleSave = useCallback(async () => {
    if (!form.podcastId) {
      setMessage('Please select a podcast first');
      return;
    }
    setSaving(true);
    setMessage('');
    try {
      const res = await fetch('/api/admin/landing-showcase', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (res.ok) {
        const data = await res.json();
        setConfig(data.config);
        setMessage('Saved successfully');
      } else {
        const err = await res.json();
        setMessage(`Error: ${JSON.stringify(err)}`);
      }
    } catch (e) {
      setMessage(`Error: ${e instanceof Error ? e.message : 'Unknown error'}`);
    } finally {
      setSaving(false);
    }
  }, [form]);

  const handleReset = useCallback(async () => {
    if (!confirm('Reset to hardcoded landing page? The config will be deleted.')) return;
    setSaving(true);
    setMessage('');
    try {
      const res = await fetch('/api/admin/landing-showcase', { method: 'DELETE' });
      if (res.ok) {
        setConfig(null);
        setPreview(null);
        setForm({
          podcastId: '',
          scriptTurnStart: 0,
          scriptTurnCount: 2,
          audioClipStart: 0,
          audioClipEnd: null,
          videoSegmentStart: 0,
          videoSegmentCount: 4,
          showAvatar: false,
          showVideo: false,
          twitterHandle: 'andres',
          twitterName: 'Andres',
          telegramTopic: null,
        });
        setSelectedTitle('');
        setMessage('Reset to defaults — landing page now shows hardcoded content');
      }
    } finally {
      setSaving(false);
    }
  }, []);

  const [bootstrapping, setBootstrapping] = useState(false);

  const handleBootstrap = useCallback(async () => {
    if (!confirm('Create a new CRISPR showcase podcast and start the generation pipeline? This will also set it as the active showcase.')) return;
    setBootstrapping(true);
    setMessage('');
    try {
      const res = await fetch('/api/admin/landing-showcase/bootstrap', { method: 'POST' });
      const data = await res.json();
      if (res.ok) {
        setForm((f) => ({ ...f, podcastId: data.id }));
        setSelectedTitle('CRISPR Gene Editing Explained');
        setConfig({ ...form, podcastId: data.id });
        setMessage(`Pipeline started (podcast ${data.id}). Landing page will go live when podcast reaches READY.`);
      } else {
        setMessage(`Error: ${JSON.stringify(data)}`);
      }
    } catch (e) {
      setMessage(`Error: ${e instanceof Error ? e.message : 'Unknown error'}`);
    } finally {
      setBootstrapping(false);
    }
  }, [form]);

  const handlePreview = useCallback(async () => {
    if (!form.podcastId) {
      setPreviewError('Select a podcast first');
      return;
    }
    setPreviewing(true);
    setPreviewError('');
    try {
      const res = await fetch('/api/admin/landing-showcase/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (res.ok) {
        const json = await res.json();
        setPreview(json.data);
      } else {
        const err = await res.json();
        setPreviewError(err.error ?? 'Failed to load preview');
      }
    } catch (e) {
      setPreviewError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setPreviewing(false);
    }
  }, [form]);

  if (loading) {
    return <div className={styles.loading}>Loading configuration...</div>;
  }

  return (
    <div className={styles.dashboard}>
      {/* Podcast Picker */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Podcast</h2>
        {(config?.podcastId || form.podcastId) && (
          <div className={styles.currentPodcast}>
            Current: <strong>{selectedTitle || form.podcastId}</strong>
            <a
              href={`/podcast/${form.podcastId}`}
              target="_blank"
              rel="noopener noreferrer"
              className={styles.viewLink}
            >
              View &rarr;
            </a>
          </div>
        )}
        <div className={styles.searchBox}>
          <input
            type="text"
            placeholder="Search READY + PUBLIC podcasts..."
            value={searchQuery}
            onChange={(e) => handleSearch(e.target.value)}
            className={styles.input}
          />
          {searching && <span className={styles.searchSpinner}>Searching...</span>}
        </div>
        {searchResults.length > 0 && (
          <ul className={styles.searchResults}>
            {searchResults.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  className={styles.searchResultBtn}
                  onClick={() => selectPodcast(r)}
                >
                  <span className={styles.resultTitle}>{r.title}</span>
                  <span className={styles.resultMeta}>
                    by {r.creator} &middot; {r.duration ? `${Math.round(r.duration / 60)} min` : 'N/A'}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Script Range */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Script Excerpt (Step 2)</h2>
        <div className={styles.row}>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Start turn</span>
            <input
              type="number"
              min={0}
              value={form.scriptTurnStart}
              onChange={(e) => setForm((f) => ({ ...f, scriptTurnStart: parseInt(e.target.value) || 0 }))}
              className={styles.inputSmall}
            />
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Turn count</span>
            <input
              type="number"
              min={1}
              max={10}
              value={form.scriptTurnCount}
              onChange={(e) => setForm((f) => ({ ...f, scriptTurnCount: parseInt(e.target.value) || 2 }))}
              className={styles.inputSmall}
            />
          </label>
        </div>
      </section>

      {/* Media Clip */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Media Clip — Audio + Video (Step 3)</h2>
        <div className={styles.row}>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Start segment #</span>
            <input
              type="number"
              min={0}
              max={segments.length - 1}
              value={segments.length > 0 ? secondsToSegment(form.audioClipStart, segments) : ''}
              onChange={(e) => {
                const order = parseInt(e.target.value);
                if (isNaN(order)) return;
                const secs = segmentToSeconds(order, segments);
                if (secs != null) setForm((f) => ({ ...f, audioClipStart: secs }));
              }}
              className={styles.inputSmall}
              disabled={segments.length === 0}
              placeholder={segments.length === 0 ? 'loading...' : ''}
            />
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Start (seconds)</span>
            <input
              type="number"
              min={0}
              step={0.1}
              value={form.audioClipStart}
              onChange={(e) => setForm((f) => ({ ...f, audioClipStart: parseFloat(e.target.value) || 0 }))}
              className={styles.inputSmall}
            />
          </label>
        </div>
        <div className={styles.row}>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>End segment #</span>
            <input
              type="number"
              min={0}
              max={segments.length - 1}
              value={segments.length > 0 && form.audioClipEnd != null ? secondsToSegment(form.audioClipEnd, segments) : ''}
              onChange={(e) => {
                const order = parseInt(e.target.value);
                if (isNaN(order)) return;
                const secs = segmentEndSeconds(order, segments);
                if (secs != null) setForm((f) => ({ ...f, audioClipEnd: secs }));
              }}
              className={styles.inputSmall}
              disabled={segments.length === 0}
              placeholder={segments.length === 0 ? 'loading...' : 'auto'}
            />
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>End (seconds, blank = +30s)</span>
            <input
              type="number"
              min={0}
              step={0.1}
              value={form.audioClipEnd ?? ''}
              onChange={(e) => setForm((f) => ({
                ...f,
                audioClipEnd: e.target.value ? parseFloat(e.target.value) : null,
              }))}
              className={styles.inputSmall}
              placeholder="auto"
            />
          </label>
        </div>
      </section>

      {/* Video Segments */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Video Storyboard</h2>
        <div className={styles.row}>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Segment start</span>
            <input
              type="number"
              min={0}
              value={form.videoSegmentStart}
              onChange={(e) => {
                const idx = parseInt(e.target.value) || 0;
                setForm((f) => ({ ...f, videoSegmentStart: idx }));
              }}
              className={styles.inputSmall}
            />
            {segments.length > 0 && (() => {
              const secs = segmentToSeconds(form.videoSegmentStart, segments);
              return secs != null ? (
                <span className={styles.fieldHint}>&asymp; {Math.round(secs)}s</span>
              ) : null;
            })()}
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Segment count</span>
            <input
              type="number"
              min={1}
              max={50}
              value={form.videoSegmentCount}
              onChange={(e) => setForm((f) => ({ ...f, videoSegmentCount: parseInt(e.target.value) || 4 }))}
              className={styles.inputSmall}
            />
          </label>
        </div>
      </section>

      {/* Feature Toggles */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Feature Toggles</h2>
        <div className={styles.row}>
          <label className={styles.checkboxField}>
            <input
              type="checkbox"
              checked={form.showAvatar}
              onChange={(e) => setForm((f) => ({ ...f, showAvatar: e.target.checked }))}
            />
            <span className={styles.fieldLabel}>Show avatar toggle on landing page</span>
          </label>
          <label className={styles.checkboxField}>
            <input
              type="checkbox"
              checked={form.showVideo}
              onChange={(e) => setForm((f) => ({ ...f, showVideo: e.target.checked }))}
            />
            <span className={styles.fieldLabel}>Show video toggle on landing page</span>
          </label>
        </div>
      </section>

      {/* Bot Overrides */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Bot Overrides</h2>
        <div className={styles.row}>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Twitter handle</span>
            <input
              type="text"
              value={form.twitterHandle}
              onChange={(e) => setForm((f) => ({ ...f, twitterHandle: e.target.value }))}
              className={styles.input}
            />
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Twitter name</span>
            <input
              type="text"
              value={form.twitterName}
              onChange={(e) => setForm((f) => ({ ...f, twitterName: e.target.value }))}
              className={styles.input}
            />
          </label>
        </div>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Telegram topic (blank = derive from podcast)</span>
          <input
            type="text"
            value={form.telegramTopic ?? ''}
            onChange={(e) => setForm((f) => ({
              ...f,
              telegramTopic: e.target.value || null,
            }))}
            className={styles.input}
            placeholder="auto"
          />
        </label>
      </section>

      {/* Actions */}
      <div className={styles.actions}>
        <button
          type="button"
          className={styles.previewBtn}
          onClick={handlePreview}
          disabled={previewing || !form.podcastId}
        >
          {previewing ? 'Loading...' : 'Load Preview'}
        </button>
        <button
          type="button"
          className={styles.saveBtn}
          onClick={handleSave}
          disabled={saving || !form.podcastId}
        >
          {saving ? 'Saving...' : 'Save Configuration'}
        </button>
        {config && (
          <button
            type="button"
            className={styles.resetBtn}
            onClick={handleReset}
            disabled={saving}
          >
            Reset to Defaults
          </button>
        )}
        {!config && (
          <button
            type="button"
            className={styles.bootstrapBtn}
            onClick={handleBootstrap}
            disabled={bootstrapping}
          >
            {bootstrapping ? 'Creating...' : 'Bootstrap Showcase Podcast'}
          </button>
        )}
        {message && <span className={styles.message}>{message}</span>}
        {previewError && <span className={styles.previewError}>{previewError}</span>}
      </div>

      {/* Live Preview */}
      {preview && (
        <section className={styles.previewPanel}>
          <h2 className={styles.previewTitle}>Landing Page Preview</h2>

          {/* Step 1: Discovery chat */}
          <div className={styles.previewBlock}>
            <h3 className={styles.previewBlockTitle}>Step 1 — Discovery Chat</h3>
            <div className={styles.previewChat}>
              {preview.chatMessages.map((msg, i) => (
                <div
                  key={i}
                  className={`${styles.chatMsg} ${msg.role === 'user' ? styles.chatMsgUser : styles.chatMsgBot}`}
                >
                  {msg.role === 'assistant' && <div className={styles.chatAvatar}>S</div>}
                  <div className={styles.chatBubble}>{msg.content}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Step 2: Script excerpt */}
          {preview.scriptTurns.length > 0 && (
            <div className={styles.previewBlock}>
              <h3 className={styles.previewBlockTitle}>Step 2 — Script Excerpt</h3>
              <ScriptEditorMock turns={preview.scriptTurns} references={preview.references} />
            </div>
          )}

          {/* Step 3: Audio + Video player */}
          <div className={styles.previewBlock}>
            <h3 className={styles.previewBlockTitle}>Step 3 — Media Player</h3>
            <AudioClipPlayer
              title={preview.podcast.title}
              voiceCount={preview.voiceCount}
              sourceCount={preview.sourceCount}
              audioUrl={preview.audioClip.url}
              originalTrackName={preview.originalTrackName}
              startTime={preview.audioClip.start}
              endTime={preview.audioClip.end}
              totalDuration={preview.audioClip.totalDuration}
              podcastId={preview.podcast.podcastId}
              voiceTracks={preview.voiceTracks}
              videoClip={preview.videoClip}
              showVideoToggle={preview.showVideo}
            />
          </div>

          {/* Video segments */}
          {preview.videoSegments.length > 0 && (
            <div className={styles.previewBlock}>
              <h3 className={styles.previewBlockTitle}>Video Storyboard</h3>
              <div className={styles.previewSegments}>
                {preview.videoSegments.map((seg, i) => (
                  <div key={`${seg.order}-${i}`} className={styles.previewSegment}>
                    <span className={styles.segNum}>{seg.order}</span>
                    <span className={styles.segLabel}>{seg.label}</span>
                    <span className={`${styles.segBadge} ${styles[`badge${COLOR_CYCLE[i % COLOR_CYCLE.length]}`]}`}>
                      {seg.type}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Bot overrides */}
          <div className={styles.previewBlock}>
            <h3 className={styles.previewBlockTitle}>Bot — Overrides</h3>
            <div className={styles.previewBot}>
              <div>Twitter: <strong>@{preview.bot.twitterHandle}</strong> ({preview.bot.twitterName})</div>
              <div>Podcast: <strong>{preview.bot.podcastTitle}</strong> &middot; {preview.bot.podcastDuration}</div>
              <div>Telegram topic: <strong>{preview.bot.telegramTopic}</strong></div>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
