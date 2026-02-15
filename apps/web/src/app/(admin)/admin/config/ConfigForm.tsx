'use client';

import { useState } from 'react';
import styles from './ConfigForm.module.css';

interface AiModel {
  id: string;
  displayName: string;
  tier: string;
}

interface AiProvider {
  id: string;
  displayName: string;
  models: AiModel[];
}

interface TtsProvider {
  id: string;
  displayName: string;
}

interface ConfigFormProps {
  initialConfig: {
    aiProvider: string;
    aiModel: string;
    ttsProvider: string;
    generationLimit: number;
  };
  aiProviders: AiProvider[];
  ttsProviders: TtsProvider[];
}

export function ConfigForm({ initialConfig, aiProviders, ttsProviders }: ConfigFormProps) {
  const [aiProvider, setAiProvider] = useState(initialConfig.aiProvider);
  const [aiModel, setAiModel] = useState(initialConfig.aiModel);
  const [ttsProvider, setTtsProvider] = useState(initialConfig.ttsProvider);
  const [generationLimit, setGenerationLimit] = useState(initialConfig.generationLimit);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedAiProvider = aiProviders.find((p) => p.id === aiProvider);
  const models = selectedAiProvider?.models ?? [];

  // When AI provider changes, reset model to the first available
  const handleAiProviderChange = (newProvider: string) => {
    setAiProvider(newProvider);
    const provider = aiProviders.find((p) => p.id === newProvider);
    if (provider && provider.models.length > 0) {
      setAiModel(provider.models[0].id);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setSaved(false);

    try {
      const res = await fetch('/api/admin/config', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ aiProvider, aiModel, ttsProvider, generationLimit }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to save');
      }

      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={styles.form}>
      <div className={styles.field}>
        <label className={styles.label} htmlFor="aiProvider">
          AI Provider
        </label>
        <select
          id="aiProvider"
          className={styles.select}
          value={aiProvider}
          onChange={(e) => handleAiProviderChange(e.target.value)}
        >
          {aiProviders.map((p) => (
            <option key={p.id} value={p.id}>
              {p.displayName}
            </option>
          ))}
        </select>
        <span className={styles.hint}>Provider used for free tier generations</span>
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor="aiModel">
          AI Model
        </label>
        <select
          id="aiModel"
          className={styles.select}
          value={aiModel}
          onChange={(e) => setAiModel(e.target.value)}
        >
          {models.map((m) => (
            <option key={m.id} value={m.id}>
              {m.displayName} ({m.tier})
            </option>
          ))}
        </select>
        <span className={styles.hint}>Model used for free tier script generation</span>
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor="ttsProvider">
          TTS Provider
        </label>
        <select
          id="ttsProvider"
          className={styles.select}
          value={ttsProvider}
          onChange={(e) => setTtsProvider(e.target.value)}
        >
          {ttsProviders.map((p) => (
            <option key={p.id} value={p.id}>
              {p.displayName}
            </option>
          ))}
        </select>
        <span className={styles.hint}>Voice provider for free tier audio generation</span>
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor="generationLimit">
          Free Generation Limit
        </label>
        <input
          id="generationLimit"
          type="number"
          className={styles.input}
          value={generationLimit}
          onChange={(e) => setGenerationLimit(parseInt(e.target.value, 10) || 0)}
          min={0}
          max={100}
        />
        <span className={styles.hint}>Max free podcasts per user before requiring BYOK keys</span>
      </div>

      {error && (
        <div className={styles.error} role="alert">
          {error}
        </div>
      )}

      <button
        type="button"
        className={styles.saveButton}
        onClick={handleSave}
        disabled={saving}
      >
        {saving ? 'Saving...' : saved ? 'Saved' : 'Save Changes'}
      </button>
    </div>
  );
}
