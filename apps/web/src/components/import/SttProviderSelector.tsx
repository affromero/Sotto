'use client';

import { useEffect, useState } from 'react';
import styles from './SttProviderSelector.module.css';

interface SttProviderInfo {
  id: string;
  displayName: string;
  description: string;
}

interface SttProviderSelectorProps {
  value: string | undefined;
  onChange: (provider: string | undefined) => void;
}

export function SttProviderSelector({ value, onChange }: SttProviderSelectorProps) {
  const [providers, setProviders] = useState<SttProviderInfo[]>([]);
  const [configuredProviders, setConfiguredProviders] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/stt-providers')
      .then((res) => res.json())
      .then((data) => {
        setProviders(data.providers || []);
        setConfiguredProviders(data.configuredProviders || []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading || providers.length === 0) return null;

  return (
    <div className={styles.root}>
      <label className={styles.label}>Transcription Provider</label>
      <div className={styles.options}>
        {providers.map((provider) => {
          const isAvailable = configuredProviders.includes(provider.id);
          const isActive = value === provider.id || (!value && provider.id === 'openai');

          return (
            <button
              key={provider.id}
              type="button"
              className={`${styles.option} ${isActive ? styles.optionActive : ''} ${!isAvailable ? styles.optionDisabled : ''}`}
              onClick={() => {
                if (!isAvailable) return;
                onChange(provider.id === 'openai' ? undefined : provider.id);
              }}
              disabled={!isAvailable}
              title={isAvailable ? provider.description : 'Add API key in Settings to enable'}
            >
              <span className={styles.optionName}>{provider.displayName}</span>
              {!isAvailable && <span className={styles.optionUnavailable}>No key</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
