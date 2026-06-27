'use client';

import { useCallback, useMemo, useState } from 'react';
import { Glyph } from '@/components/Glyph';
import { TtsProviderLogo } from '@/components/ui/TtsProviderLogo';
import shell from '../../adminTheme.styles';

type LogoProvider = Parameters<typeof TtsProviderLogo>[0]['provider'];

// ---------------------------------------------------------------------------
// Shared types
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
// Key helpers
// ---------------------------------------------------------------------------

function toKey(provider: string, model: string, composite: boolean): string {
  return composite ? `${provider}:${model}` : model;
}

function parseKey(
  key: string,
  composite: boolean,
  providers: ProviderOption[]
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

function errorMessageFromResponseBody(body: unknown, fallback: string): string {
  if (!body || typeof body !== 'object') return fallback;
  const error = (body as { error?: unknown }).error;
  if (typeof error === 'string' && error.trim()) return error;
  if (error && typeof error === 'object') {
    const fieldErrors = (error as { fieldErrors?: Record<string, string[]> }).fieldErrors;
    if (fieldErrors) {
      const messages = Object.values(fieldErrors).flat().filter(Boolean);
      if (messages.length > 0) return messages.join(' ');
    }
    const formErrors = (error as { formErrors?: string[] }).formErrors;
    if (formErrors?.length) return formErrors.join(' ');
  }
  const details = (body as { details?: unknown }).details;
  if (details && typeof details === 'object') {
    const fieldErrors = (details as { fieldErrors?: Record<string, string[]> }).fieldErrors;
    if (fieldErrors) {
      const messages = Object.values(fieldErrors).flat().filter(Boolean);
      if (messages.length > 0) return messages.join(' ');
    }
  }
  return fallback;
}

function tierClass(tier: string): string {
  const t = tier.toLowerCase();
  if (t === 'fast') return `${shell.tierBadge} ${shell.tierFast}`;
  if (t === 'best' || t === 'max' || t === 'ultra' || t === 'premium') {
    return `${shell.tierBadge} ${shell.tierBest}`;
  }
  return shell.tierBadge;
}

// ---------------------------------------------------------------------------
// Unified model state hook
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
    () => new Set(cfg.initialIncluded ?? (initialDefaultKey ? [initialDefaultKey] : []))
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
    [defaultKey]
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
  lede?: string;
  state: UnifiedModelState;
}

