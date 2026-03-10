'use client';

import { useState } from 'react';
import type { MusicProviderClientMeta } from '@/lib/providers/music-registry';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import styles from './ProviderCards.module.css';

interface MusicProviderCardsProps {
  initialConfigured: Array<{ provider: string; isValid: boolean }>;
  providerMeta: MusicProviderClientMeta[];
}

export function MusicProviderCards({ initialConfigured, providerMeta }: MusicProviderCardsProps) {
  const [configured, setConfigured] = useState<Map<string, boolean>>(
    new Map(initialConfigured.map((p) => [p.provider, p.isValid]))
  );
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [savingId, setSavingId] = useState<string | null>(null);
  const [status, setStatus] = useState<Record<string, 'idle' | 'saved' | 'removed' | 'error' | 'validating'>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  const handleSaveKey = async (providerId: string) => {
    if (!apiKey.trim()) return;

    setSavingId(providerId);
    setStatus((prev) => ({ ...prev, [providerId]: 'validating' }));
    setErrors((prev) => ({ ...prev, [providerId]: '' }));

    try {
      const res = await fetch('/api/settings/byok', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: providerId, apiKey: apiKey.trim() }),
      });

      if (!res.ok) {
        const data = await res.json();
        setErrors((prev) => ({ ...prev, [providerId]: data.error || 'Failed to save key' }));
        setStatus((prev) => ({ ...prev, [providerId]: 'error' }));
        return;
      }

      setConfigured((prev) => new Map(prev).set(providerId, true));
      setApiKey('');
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
        const modelCount = provider.models.length;

        return (
          <div key={provider.id} className={styles.card}>
            <div className={styles.cardHeader}>
              <div className={styles.cardHeaderLeft}>
                <div className={styles.cardInfo}>
                  <span className={styles.cardNameRow}>
                    <span className={styles.cardName}>{provider.displayName}</span>
                  </span>
                  <span className={styles.cardQuality}>
                    {modelCount} {modelCount === 1 ? 'model' : 'models'}
                    {provider.note && <> · {provider.note}</>}
                  </span>
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
                <Input
                  label="API Key"
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="Enter your API key"
                />
                <div className={styles.keyFormActions}>
                  <Button
                    onClick={() => handleSaveKey(provider.id)}
                    loading={isSaving}
                    disabled={savingId !== null || !apiKey.trim()}
                  >
                    Save Key
                  </Button>
                  <Button variant="ghost" onClick={() => { setExpandedId(null); setApiKey(''); }}>
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
