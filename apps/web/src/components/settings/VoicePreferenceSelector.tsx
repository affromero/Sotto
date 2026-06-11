'use client';

import { useState, useEffect } from 'react';
import styles from './VoicePreferenceSelector.module.css';

interface Voice {
  id: string;
  name: string;
  category?: string;
}

interface VoicePreferenceSelectorProps {
  label: string;
  value: string | null;
  onChange: (voiceId: string | null) => void;
}

export function VoicePreferenceSelector({
  label,
  value,
  onChange,
}: VoicePreferenceSelectorProps) {
  const [poolVoices, setPoolVoices] = useState<Voice[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/v1/voices')
      .then((res) => (res.ok ? res.json() : { poolVoices: [] }))
      .then((data) => {
        const voices = (data.poolVoices ?? data.voices ?? [])
          .map((voice: { id?: string; voice_id?: string; name: string; category?: string }) => ({
            id: voice.id ?? voice.voice_id ?? '',
            name: voice.name,
            category: voice.category,
          }))
          .filter((voice: Voice) => voice.id);
        setPoolVoices(voices);
      })
      .catch(() => setPoolVoices([]))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className={styles.field}>
      <label className={styles.label}>{label}</label>
      <select
        className={styles.select}
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value || null)}
        disabled={loading}
        aria-label={label}
      >
        <option value="">Auto-assign (recommended)</option>

        {poolVoices.length > 0 && (
          <optgroup label="Voice Library">
            {poolVoices.map((voice) => (
              <option key={voice.id} value={voice.id}>
                {voice.category ? `${voice.name} (${voice.category})` : voice.name}
              </option>
            ))}
          </optgroup>
        )}
      </select>
    </div>
  );
}
