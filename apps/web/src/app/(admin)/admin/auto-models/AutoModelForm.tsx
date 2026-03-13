'use client';

import { useState, useCallback } from 'react';
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
    freeIncludedModels: string[] | null;
    proIncludedModels: string[] | null;
    freeIncludedTtsModels: string[] | null;
    proIncludedTtsModels: string[] | null;
    freeIncludedSttModels: string[] | null;
    proIncludedSttModels: string[] | null;
    freeImageProvider: string;
    freeImageModel: string;
    proImageProvider: string;
    proImageModel: string;
    freeIncludedImageModels: string[] | null;
    proIncludedImageModels: string[] | null;
    freeVideoProvider: string;
    freeVideoModel: string;
    proVideoProvider: string;
    proVideoModel: string;
    freeIncludedVideoModels: string[] | null;
    proIncludedVideoModels: string[] | null;
    freeAvatarProvider: string;
    freeAvatarModel: string;
    proAvatarProvider: string;
    proAvatarModel: string;
    freeIncludedAvatarModels: string[] | null;
    proIncludedAvatarModels: string[] | null;
    freeMusicProvider: string;
    freeMusicModel: string;
    proMusicProvider: string;
    proMusicModel: string;
    freeIncludedMusicModels: string[] | null;
    proIncludedMusicModels: string[] | null;
    dailyGenerationLimit: number;
    dailyGenerationLimitPro: number;
    dailyVideoLimit: number;
    dailyVideoLimitPro: number;
    dailyMusicLimit: number;
    dailyMusicLimitPro: number;
  };
  aiProviders: ProviderOption[];
  ttsProviders: ProviderOption[];
  sttProviders: ProviderOption[];
  imageProviders: ProviderOption[];
  videoProviders: ProviderOption[];
  avatarProviders: ProviderOption[];
  musicProviders: ProviderOption[];
}

// --- Tri-state hook ---

type TriState = 'off' | 'enabled' | 'default';

interface ModalityStateConfig {
  initialFreeDefault: { provider: string; model: string };
  initialProDefault: { provider: string; model: string };
  initialFreeIncluded: string[] | null;
  initialProIncluded: string[] | null;
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
  for (const p of providers) {
    if (p.models.some(m => m.id === key)) return { provider: p.id, model: key };
  }
  return { provider: providers[0]?.id ?? '', model: key };
}

function firstModelKey(providers: ProviderOption[], composite: boolean): string {
  for (const p of providers) {
    if (p.models.length > 0) return toKey(p.id, p.models[0].id, composite);
  }
  return '';
}

