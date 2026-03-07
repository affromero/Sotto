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
  };
  aiProviders: ProviderOption[];
  ttsProviders: ProviderOption[];
  sttProviders: ProviderOption[];
  imageProviders: ProviderOption[];
  videoProviders: ProviderOption[];
  avatarProviders: ProviderOption[];
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

/** Reusable hook for a single provider + model pair. */
function useProviderModelState(
  initialProvider: string,
  initialModel: string,
  providers: ProviderOption[],
) {
  const [provider, setProvider] = useState(initialProvider);
  const [model, setModel] = useState(initialModel);
  const models = providers.find((p) => p.id === provider)?.models ?? [];

  const handleProviderChange = (newProvider: string) => {
    setProvider(newProvider);
    const p = providers.find((pp) => pp.id === newProvider);
    if (p && p.models.length > 0) setModel(p.models[0].id);
  };

  return { provider, model, setModel, models, handleProviderChange };
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

/** Reusable provider + model selector for a modality (image, video, avatar). */
function ModalityTierSection({
  title,
  description,
  freeState,
  proState,
  providers,
}: {
  title: string;
  description: string;
  freeState: ReturnType<typeof useProviderModelState>;
  proState: ReturnType<typeof useProviderModelState>;
  providers: ProviderOption[];
}) {
  const slug = title.toLowerCase().replace(/\s+/g, '-');

  return (
    <fieldset className={styles.section}>
      <legend className={styles.sectionTitle}>{title}</legend>
      <p className={styles.platformDescription}>{description}</p>

      <div className={styles.field}>
        <label className={styles.label} htmlFor={`${slug}-free-provider`}>Free Provider</label>
        <select
          id={`${slug}-free-provider`}
          className={styles.select}
          value={freeState.provider}
          onChange={(e) => freeState.handleProviderChange(e.target.value)}
        >
          {providers.map((p) => (
            <option key={p.id} value={p.id}>{p.displayName}</option>
          ))}
        </select>
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor={`${slug}-free-model`}>Free Model</label>
        <select
          id={`${slug}-free-model`}
          className={styles.select}
          value={freeState.model}
          onChange={(e) => freeState.setModel(e.target.value)}
        >
          {freeState.models.map((m) => (
            <option key={m.id} value={m.id}>{m.displayName} ({m.tier})</option>
          ))}
        </select>
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor={`${slug}-pro-provider`}>Pro Provider</label>
        <select
          id={`${slug}-pro-provider`}
          className={styles.select}
          value={proState.provider}
          onChange={(e) => proState.handleProviderChange(e.target.value)}
        >
          {providers.map((p) => (
            <option key={p.id} value={p.id}>{p.displayName}</option>
          ))}
        </select>
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor={`${slug}-pro-model`}>Pro Model</label>
        <select
          id={`${slug}-pro-model`}
          className={styles.select}
          value={proState.model}
          onChange={(e) => proState.setModel(e.target.value)}
        >
          {proState.models.map((m) => (
            <option key={m.id} value={m.id}>{m.displayName} ({m.tier})</option>
          ))}
        </select>
      </div>
    </fieldset>
  );
}

function IncludedModelsEditor({
  title,
  description,
  providers,
  freeIncluded,
  proIncluded,
  freeDefault,
  proDefault,
  compositeIds,
  onFreeChange,
  onProChange,
  onClear,
}: {
  title: string;
  description: string;
  providers: ProviderOption[];
  freeIncluded: Set<string>;
  proIncluded: Set<string>;
  freeDefault: string;
  proDefault: string;
  compositeIds?: boolean;
  onFreeChange: (modelId: string, checked: boolean) => void;
  onProChange: (modelId: string, checked: boolean) => void;
  onClear: () => void;
}) {
  const hasOverrides = freeIncluded.size > 0 || proIncluded.size > 0;

  const modelKey = (providerId: string, modelId: string) =>
    compositeIds ? `${providerId}:${modelId}` : modelId;

  return (
    <fieldset className={styles.section}>
      <legend className={styles.sectionTitle}>{title}</legend>
      <p className={styles.platformDescription}>{description}</p>

      {!hasOverrides && (
        <p className={styles.defaultsHint}>
          Using defaults — only the auto model per tier is shown to users.
        </p>
      )}

      <div className={styles.providerCards}>
        {providers.filter((p) => p.models.length > 0).map((provider) => (
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
                <span className={styles.checkboxHeader}>Free</span>
                <span className={styles.checkboxHeader}>Pro</span>
              </div>

              {provider.models.map((model) => {
                const key = modelKey(provider.id, model.id);
                const isFreeDefault = key === freeDefault;
                const isProDefault = key === proDefault;

                return (
                  <div key={key} className={styles.modelRow}>
                    <span className={styles.modelName}>
                      {model.displayName}
                      <span className={styles.modelTier}>{model.tier}</span>
                      {(isFreeDefault || isProDefault) && (
                        <span className={styles.defaultBadge}>
                          {isFreeDefault && isProDefault ? 'default' : isFreeDefault ? 'free default' : 'pro default'}
                        </span>
                      )}
                    </span>
                    <label className={styles.checkboxCell}>
                      <input
                        type="checkbox"
                        className={styles.checkbox}
                        checked={freeIncluded.has(key)}
                        onChange={(e) => onFreeChange(key, e.target.checked)}
                      />
                    </label>
                    <label className={styles.checkboxCell}>
                      <input
                        type="checkbox"
                        className={styles.checkbox}
                        checked={proIncluded.has(key)}
                        onChange={(e) => onProChange(key, e.target.checked)}
                      />
                    </label>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {hasOverrides && (
        <button
          type="button"
          className={styles.clearButton}
          onClick={onClear}
        >
          Clear overrides (use defaults)
        </button>
      )}
    </fieldset>
  );
}

export function AutoModelForm({ initialConfig, aiProviders, ttsProviders, sttProviders, imageProviders, videoProviders, avatarProviders }: AutoModelFormProps) {
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const providers = { ai: aiProviders, tts: ttsProviders, stt: sttProviders };
  const freeState = usePlanState(initialConfig.free, providers);
  const proState = usePlanState(initialConfig.pro, providers);

  // AI included models state
  const [freeIncluded, setFreeIncluded] = useState<Set<string>>(
    new Set(initialConfig.freeIncludedModels ?? [])
  );
  const [proIncluded, setProIncluded] = useState<Set<string>>(
    new Set(initialConfig.proIncludedModels ?? [])
  );

  // TTS included models state
  const [freeIncludedTts, setFreeIncludedTts] = useState<Set<string>>(
    new Set(initialConfig.freeIncludedTtsModels ?? [])
  );
  const [proIncludedTts, setProIncludedTts] = useState<Set<string>>(
    new Set(initialConfig.proIncludedTtsModels ?? [])
  );

  // STT included models state
  const [freeIncludedStt, setFreeIncludedStt] = useState<Set<string>>(
    new Set(initialConfig.freeIncludedSttModels ?? [])
  );
  const [proIncludedStt, setProIncludedStt] = useState<Set<string>>(
    new Set(initialConfig.proIncludedSttModels ?? [])
  );

  // Image provider/model state (free + pro)
  const freeImage = useProviderModelState(initialConfig.freeImageProvider, initialConfig.freeImageModel, imageProviders);
  const proImage = useProviderModelState(initialConfig.proImageProvider, initialConfig.proImageModel, imageProviders);
  const [freeIncludedImage, setFreeIncludedImage] = useState<Set<string>>(new Set(initialConfig.freeIncludedImageModels ?? []));
  const [proIncludedImage, setProIncludedImage] = useState<Set<string>>(new Set(initialConfig.proIncludedImageModels ?? []));

  // Video provider/model state (free + pro)
  const freeVideo = useProviderModelState(initialConfig.freeVideoProvider, initialConfig.freeVideoModel, videoProviders);
  const proVideo = useProviderModelState(initialConfig.proVideoProvider, initialConfig.proVideoModel, videoProviders);
  const [freeIncludedVideo, setFreeIncludedVideo] = useState<Set<string>>(new Set(initialConfig.freeIncludedVideoModels ?? []));
  const [proIncludedVideo, setProIncludedVideo] = useState<Set<string>>(new Set(initialConfig.proIncludedVideoModels ?? []));

  // Avatar provider/model state (free + pro)
  const freeAvatar = useProviderModelState(initialConfig.freeAvatarProvider, initialConfig.freeAvatarModel, avatarProviders);
  const proAvatar = useProviderModelState(initialConfig.proAvatarProvider, initialConfig.proAvatarModel, avatarProviders);
  const [freeIncludedAvatar, setFreeIncludedAvatar] = useState<Set<string>>(new Set(initialConfig.freeIncludedAvatarModels ?? []));
  const [proIncludedAvatar, setProIncludedAvatar] = useState<Set<string>>(new Set(initialConfig.proIncludedAvatarModels ?? []));

  // Platform AI
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

  // Generic included model handlers
  function makeIncludedHandlers(
    setFree: React.Dispatch<React.SetStateAction<Set<string>>>,
    setPro: React.Dispatch<React.SetStateAction<Set<string>>>
  ) {
    const onFreeChange = (modelId: string, checked: boolean) => {
      setFree((prev) => {
        const next = new Set(prev);
        if (checked) next.add(modelId);
        else next.delete(modelId);
        return next;
      });
    };

    const onProChange = (modelId: string, checked: boolean) => {
      setPro((prev) => {
        const next = new Set(prev);
        if (checked) next.add(modelId);
        else next.delete(modelId);
        return next;
      });
    };

    const onClear = () => {
      setFree(new Set());
      setPro(new Set());
    };

    return { onFreeChange, onProChange, onClear };
  }

  const aiHandlers = makeIncludedHandlers(setFreeIncluded, setProIncluded);
  const ttsHandlers = makeIncludedHandlers(setFreeIncludedTts, setProIncludedTts);
  const sttHandlers = makeIncludedHandlers(setFreeIncludedStt, setProIncludedStt);
  const imageHandlers = makeIncludedHandlers(setFreeIncludedImage, setProIncludedImage);
  const videoHandlers = makeIncludedHandlers(setFreeIncludedVideo, setProIncludedVideo);
  const avatarHandlers = makeIncludedHandlers(setFreeIncludedAvatar, setProIncludedAvatar);

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
          free: freeState.toData(),
          pro: proState.toData(),
          platform: { aiProvider: platformAiProvider, aiModel: platformAiModel },
          freeIncludedModels: setToArray(freeIncluded),
          proIncludedModels: setToArray(proIncluded),
          freeIncludedTtsModels: setToArray(freeIncludedTts),
          proIncludedTtsModels: setToArray(proIncludedTts),
          freeIncludedSttModels: setToArray(freeIncludedStt),
          proIncludedSttModels: setToArray(proIncludedStt),
          // Image
          freeImageProvider: freeImage.provider,
          freeImageModel: freeImage.model,
          proImageProvider: proImage.provider,
          proImageModel: proImage.model,
          freeIncludedImageModels: setToArray(freeIncludedImage),
          proIncludedImageModels: setToArray(proIncludedImage),
          // Video
          freeVideoProvider: freeVideo.provider,
          freeVideoModel: freeVideo.model,
          proVideoProvider: proVideo.provider,
          proVideoModel: proVideo.model,
          freeIncludedVideoModels: setToArray(freeIncludedVideo),
          proIncludedVideoModels: setToArray(proIncludedVideo),
          // Avatar
          freeAvatarProvider: freeAvatar.provider,
          freeAvatarModel: freeAvatar.model,
          proAvatarProvider: proAvatar.provider,
          proAvatarModel: proAvatar.model,
          freeIncludedAvatarModels: setToArray(freeIncludedAvatar),
          proIncludedAvatarModels: setToArray(proIncludedAvatar),
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

      <IncludedModelsEditor
        title="Included AI Models"
        description="Control which AI models appear in the picker for non-BYOK users. Free models are always included in the Pro tier."
        providers={aiProviders}
        freeIncluded={freeIncluded}
        proIncluded={proIncluded}
        freeDefault={freeState.aiModel}
        proDefault={proState.aiModel}
        onFreeChange={aiHandlers.onFreeChange}
        onProChange={aiHandlers.onProChange}
        onClear={aiHandlers.onClear}
      />

      <IncludedModelsEditor
        title="Included TTS Models"
        description="Control which TTS models are available to non-BYOK users. Free models are always included in the Pro tier."
        providers={ttsProviders}
        freeIncluded={freeIncludedTts}
        proIncluded={proIncludedTts}
        freeDefault={`${freeState.ttsProvider}:${freeState.ttsModel}`}
        proDefault={`${proState.ttsProvider}:${proState.ttsModel}`}
        compositeIds
        onFreeChange={ttsHandlers.onFreeChange}
        onProChange={ttsHandlers.onProChange}
        onClear={ttsHandlers.onClear}
      />

      <IncludedModelsEditor
        title="Included STT Models"
        description="Control which STT models are available to non-BYOK users. Free models are always included in the Pro tier."
        providers={sttProviders}
        freeIncluded={freeIncludedStt}
        proIncluded={proIncludedStt}
        freeDefault={`${freeState.sttProvider}:${freeState.sttModel}`}
        proDefault={`${proState.sttProvider}:${proState.sttModel}`}
        compositeIds
        onFreeChange={sttHandlers.onFreeChange}
        onProChange={sttHandlers.onProChange}
        onClear={sttHandlers.onClear}
      />

      <ModalityTierSection
        title="Image Generation"
        description="Still image provider and model for video visuals (AI illustrations)."
        freeState={freeImage}
        proState={proImage}
        providers={imageProviders}
      />

      <IncludedModelsEditor
        title="Included Image Models"
        description="Control which image models are available for video generation."
        providers={imageProviders}
        freeIncluded={freeIncludedImage}
        proIncluded={proIncludedImage}
        freeDefault={`${freeImage.provider}:${freeImage.model}`}
        proDefault={`${proImage.provider}:${proImage.model}`}
        compositeIds
        onFreeChange={imageHandlers.onFreeChange}
        onProChange={imageHandlers.onProChange}
        onClear={imageHandlers.onClear}
      />

      <ModalityTierSection
        title="Video Generation"
        description="Text-to-video provider and model for animated video segments."
        freeState={freeVideo}
        proState={proVideo}
        providers={videoProviders}
      />

      <IncludedModelsEditor
        title="Included Video Models"
        description="Control which video models are available for text-to-video generation."
        providers={videoProviders}
        freeIncluded={freeIncludedVideo}
        proIncluded={proIncludedVideo}
        freeDefault={`${freeVideo.provider}:${freeVideo.model}`}
        proDefault={`${proVideo.provider}:${proVideo.model}`}
        compositeIds
        onFreeChange={videoHandlers.onFreeChange}
        onProChange={videoHandlers.onProChange}
        onClear={videoHandlers.onClear}
      />

      <ModalityTierSection
        title="Avatar Generation"
        description="Lip-sync avatar overlay provider and engine for video podcasts."
        freeState={freeAvatar}
        proState={proAvatar}
        providers={avatarProviders}
      />

      <IncludedModelsEditor
        title="Included Avatar Models"
        description="Control which avatar engines are available for lip-sync overlays."
        providers={avatarProviders}
        freeIncluded={freeIncludedAvatar}
        proIncluded={proIncludedAvatar}
        freeDefault={`${freeAvatar.provider}:${freeAvatar.model}`}
        proDefault={`${proAvatar.provider}:${proAvatar.model}`}
        compositeIds
        onFreeChange={avatarHandlers.onFreeChange}
        onProChange={avatarHandlers.onProChange}
        onClear={avatarHandlers.onClear}
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
