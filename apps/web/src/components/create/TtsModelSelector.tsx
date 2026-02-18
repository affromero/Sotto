'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import styles from './TtsModelSelector.module.css';

interface TtsModel {
  id: string;
  displayName: string;
  tier: 'standard' | 'premium' | 'ultra';
  isDefault: boolean;
}

const TIER_LABELS: Record<string, string> = {
  standard: 'Standard',
  premium: 'Premium',
  ultra: 'Ultra',
};

interface TtsModelSelectorProps {
  provider: string | undefined;
  value: string | undefined;
  onChange: (model: string | undefined) => void;
}

export function TtsModelSelector({ provider, value, onChange }: TtsModelSelectorProps) {
  const [models, setModels] = useState<TtsModel[]>([]);
  const [loading, setLoading] = useState(false);
  const prevProviderRef = useRef(provider);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const fetchModels = useCallback((providerId: string) => {
    setLoading(true);
    fetch(`/api/tts-models?provider=${encodeURIComponent(providerId)}`)
      .then((res) => res.json())
      .then((data) => {
        setModels(data.models || []);
      })
      .catch(() => {
        setModels([]);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const providerChanged = prevProviderRef.current !== provider;
    prevProviderRef.current = provider;

    if (providerChanged) {
      setModels([]);
    }

    if (!provider) {
      return;
    }

    fetchModels(provider);
  }, [provider, fetchModels]);

  // Reset parent value when provider changes (separate effect to avoid cascading render)
  useEffect(() => {
    // Only reset if value is set — avoids unnecessary calls on mount
    if (value !== undefined) {
      onChangeRef.current(undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider]);

  if (loading) return null;

  // Hide for single-model providers
  if (models.length <= 1) return null;

  return (
    <div className={styles.root}>
      <label className={styles.label}>TTS Model</label>
      <div className={styles.options}>
        {models.map((model) => (
          <button
            key={model.id}
            type="button"
            className={`${styles.option} ${
              value === model.id || (!value && model.isDefault) ? styles.optionActive : ''
            }`}
            onClick={() => onChange(model.isDefault ? undefined : model.id)}
          >
            <span className={styles.optionName}>{model.displayName}</span>
            <span className={styles.optionTier}>{TIER_LABELS[model.tier]}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
