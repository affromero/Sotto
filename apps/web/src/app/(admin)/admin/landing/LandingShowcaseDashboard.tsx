'use client';

import { useState, useEffect, useCallback } from 'react';
import styles from './LandingShowcaseDashboard.module.css';

interface Config {
  podcastId: string;
  scriptTurnStart: number;
  scriptTurnCount: number;
  audioClipStart: number;
  audioClipEnd: number | null;
  videoSegmentStart: number;
  videoSegmentCount: number;
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

  // Form state
  const [form, setForm] = useState<Config>({
    podcastId: '',
    scriptTurnStart: 0,
    scriptTurnCount: 2,
    audioClipStart: 0,
    audioClipEnd: null,
    videoSegmentStart: 0,
    videoSegmentCount: 4,
    twitterHandle: 'andres',
    twitterName: 'Andres',
    telegramTopic: null,
  });

  useEffect(() => {
    fetch('/api/admin/landing-showcase')
      .then((r) => r.json())
      .then((data) => {
        if (data.config) {
          setConfig(data.config);
          setForm(data.config);
        }
      })
      .finally(() => setLoading(false));
  }, []);

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
  }, []);

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
        setForm({
          podcastId: '',
          scriptTurnStart: 0,
          scriptTurnCount: 2,
          audioClipStart: 0,
          audioClipEnd: null,
          videoSegmentStart: 0,
          videoSegmentCount: 4,
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

      {/* Audio Clip */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Media Clip — Audio + Video (Step 3)</h2>
        <div className={styles.row}>
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
        <h2 className={styles.sectionTitle}>Video Segments (Showcase)</h2>
        <div className={styles.row}>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Segment start</span>
            <input
              type="number"
              min={0}
              value={form.videoSegmentStart}
              onChange={(e) => setForm((f) => ({ ...f, videoSegmentStart: parseInt(e.target.value) || 0 }))}
              className={styles.inputSmall}
            />
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
      </div>
    </div>
  );
}
