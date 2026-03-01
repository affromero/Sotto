'use client';

import { useState } from 'react';
import { AllocationEditor, type Allocation } from './AllocationEditor';
import styles from './ConfigForm.module.css';

interface ModelOption {
  id: string;
  displayName: string;
  tier: string;
}

interface ProviderOption {
  id: string;
  displayName: string;
  models: ModelOption[];
}

interface ConfigFormProps {
  initialConfig: {
    aiProvider: string;
    aiModel: string;
    ttsProvider: string;
    ttsModel: string;
    sttProvider: string;
    sttModel: string;
    generationLimit: number;
    dailyGenerationLimit: number;
    aiAllocations: Allocation[];
    ttsAllocations: Allocation[];
  };
  aiProviders: ProviderOption[];
  ttsProviders: ProviderOption[];
  sttProviders: ProviderOption[];
}

export function ConfigForm({ initialConfig, aiProviders, ttsProviders, sttProviders }: ConfigFormProps) {
  const [aiProvider, setAiProvider] = useState(initialConfig.aiProvider);
  const [aiModel, setAiModel] = useState(initialConfig.aiModel);
  const [ttsProvider, setTtsProvider] = useState(initialConfig.ttsProvider);
  const [ttsModel, setTtsModel] = useState(initialConfig.ttsModel);
  const [sttProvider, setSttProvider] = useState(initialConfig.sttProvider);
  const [sttModel, setSttModel] = useState(initialConfig.sttModel);
  const [generationLimit, setGenerationLimit] = useState(initialConfig.generationLimit);
  const [dailyGenerationLimit, setDailyGenerationLimit] = useState(initialConfig.dailyGenerationLimit);
  const [useAiAllocations, setUseAiAllocations] = useState(initialConfig.aiAllocations.length > 0);
  const [aiAllocations, setAiAllocations] = useState<Allocation[]>(initialConfig.aiAllocations);
  const [useTtsAllocations, setUseTtsAllocations] = useState(initialConfig.ttsAllocations.length > 0);
  const [ttsAllocations, setTtsAllocations] = useState<Allocation[]>(initialConfig.ttsAllocations);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const aiModels = aiProviders.find((p) => p.id === aiProvider)?.models ?? [];
  const ttsModels = ttsProviders.find((p) => p.id === ttsProvider)?.models ?? [];
  const sttModels = sttProviders.find((p) => p.id === sttProvider)?.models ?? [];

  const handleAiProviderChange = (newProvider: string) => {
    setAiProvider(newProvider);
    const provider = aiProviders.find((p) => p.id === newProvider);
    if (provider && provider.models.length > 0) {
      setAiModel(provider.models[0].id);
    }
  };

  const handleTtsProviderChange = (newProvider: string) => {
    setTtsProvider(newProvider);
    const provider = ttsProviders.find((p) => p.id === newProvider);
    if (provider && provider.models.length > 0) {
      setTtsModel(provider.models[0].id);
    }
  };

  const handleSttProviderChange = (newProvider: string) => {
    setSttProvider(newProvider);
    const provider = sttProviders.find((p) => p.id === newProvider);
    if (provider && provider.models.length > 0) {
      setSttModel(provider.models[0].id);
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
        body: JSON.stringify({
          aiProvider, aiModel,
          ttsProvider, ttsModel,
          sttProvider, sttModel,
          generationLimit,
          dailyGenerationLimit,
          aiAllocations: useAiAllocations ? aiAllocations : [],
          ttsAllocations: useTtsAllocations ? ttsAllocations : [],
        }),
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
          {aiModels.map((m) => (
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
          onChange={(e) => handleTtsProviderChange(e.target.value)}
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
        <label className={styles.label} htmlFor="ttsModel">
          TTS Model
        </label>
        <select
          id="ttsModel"
          className={styles.select}
          value={ttsModel}
          onChange={(e) => setTtsModel(e.target.value)}
        >
          {ttsModels.map((m) => (
            <option key={m.id} value={m.id}>
              {m.displayName} ({m.tier})
            </option>
          ))}
        </select>
        <span className={styles.hint}>Model used for free tier voice generation</span>
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor="sttProvider">
          STT Provider
        </label>
        <select
          id="sttProvider"
          className={styles.select}
          value={sttProvider}
          onChange={(e) => handleSttProviderChange(e.target.value)}
        >
          {sttProviders.map((p) => (
            <option key={p.id} value={p.id}>
              {p.displayName}
            </option>
          ))}
        </select>
        <span className={styles.hint}>Speech-to-text provider for free tier transcription</span>
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor="sttModel">
          STT Model
        </label>
        <select
          id="sttModel"
          className={styles.select}
          value={sttModel}
          onChange={(e) => setSttModel(e.target.value)}
        >
          {sttModels.map((m) => (
            <option key={m.id} value={m.id}>
              {m.displayName} ({m.tier})
            </option>
          ))}
        </select>
        <span className={styles.hint}>Model used for free tier transcription</span>
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

      <div className={styles.field}>
        <label className={styles.label} htmlFor="dailyGenerationLimit">
          Daily Generation Limit
        </label>
        <input
          id="dailyGenerationLimit"
          type="number"
          className={styles.input}
          value={dailyGenerationLimit}
          onChange={(e) => setDailyGenerationLimit(parseInt(e.target.value, 10) || 0)}
          min={0}
          max={100}
        />
        <span className={styles.hint}>Max free podcasts per user per day (0 = unlimited)</span>
      </div>

      <div className={styles.field}>
        <label className={styles.toggleRow}>
          <input
            type="checkbox"
            checked={useAiAllocations}
            onChange={(e) => {
              setUseAiAllocations(e.target.checked);
              if (!e.target.checked) setAiAllocations([]);
            }}
          />
          <span className={styles.label}>Per-provider AI quotas</span>
        </label>
        <span className={styles.hint}>
          Distribute AI generations across multiple providers instead of using a single default
        </span>
      </div>

      {useAiAllocations && (
        <AllocationEditor
          label="AI"
          providers={aiProviders}
          allocations={aiAllocations}
          onChange={setAiAllocations}
          generationLimit={generationLimit}
        />
      )}

      <div className={styles.field}>
        <label className={styles.toggleRow}>
          <input
            type="checkbox"
            checked={useTtsAllocations}
            onChange={(e) => {
              setUseTtsAllocations(e.target.checked);
              if (!e.target.checked) setTtsAllocations([]);
            }}
          />
          <span className={styles.label}>Per-provider TTS quotas</span>
        </label>
        <span className={styles.hint}>
          Distribute TTS generations across multiple providers instead of using a single default
        </span>
      </div>

      {useTtsAllocations && (
        <AllocationEditor
          label="TTS"
          providers={ttsProviders}
          allocations={ttsAllocations}
          onChange={setTtsAllocations}
          generationLimit={generationLimit}
        />
      )}

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