function useModalityState(config: ModalityStateConfig) {
  const { providers, compositeIds } = config;

  const initFreeKey = toKey(config.initialFreeDefault.provider, config.initialFreeDefault.model, compositeIds);
  const initProKey = toKey(config.initialProDefault.provider, config.initialProDefault.model, compositeIds);

  const [freeDefaultKey, setFreeDefaultKey] = useState(initFreeKey);
  const [proDefaultKey, setProDefaultKey] = useState(initProKey);
  const [freeIncluded, setFreeIncluded] = useState<Set<string>>(
    () => new Set(config.initialFreeIncluded ?? [])
  );
  const [proIncluded, setProIncluded] = useState<Set<string>>(
    () => new Set(config.initialProIncluded ?? [])
  );

  const getState = useCallback((tier: 'free' | 'pro', key: string): TriState => {
    const defaultKey = tier === 'free' ? freeDefaultKey : proDefaultKey;
    const included = tier === 'free' ? freeIncluded : proIncluded;
    if (key === defaultKey) return 'default';
    if (included.has(key)) return 'enabled';
    return 'off';
  }, [freeDefaultKey, proDefaultKey, freeIncluded, proIncluded]);

  const findFirstEnabled = useCallback((tier: 'free' | 'pro', excludeKey: string): string | null => {
    const included = tier === 'free' ? freeIncluded : proIncluded;
    for (const p of providers) {
      for (const m of p.models) {
        const k = toKey(p.id, m.id, compositeIds);
        if (k !== excludeKey && included.has(k)) return k;
      }
    }
    return null;
  }, [freeIncluded, proIncluded, providers, compositeIds]);

  const cycle = useCallback((tier: 'free' | 'pro', key: string) => {
    const setDefault = tier === 'free' ? setFreeDefaultKey : setProDefaultKey;
    const setIncluded = tier === 'free' ? setFreeIncluded : setProIncluded;
    const defaultKey = tier === 'free' ? freeDefaultKey : proDefaultKey;
    const included = tier === 'free' ? freeIncluded : proIncluded;

    let current: TriState;
    if (key === defaultKey) current = 'default';
    else if (included.has(key)) current = 'enabled';
    else current = 'off';

    if (current === 'off') {
      // off → enabled
      setIncluded(prev => {
        const next = new Set(prev);
        next.add(key);
        return next;
      });
    } else if (current === 'enabled') {
      // enabled → default (previous default stays in included)
      const prevDefault = defaultKey;
      setDefault(key);
      setIncluded(prev => {
        const next = new Set(prev);
        next.add(key);
        if (prevDefault && prevDefault !== key) next.add(prevDefault);
        return next;
      });
    } else {
      // default → off: remove from included, pick fallback
      const fallback = findFirstEnabled(tier, key) ?? firstModelKey(providers, compositeIds);
      setDefault(fallback);
      setIncluded(prev => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  }, [freeDefaultKey, proDefaultKey, freeIncluded, proIncluded, findFirstEnabled, providers, compositeIds]);

  const clear = useCallback(() => {
    setFreeDefaultKey(initFreeKey);
    setProDefaultKey(initProKey);
    setFreeIncluded(new Set());
    setProIncluded(new Set());
  }, [initFreeKey, initProKey]);

  const hasOverrides = freeIncluded.size > 0 || proIncluded.size > 0;

  return {
    getState,
    cycle,
    freeDefault: parseKey(freeDefaultKey, compositeIds, providers),
    proDefault: parseKey(proDefaultKey, compositeIds, providers),
    freeIncluded,
    proIncluded,
    clear,
    hasOverrides,
    providers,
    compositeIds,
  };
}

type ModalityState = ReturnType<typeof useModalityState>;

// --- Tri-state toggle icon SVGs ---

function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path d="M3 7l3 3 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function StarIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path d="M7 1l1.76 3.57L13 5.24l-3 2.92.71 4.13L7 10.27 3.29 12.29 4 8.16 1 5.24l4.24-.67L7 1z" fill="currentColor" />
    </svg>
  );
}

// --- Unified Model Editor ---

