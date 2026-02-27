'use client';

import { useState } from 'react';
import styles from './AutoModelForm.module.css';

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

interface PlanConfig {
  aiProvider: string;
  aiModel: string;
  ttsProvider: string;
  ttsModel: string;
  sttProvider: string;
  sttModel: string;
}

interface PlatformConfig {
  aiProvider: string;
  aiModel: string;
}

interface AutoModelFormProps {
  initialConfig: {
    free: PlanConfig;
    pro: PlanConfig;
    platform: PlatformConfig;
  };
  aiProviders: ProviderOption[];
  ttsProviders: ProviderOption[];
  sttProviders: ProviderOption[];
}

function usePlanState(initial: PlanConfig, providers: { ai: ProviderOption[]; tts: ProviderOption[]; stt: ProviderOption[] }) {
  const [aiProvider, setAiProvider] = useState(initial.aiProvider);
  const [aiModel, setAiModel] = useState(initial.aiModel);
  const [ttsProvider, setTtsProvider] = useState(initial.ttsProvider);
  const [ttsModel, setTtsModel] = useState(initial.ttsModel);
  const [sttProvider, setSttProvider] = useState(initial.sttProvider);
  const [sttModel, setSttModel] = useState(initial.sttModel);

  const aiModels = providers.ai.find((p) => p.id === aiProvider)?.models ?? [];
  const ttsModels = providers.tts.find((p) => p.id === ttsProvider)?.models ?? [];
  const sttModels = providers.stt.find((p) => p.id === sttProvider)?.models ?? [];

  const handleAiProviderChange = (newProvider: string) => {
    setAiProvider(newProvider);
    const provider = providers.ai.find((p) => p.id === newProvider);
    if (provider && provider.models.length > 0) {
      setAiModel(provider.models[0].id);
    }
  };

  const handleTtsProviderChange = (newProvider: string) => {
    setTtsProvider(newProvider);
    const provider = providers.tts.find((p) => p.id === newProvider);
    if (provider && provider.models.length > 0) {
      setTtsModel(provider.models[0].id);
    }
  };

  const handleSttProviderChange = (newProvider: string) => {
    setSttProvider(newProvider);
    const provider = providers.stt.find((p) => p.id === newProvider);
    if (provider && provider.models.length > 0) {
      setSttModel(provider.models[0].id);
    }
  };

  return {
    aiProvider, aiModel, setAiModel, aiModels, handleAiProviderChange,
    ttsProvider, ttsModel, setTtsModel, ttsModels, handleTtsProviderChange,
    sttProvider, sttModel, setSttModel, sttModels, handleSttProviderChange,
    toData: () => ({ aiProvider, aiModel, ttsProvider, ttsModel, sttProvider, sttModel }),
  };
}

