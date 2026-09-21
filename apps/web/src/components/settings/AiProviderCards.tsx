'use client';

import { useEffect, useMemo, useState } from 'react';
import { useCredentialEditor } from './useCredentialEditor';
import type { AiProviderClientMeta } from '@/lib/providers/ai-registry';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { TtsProviderLogo } from '@/components/ui/TtsProviderLogo';
import { Glyph } from '@/components/Glyph';
import styles from './ProviderCards.module.css';
import type { AgentReadiness } from '@/lib/agent-availability';

interface ProviderStatus {
  provider: string;
  isValid: boolean;
}

interface SystemProvider {
  id: string;
  label: string;
  description: string;
  available: boolean;
  readiness?: AgentReadiness;
  credentialReloadAvailable?: boolean;
  disabled?: boolean;
}

interface AiProviderCardsProps {
  initialConfigured: Array<ProviderStatus>;
  providerMeta: AiProviderClientMeta[];
  /** CLI-backed agents linked from the host (Claude Code, Codex) — no API key. */
  systemProviders?: SystemProvider[];
  onReadyChange?: (ready: boolean) => void;
}

export function AiProviderCards({
  initialConfigured,
  providerMeta,
  systemProviders,
  onReadyChange,
}: AiProviderCardsProps) {
  const credentials = useCredentialEditor('ai-keys');
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
  const [savingId, setSavingId] = useState<string | null>(null);
  const [status, setStatus] = useState<
    Record<string, 'idle' | 'saved' | 'removed' | 'error' | 'validating'>
  >({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [systemDisabled, setSystemDisabled] = useState<Map<string, boolean>>(
    new Map((systemProviders ?? []).map((provider) => [provider.id, provider.disabled ?? false]))
  );
  const effectiveSystemProviders = useMemo(
    () =>
      (systemProviders ?? []).map((provider) => ({
        ...provider,
        disabled: systemDisabled.get(provider.id) ?? provider.disabled ?? false,
      })),
    [systemProviders, systemDisabled]
  );
  const connectedSystemProviders = useMemo(
    () => effectiveSystemProviders.filter((provider) => provider.available && !provider.disabled),
    [effectiveSystemProviders]
  );
  const disabledSystemProviders = useMemo(
    () => effectiveSystemProviders.filter((provider) => provider.disabled),
    [effectiveSystemProviders]
  );
  const unavailableSystemProviders = useMemo(
    () => effectiveSystemProviders.filter((provider) => !provider.available && !provider.disabled),
    [effectiveSystemProviders]
  );
  const sortedProviderMeta = useMemo(() => {
    return [...providerMeta].sort((a, b) => {
      const aRank = configured.get(a.id) ? 0 : configured.has(a.id) ? 1 : 2;
      const bRank = configured.get(b.id) ? 0 : configured.has(b.id) ? 1 : 2;
      return aRank - bRank;
    });
  }, [configured, providerMeta]);

  const finishCredentialEdit = (providerId: string) => {
    setFieldValues((previous) => {
      const next = { ...previous };
      delete next[providerId];
      return next;
    });
    setExpandedId(null);
  };
  const handleSaveKey = async (providerId: string) => {
    const apiKey = fieldValues[providerId]?.trim();
    if (!apiKey) return;
    const result = await credentials.save(providerId, { values: { apiKey } });
    if (result?.status === 'confirmed') finishCredentialEdit(providerId);
  };
  const handleRemoveKey = async (providerId: string) => {
    await credentials.remove(providerId);
  };
  const handleCredentialAction = async () => {
    const provider = credentials.feedback?.provider;
    const result = await credentials.act();
    if (provider && result?.status === 'confirmed') finishCredentialEdit(provider);
  };

  const handleToggleSystemProvider = async (providerId: string, enabled: boolean) => {
    setSavingId(providerId);
    setErrors((prev) => ({ ...prev, [providerId]: '' }));
    try {
      const res = await fetch('/api/v1/admin/system-ai-providers', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ providerId, enabled }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        const message =
          data && typeof data === 'object' && 'error' in data && typeof data.error === 'string'
            ? data.error
            : 'Failed to update provider';
        setErrors((prev) => ({ ...prev, [providerId]: message }));
        setStatus((prev) => ({ ...prev, [providerId]: 'error' }));
        return;
      }

      setSystemDisabled((prev) => new Map(prev).set(providerId, !enabled));
      setStatus((prev) => ({ ...prev, [providerId]: 'saved' }));
      setTimeout(() => setStatus((prev) => ({ ...prev, [providerId]: 'idle' })), 3000);
    } catch {
      setErrors((prev) => ({ ...prev, [providerId]: 'Network error. Please try again.' }));
      setStatus((prev) => ({ ...prev, [providerId]: 'error' }));
    } finally {
      setSavingId(null);
    }
  };

  const handleReloadCredentials = async (providerId: string) => {
    setSavingId(providerId);
    setErrors((prev) => ({ ...prev, [providerId]: '' }));
    try {
      const res = await fetch('/api/v1/admin/agent-credentials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: providerId }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setErrors((prev) => ({
          ...prev,
          [providerId]: data?.error || 'Could not reload CLI credentials.',
        }));
        return;
      }
      window.location.reload();
    } catch {
      setErrors((prev) => ({ ...prev, [providerId]: 'Network error. Please try again.' }));
    } finally {
      setSavingId(null);
    }
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
      {connectedSystemProviders.map((sp) => (
        <div key={sp.id} className={`${styles.card} ${styles.cardConnected}`}>
          <div className={styles.cardHeader}>
            <div className={styles.cardHeaderLeft}>
              <Glyph name="plug" size={28} />
              <div className={styles.cardInfo}>
                <span className={styles.cardNameRow}>
                  <span className={styles.cardName}>{sp.label}</span>
                  <Badge variant="system">System</Badge>
                </span>
                <span className={styles.cardQuality}>{sp.description}</span>
              </div>
            </div>
            <span className={styles.statusConnected}>Connected</span>
          </div>
          <div className={styles.cardActions}>
            <Button
              variant="ghost"
              onClick={() => handleToggleSystemProvider(sp.id, false)}
              loading={savingId === sp.id}
              disabled={savingId !== null || credentials.editingBlocked}
            >
              Disable
            </Button>
            {status[sp.id] === 'saved' && (
              <span className={styles.feedbackSuccess}>Provider updated.</span>
            )}
            {status[sp.id] === 'error' && (
              <span className={styles.feedbackError}>{errors[sp.id]}</span>
            )}
          </div>
        </div>
      ))}

      {disabledSystemProviders.map((sp) => (
        <div key={sp.id} className={`${styles.card} ${styles.cardDisabled}`}>
          <div className={styles.cardHeader}>
            <div className={styles.cardHeaderLeft}>
              <Glyph name="plug" size={28} />
              <div className={styles.cardInfo}>
                <span className={styles.cardNameRow}>
                  <span className={styles.cardName}>{sp.label}</span>
                  <Badge variant="system">System</Badge>
                </span>
                <span className={styles.cardQuality}>{sp.description}</span>
              </div>
            </div>
            <span className={styles.statusDisabled}>Disabled</span>
          </div>
          <div className={styles.cardActions}>
            <button
              type="button"
              className={styles.addKeyBtn}
              onClick={() => handleToggleSystemProvider(sp.id, true)}
              disabled={savingId !== null || credentials.editingBlocked}
            >
              Enable
            </button>
            {status[sp.id] === 'saved' && (
              <span className={styles.feedbackSuccess}>Provider updated.</span>
            )}
            {status[sp.id] === 'error' && (
              <span className={styles.feedbackError}>{errors[sp.id]}</span>
            )}
          </div>
        </div>
      ))}

      {sortedProviderMeta.map((provider) => {
        const isConfigured = configured.has(provider.id);
        const isValid = configured.get(provider.id) ?? true;
        const verified =
          credentials.snapshot?.keys.find((key) => key.provider === provider.id)?.verification
            .lastConfirmed?.status === 'verified';
        const isExpanded = expandedId === provider.id;
        const isSaving = credentials.busy;
        const modelNames = provider.models.map((m) => m.displayName).join(' · ');
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
                    {provider.badge === 'free' && <Badge variant="success">Free</Badge>}
                  </span>
                  <span className={styles.cardQuality}>{provider.description}</span>
                  <span className={styles.cardQuality}>{modelNames}</span>
                </div>
              </div>
              {status[provider.id] === 'validating' ? (
                <span className={styles.statusValidating}>Validating key...</span>
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
                  Update Key
                </button>
                <Button
                  variant="ghost"
                  onClick={() => handleRemoveKey(provider.id)}
                  loading={isSaving}
                  disabled={savingId !== null || credentials.editingBlocked}
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
                {provider.authFields.map((field) => (
                  <Input
                    key={field.key}
                    label={field.label}
                    type="password"
                    value={fieldValues[provider.id] || ''}
                    disabled={credentials.editingBlocked}
                    onChange={(e) => {
                      credentials.edited();
                      setFieldValues((prev) => ({ ...prev, [provider.id]: e.target.value }));
                    }}
                    placeholder={field.placeholder}
                  />
                ))}
                <div className={styles.keyFormActions}>
                  <Button
                    onClick={() => handleSaveKey(provider.id)}
                    loading={isSaving}
                    disabled={
                      savingId !== null ||
                      credentials.editingBlocked ||
                      credentials.feedback?.action === 'confirm' ||
                      !fieldValues[provider.id]?.trim()
                    }
                  >
                    Save Key
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

      {unavailableSystemProviders.map((sp) => (
        <div key={sp.id} className={styles.card}>
          <div className={styles.cardHeader}>
            <div className={styles.cardHeaderLeft}>
              <Glyph name="plug" size={28} />
              <div className={styles.cardInfo}>
                <span className={styles.cardNameRow}>
                  <span className={styles.cardName}>{sp.label}</span>
                  <Badge variant="system">System</Badge>
                </span>
                <span className={styles.cardQuality}>{sp.description}</span>
              </div>
            </div>
            {sp.available ? (
              <span className={styles.statusConnected}>Connected</span>
            ) : (
              <span className={styles.statusNone}>
                {sp.readiness === 'not_authenticated'
                  ? 'Sign-in required'
                  : sp.readiness === 'unreachable'
                    ? 'Remote CLI unreachable'
                    : 'CLI not found'}
              </span>
            )}
          </div>
          {sp.credentialReloadAvailable && (
            <div className={styles.cardActions}>
              <Button
                variant="ghost"
                onClick={() => handleReloadCredentials(sp.id)}
                loading={savingId === sp.id}
                disabled={savingId !== null || credentials.editingBlocked}
              >
                Reload host login
              </Button>
              {errors[sp.id] && <span className={styles.feedbackError}>{errors[sp.id]}</span>}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