function UnifiedModelEditor({
  title,
  description,
  state,
}: {
  title: string;
  description: string;
  state: ModalityState;
}) {
  const { providers, compositeIds } = state;

  const modelKey = (providerId: string, modelId: string) =>
    toKey(providerId, modelId, compositeIds);

  const ariaLabel = (modelName: string, tier: string, triState: TriState): string => {
    switch (triState) {
      case 'off': return `${modelName} ${tier} tier: off. Click to enable.`;
      case 'enabled': return `${modelName} ${tier} tier: enabled. Click to set as default.`;
      case 'default': return `${modelName} ${tier} tier: default. Click to disable.`;
    }
  };

  return (
    <fieldset className={styles.section}>
      <legend className={styles.sectionTitle}>{title}</legend>
      <p className={styles.platformDescription}>{description}</p>

      {!state.hasOverrides && (
        <p className={styles.defaultsHint}>
          Using defaults — only the auto model per tier is shown to users.
        </p>
      )}

      <div className={styles.providerCards}>
        {providers.filter(p => p.models.length > 0).map(provider => (
          <div key={provider.id} className={styles.providerCard}>
            <div className={styles.providerCardHeader}>
              <span className={styles.providerCardName}>{provider.displayName}</span>
              <span className={styles.providerModelCount}>
                {provider.models.length} model{provider.models.length !== 1 ? 's' : ''}
              </span>
            </div>

            <div className={styles.providerCardBody}>
              <div className={styles.providerCardColumns}>
                <span className={styles.modelNameHeader}>Model</span>
                <span className={styles.tierHeader}>Free</span>
                <span className={styles.tierHeader}>Pro</span>
              </div>

              {provider.models.map(model => {
                const key = modelKey(provider.id, model.id);
                const freeState = state.getState('free', key);
                const proState = state.getState('pro', key);

                return (
                  <div key={key} className={styles.modelRow}>
                    <span className={styles.modelName}>
                      {model.displayName}
                      <span className={styles.modelTier}>{model.tier}</span>
                      {model.price && (
                        <span className={styles.modelPrice}>{model.price}</span>
                      )}
                    </span>
                    <div className={styles.triToggleCell}>
                      <button
                        type="button"
                        className={`${styles.triToggle} ${
                          freeState === 'enabled' ? styles.triToggleEnabled :
                          freeState === 'default' ? styles.triToggleDefault : ''
                        }`}
                        aria-label={ariaLabel(model.displayName, 'free', freeState)}
                        onClick={() => state.cycle('free', key)}
                      >
                        {freeState === 'enabled' && <CheckIcon />}
                        {freeState === 'default' && <StarIcon />}
                      </button>
                    </div>
                    <div className={styles.triToggleCell}>
                      <button
                        type="button"
                        className={`${styles.triToggle} ${
                          proState === 'enabled' ? styles.triToggleEnabled :
                          proState === 'default' ? styles.triToggleDefault : ''
                        }`}
                        aria-label={ariaLabel(model.displayName, 'pro', proState)}
                        onClick={() => state.cycle('pro', key)}
                      >
                        {proState === 'enabled' && <CheckIcon />}
                        {proState === 'default' && <StarIcon />}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {state.hasOverrides && (
        <button
          type="button"
          className={styles.clearButton}
          onClick={state.clear}
        >
          Clear overrides (use defaults)
        </button>
      )}
    </fieldset>
  );
}

// --- Main form ---

export function AutoModelForm({ initialConfig, aiProviders, ttsProviders, sttProviders, imageProviders, videoProviders, avatarProviders, musicProviders }: AutoModelFormProps) {
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 7 modality states
  const aiState = useModalityState({
    initialFreeDefault: { provider: initialConfig.free.aiProvider, model: initialConfig.free.aiModel },
    initialProDefault: { provider: initialConfig.pro.aiProvider, model: initialConfig.pro.aiModel },
    initialFreeIncluded: initialConfig.freeIncludedModels,
    initialProIncluded: initialConfig.proIncludedModels,
    providers: aiProviders,
    compositeIds: false,
  });

  const ttsState = useModalityState({
    initialFreeDefault: { provider: initialConfig.free.ttsProvider, model: initialConfig.free.ttsModel },
    initialProDefault: { provider: initialConfig.pro.ttsProvider, model: initialConfig.pro.ttsModel },
    initialFreeIncluded: initialConfig.freeIncludedTtsModels,
    initialProIncluded: initialConfig.proIncludedTtsModels,
    providers: ttsProviders,
    compositeIds: true,
  });

  const sttState = useModalityState({
    initialFreeDefault: { provider: initialConfig.free.sttProvider, model: initialConfig.free.sttModel },
    initialProDefault: { provider: initialConfig.pro.sttProvider, model: initialConfig.pro.sttModel },
    initialFreeIncluded: initialConfig.freeIncludedSttModels,
    initialProIncluded: initialConfig.proIncludedSttModels,
    providers: sttProviders,
    compositeIds: true,
  });

  const imageState = useModalityState({
    initialFreeDefault: { provider: initialConfig.freeImageProvider, model: initialConfig.freeImageModel },
    initialProDefault: { provider: initialConfig.proImageProvider, model: initialConfig.proImageModel },
    initialFreeIncluded: initialConfig.freeIncludedImageModels,
    initialProIncluded: initialConfig.proIncludedImageModels,
    providers: imageProviders,
    compositeIds: true,
  });

  const videoState = useModalityState({
    initialFreeDefault: { provider: initialConfig.freeVideoProvider, model: initialConfig.freeVideoModel },
    initialProDefault: { provider: initialConfig.proVideoProvider, model: initialConfig.proVideoModel },
    initialFreeIncluded: initialConfig.freeIncludedVideoModels,
    initialProIncluded: initialConfig.proIncludedVideoModels,
    providers: videoProviders,
    compositeIds: true,
  });

  const avatarState = useModalityState({
    initialFreeDefault: { provider: initialConfig.freeAvatarProvider, model: initialConfig.freeAvatarModel },
    initialProDefault: { provider: initialConfig.proAvatarProvider, model: initialConfig.proAvatarModel },
    initialFreeIncluded: initialConfig.freeIncludedAvatarModels,
    initialProIncluded: initialConfig.proIncludedAvatarModels,
    providers: avatarProviders,
    compositeIds: true,
  });

  const musicState = useModalityState({
    initialFreeDefault: { provider: initialConfig.freeMusicProvider, model: initialConfig.freeMusicModel },
    initialProDefault: { provider: initialConfig.proMusicProvider, model: initialConfig.proMusicModel },
    initialFreeIncluded: initialConfig.freeIncludedMusicModels,
    initialProIncluded: initialConfig.proIncludedMusicModels,
    providers: musicProviders,
    compositeIds: true,
  });

  // Platform AI (stays as dropdown — not a modality toggle)
  const [platformAiProvider, setPlatformAiProvider] = useState(initialConfig.platform.aiProvider);
  const [platformAiModel, setPlatformAiModel] = useState(initialConfig.platform.aiModel);
  const platformAiModels = aiProviders.find(p => p.id === platformAiProvider)?.models ?? [];

  const handlePlatformAiProviderChange = (newProvider: string) => {
    setPlatformAiProvider(newProvider);
    const provider = aiProviders.find(p => p.id === newProvider);
    if (provider && provider.models.length > 0) {
      setPlatformAiModel(provider.models[0].id);
    }
  };

  // Daily limits
  const [dailyGenerationLimit, setDailyGenerationLimit] = useState(initialConfig.dailyGenerationLimit);
  const [dailyGenerationLimitPro, setDailyGenerationLimitPro] = useState(initialConfig.dailyGenerationLimitPro);
  const [dailyVideoLimit, setDailyVideoLimit] = useState(initialConfig.dailyVideoLimit);
  const [dailyVideoLimitPro, setDailyVideoLimitPro] = useState(initialConfig.dailyVideoLimitPro);
  const [dailyMusicLimit, setDailyMusicLimit] = useState(initialConfig.dailyMusicLimit);
  const [dailyMusicLimitPro, setDailyMusicLimitPro] = useState(initialConfig.dailyMusicLimitPro);

  const setToArray = (s: Set<string>) => s.size > 0 ? [...s] : null;

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setSaved(false);

    try {
      const res = await fetch('/api/admin/auto-models', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          free: {
            aiProvider: aiState.freeDefault.provider,
            aiModel: aiState.freeDefault.model,
            ttsProvider: ttsState.freeDefault.provider,
            ttsModel: ttsState.freeDefault.model,
            sttProvider: sttState.freeDefault.provider,
            sttModel: sttState.freeDefault.model,
          },
          pro: {
            aiProvider: aiState.proDefault.provider,
            aiModel: aiState.proDefault.model,
            ttsProvider: ttsState.proDefault.provider,
            ttsModel: ttsState.proDefault.model,
            sttProvider: sttState.proDefault.provider,
            sttModel: sttState.proDefault.model,
          },
          platform: { aiProvider: platformAiProvider, aiModel: platformAiModel },
          freeIncludedModels: setToArray(aiState.freeIncluded),
          proIncludedModels: setToArray(aiState.proIncluded),
          freeIncludedTtsModels: setToArray(ttsState.freeIncluded),
          proIncludedTtsModels: setToArray(ttsState.proIncluded),
          freeIncludedSttModels: setToArray(sttState.freeIncluded),
          proIncludedSttModels: setToArray(sttState.proIncluded),
          freeImageProvider: imageState.freeDefault.provider,
          freeImageModel: imageState.freeDefault.model,
          proImageProvider: imageState.proDefault.provider,
          proImageModel: imageState.proDefault.model,
          freeIncludedImageModels: setToArray(imageState.freeIncluded),
          proIncludedImageModels: setToArray(imageState.proIncluded),
          freeVideoProvider: videoState.freeDefault.provider,
          freeVideoModel: videoState.freeDefault.model,
          proVideoProvider: videoState.proDefault.provider,
          proVideoModel: videoState.proDefault.model,
          freeIncludedVideoModels: setToArray(videoState.freeIncluded),
          proIncludedVideoModels: setToArray(videoState.proIncluded),
          freeAvatarProvider: avatarState.freeDefault.provider,
          freeAvatarModel: avatarState.freeDefault.model,
          proAvatarProvider: avatarState.proDefault.provider,
          proAvatarModel: avatarState.proDefault.model,
          freeIncludedAvatarModels: setToArray(avatarState.freeIncluded),
          proIncludedAvatarModels: setToArray(avatarState.proIncluded),
          freeMusicProvider: musicState.freeDefault.provider,
          freeMusicModel: musicState.freeDefault.model,
          proMusicProvider: musicState.proDefault.provider,
          proMusicModel: musicState.proDefault.model,
          freeIncludedMusicModels: setToArray(musicState.freeIncluded),
          proIncludedMusicModels: setToArray(musicState.proIncluded),
          dailyGenerationLimit,
          dailyGenerationLimitPro,
          dailyVideoLimit,
          dailyVideoLimitPro,
          dailyMusicLimit,
          dailyMusicLimitPro,
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
      <UnifiedModelEditor
        title="AI Models"
        description="Control which AI models appear in the picker for non-BYOK users. Star = default for the tier."
        state={aiState}
      />

      <UnifiedModelEditor
        title="TTS Models"
        description="Control which TTS models are available to non-BYOK users."
        state={ttsState}
      />

      <UnifiedModelEditor
        title="STT Models"
        description="Control which STT models are available to non-BYOK users."
        state={sttState}
      />

      <UnifiedModelEditor
        title="Image Models"
        description="Control which image models are available for video generation."
        state={imageState}
      />

      <UnifiedModelEditor
        title="Video Models"
        description="Control which video models are available for text-to-video generation."
        state={videoState}
      />

      <UnifiedModelEditor
        title="Avatar Models"
        description="Control which avatar engines are available for lip-sync overlays."
        state={avatarState}
      />

      <UnifiedModelEditor
        title="Music Models"
        description="Control which music models are available for background music generation."
        state={musicState}
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

      <fieldset className={styles.section}>
        <legend className={styles.sectionTitle}>Daily Limits</legend>
        <p className={styles.platformDescription}>
          Maximum generations per user per day. 0 = unlimited.
        </p>

        <div className={styles.dailyLimitsGrid}>
          <span className={styles.dailyLimitsHeader} />
          <span className={styles.dailyLimitsHeader}>Free</span>
          <span className={styles.dailyLimitsHeader}>Pro</span>

          <label className={styles.dailyLimitsLabel} htmlFor="dailyGenerationLimit">Podcasts</label>
          <input
            id="dailyGenerationLimit"
            type="number"
            className={styles.select}
            min={0}
            value={dailyGenerationLimit}
            onChange={(e) => setDailyGenerationLimit(parseInt(e.target.value, 10) || 0)}
          />
          <input
            id="dailyGenerationLimitPro"
            type="number"
            className={styles.select}
            min={0}
            value={dailyGenerationLimitPro}
            onChange={(e) => setDailyGenerationLimitPro(parseInt(e.target.value, 10) || 0)}
          />

          <label className={styles.dailyLimitsLabel} htmlFor="dailyVideoLimit">Videos</label>
          <input
            id="dailyVideoLimit"
            type="number"
            className={styles.select}
            min={0}
            value={dailyVideoLimit}
            onChange={(e) => setDailyVideoLimit(parseInt(e.target.value, 10) || 0)}
          />
          <input
            id="dailyVideoLimitPro"
            type="number"
            className={styles.select}
            min={0}
            value={dailyVideoLimitPro}
            onChange={(e) => setDailyVideoLimitPro(parseInt(e.target.value, 10) || 0)}
          />

          <label className={styles.dailyLimitsLabel} htmlFor="dailyMusicLimit">Music</label>
          <input
            id="dailyMusicLimit"
            type="number"
            className={styles.select}
            min={0}
            value={dailyMusicLimit}
            onChange={(e) => setDailyMusicLimit(parseInt(e.target.value, 10) || 0)}
          />
          <input
            id="dailyMusicLimitPro"
            type="number"
            className={styles.select}
            min={0}
            value={dailyMusicLimitPro}
            onChange={(e) => setDailyMusicLimitPro(parseInt(e.target.value, 10) || 0)}
          />
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
