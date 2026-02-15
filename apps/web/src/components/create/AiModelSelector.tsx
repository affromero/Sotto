'use client';

import { useEffect, useState } from 'react';
import styles from './AiModelSelector.module.css';

interface AiModel {
  id: string;
  displayName: string;
  tier: 'fast' | 'balanced' | 'best';
  isDefault: boolean;
}

const TIER_LABELS: Record<string, string> = {
  fast: 'Fast',
  balanced: 'Balanced',
  best: 'Best',
};

interface AiModelSelectorProps {
  value: string | undefined;
  onChange: (model: string | undefined) => void;
}

export function AiModelSelector({ value, onChange }: AiModelSelectorProps) {
  const [models, setModels] = useState<AiModel[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/ai-models')
      .then((res) => res.json())
      .then((data) => {
        setModels(data.models || []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) return null;

  // No BYOK AI key → free tier users don't get model selection
  if (models.length === 0) return null;

  return (
    <div className={styles.root}>
      <label className={styles.label}>AI Model</label>
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
