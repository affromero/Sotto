'use client';

import { useState, useEffect, useCallback } from 'react';
import type { TwitterConfigData } from '@/types/twitter';
import styles from './SettingsSection.module.css';

interface ProviderModelOption {
  id: string;
  displayName: string;
  tier: string;
}

interface ProviderOption {
  id: string;
  displayName: string;
  models: ProviderModelOption[];
}

export function SettingsSection() {
  const [config, setConfig] = useState<TwitterConfigData | null>(null);
  const [aiProviders, setAiProviders] = useState<ProviderOption[]>([]);
  const [ttsProviders, setTtsProviders] = useState<ProviderOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    try {
      const [configRes, modelsRes] = await Promise.all([
        fetch('/api/admin/twitter/config'),
        fetch('/api/admin/twitter/models'),
      ]);

      if (!configRes.ok) throw new Error('Failed to load config');
      if (!modelsRes.ok) throw new Error('Failed to load model options');

      const configData = await configRes.json();
      const modelsData = await modelsRes.json();

      setConfig(configData);
      setAiProviders(modelsData.aiProviders);
      setTtsProviders(modelsData.ttsProviders);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleTtsProviderChange = (newProvider: string) => {
    if (!config) return;
    const provider = ttsProviders.find((p) => p.id === newProvider);
    const firstModel = provider?.models[0]?.id ?? null;
    setConfig({
      ...config,
      defaultTtsProvider: newProvider || null,
      defaultTtsModel: firstModel,
    });
  };

  const handleSave = async () => {
    if (!config) return;
    setSaving(true);
    setError(null);
    setSaved(false);

    try {
      const res = await fetch('/api/admin/twitter/config', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          defaultAiModel: config.defaultAiModel,
          defaultTtsProvider: config.defaultTtsProvider,
          defaultTtsModel: config.defaultTtsModel,
        }),
      });

      if (!res.ok) throw new Error('Failed to save');
      setConfig(await res.json());
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className={styles.loading}>Loading...</div>;
  if (!config) return <div className={styles.error}>{error || 'Failed to load'}</div>;

  const allAiModels = aiProviders.flatMap((p) =>
    p.models.map((m) => ({ ...m, providerName: p.displayName }))
  );

  const ttsModels = config.defaultTtsProvider
    ? ttsProviders.find((p) => p.id === config.defaultTtsProvider)?.models ?? []
    : [];

  return (
    <div className={styles.section}>
      <div className={styles.form}>
        <p className={styles.description}>
          Default AI and audio models for Twitter-generated podcasts (trends and admin thread-to-podcast).
          Users can override these by specifying a model in their tweet.
        </p>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="defaultAiModel">
            AI Model
          </label>
          <select
            id="defaultAiModel"
            className={styles.select}
            value={config.defaultAiModel ?? ''}
            onChange={(e) => setConfig({ ...config, defaultAiModel: e.target.value || null })}
            aria-label="Default AI model for Twitter podcasts"
          >
            <option value="">System default</option>
            {allAiModels.map((m) => (
              <option key={m.id} value={m.id}>
                {m.displayName} ({m.providerName}) — {m.tier}
              </option>
            ))}
          </select>
          <span className={styles.hint}>
            Used for script generation in trend and admin-created podcasts
          </span>
        </div>

        <div className={styles.row}>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="defaultTtsProvider">
              TTS Provider
            </label>
            <select
              id="defaultTtsProvider"
              className={styles.select}
              value={config.defaultTtsProvider ?? ''}
              onChange={(e) => handleTtsProviderChange(e.target.value)}
              aria-label="Default TTS provider for Twitter podcasts"
            >
              <option value="">System default</option>
              {ttsProviders.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.displayName}
                </option>
              ))}
            </select>
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="defaultTtsModel">
              TTS Model
            </label>
            <select
              id="defaultTtsModel"
              className={styles.select}
              value={config.defaultTtsModel ?? ''}
              onChange={(e) => setConfig({ ...config, defaultTtsModel: e.target.value || null })}
              disabled={!config.defaultTtsProvider}
              aria-label="Default TTS model for Twitter podcasts"
            >
              <option value="">Default for provider</option>
              {ttsModels.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.displayName} ({m.tier})
                </option>
              ))}
            </select>
          </div>
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
          {saving ? 'Saving...' : saved ? 'Saved' : 'Save Defaults'}
        </button>
      </div>
    </div>
  );
}
