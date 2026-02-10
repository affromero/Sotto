'use client';

import { useEffect, useState } from 'react';
import { TtsProviderLogo } from '@/components/ui/TtsProviderLogo';
import styles from './TtsProviderSelector.module.css';

type ProviderId = 'elevenlabs' | 'openai' | 'playht' | 'cartesia' | 'hume';

const QUALITY_LABELS: Record<string, string> = {
  elevenlabs: 'Premium',
  openai: 'Standard',
  playht: 'Premium',
  cartesia: 'Premium',
  hume: 'Ultra',
};

interface TtsProviderSelectorProps {
  value: string | undefined;
  onChange: (provider: string | undefined) => void;
}

export function TtsProviderSelector({ value, onChange }: TtsProviderSelectorProps) {
  const [configuredProviders, setConfiguredProviders] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/tts-providers')
      .then((res) => res.json())
      .then((data) => {
        setConfiguredProviders(data.configuredProviders || []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) return null;

  // Only show selector if user has BYOK keys
  if (configuredProviders.length === 0) return null;

  return (
    <div className={styles.root}>
      <label className={styles.label}>Voice Provider</label>
      <div className={styles.options}>
        <button
          type="button"
          className={`${styles.option} ${!value ? styles.optionActive : ''}`}
          onClick={() => onChange(undefined)}
          title="Uses your best available provider"
        >
          <span className={styles.optionName}>Auto</span>
          <span className={styles.optionQuality}>Best available</span>
        </button>
        {configuredProviders.map((id) => (
          <button
            key={id}
            type="button"
            className={`${styles.option} ${value === id ? styles.optionActive : ''}`}
            onClick={() => onChange(id)}
          >
            <TtsProviderLogo provider={id as ProviderId} size={20} />
            <span className={styles.optionName}>
              {id === 'elevenlabs'
                ? 'ElevenLabs'
                : id === 'playht'
                  ? 'PlayHT'
                  : id === 'hume'
                    ? 'Hume AI'
                    : id.charAt(0).toUpperCase() + id.slice(1)}
            </span>
            <span className={styles.optionQuality}>{QUALITY_LABELS[id] || ''}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
