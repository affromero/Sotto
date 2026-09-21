'use client';

import { useEffect, useMemo, useState } from 'react';
import { useCredentialEditor } from './useCredentialEditor';
import { LANGUAGE_DISPLAY } from '@sotto/shared';
import type { TtsProviderClientMeta } from '@/lib/providers/tts-registry';
import { normalizeSottoLanguageCode, SOTTO_LANGUAGE_CODES } from '@/lib/speech-language-support';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { TtsProviderLogo } from '@/components/ui/TtsProviderLogo';
import styles from './ProviderCards.module.css';

interface ProviderStatus {
  provider: string;
  isValid: boolean;
}

interface TtsProviderCardsProps {
  initialConfigured: Array<ProviderStatus>;
  providerMeta: TtsProviderClientMeta[];
  preferredLanguage?: string | null;
  onReadyChange?: (ready: boolean) => void;
}

const QUALITY_LABELS: Record<string, string> = {
  standard: 'Standard',
  premium: 'Premium',
  ultra: 'Ultra',
};

const TIER_RANK: Record<string, number> = {
  ultra: 3,
  premium: 2,
  standard: 1,
};

const CUSTOM_ALLOWANCE_PRESET = 'custom';

function languageName(code: string): string {
  return LANGUAGE_DISPLAY[code as keyof typeof LANGUAGE_DISPLAY] ?? code.toUpperCase();
}

function fieldKey(providerId: string, key: string): string {
  return `${providerId}-${key}`;
}

function formatAllowanceLimit(value: number, unitLabel: string): string {
  return `${new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(value)} ${unitLabel}/month`;
}

function isAllowanceField(provider: TtsProviderClientMeta, key: string): boolean {
  const allowance = provider.usageAllowance;
  if (!allowance) return false;
  return (
    key === allowance.planField ||
    key === allowance.allowanceField ||
    key === allowance.resetDayField
  );
}

function summarizeLanguageSupport(
  provider: TtsProviderClientMeta,
  preferredLanguage?: string | null
) {
  const language = normalizeSottoLanguageCode(preferredLanguage);
  const languageCount = new Set(provider.models.flatMap((model) => model.supportedLanguages)).size;

  if (!language) {
    return {
      tone: 'neutral' as const,
      label: `${languageCount}/${SOTTO_LANGUAGE_CODES.size} Sotto languages`,
    };
  }

  const compatible = provider.models
    .filter((model) => model.supportedLanguages.includes(language))
    .sort((a, b) => (TIER_RANK[b.tier] ?? 0) - (TIER_RANK[a.tier] ?? 0));

  if (compatible[0]) {
    return {
      tone: 'ok' as const,
      label: `${languageName(language)} ready via ${compatible[0].displayName}`,
    };
  }

  return {
    tone: 'warn' as const,
    label: `No ${languageName(language)} TTS model`,
  };
}

