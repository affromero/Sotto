'use client';

import { useCallback, useMemo, useState } from 'react';
import { Glyph } from '@/components/Glyph';
import shell from '../../adminTheme.module.css';

// ---------------------------------------------------------------------------
// Shared types (mirror AutoModelForm's prop shape exactly)
// ---------------------------------------------------------------------------

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

export interface ProviderModelConfigProps {
  initialConfig: {
    model: ModelConfig;
    platform: PlatformConfig;
    includedModels: string[] | null;
    includedTtsModels: string[] | null;
    includedSttModels: string[] | null;
  };
  aiProviders: ProviderOption[];
  ttsProviders: ProviderOption[];
  sttProviders: ProviderOption[];
}

// ---------------------------------------------------------------------------
// Key helpers — mirrors AutoModelForm toKey/parseKey/compositeIds convention
// ---------------------------------------------------------------------------

function toKey(provider: string, model: string, composite: boolean): string {
  return composite ? `${provider}:${model}` : model;
}

function parseKey(
  key: string,
  composite: boolean,
  providers: ProviderOption[],
): { provider: string; model: string } {
  if (composite) {
    const idx = key.indexOf(':');
    return { provider: key.slice(0, idx), model: key.slice(idx + 1) };
  }
  for (const p of providers) {
    if (p.models.some((m) => m.id === key)) {
      return { provider: p.id, model: key };
    }
  }
  return { provider: providers[0]?.id ?? '', model: key };
}

function firstModelKey(providers: ProviderOption[], composite: boolean): string {
  for (const p of providers) {
    const m = p.models[0];
    if (m) return toKey(p.id, m.id, composite);
  }
  // For providers with no models (e.g. codex) — fall back to empty composite key
  if (providers[0]) return toKey(providers[0].id, '', composite);
  return '';
}

function setToArray(set: Set<string>): string[] | null {
  return set.size > 0 ? [...set] : null;
}

// ---------------------------------------------------------------------------
// Unified model state hook — identical logic to AutoModelForm
// ---------------------------------------------------------------------------

interface UnifiedStateConfig {
  initialDefault: { provider: string; model: string };
  initialIncluded: string[] | null;
  providers: ProviderOption[];
  compositeIds: boolean;
}

