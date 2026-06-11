'use client';

import { useCallback, useMemo, useState } from 'react';
import styles from './AutoModelForm.module.css';

interface ModelOption {
  id: string;
  displayName: string;
  tier: string;
  price?: string;
}

interface ProviderOption {
  id: string;
  displayName: string;
  models: ModelOption[];
}

interface ModelConfig {
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
    model: ModelConfig;
    platform: PlatformConfig;
    includedModels: string[] | null;
    includedTtsModels: string[] | null;
    includedSttModels: string[] | null;
    imageProvider: string;
    imageModel: string;
    includedImageModels: string[] | null;
    videoProvider: string;
    videoModel: string;
    includedVideoModels: string[] | null;
    avatarProvider: string;
    avatarModel: string;
    includedAvatarModels: string[] | null;
    motionProvider: string;
  };
  aiProviders: ProviderOption[];
  ttsProviders: ProviderOption[];
  sttProviders: ProviderOption[];
  imageProviders: ProviderOption[];
  videoProviders: ProviderOption[];
  avatarProviders: ProviderOption[];
}

interface UnifiedStateConfig {
  initialDefault: { provider: string; model: string };
  initialIncluded: string[] | null;
  providers: ProviderOption[];
  compositeIds: boolean;
}

function toKey(provider: string, model: string, composite: boolean): string {
  return composite ? `${provider}:${model}` : model;
}

function parseKey(key: string, composite: boolean, providers: ProviderOption[]): { provider: string; model: string } {
  if (composite) {
    const idx = key.indexOf(':');
    return { provider: key.slice(0, idx), model: key.slice(idx + 1) };
  }

  for (const provider of providers) {
    if (provider.models.some((model) => model.id === key)) {
      return { provider: provider.id, model: key };
    }
  }

  return { provider: providers[0]?.id ?? '', model: key };
}

function firstModelKey(providers: ProviderOption[], composite: boolean): string {
  for (const provider of providers) {
    const model = provider.models[0];
    if (model) return toKey(provider.id, model.id, composite);
  }
  return '';
}

