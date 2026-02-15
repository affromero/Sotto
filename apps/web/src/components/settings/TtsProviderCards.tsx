'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { TtsProviderLogo } from '@/components/ui/TtsProviderLogo';
import styles from './TtsProviderCards.module.css';

const PROVIDERS = [
  {
    id: 'elevenlabs' as const,
    name: 'ElevenLabs',
    quality: 'Premium',
    fields: [{ key: 'apiKey', label: 'API Key', placeholder: 'xi-xxxxxxxxxxxxxxxxxxxx' }],
    getKeyUrl: 'https://elevenlabs.io/app/settings/api-keys',
  },
  {
    id: 'openai' as const,
    name: 'OpenAI',
    quality: 'Standard',
    fields: [{ key: 'apiKey', label: 'API Key', placeholder: 'sk-...' }],
    getKeyUrl: 'https://platform.openai.com/api-keys',
  },
  {
    id: 'playht' as const,
    name: 'PlayHT',
    quality: 'Premium',
    fields: [
      { key: 'apiKey', label: 'API Key', placeholder: 'Your PlayHT API key' },
      { key: 'userId', label: 'User ID', placeholder: 'Your PlayHT User ID' },
    ],
    getKeyUrl: 'https://play.ht/studio/api-access',
  },
  {
    id: 'cartesia' as const,
    name: 'Cartesia',
    quality: 'Premium',
    fields: [{ key: 'apiKey', label: 'API Key', placeholder: 'Your Cartesia API key' }],
    getKeyUrl: 'https://play.cartesia.ai/keys',
  },
  {
    id: 'hume' as const,
    name: 'Hume AI',
    quality: 'Ultra',
    fields: [{ key: 'apiKey', label: 'API Key', placeholder: 'Your Hume AI API key' }],
    getKeyUrl: 'https://platform.hume.ai/settings/keys',
  },
];

interface ProviderStatus {
  provider: string;
  isValid: boolean;
}

interface TtsProviderCardsProps {
  initialConfigured: Array<ProviderStatus>;
}

export function TtsProviderCards({ initialConfigured }: TtsProviderCardsProps) {
  const [configured, setConfigured] = useState<Map<string, boolean>>(
    new Map(initialConfigured.map((p) => [p.provider, p.isValid]))
  );
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<Record<string, 'idle' | 'saved' | 'removed' | 'error'>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  const handleSaveKey = async (providerId: string) => {
    const provider = PROVIDERS.find((p) => p.id === providerId);
    if (!provider) return;

    const apiKey = fieldValues[`${providerId}-apiKey`]?.trim();
    if (!apiKey) return;

    setSaving(true);
    setStatus((prev) => ({ ...prev, [providerId]: 'idle' }));
    setErrors((prev) => ({ ...prev, [providerId]: '' }));

    try {
      const body: Record<string, string> = { provider: providerId, apiKey };
      const userIdVal = fieldValues[`${providerId}-userId`]?.trim();
      if (userIdVal) body.userId = userIdVal;

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

      setConfigured((prev) => new Map(prev).set(providerId, true));
      setFieldValues((prev) => {
        const next = { ...prev };
        delete next[`${providerId}-apiKey`];
        delete next[`${providerId}-userId`];
        return next;
      });
      setExpandedId(null);
      setStatus((prev) => ({ ...prev, [providerId]: 'saved' }));
      setTimeout(() => setStatus((prev) => ({ ...prev, [providerId]: 'idle' })), 3000);
    } catch {
      setErrors((prev) => ({ ...prev, [providerId]: 'Network error. Please try again.' }));
      setStatus((prev) => ({ ...prev, [providerId]: 'error' }));
    } finally {
      setSaving(false);
    }
  };

  const handleRemoveKey = async (providerId: string) => {
    setSaving(true);
    try {
      await fetch('/api/settings/byok', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: providerId }),
      });
      setConfigured((prev) => {
        const next = new Map(prev);
        next.delete(providerId);
        return next;
      });
      setStatus((prev) => ({ ...prev, [providerId]: 'removed' }));
      setTimeout(() => setStatus((prev) => ({ ...prev, [providerId]: 'idle' })), 3000);
    } catch {
      setErrors((prev) => ({ ...prev, [providerId]: 'Failed to remove key.' }));
      setStatus((prev) => ({ ...prev, [providerId]: 'error' }));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={styles.grid}>
      {PROVIDERS.map((provider) => {
        const isConfigured = configured.has(provider.id);
        const isValid = configured.get(provider.id) ?? true;
        const isExpanded = expandedId === provider.id;

        return (
          <div key={provider.id} className={styles.card}>
            <div className={styles.cardHeader}>
              <div className={styles.cardHeaderLeft}>
                <TtsProviderLogo provider={provider.id} size={28} />
                <div className={styles.cardInfo}>
                  <span className={styles.cardName}>{provider.name}</span>
                  <span className={styles.cardQuality}>{provider.quality}</span>
                </div>
              </div>
              {isConfigured ? (
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
                <Button
                  variant="ghost"
                  onClick={() => handleRemoveKey(provider.id)}
                  loading={saving}
                  disabled={saving}
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
                <a
                  href={provider.getKeyUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={styles.getKeyLink}
                >
                  Get API Key
                </a>
              </div>
            )}

            {isExpanded && (
              <div className={styles.keyForm}>
                {provider.fields.map((field) => (
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
                    onClick={() => handleSaveKey(provider.id)}
                    loading={saving}
                    disabled={saving || !fieldValues[`${provider.id}-apiKey`]?.trim()}
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