function useUnifiedModelState(cfg: UnifiedStateConfig) {
  const { providers, compositeIds } = cfg;

  const initialDefaultKey =
    toKey(cfg.initialDefault.provider, cfg.initialDefault.model, compositeIds) ||
    firstModelKey(providers, compositeIds);

  const [defaultKey, setDefaultKey] = useState(initialDefaultKey);
  const [included, setIncluded] = useState<Set<string>>(
    () => new Set(cfg.initialIncluded ?? (initialDefaultKey ? [initialDefaultKey] : [])),
  );

  const setDefault = useCallback((key: string) => {
    setDefaultKey(key);
    setIncluded((prev) => {
      const next = new Set(prev);
      next.add(key);
      return next;
    });
  }, []);

  const toggleIncluded = useCallback(
    (key: string) => {
      setIncluded((prev) => {
        const next = new Set(prev);
        if (key === defaultKey) {
          next.add(key);
          return next;
        }
        if (next.has(key)) next.delete(key);
        else next.add(key);
        return next;
      });
    },
    [defaultKey],
  );

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

// ---------------------------------------------------------------------------
// TaskSection: one panel per task (AI / TTS / STT)
// ---------------------------------------------------------------------------

interface TaskSectionProps {
  title: string;
  icon: 'spark' | 'volume' | 'mic';
  state: UnifiedModelState;
}

function TaskSection({ title, icon, state }: TaskSectionProps) {
  const { providers, compositeIds } = state;
  const [open, setOpen] = useState(false);

  // Derive the active provider from the current defaultKey
  const activeProviderId = state.defaultSelection.provider || providers[0]?.id || '';
  const [selectedProvider, setSelectedProvider] = useState(activeProviderId);

  const providerData = useMemo(
    () => providers.find((p) => p.id === selectedProvider) ?? providers[0],
    [providers, selectedProvider],
  );

  // Cards to display — if no models, show a single "use configured" card
  const cards = useMemo(() => {
    if (!providerData) return [];
    if (providerData.models.length === 0) {
      // Codex / local provider with no enumerated models
      return [{ id: '', displayName: `Use the configured ${providerData.displayName} model`, tier: '', price: undefined }];
    }
    return providerData.models;
  }, [providerData]);

  function handleProviderChange(newProvider: string) {
    setSelectedProvider(newProvider);
    // Auto-select first model of new provider
    const pData = providers.find((p) => p.id === newProvider);
    if (pData) {
      const firstKey = pData.models[0]
        ? toKey(newProvider, pData.models[0].id, compositeIds)
        : toKey(newProvider, '', compositeIds);
      state.setDefault(firstKey);
    }
  }

  // Flat list for the advanced learner-available section
  const flatModels = useMemo(
    () =>
      providers.flatMap((p) => {
        if (p.models.length === 0) {
          return [{ provider: p, model: { id: '', displayName: `${p.displayName} (configured)`, tier: '', price: undefined }, key: toKey(p.id, '', compositeIds) }];
        }
        return p.models.map((m) => ({
          provider: p,
          model: m,
          key: toKey(p.id, m.id, compositeIds),
        }));
      }),
    [providers, compositeIds],
  );

  return (
    <div className={shell.panel}>
      <div className={shell.panelHead}>
        <span className={shell.phTitle}>
          <Glyph name={icon} size={15} />
          {title}
        </span>
      </div>

      <div className={shell.panelBody}>
        {/* Step 1: Provider chooser */}
        <div style={{ marginBottom: '16px' }}>
          <div
            style={{
              fontFamily: 'var(--mono)',
              fontSize: '10px',
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
              color: 'var(--ink-mute)',
              marginBottom: '8px',
            }}
          >
            Provider
          </div>
          <div
            className={shell.seg}
            role="radiogroup"
            aria-label={`${title} provider`}
          >
            {providers.map((p) => (
              <button
                key={p.id}
                type="button"
                role="radio"
                aria-checked={selectedProvider === p.id}
                aria-label={p.displayName}
                className={selectedProvider === p.id ? shell.on : ''}
                onClick={() => handleProviderChange(p.id)}
                style={{ minHeight: '44px' }}
              >
                {p.displayName}
              </button>
            ))}
          </div>
        </div>

        {/* Step 2: Model grid for the selected provider */}
        <div
          style={{
            fontFamily: 'var(--mono)',
            fontSize: '10px',
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            color: 'var(--ink-mute)',
            marginBottom: '10px',
          }}
        >
          Model
        </div>
        <div className={shell.modelGrid} role="radiogroup" aria-label={`${title} model`}>
          {cards.map((model) => {
            const cardKey = toKey(selectedProvider, model.id, compositeIds);
            const isSelected = state.defaultKey === cardKey;
            return (
              <button
                key={cardKey}
                type="button"
                role="radio"
                aria-checked={isSelected}
                aria-label={`Select ${model.displayName}`}
                className={`${shell.modelCard}${isSelected ? ` ${shell.on}` : ''}`}
                onClick={() => state.setDefault(cardKey)}
                style={{ minHeight: '44px' }}
              >
                <div className={shell.mcName}>{model.displayName}</div>
                {model.tier && <div className={shell.mcNote}>{model.tier}</div>}
                {model.price && <div className={shell.mcPrice}>{model.price}</div>}
                <span className={shell.mcCheck} aria-hidden="true">
                  <Glyph name="check" size={14} />
                </span>
              </button>
            );
          })}
        </div>

        {/* Advanced: learner-available models (collapsible) */}
        <div style={{ marginTop: '16px', borderTop: '1px solid var(--line)', paddingTop: '14px' }}>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              fontFamily: 'var(--mono)',
              fontSize: '10px',
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
              color: 'var(--ink-mute)',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '0',
              minHeight: '44px',
            }}
            aria-label={`${open ? 'Collapse' : 'Expand'} learner-available models for ${title}`}
          >
            <Glyph name={open ? 'arrow' : 'plus'} size={12} />
            Advanced: learner-available models
          </button>

          {open && (
            <div style={{ marginTop: '10px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {flatModels.map(({ model, key, provider: prov }) => {
                const checked = state.included.has(key);
                const isDefault = key === state.defaultKey;
                return (
                  <label
                    key={key}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '10px',
                      fontSize: '13px',
                      color: 'var(--ink)',
                      cursor: isDefault ? 'default' : 'pointer',
                      minHeight: '44px',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={isDefault}
                      onChange={() => state.toggleIncluded(key)}
                      aria-label={`${model.displayName} (${prov.displayName}) available to learners`}
                      style={{ width: '16px', height: '16px', flexShrink: 0 }}
                    />
                    <span>
                      <span style={{ fontWeight: 500 }}>{model.displayName}</span>
                      <span
                        style={{
                          fontFamily: 'var(--mono)',
                          fontSize: '10px',
                          color: 'var(--ink-mute)',
                          marginLeft: '7px',
                        }}
                      >
                        {prov.displayName}
                        {isDefault ? ' · current default' : ''}
                      </span>
                    </span>
                  </label>
                );
              })}
              <button
                type="button"
                onClick={state.reset}
                style={{
                  background: 'none',
                  border: '1px solid var(--line-strong)',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontFamily: 'var(--sans)',
                  fontSize: '11.5px',
                  color: 'var(--ink-soft)',
                  padding: '6px 10px',
                  marginTop: '4px',
                  alignSelf: 'flex-start',
                  minHeight: '44px',
                }}
                aria-label={`Reset ${title} to default model only`}
              >
                Reset to default only
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Platform operations — compact provider + model dropdowns
// ---------------------------------------------------------------------------

interface PlatformSectionProps {
  aiProviders: ProviderOption[];
  initialPlatformAiProvider: string;
  initialPlatformAiModel: string;
  onChange: (provider: string, model: string) => void;
}

function PlatformSection({
  aiProviders,
  initialPlatformAiProvider,
  initialPlatformAiModel,
  onChange,
}: PlatformSectionProps) {
  const [provider, setProvider] = useState(initialPlatformAiProvider);
  const [model, setModel] = useState(initialPlatformAiModel);

  const models = useMemo(
    () => aiProviders.find((p) => p.id === provider)?.models ?? [],
    [aiProviders, provider],
  );

  function handleProvider(newProvider: string) {
    setProvider(newProvider);
    const pData = aiProviders.find((p) => p.id === newProvider);
    const firstModel = pData?.models[0]?.id ?? '';
    setModel(firstModel);
    onChange(newProvider, firstModel);
  }

  function handleModel(newModel: string) {
    setModel(newModel);
    onChange(provider, newModel);
  }

  return (
    <div className={shell.panel}>
      <div className={shell.panelHead}>
        <span className={shell.phTitle}>
          <Glyph name="gear" size={15} />
          Platform operations AI
        </span>
      </div>
      <div className={shell.panelBody}>
        <p
          style={{
            fontSize: '13px',
            color: 'var(--ink-soft)',
            marginTop: 0,
            marginBottom: '14px',
            lineHeight: 1.6,
          }}
        >
          AI model for internal platform tasks (handle screening, credential lookup, language
          detection) that run without learner context.
        </p>
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
            <label
              htmlFor="platform-provider"
              style={{
                fontFamily: 'var(--mono)',
                fontSize: '10px',
                letterSpacing: '0.1em',
                textTransform: 'uppercase',
                color: 'var(--ink-mute)',
              }}
            >
              Provider
            </label>
            <select
              id="platform-provider"
              className={shell.uselect}
              value={provider}
              onChange={(e) => handleProvider(e.target.value)}
              aria-label="Platform AI provider"
              style={{ minHeight: '44px' }}
            >
              {aiProviders.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.displayName}
                </option>
              ))}
            </select>
          </div>

          {models.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
              <label
                htmlFor="platform-model"
                style={{
                  fontFamily: 'var(--mono)',
                  fontSize: '10px',
                  letterSpacing: '0.1em',
                  textTransform: 'uppercase',
                  color: 'var(--ink-mute)',
                }}
              >
                Model
              </label>
              <select
                id="platform-model"
                className={shell.uselect}
                value={model}
                onChange={(e) => handleModel(e.target.value)}
                aria-label="Platform AI model"
                style={{ minHeight: '44px' }}
              >
                {models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.displayName} ({m.tier})
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

interface SpeechProviderOnlySectionProps {
  title: string;
  icon: 'volume' | 'mic';
  providers: ProviderOption[];
  selectedProvider: string;
  onProviderChange: (provider: string) => void;
}

function SpeechProviderOnlySection({
  title,
  icon,
  providers,
  selectedProvider,
  onProviderChange,
}: SpeechProviderOnlySectionProps) {
  const activeProvider = providers.find((provider) => provider.id === selectedProvider) ?? providers[0];
  const modelCount = activeProvider?.models.length ?? 0;

  return (
    <div className={shell.panel}>
      <div className={shell.panelHead}>
        <span className={shell.phTitle}>
          <Glyph name={icon} size={15} />
          {title}
        </span>
      </div>
      <div className={shell.panelBody}>
        <p
          style={{
            fontSize: '13px',
            color: 'var(--ink-soft)',
            marginTop: 0,
            marginBottom: '14px',
            lineHeight: 1.6,
          }}
        >
          Admin chooses the provider for the install. Learners choose the compatible model for
          their language from their own Settings page.
        </p>
        <div className={shell.seg} role="radiogroup" aria-label={`${title} provider`}>
          {providers.map((provider) => (
            <button
              key={provider.id}
              type="button"
              role="radio"
              aria-checked={selectedProvider === provider.id}
              aria-label={provider.displayName}
              className={selectedProvider === provider.id ? shell.on : ''}
              onClick={() => onProviderChange(provider.id)}
              style={{ minHeight: '44px' }}
            >
              {provider.displayName}
            </button>
          ))}
        </div>
        {activeProvider ? (
          <p
            style={{
              fontSize: '12.5px',
              color: 'var(--ink-mute)',
              margin: '12px 0 0',
            }}
          >
            {modelCount} {modelCount === 1 ? 'model' : 'models'} will be available for
            language-aware learner selection when provider access is configured.
          </p>
        ) : null}
      </div>
    </div>
  );
}

function firstModelForProvider(providers: ProviderOption[], providerId: string): string {
  return providers.find((provider) => provider.id === providerId)?.models[0]?.id ?? '';
}

// ---------------------------------------------------------------------------
// Root export
// ---------------------------------------------------------------------------

export function ProviderModelConfig({
  initialConfig,
  aiProviders,
  ttsProviders,
  sttProviders,
}: ProviderModelConfigProps) {
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Unified model states (same logic as AutoModelForm)
  const aiState = useUnifiedModelState({
    initialDefault: {
      provider: initialConfig.model.aiProvider,
      model: initialConfig.model.aiModel,
    },
    initialIncluded: initialConfig.includedModels,
    providers: aiProviders,
    compositeIds: false,
  });

  const [ttsProvider, setTtsProvider] = useState(initialConfig.model.ttsProvider);
  const [sttProvider, setSttProvider] = useState(initialConfig.model.sttProvider);

  const [platformAiProvider, setPlatformAiProvider] = useState(
    initialConfig.platform.aiProvider,
  );
  const [platformAiModel, setPlatformAiModel] = useState(initialConfig.platform.aiModel);

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
            ttsProvider,
            ttsModel: firstModelForProvider(ttsProviders, ttsProvider),
            sttProvider,
            sttModel: firstModelForProvider(sttProviders, sttProvider),
          },
          platform: { aiProvider: platformAiProvider, aiModel: platformAiModel },
          includedModels: setToArray(aiState.included),
          includedTtsModels: null,
          includedSttModels: null,
        }),
      });

      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error ?? 'Failed to save');
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
    <div>
      <TaskSection title="Language model (AI)" icon="spark" state={aiState} />
      <SpeechProviderOnlySection
        title="Text-to-speech provider"
        icon="volume"
        providers={ttsProviders}
        selectedProvider={ttsProvider}
        onProviderChange={setTtsProvider}
      />
      <SpeechProviderOnlySection
        title="Speech-to-text provider"
        icon="mic"
        providers={sttProviders}
        selectedProvider={sttProvider}
        onProviderChange={setSttProvider}
      />

      <PlatformSection
        aiProviders={aiProviders}
        initialPlatformAiProvider={platformAiProvider}
        initialPlatformAiModel={platformAiModel}
        onChange={(p, m) => {
          setPlatformAiProvider(p);
          setPlatformAiModel(m);
        }}
      />

      {error && (
        <div
          role="alert"
          style={{
            background: 'color-mix(in oklab, var(--danger) 13%, transparent)',
            border: '1px solid color-mix(in oklab, var(--danger) 40%, transparent)',
            borderRadius: '8px',
            padding: '12px 16px',
            fontSize: '13.5px',
            color: 'var(--danger)',
            marginBottom: '14px',
          }}
        >
          {error}
        </div>
      )}

      <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
        <button
          type="button"
          className={`${shell.btnSm} ${shell.primary}`}
          onClick={handleSave}
          disabled={saving}
          aria-label="Save provider and model changes"
        >
          {saving ? 'Saving…' : saved ? 'Saved' : 'Save changes'}
        </button>
        {saved && (
          <span
            style={{
              fontFamily: 'var(--mono)',
              fontSize: '11px',
              color: 'var(--ok)',
              display: 'flex',
              alignItems: 'center',
              gap: '5px',
            }}
          >
            <Glyph name="check" size={12} />
            Saved
          </span>
        )}
      </div>
    </div>
  );
}
