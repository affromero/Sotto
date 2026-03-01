'use client';

import { useCallback, useEffect, useState } from 'react';
import { VoiceCard } from './VoiceCard';
import styles from './HumeVoiceBrowser.module.css';

interface HumeVoice {
  id: string;
  name: string;
  gender: string;
  age: string;
  accent: string;
  language: string;
}

interface HumeVoiceBrowserProps {
  selectedVoiceId?: string;
  onSelect: (voiceId: string, voiceName: string) => void;
  showCustomTab?: boolean;
}

export function HumeVoiceBrowser({ selectedVoiceId, onSelect, showCustomTab }: HumeVoiceBrowserProps) {
  const [voices, setVoices] = useState<HumeVoice[]>([]);
  const [allVoices, setAllVoices] = useState<HumeVoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [genderFilter, setGenderFilter] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [voiceTab, setVoiceTab] = useState<'library' | 'custom'>('library');

  const loadVoices = useCallback(async (provider?: string) => {
    setLoading(true);
    setError(null);
    try {
      const all: HumeVoice[] = [];
      let page = 0;
      let totalPages = 1;
      const providerParam = provider ? `&provider=${provider}` : '';
      while (page < totalPages) {
        const res = await fetch(`/api/voices/hume?page=${page}${providerParam}`);
        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || 'Failed to load voices');
        }
        const data = await res.json();
        all.push(...data.voices);
        totalPages = data.totalPages;
        page++;
      }
      setAllVoices(all);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load voices');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadVoices(voiceTab === 'custom' ? 'CUSTOM_VOICE' : undefined);
  }, [loadVoices, voiceTab]);

  useEffect(() => {
    let filtered = allVoices;
    if (genderFilter !== 'all') {
      filtered = filtered.filter((v) => v.gender === genderFilter);
    }
    if (search) {
      const q = search.toLowerCase();
      filtered = filtered.filter(
        (v) =>
          v.name.toLowerCase().includes(q) ||
          v.accent.toLowerCase().includes(q) ||
          v.language.toLowerCase().includes(q)
      );
    }
    setVoices(filtered);
  }, [allVoices, genderFilter, search]);

  if (loading) {
    return (
      <div className={styles.loading}>
        <span className={styles.spinner} />
        Loading Hume voices...
      </div>
    );
  }

  if (error) {
    return (
      <div className={styles.error}>
        <p>{error}</p>
        <button type="button" className={styles.retryButton} onClick={() => loadVoices(voiceTab === 'custom' ? 'CUSTOM_VOICE' : undefined)}>
          Try again
        </button>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      {showCustomTab && (
        <div className={styles.genderPills} role="tablist" style={{ marginBottom: '0.75rem' }}>
          <button
            type="button"
            role="tab"
            aria-selected={voiceTab === 'library'}
            className={`${styles.pill} ${voiceTab === 'library' ? styles.pillActive : ''}`}
            onClick={() => setVoiceTab('library')}
          >
            Library
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={voiceTab === 'custom'}
            className={`${styles.pill} ${voiceTab === 'custom' ? styles.pillActive : ''}`}
            onClick={() => setVoiceTab('custom')}
          >
            My Voices
          </button>
        </div>
      )}
      <div className={styles.filters}>
        <div className={styles.searchWrapper}>
          <svg className={styles.searchIcon} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.35-4.35" />
          </svg>
          <input
            type="text"
            className={styles.searchInput}
            placeholder="Search voices..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search voices"
          />
        </div>
        <div className={styles.genderPills}>
          {(['all', 'male', 'female'] as const).map((g) => (
            <button
              key={g}
              type="button"
              className={`${styles.pill} ${genderFilter === g ? styles.pillActive : ''}`}
              onClick={() => setGenderFilter(g)}
              aria-pressed={genderFilter === g}
            >
              {g === 'all' ? 'All' : g.charAt(0).toUpperCase() + g.slice(1)}
            </button>
          ))}
        </div>
      </div>

      <div className={styles.count}>
        {voices.length} voice{voices.length !== 1 ? 's' : ''}
      </div>

      <div className={styles.grid}>
        {voices.map((voice) => (
          <VoiceCard
            key={voice.id}
            voiceId={voice.id}
            name={voice.name}
            accent={voice.accent || undefined}
            character={voice.age !== 'unknown' ? voice.age : undefined}
            isSelected={selectedVoiceId === voice.id}
            onSelect={() => onSelect(voice.id, voice.name)}
            provider="hume"
          />
        ))}
      </div>

      {voices.length === 0 && (
        <div className={styles.empty}>
          No voices match your filters. Try broadening your search.
        </div>
      )}
    </div>
  );
}
