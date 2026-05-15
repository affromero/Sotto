'use client';

import { useState } from 'react';
import type { TtsProviderClientMeta } from '@/lib/providers/tts-registry';
import { Badge } from '@/components/ui/Badge';
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
  onReadyChange?: (ready: boolean) => void;
}

const QUALITY_LABELS: Record<string, string> = {
  standard: 'Standard',
  premium: 'Premium',
  ultra: 'Ultra',
};

export function TtsProviderCards({
  initialConfigured,
  providerMeta,
  onReadyChange,
}: TtsProviderCardsProps) {
  const [configured, setConfigured] = useState<Map<string, boolean>>(
    new Map(initialConfigured.map((p) => [p.provider, p.isValid]))
  );
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [status, setStatus] = useState<Record<string, 'idle' | 'saved' | 'removed' | 'error' | 'validating'>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  const handleSaveKey = async (providerId: string, authFields: TtsProviderClientMeta['authFields']) => {
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

      const res = await fetch('/api/settings/byok', {
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
      await fetch('/api/settings/byok', {
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
      {providerMeta.map((provider) => {
        const isConfigured = configured.has(provider.id);
        const isValid = configured.get(provider.id) ?? true;
        const isExpanded = expandedId === provider.id;
        const isSaving = savingId === provider.id;
        const qualityLabel = QUALITY_LABELS[provider.qualityTier] ?? provider.qualityTier;
        const modelCount = provider.models.length;

        return (
          <div key={provider.id} className={styles.card}>
            <div className={styles.cardHeader}>
              <div className={styles.cardHeaderLeft}>
                <TtsProviderLogo provider={provider.id} size={28} />
                <div className={styles.cardInfo}>
                  <span className={styles.cardNameRow}>
                    <span className={styles.cardName}>{provider.displayName}</span>
                    {provider.recommended && <Badge variant="success">Recommended</Badge>}
                  </span>
                  <span className={styles.cardQuality}>
                    {qualityLabel} · {modelCount} {modelCount === 1 ? 'model' : 'models'}
                  </span>
                  <div className={styles.capabilityRow}>
                    {provider.supportsVoiceCloning && (
                      <span className={styles.capabilityPill}>Voice Cloning</span>
                    )}
                    {provider.supportsSfx && (
                      <span className={styles.capabilityPill}>SFX</span>
                    )}
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
