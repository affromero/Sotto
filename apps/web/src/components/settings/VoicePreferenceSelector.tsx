'use client';

import { useState, useEffect } from 'react';
import styles from './VoicePreferenceSelector.module.css';

interface Voice {
  voice_id: string;
  name: string;
  category: string;
}

interface VoiceClone {
  id: string;
  name: string;
  externalVoiceId: string;
}

interface VoicePreferenceSelectorProps {
  label: string;
  value: string | null;
  onChange: (voiceId: string | null) => void;
  voiceClones: VoiceClone[];
}

export function VoicePreferenceSelector({
  label,
  value,
  onChange,
  voiceClones,
}: VoicePreferenceSelectorProps) {
  const [poolVoices, setPoolVoices] = useState<Voice[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/v1/voices')
      .then((res) => (res.ok ? res.json() : { voices: [] }))
      .then((data) => setPoolVoices(data.voices ?? []))
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

        {voiceClones.length > 0 && (
          <optgroup label="Your Voice Clones">
            {voiceClones.map((clone) => (
              <option key={clone.externalVoiceId} value={clone.externalVoiceId}>
                {clone.name}
              </option>
            ))}
          </optgroup>
        )}

        {poolVoices.length > 0 && (
          <optgroup label="Voice Library">
            {poolVoices.map((voice) => (
              <option key={voice.voice_id} value={voice.voice_id}>
                {voice.name} ({voice.category})
              </option>
            ))}
          </optgroup>
        )}
      </select>
    </div>
  );
}