function PlanSection({
  label,
  state,
  aiProviders,
  ttsProviders,
  sttProviders,
}: {
  label: string;
  state: ReturnType<typeof usePlanState>;
  aiProviders: ProviderOption[];
  ttsProviders: ProviderOption[];
  sttProviders: ProviderOption[];
}) {
  const prefix = label.toLowerCase();

  return (
    <fieldset className={styles.section}>
      <legend className={styles.sectionTitle}>{label} Tier</legend>

      <div className={styles.field}>
        <label className={styles.label} htmlFor={`${prefix}-aiProvider`}>AI Provider</label>
        <select
          id={`${prefix}-aiProvider`}
          className={styles.select}
          value={state.aiProvider}
          onChange={(e) => state.handleAiProviderChange(e.target.value)}
        >
          {aiProviders.map((p) => (
            <option key={p.id} value={p.id}>{p.displayName}</option>
          ))}
        </select>
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor={`${prefix}-aiModel`}>AI Model</label>
        <select
          id={`${prefix}-aiModel`}
          className={styles.select}
          value={state.aiModel}
          onChange={(e) => state.setAiModel(e.target.value)}
        >
          {state.aiModels.map((m) => (
            <option key={m.id} value={m.id}>{m.displayName} ({m.tier})</option>
          ))}
        </select>
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor={`${prefix}-ttsProvider`}>TTS Provider</label>
        <select
          id={`${prefix}-ttsProvider`}
          className={styles.select}
          value={state.ttsProvider}
          onChange={(e) => state.handleTtsProviderChange(e.target.value)}
        >
          {ttsProviders.map((p) => (
            <option key={p.id} value={p.id}>{p.displayName}</option>
          ))}
        </select>
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor={`${prefix}-ttsModel`}>TTS Model</label>
        <select
          id={`${prefix}-ttsModel`}
          className={styles.select}
          value={state.ttsModel}
          onChange={(e) => state.setTtsModel(e.target.value)}
        >
          {state.ttsModels.map((m) => (
            <option key={m.id} value={m.id}>{m.displayName} ({m.tier})</option>
          ))}
        </select>
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor={`${prefix}-sttProvider`}>STT Provider</label>
        <select
          id={`${prefix}-sttProvider`}
          className={styles.select}
          value={state.sttProvider}
          onChange={(e) => state.handleSttProviderChange(e.target.value)}
        >
          {sttProviders.map((p) => (
            <option key={p.id} value={p.id}>{p.displayName}</option>
          ))}
        </select>
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor={`${prefix}-sttModel`}>STT Model</label>
        <select
          id={`${prefix}-sttModel`}
          className={styles.select}
          value={state.sttModel}
          onChange={(e) => state.setSttModel(e.target.value)}
        >
          {state.sttModels.map((m) => (
            <option key={m.id} value={m.id}>{m.displayName} ({m.tier})</option>
          ))}
        </select>
      </div>
    </fieldset>
  );
}

export function AutoModelForm({ initialConfig, aiProviders, ttsProviders, sttProviders }: AutoModelFormProps) {
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const providers = { ai: aiProviders, tts: ttsProviders, stt: sttProviders };
  const freeState = usePlanState(initialConfig.free, providers);
  const proState = usePlanState(initialConfig.pro, providers);

  const [platformAiProvider, setPlatformAiProvider] = useState(initialConfig.platform.aiProvider);
  const [platformAiModel, setPlatformAiModel] = useState(initialConfig.platform.aiModel);
  const platformAiModels = aiProviders.find((p) => p.id === platformAiProvider)?.models ?? [];

  const handlePlatformAiProviderChange = (newProvider: string) => {
    setPlatformAiProvider(newProvider);
    const provider = aiProviders.find((p) => p.id === newProvider);
    if (provider && provider.models.length > 0) {
      setPlatformAiModel(provider.models[0].id);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setSaved(false);

    try {
      const res = await fetch('/api/admin/auto-models', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          free: freeState.toData(),
          pro: proState.toData(),
          platform: { aiProvider: platformAiProvider, aiModel: platformAiModel },
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
      <PlanSection
        label="Free"
        state={freeState}
        aiProviders={aiProviders}
        ttsProviders={ttsProviders}
        sttProviders={sttProviders}
      />

      <PlanSection
        label="Pro"
        state={proState}
        aiProviders={aiProviders}
        ttsProviders={ttsProviders}
        sttProviders={sttProviders}
      />

      <fieldset className={styles.section}>
        <legend className={styles.sectionTitle}>Platform Operations</legend>
        <p className={styles.platformDescription}>
          AI model for internal platform tasks: handle screening (name/offensive classification) and credential lookup (participant verification via web search).
        </p>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="platform-aiProvider">AI Provider</label>
          <select
            id="platform-aiProvider"
            className={styles.select}
            value={platformAiProvider}
            onChange={(e) => handlePlatformAiProviderChange(e.target.value)}
          >
            {aiProviders.map((p) => (
              <option key={p.id} value={p.id}>{p.displayName}</option>
            ))}
          </select>
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="platform-aiModel">AI Model</label>
          <select
            id="platform-aiModel"
            className={styles.select}
            value={platformAiModel}
            onChange={(e) => setPlatformAiModel(e.target.value)}
          >
            {platformAiModels.map((m) => (
              <option key={m.id} value={m.id}>{m.displayName} ({m.tier})</option>
            ))}
          </select>
        </div>
      </fieldset>

      {error && (
        <div className={styles.error} role="alert">{error}</div>
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
