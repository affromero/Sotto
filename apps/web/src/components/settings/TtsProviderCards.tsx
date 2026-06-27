'use client';

import { useMemo, useState } from 'react';
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

function languageName(code: string): string {
  return LANGUAGE_DISPLAY[code as keyof typeof LANGUAGE_DISPLAY] ?? code.toUpperCase();
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
  const [configured, setConfigured] = useState<Map<string, boolean>>(
    new Map(initialConfigured.map((p) => [p.provider, p.isValid]))
  );
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [status, setStatus] = useState<
    Record<string, 'idle' | 'saved' | 'removed' | 'error' | 'validating'>
  >({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const sortedProviderMeta = useMemo(() => {
    return [...providerMeta].sort((a, b) => {
      const aRank = configured.get(a.id) ? 0 : configured.has(a.id) ? 1 : 2;
      const bRank = configured.get(b.id) ? 0 : configured.has(b.id) ? 1 : 2;
      return aRank - bRank;
    });
  }, [configured, providerMeta]);

  const handleSaveKey = async (
    providerId: string,
    authFields: TtsProviderClientMeta['authFields']
  ) => {
    const apiKey = fieldValues[`${providerId}-apiKey`]?.trim();
    if (!apiKey) return;

    setSavingId(providerId);
    setStatus((prev) => ({ ...prev, [providerId]: 'validating' }));
    setErrors((prev) => ({ ...prev, [providerId]: '' }));

    try {
      const body: Record<string, string> = { provider: providerId, apiKey };
      for (const field of authFields) {
        if (field.key !== 'apiKey') {
          const val = fieldValues[`${providerId}-${field.key}`]?.trim();
          if (val) body[field.key] = val;
        }
      }

      const res = await fetch('/api/v1/settings/byok', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = await res.json();
        setErrors((prev) => ({ ...prev, [providerId]: data.error || 'Failed to save key' }));
        setStatus((prev) => ({ ...prev, [providerId]: 'error' }));
        return;
      }

      setConfigured((prev) => {
        const next = new Map(prev).set(providerId, true);
        onReadyChange?.(Array.from(next.values()).some(Boolean));
        return next;
      });
      setFieldValues((prev) => {
        const next = { ...prev };
        for (const field of authFields) {
          delete next[`${providerId}-${field.key}`];
        }
        return next;
      });
      setExpandedId(null);
      setStatus((prev) => ({ ...prev, [providerId]: 'saved' }));
      setTimeout(() => setStatus((prev) => ({ ...prev, [providerId]: 'idle' })), 3000);
    } catch {
      setErrors((prev) => ({ ...prev, [providerId]: 'Network error. Please try again.' }));
      setStatus((prev) => ({ ...prev, [providerId]: 'error' }));
    } finally {
      setSavingId(null);
    }
  };

  const handleRemoveKey = async (providerId: string) => {
    setSavingId(providerId);
    try {
      await fetch('/api/v1/settings/byok', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: providerId }),
      });
      setConfigured((prev) => {
        const next = new Map(prev);
        next.delete(providerId);
        onReadyChange?.(Array.from(next.values()).some(Boolean));
        return next;
      });
      setStatus((prev) => ({ ...prev, [providerId]: 'removed' }));
      setTimeout(() => setStatus((prev) => ({ ...prev, [providerId]: 'idle' })), 3000);
    } catch {
      setErrors((prev) => ({ ...prev, [providerId]: 'Failed to remove key.' }));
      setStatus((prev) => ({ ...prev, [providerId]: 'error' }));
    } finally {
      setSavingId(null);
    }
  };

  return (
    <div className={styles.grid}>
      {sortedProviderMeta.map((provider) => {
        const isConfigured = configured.has(provider.id);
        const isValid = configured.get(provider.id) ?? true;
        const isExpanded = expandedId === provider.id;
        const isSaving = savingId === provider.id;
        const qualityLabel = QUALITY_LABELS[provider.qualityTier] ?? provider.qualityTier;
        const modelCount = provider.models.length;
        const languageSummary = summarizeLanguageSupport(provider, preferredLanguage);
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
              {status[provider.id] === 'validating' ? (
                <span className={styles.statusValidating}>Validating key...</span>
              ) : isConfigured ? (
                isValid ? (
                  <span className={styles.statusConnected}>Connected</span>
                ) : (
                  <span className={styles.statusInvalid}>Key Invalid</span>
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
                  onClick={() => setExpandedId(provider.id)}
                >
                  Update Key
                </button>
                <Button
                  variant="ghost"
                  onClick={() => handleRemoveKey(provider.id)}
                  loading={isSaving}
                  disabled={savingId !== null}
                >
                  Remove Key
                </Button>
                {status[provider.id] === 'removed' && (
                  <span className={styles.feedbackSuccess}>Removed</span>
                )}
              </div>
            )}

            {!isConfigured && !isExpanded && (
              <div className={styles.cardActions}>
                <button
                  type="button"
                  className={styles.addKeyBtn}
                  onClick={() => setExpandedId(provider.id)}
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
                {provider.authFields.map((field) => (
                  <Input
                    key={field.key}
                    label={field.label}
                    type="password"
                    value={fieldValues[`${provider.id}-${field.key}`] || ''}
                    onChange={(e) =>
                      setFieldValues((prev) => ({
                        ...prev,
                        [`${provider.id}-${field.key}`]: e.target.value,
                      }))
                    }
                    placeholder={field.placeholder}
                  />
                ))}
                <div className={styles.keyFormActions}>
                  <Button
                    onClick={() => handleSaveKey(provider.id, provider.authFields)}
                    loading={isSaving}
                    disabled={savingId !== null || !fieldValues[`${provider.id}-apiKey`]?.trim()}
                  >
                    Save Key
                  </Button>
                  <Button variant="ghost" onClick={() => setExpandedId(null)}>
                    Cancel
                  </Button>
                </div>
                {status[provider.id] === 'saved' && (
                  <span className={styles.feedbackSuccess}>Key saved and validated.</span>
                )}
                {status[provider.id] === 'error' && (
                  <span className={styles.feedbackError}>{errors[provider.id]}</span>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