function useUnifiedModelState(config: UnifiedStateConfig) {
  const { providers, compositeIds } = config;
  const initialDefaultKey =
    toKey(config.initialDefault.provider, config.initialDefault.model, compositeIds) ||
    firstModelKey(providers, compositeIds);

  const [defaultKey, setDefaultKey] = useState(initialDefaultKey);
  const [included, setIncluded] = useState<Set<string>>(
    () => new Set(config.initialIncluded ?? (initialDefaultKey ? [initialDefaultKey] : [])),
  );

  const setDefault = useCallback((key: string) => {
    setDefaultKey(key);
    setIncluded((prev) => {
      const next = new Set(prev);
      next.add(key);
      return next;
    });
  }, []);

  const toggleIncluded = useCallback((key: string) => {
    setIncluded((prev) => {
      const next = new Set(prev);
      if (key === defaultKey) {
        next.add(key);
        return next;
      }
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }, [defaultKey]);

  const reset = useCallback(() => {
    setDefaultKey(initialDefaultKey);
    setIncluded(new Set(initialDefaultKey ? [initialDefaultKey] : []));
  }, [initialDefaultKey]);

  return {
    defaultKey,
    defaultSelection: parseKey(defaultKey, compositeIds, providers),
    included,
    providers,
    compositeIds,
    setDefault,
    toggleIncluded,
    reset,
  };
}

type UnifiedModelState = ReturnType<typeof useUnifiedModelState>;

function setToArray(set: Set<string>): string[] | null {
  return set.size > 0 ? [...set] : null;
}

function UnifiedModelEditor({
  title,
  description,
  state,
}: {
  title: string;
  description: string;
  state: UnifiedModelState;
}) {
  const { providers, compositeIds } = state;
  const flatModels = useMemo(
    () =>
      providers.flatMap((provider) =>
        provider.models.map((model) => ({
          provider,
          model,
          key: toKey(provider.id, model.id, compositeIds),
        })),
      ),
    [providers, compositeIds],
  );

  return (
    <fieldset className={styles.section}>
      <legend className={styles.sectionTitle}>{title}</legend>
      <p className={styles.platformDescription}>{description}</p>

      <div className={styles.field}>
        <label className={styles.label} htmlFor={`${title}-default`}>
          Default model
        </label>
        <select
          id={`${title}-default`}
          className={styles.select}
          value={state.defaultKey}
          onChange={(event) => state.setDefault(event.target.value)}
        >
          {flatModels.map(({ provider, model, key }) => (
            <option key={key} value={key}>
              {provider.displayName} - {model.displayName} ({model.tier})
            </option>
          ))}
        </select>
      </div>

      <div className={styles.providerCards}>
        {providers.filter((provider) => provider.models.length > 0).map((provider) => (
          <div key={provider.id} className={styles.providerCard}>
            <div className={styles.providerCardHeader}>
              <span className={styles.providerCardName}>{provider.displayName}</span>
              <span className={styles.providerModelCount}>
                {provider.models.length} model{provider.models.length !== 1 ? 's' : ''}
              </span>
            </div>
            <div className={styles.providerCardBody}>
              {provider.models.map((model) => {
                const key = toKey(provider.id, model.id, compositeIds);
                const checked = state.included.has(key);
                const isDefault = key === state.defaultKey;
                return (
                  <label key={key} className={styles.modelRow}>
                    <span className={styles.modelName}>
                      {model.displayName}
                      <span className={styles.modelTier}>{isDefault ? 'default' : model.tier}</span>
                      {model.price && <span className={styles.modelPrice}>{model.price}</span>}
                    </span>
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={isDefault}
                      onChange={() => state.toggleIncluded(key)}
                      aria-label={`${model.displayName} available`}
                    />
                  </label>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <button type="button" className={styles.clearButton} onClick={state.reset}>
        Reset to default only
      </button>
    </fieldset>
  );
}

export function AutoModelForm({
  initialConfig,
  aiProviders,
  ttsProviders,
  sttProviders,
  imageProviders,
  videoProviders,
  avatarProviders,
}: AutoModelFormProps) {
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const aiState = useUnifiedModelState({
    initialDefault: { provider: initialConfig.model.aiProvider, model: initialConfig.model.aiModel },
    initialIncluded: initialConfig.includedModels,
    providers: aiProviders,
    compositeIds: false,
  });

  const ttsState = useUnifiedModelState({
    initialDefault: { provider: initialConfig.model.ttsProvider, model: initialConfig.model.ttsModel },
    initialIncluded: initialConfig.includedTtsModels,
    providers: ttsProviders,
    compositeIds: true,
  });

  const sttState = useUnifiedModelState({
    initialDefault: { provider: initialConfig.model.sttProvider, model: initialConfig.model.sttModel },
    initialIncluded: initialConfig.includedSttModels,
    providers: sttProviders,
    compositeIds: true,
  });

  const imageState = useUnifiedModelState({
    initialDefault: { provider: initialConfig.imageProvider, model: initialConfig.imageModel },
    initialIncluded: initialConfig.includedImageModels,
    providers: imageProviders,
    compositeIds: false,
  });

  const videoState = useUnifiedModelState({
    initialDefault: { provider: initialConfig.videoProvider, model: initialConfig.videoModel },
    initialIncluded: initialConfig.includedVideoModels,
    providers: videoProviders,
    compositeIds: false,
  });

  const avatarState = useUnifiedModelState({
    initialDefault: { provider: initialConfig.avatarProvider, model: initialConfig.avatarModel },
    initialIncluded: initialConfig.includedAvatarModels,
    providers: avatarProviders,
    compositeIds: false,
  });

  const [platformAiProvider, setPlatformAiProvider] = useState(initialConfig.platform.aiProvider);
  const [platformAiModel, setPlatformAiModel] = useState(initialConfig.platform.aiModel);
  const [motionProvider, setMotionProvider] = useState(initialConfig.motionProvider);

  const platformAiModels = aiProviders.find((provider) => provider.id === platformAiProvider)?.models ?? [];

  function handlePlatformAiProviderChange(newProvider: string) {
    setPlatformAiProvider(newProvider);
    const provider = aiProviders.find((item) => item.id === newProvider);
    const firstModel = provider?.models[0];
    if (firstModel) setPlatformAiModel(firstModel.id);
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    setSaved(false);

    try {
      const res = await fetch('/api/v1/admin/auto-models', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: {
            aiProvider: aiState.defaultSelection.provider,
            aiModel: aiState.defaultSelection.model,
            ttsProvider: ttsState.defaultSelection.provider,
            ttsModel: ttsState.defaultSelection.model,
            sttProvider: sttState.defaultSelection.provider,
            sttModel: sttState.defaultSelection.model,
          },
          platform: { aiProvider: platformAiProvider, aiModel: platformAiModel },
          includedModels: setToArray(aiState.included),
          includedTtsModels: setToArray(ttsState.included),
          includedSttModels: setToArray(sttState.included),
          imageProvider: imageState.defaultSelection.provider,
          imageModel: imageState.defaultSelection.model,
          includedImageModels: setToArray(imageState.included),
          videoProvider: videoState.defaultSelection.provider,
          videoModel: videoState.defaultSelection.model,
          includedVideoModels: setToArray(videoState.included),
          avatarProvider: avatarState.defaultSelection.provider,
          avatarModel: avatarState.defaultSelection.model,
          includedAvatarModels: setToArray(avatarState.included),
          motionProvider,
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
  }

  return (
    <div className={styles.form}>
      <UnifiedModelEditor
        title="AI Models"
        description="Choose the default AI model and the server-configured models available in the picker."
        state={aiState}
      />

      <UnifiedModelEditor
        title="TTS Models"
        description="Choose the default text-to-speech model and the server-configured models available for voice generation."
        state={ttsState}
      />

      <UnifiedModelEditor
        title="STT Models"
        description="Choose the default transcription model and the server-configured models available for imports."
        state={sttState}
      />

      <UnifiedModelEditor
        title="Image Models"
        description="Choose the default image model and the server-configured models available for storyboards."
        state={imageState}
      />

      <UnifiedModelEditor
        title="Video Models"
        description="Choose the default video model and the server-configured models available for text-to-video generation."
        state={videoState}
      />

      <UnifiedModelEditor
        title="Avatar Models"
        description="Choose the default avatar engine and the server-configured models available for lip-sync overlays."
        state={avatarState}
      />

      <fieldset className={styles.section}>
        <legend className={styles.sectionTitle}>Motion Graphics</legend>
        <p className={styles.platformDescription}>
          Rendering engine for programmatic visual types such as charts, quotes, and timelines.
        </p>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="motionProvider">Provider</label>
          <select
            id="motionProvider"
            className={styles.select}
            value={motionProvider}
            onChange={(event) => setMotionProvider(event.target.value)}
          >
            <option value="remotion">Remotion (React)</option>
            <option value="hera">Hera (AI Motion)</option>
          </select>
        </div>
      </fieldset>

      <fieldset className={styles.section}>
        <legend className={styles.sectionTitle}>Platform Operations</legend>
        <p className={styles.platformDescription}>
          AI model for internal platform tasks such as handle screening, credential lookup, and language detection.
        </p>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="platform-aiProvider">AI Provider</label>
          <select
            id="platform-aiProvider"
            className={styles.select}
            value={platformAiProvider}
            onChange={(event) => handlePlatformAiProviderChange(event.target.value)}
          >
            {aiProviders.map((provider) => (
              <option key={provider.id} value={provider.id}>{provider.displayName}</option>
            ))}
          </select>
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="platform-aiModel">AI Model</label>
          <select
            id="platform-aiModel"
            className={styles.select}
            value={platformAiModel}
            onChange={(event) => setPlatformAiModel(event.target.value)}
          >
            {platformAiModels.map((model) => (
              <option key={model.id} value={model.id}>{model.displayName} ({model.tier})</option>
            ))}
          </select>
        </div>
      </fieldset>

      {error && <div className={styles.error} role="alert">{error}</div>}

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