export function TtsProviderCards({
  initialConfigured,
  providerMeta,
  preferredLanguage,
  onReadyChange,
}: TtsProviderCardsProps) {
  const credentials = useCredentialEditor('byok');
  const configured = useMemo(
    () =>
      new Map(
        (credentials.snapshot?.keys ?? initialConfigured).map((key) => [key.provider, key.isValid])
      ),
    [credentials.snapshot, initialConfigured]
  );
  useEffect(() => {
    if (credentials.snapshot) onReadyChange?.(credentials.snapshot.keys.some((key) => key.isValid));
  }, [credentials.snapshot, onReadyChange]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
  const sortedProviderMeta = useMemo(() => {
    return [...providerMeta].sort((a, b) => {
      const aRank = configured.get(a.id) ? 0 : configured.has(a.id) ? 1 : 2;
      const bRank = configured.get(b.id) ? 0 : configured.has(b.id) ? 1 : 2;
      return aRank - bRank;
    });
  }, [configured, providerMeta]);

  const updateFieldValue = (providerId: string, key: string, value: string) => {
    credentials.edited();
    setFieldValues((prev) => ({
      ...prev,
      [fieldKey(providerId, key)]: value,
    }));
  };

  const handleAllowancePresetChange = (provider: TtsProviderClientMeta, presetId: string): void => {
    const allowance = provider.usageAllowance;
    if (!allowance) return;
    credentials.edited();
    const preset = allowance.presets.find((item) => item.id === presetId);

    setFieldValues((prev) => {
      const next = {
        ...prev,
        [fieldKey(provider.id, allowance.planField)]: presetId,
      };
      if (preset) {
        delete next[fieldKey(provider.id, allowance.allowanceField)];
      } else if (presetId !== CUSTOM_ALLOWANCE_PRESET) {
        delete next[fieldKey(provider.id, allowance.allowanceField)];
      }
      return next;
    });
  };

  const hasPendingChanges = (provider: TtsProviderClientMeta): boolean => {
    return (
      provider.authFields.some((field) => fieldValues[fieldKey(provider.id, field.key)]?.trim()) ||
      Boolean(
        provider.usageAllowance &&
        [
          provider.usageAllowance.planField,
          provider.usageAllowance.allowanceField,
          provider.usageAllowance.resetDayField,
        ].some((key) => fieldValues[fieldKey(provider.id, key)]?.trim())
      )
    );
  };

  const finishCredentialEdit = (providerId: string) => {
    setFieldValues((previous) =>
      Object.fromEntries(
        Object.entries(previous).filter(([key]) => !key.startsWith(`${providerId}-`))
      )
    );
    setExpandedId(null);
  };
  const handleSaveKey = async (provider: TtsProviderClientMeta) => {
    const values: Record<string, string | number> = {};
    for (const field of provider.authFields) {
      const value = fieldValues[fieldKey(provider.id, field.key)]?.trim();
      if (value) values[field.key] = field.type === 'number' ? Number(value) : value;
    }
    const allowance = provider.usageAllowance;
    if (allowance) {
      for (const key of [allowance.planField, allowance.allowanceField, allowance.resetDayField]) {
        const value = fieldValues[fieldKey(provider.id, key)]?.trim();
        if (value) values[key] = key === allowance.planField ? value : Number(value);
      }
    }
    const patch: Record<string, string | number | null> = { ...values };
    if (
      allowance &&
      values[allowance.planField] &&
      values[allowance.planField] !== CUSTOM_ALLOWANCE_PRESET
    )
      patch[allowance.allowanceField] = null;
    const result = await credentials.save(
      provider.id,
      configured.has(provider.id) ? { patch } : { values }
    );
    if (result?.status === 'confirmed') finishCredentialEdit(provider.id);
  };
  const handleRemoveKey = async (providerId: string) => {
    await credentials.remove(providerId);
  };
  const handleCredentialAction = async () => {
    const provider = credentials.feedback?.provider;
    const result = await credentials.act();
    if (provider && result?.status === 'confirmed') finishCredentialEdit(provider);
  };

  return (
    <div className={styles.grid}>
      {credentials.feedback && (
        <div role="status" className={styles.card}>
          <p>{credentials.feedback.message}</p>
          {credentials.feedback.action && (
            <Button onClick={handleCredentialAction} disabled={credentials.busy}>
              {credentials.feedback.action === 'confirm'
                ? 'Save without verification'
                : credentials.feedback.action === 'reconcile'
                  ? 'Check status'
                  : 'Reload settings'}
            </Button>
          )}
        </div>
      )}
      {sortedProviderMeta.map((provider) => {
        const isConfigured = configured.has(provider.id);
        const isValid = configured.get(provider.id) ?? true;
        const verified =
          credentials.snapshot?.keys.find((key) => key.provider === provider.id)?.verification
            .lastConfirmed?.status === 'verified';
        const isExpanded = expandedId === provider.id;
        const isSaving = credentials.busy;
        const qualityLabel = QUALITY_LABELS[provider.qualityTier] ?? provider.qualityTier;
        const modelCount = provider.models.length;
        const languageSummary = summarizeLanguageSupport(provider, preferredLanguage);
        const allowance = provider.usageAllowance;
        const visibleAuthFields = provider.authFields.filter(
          (field) => !isAllowanceField(provider, field.key)
        );
        const allowanceField = allowance
          ? provider.authFields.find((field) => field.key === allowance.allowanceField)
          : null;
        const resetDayField = allowance
          ? provider.authFields.find((field) => field.key === allowance.resetDayField)
          : null;
        const selectedUsagePlan = allowance
          ? fieldValues[fieldKey(provider.id, allowance.planField)] || ''
          : '';
        const showCustomAllowance =
          Boolean(allowance) && selectedUsagePlan === CUSTOM_ALLOWANCE_PRESET;
        const cardClassName = isConfigured
          ? `${styles.card} ${isValid ? styles.cardConnected : styles.cardInvalid}`
          : styles.card;

        return (
          <div key={provider.id} className={cardClassName}>
            <div className={styles.cardHeader}>
              <div className={styles.cardHeaderLeft}>
                <TtsProviderLogo provider={provider.id} size={28} />
                <div className={styles.cardInfo}>
                  <span className={styles.cardNameRow}>
                    <span className={styles.cardName}>{provider.displayName}</span>
                  </span>
                  <span className={styles.cardQuality}>
                    {qualityLabel} · {modelCount} {modelCount === 1 ? 'model' : 'models'}
                  </span>
                  <span
                    className={`${styles.languageLine} ${
                      languageSummary.tone === 'ok'
                        ? styles.languageLineOk
                        : languageSummary.tone === 'warn'
                          ? styles.languageLineWarn
                          : ''
                    }`}
                  >
                    {languageSummary.label}
                  </span>
                  <div className={styles.capabilityRow}>
                    {provider.supportsSfx && <span className={styles.capabilityPill}>SFX</span>}
                    {provider.supportsStreaming && (
                      <span className={styles.capabilityPill}>Streaming</span>
                    )}
                  </div>
                </div>
              </div>
              {credentials.busy ? (
                <span className={styles.statusValidating}>Saving...</span>
              ) : isConfigured ? (
                isValid ? (
                  <span className={styles.statusConnected}>
                    {verified ? 'Verified' : 'Saved, unverified'}
                  </span>
                ) : (
                  <span className={styles.statusInvalid}>Key disabled</span>
                )
              ) : (
                <span className={styles.statusNone}>Not configured</span>
              )}
            </div>

            {isConfigured && !isExpanded && (
              <div className={styles.cardActions}>
                <button
                  type="button"
                  className={styles.addKeyBtn}
                  onClick={() => {
                    if (credentials.begin(provider.id)) setExpandedId(provider.id);
                  }}
                  disabled={credentials.editingBlocked}
                >
                  {provider.authFields.length > 1 ? 'Manage credentials' : 'Replace Key'}
                </button>
                <Button
                  variant="ghost"
                  onClick={() => handleRemoveKey(provider.id)}
                  loading={isSaving}
                  disabled={
                    credentials.editingBlocked || credentials.feedback?.action === 'confirm'
                  }
                >
                  Remove Key
                </Button>
              </div>
            )}

            {!isConfigured && !isExpanded && (
              <div className={styles.cardActions}>
                <button
                  type="button"
                  className={styles.addKeyBtn}
                  onClick={() => {
                    if (credentials.begin(provider.id)) setExpandedId(provider.id);
                  }}
                  disabled={credentials.editingBlocked}
                >
                  Add Key
                </button>
                {provider.getApiKeyUrl && (
                  <a
                    href={provider.getApiKeyUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={styles.getKeyLink}
                  >
                    Get API Key
                  </a>
                )}
              </div>
            )}

            {isExpanded && (
              <div className={styles.keyForm}>
                {visibleAuthFields.map((field) => (
                  <Input
                    disabled={credentials.editingBlocked}
                    key={field.key}
                    label={field.label}
                    type={field.type ?? 'password'}
                    value={fieldValues[fieldKey(provider.id, field.key)] || ''}
                    onChange={(e) => updateFieldValue(provider.id, field.key, e.target.value)}
                    placeholder={
                      isConfigured && field.key === 'apiKey'
                        ? 'Leave blank to keep the current API key'
                        : field.optional
                          ? `${field.placeholder} · optional`
                          : field.placeholder
                    }
                    helperText={
                      isConfigured && field.key === 'apiKey'
                        ? 'Only enter this if you want to replace the existing provider key.'
                        : undefined
                    }
                  />
                ))}
                {allowance ? (
                  <div className={styles.allowanceFields}>
                    <label className={styles.selectField}>
                      <span className={styles.fieldLabel}>Usage plan</span>
                      <select
                        disabled={credentials.editingBlocked}
                        className={styles.selectInput}
                        value={selectedUsagePlan}
                        onChange={(event) =>
                          handleAllowancePresetChange(provider, event.target.value)
                        }
                      >
                        <option value="">Plan preset</option>
                        {allowance.presets.map((preset) => (
                          <option key={preset.id} value={preset.id}>
                            {preset.label} -{' '}
                            {formatAllowanceLimit(preset.monthlyLimit, allowance.unitLabel)}
                          </option>
                        ))}
                        <option value={CUSTOM_ALLOWANCE_PRESET}>Custom monthly limit</option>
                      </select>
                    </label>
                    {showCustomAllowance ? (
                      <Input
                        disabled={credentials.editingBlocked}
                        label={allowanceField?.label ?? 'Monthly limit'}
                        type="number"
                        value={fieldValues[fieldKey(provider.id, allowance.allowanceField)] || ''}
                        onChange={(e) =>
                          updateFieldValue(provider.id, allowance.allowanceField, e.target.value)
                        }
                        placeholder={allowanceField?.placeholder ?? 'Monthly limit'}
                      />
                    ) : null}
                    <Input
                      disabled={credentials.editingBlocked}
                      label={resetDayField?.label ?? 'Billing reset day'}
                      type="number"
                      value={fieldValues[fieldKey(provider.id, allowance.resetDayField)] || ''}
                      onChange={(e) =>
                        updateFieldValue(provider.id, allowance.resetDayField, e.target.value)
                      }
                      placeholder={resetDayField?.placeholder ?? '1-31'}
                    />
                  </div>
                ) : null}
                <div className={styles.keyFormActions}>
                  <Button
                    onClick={() => handleSaveKey(provider)}
                    loading={isSaving}
                    disabled={
                      credentials.editingBlocked ||
                      credentials.feedback?.action === 'confirm' ||
                      (!isConfigured && !fieldValues[fieldKey(provider.id, 'apiKey')]?.trim()) ||
                      (isConfigured && !hasPendingChanges(provider))
                    }
                  >
                    {isConfigured ? 'Save changes' : 'Save key'}
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={credentials.editingBlocked}
                    onClick={() => {
                      credentials.edited();
                      setExpandedId(null);
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
