'use client';

import { useCallback, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import type { ApiKeyData, ApiKeyCreated } from '@/types/api-key';
import styles from './page.module.css';

interface ApiKeyManagerProps {
  initialKeys: ApiKeyData[];
  tier: string;
}

export function ApiKeyManager({ initialKeys, tier }: ApiKeyManagerProps) {
  const [keys, setKeys] = useState<ApiKeyData[]>(initialKeys);
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newKey, setNewKey] = useState<ApiKeyCreated | null>(null);
  const [copied, setCopied] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  const handleCreate = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    setCreating(true);
    setError(null);
    try {
      const response = await fetch('/api/keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim() }),
      });

      if (!response.ok) {
        const data = await response.json();
        setError(data.error || 'Failed to create API key');
        return;
      }

      const created: ApiKeyCreated = await response.json();
      setNewKey(created);
      setName('');

      setKeys((prev) => [
        {
          id: created.id,
          name: created.name,
          keyPrefix: created.keyPrefix,
          lastUsedAt: null,
          createdAt: created.createdAt,
          revokedAt: null,
        },
        ...prev,
      ]);
    } finally {
      setCreating(false);
    }
  }, [name]);

  const handleRevoke = useCallback(async (keyId: string) => {
    setRevokingId(keyId);
    try {
      const response = await fetch(`/api/keys/${keyId}`, { method: 'DELETE' });
      if (response.ok || response.status === 204) {
        setKeys((prev) =>
          prev.map((k) =>
            k.id === keyId ? { ...k, revokedAt: new Date().toISOString() } : k
          )
        );
      }
    } finally {
      setRevokingId(null);
    }
  }, []);

  const handleCopy = useCallback(async () => {
    if (!newKey) return;
    await navigator.clipboard.writeText(newKey.key);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [newKey]);

  const handleCloseModal = useCallback(() => {
    setNewKey(null);
    setCopied(false);
  }, []);

  if (tier !== 'CREATOR') {
    return (
      <div className={styles.upgradeCard}>
        <h2 className={styles.upgradeTitle}>API Access</h2>
        <p className={styles.upgradeText}>
          API keys are available on the Team plan. Upgrade to access the Sotto API programmatically.
        </p>
        <Link href="/billing"><Button>Upgrade to Team</Button></Link>
      </div>
    );
  }

  const activeKeys = keys.filter((k) => !k.revokedAt);
  const revokedKeys = keys.filter((k) => k.revokedAt);

  return (
    <>
      {/* Create Key */}
      <section className={styles.createSection}>
        <h2 className={styles.sectionTitle}>Create API Key</h2>
        <form onSubmit={handleCreate} className={styles.createForm}>
          <div className={styles.createInput}>
            <Input
              label="Key Name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Production, CI/CD, Development"
              maxLength={100}
            />
          </div>
          <div className={styles.createBtn}>
            <Button type="submit" loading={creating} disabled={creating || !name.trim()}>
              Create Key
            </Button>
          </div>
        </form>
        {error && <p className={styles.errorText}>{error}</p>}
      </section>

      {/* Active Keys */}
      <div className={styles.keyList}>
        <div className={styles.keyListHeader}>
          <h2 className={styles.keyListTitle}>Active Keys ({activeKeys.length})</h2>
        </div>
        {activeKeys.length === 0 ? (
          <p className={styles.emptyKeys}>No active API keys. Create one above.</p>
        ) : (
          activeKeys.map((apiKey) => (
            <div key={apiKey.id} className={styles.keyRow}>
              <div className={styles.keyInfo}>
                <span className={styles.keyName}>{apiKey.name}</span>
                <code className={styles.keyPrefix}>{apiKey.keyPrefix}</code>
                <div className={styles.keyMeta}>
                  <span>Created {formatDate(apiKey.createdAt)}</span>
                  {apiKey.lastUsedAt && (
                    <span>Last used {formatDate(apiKey.lastUsedAt)}</span>
                  )}
                </div>
              </div>
              <div className={styles.keyActions}>
                <Button
                  variant="danger"
                  size="small"
                  onClick={() => handleRevoke(apiKey.id)}
                  loading={revokingId === apiKey.id}
                  disabled={revokingId === apiKey.id}
                >
                  Revoke
                </Button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Revoked Keys */}
      {revokedKeys.length > 0 && (
        <div className={styles.keyList}>
          <div className={styles.keyListHeader}>
            <h2 className={styles.keyListTitle}>Revoked Keys ({revokedKeys.length})</h2>
          </div>
          {revokedKeys.map((apiKey) => (
            <div key={apiKey.id} className={styles.keyRow}>
              <div className={styles.keyInfo}>
                <span className={styles.keyName}>{apiKey.name}</span>
                <code className={styles.keyPrefix}>{apiKey.keyPrefix}</code>
                <div className={styles.keyMeta}>
                  <span>Created {formatDate(apiKey.createdAt)}</span>
                  <span>Revoked {formatDate(apiKey.revokedAt!)}</span>
                </div>
              </div>
              <span className={styles.revokedBadge}>Revoked</span>
            </div>
          ))}
        </div>
      )}

      {/* Copy Key Modal */}
      <Modal isOpen={!!newKey} onClose={handleCloseModal} title="API Key Created">
        <div className={styles.copyModal}>
          <p className={styles.copyWarning}>
            Copy your API key now. You will not be able to see it again.
          </p>
          <div className={styles.copyKeyBlock}>
            <span className={styles.copyKeyText}>{newKey?.key}</span>
            <div className={styles.copyBtn}>
              <Button size="small" onClick={handleCopy}>
                {copied ? 'Copied!' : 'Copy'}
              </Button>
            </div>
          </div>
          {copied && <span className={styles.copiedText}>Key copied to clipboard</span>}
          <Button variant="secondary" onClick={handleCloseModal}>
            Done
          </Button>
        </div>
      </Modal>
    </>
  );
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}