function TaskSection({ title, icon, lede, state }: TaskSectionProps) {
  const { providers, compositeIds } = state;
  const [open, setOpen] = useState(false);

  const activeProviderId = state.defaultSelection.provider || providers[0]?.id || '';
  const [selectedProvider, setSelectedProvider] = useState(activeProviderId);

  const providerData = useMemo(
    () => providers.find((p) => p.id === selectedProvider) ?? providers[0],
    [providers, selectedProvider]
  );

  // Cards for the selected provider — a "use configured" card when it has no models.
  const cards = useMemo(() => {
    if (!providerData) return [];
    if (providerData.models.length === 0) {
      return [
        {
          id: '',
          displayName: `Use the configured ${providerData.displayName} model`,
          tier: '',
          price: undefined,
        },
      ];
    }
    return providerData.models;
  }, [providerData]);

  function handleProviderChange(newProvider: string) {
    setSelectedProvider(newProvider);
    const pData = providers.find((p) => p.id === newProvider);
    if (pData) {
      const firstKey = pData.models[0]
        ? toKey(newProvider, pData.models[0].id, compositeIds)
        : toKey(newProvider, '', compositeIds);
      state.setDefault(firstKey);
    }
  }

  const flatModels = useMemo(
    () =>
      providers.flatMap((p) => {
        if (p.models.length === 0) {
          return [
            {
              provider: p,
              model: {
                id: '',
                displayName: `${p.displayName} (configured)`,
                tier: '',
                price: undefined,
              },
              key: toKey(p.id, '', compositeIds),
            },
          ];
        }
        return p.models.map((m) => ({
          provider: p,
          model: m,
          key: toKey(p.id, m.id, compositeIds),
        }));
      }),
    [providers, compositeIds]
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
        {lede ? <p className={shell.sectionLede}>{lede}</p> : null}

        {/* Provider chips */}
        <div className={shell.pickLabel}>Provider</div>
        <div className={shell.provGrid} role="radiogroup" aria-label={`${title} provider`}>
          {providers.map((p) => {
            const on = selectedProvider === p.id;
            return (
              <button
                key={p.id}
                type="button"
                role="radio"
                aria-checked={on}
                aria-label={p.displayName}
                className={`${shell.provChip}${on ? ` ${shell.on}` : ''}`}
                onClick={() => handleProviderChange(p.id)}
              >
                <span className={shell.provChipLogo} aria-hidden="true">
                  <TtsProviderLogo provider={p.id as LogoProvider} size={20} />
                </span>
                <span className={shell.provChipName}>{p.displayName}</span>
              </button>
            );
          })}
        </div>

        {/* Model grid for the selected provider */}
        <div className={shell.pickLabel}>Default model</div>
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
                <div className={shell.mcName}>
                  {model.displayName}
                  {model.tier ? <span className={tierClass(model.tier)}>{model.tier}</span> : null}
                </div>
                {model.price && <div className={shell.mcPrice}>{model.price}</div>}
                <span className={shell.mcCheck} aria-hidden="true">
                  <Glyph name="check" size={14} />
                </span>
              </button>
            );
          })}
        </div>

        {/* Advanced: learner-available models */}
        <div className={shell.advWrap}>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            className={shell.advToggle}
            aria-label={`${open ? 'Collapse' : 'Expand'} learner-available models for ${title}`}
          >
            <Glyph name={open ? 'arrow' : 'plus'} size={12} />
            Learner-available models
          </button>

          {open && (
            <div className={shell.advList}>
              {flatModels.map(({ model, key, provider: prov }) => {
                const checked = state.included.has(key);
                const isDefault = key === state.defaultKey;
                return (
                  <label
                    key={key}
                    className={shell.advRow}
                    style={{ cursor: isDefault ? 'default' : 'pointer' }}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={isDefault}
                      onChange={() => state.toggleIncluded(key)}
                      aria-label={`${model.displayName} (${prov.displayName}) available to learners`}
                    />
                    <span>
                      <span style={{ fontWeight: 500 }}>{model.displayName}</span>
                      <span className={shell.advMeta}>
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
                className={shell.btnSm}
                style={{ alignSelf: 'flex-start', marginTop: '6px' }}
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
    [aiProviders, provider]
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
        <p className={shell.sectionLede}>
          AI model for internal platform tasks (handle screening, credential lookup, language
          detection) that run without learner context.
        </p>
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <label htmlFor="platform-provider" className={shell.pickLabel} style={{ margin: 0 }}>
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
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label htmlFor="platform-model" className={shell.pickLabel} style={{ margin: 0 }}>
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

// ---------------------------------------------------------------------------
// Root export
// ---------------------------------------------------------------------------

const SPEECH_LEDE =
  'Pick the default model new lessons use. Enable extra language-compatible models under ' +
  '“Learner-available models” so learners can switch in their own Settings.';

export function ProviderModelConfig({
  initialConfig,
  aiProviders,
  ttsProviders,
  sttProviders,
}: ProviderModelConfigProps) {
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const aiState = useUnifiedModelState({
    initialDefault: {
      provider: initialConfig.model.aiProvider,
      model: initialConfig.model.aiModel,
    },
    initialIncluded: initialConfig.includedModels,
    providers: aiProviders,
    compositeIds: false,
  });

  const ttsState = useUnifiedModelState({
    initialDefault: {
      provider: initialConfig.model.ttsProvider,
      model: initialConfig.model.ttsModel,
    },
    initialIncluded: initialConfig.includedTtsModels,
    providers: ttsProviders,
    compositeIds: true,
  });

  const sttState = useUnifiedModelState({
    initialDefault: {
      provider: initialConfig.model.sttProvider,
      model: initialConfig.model.sttModel,
    },
    initialIncluded: initialConfig.includedSttModels,
    providers: sttProviders,
    compositeIds: true,
  });

  const [platformAiProvider, setPlatformAiProvider] = useState(initialConfig.platform.aiProvider);
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
            ttsProvider: ttsState.defaultSelection.provider,
            ttsModel: ttsState.defaultSelection.model,
            sttProvider: sttState.defaultSelection.provider,
            sttModel: sttState.defaultSelection.model,
          },
          platform: { aiProvider: platformAiProvider, aiModel: platformAiModel },
          includedModels: setToArray(aiState.included),
          includedTtsModels: setToArray(ttsState.included),
          includedSttModels: setToArray(sttState.included),
        }),
      });

      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as unknown;
        throw new Error(errorMessageFromResponseBody(data, 'Failed to save provider changes.'));
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
      <TaskSection title="Text-to-speech" icon="volume" lede={SPEECH_LEDE} state={ttsState} />
      <TaskSection title="Speech-to-text" icon="mic" lede={SPEECH_LEDE} state={sttState} />

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
