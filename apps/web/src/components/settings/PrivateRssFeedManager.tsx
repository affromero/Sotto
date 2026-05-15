'use client';

import { useState } from 'react';
import { Check, Copy, Rss, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import styles from './PrivateRssFeedManager.module.css';

export interface PrivateFeedTokenMetadata {
  id: string;
  name: string;
  feedType: string;
  createdAt: string;
  lastUsedAt: string | null;
}

interface PrivateRssFeedManagerProps {
  initialTokens: PrivateFeedTokenMetadata[];
}

interface CreatePrivateFeedResponse {
  id: string;
  token: string;
  feedUrl: string;
}

const DEFAULT_FEED_NAME = 'Private Sotto Feed';

function formatDate(value: string | null): string {
  if (!value) return 'Never used';
  return new Date(value).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function PrivateRssFeedManager({ initialTokens }: PrivateRssFeedManagerProps) {
  const [tokens, setTokens] = useState(initialTokens);
  const [name, setName] = useState('');
  const [createdFeed, setCreatedFeed] = useState<{
    id: string;
    name: string;
    feedUrl: string;
  } | null>(null);
  const [creating, setCreating] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const copyFeedUrl = async (feedUrl: string, id: string) => {
    await navigator.clipboard.writeText(feedUrl);
    setCopiedId(id);
    setTimeout(() => setCopiedId((current) => (current === id ? null : current)), 3000);
  };

  const createFeed = async () => {
    const trimmedName = name.trim();
    setCreating(true);
    setErrorMessage(null);

    try {
      const response = await fetch('/api/rss/private', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmedName || DEFAULT_FEED_NAME }),
      });

      if (!response.ok) {
        throw new Error('Unable to create private feed.');
      }

      const data = (await response.json()) as CreatePrivateFeedResponse;
      const feedName = trimmedName || DEFAULT_FEED_NAME;
      setCreatedFeed({ id: data.id, name: feedName, feedUrl: data.feedUrl });
      setTokens((current) => [
        {
          id: data.id,
          name: feedName,
          feedType: 'all',
          createdAt: new Date().toISOString(),
          lastUsedAt: null,
        },
        ...current,
      ]);
      setName('');
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Unable to create private feed.');
    } finally {
      setCreating(false);
    }
  };

  const revokeFeed = async (tokenId: string) => {
    setRevokingId(tokenId);
    setErrorMessage(null);

    try {
      const response = await fetch(`/api/rss/private/tokens/${tokenId}`, { method: 'DELETE' });
      if (!response.ok) {
        throw new Error('Unable to revoke private feed.');
      }
      setTokens((current) => current.filter((token) => token.id !== tokenId));
      setCreatedFeed((current) => (current?.id === tokenId ? null : current));
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Unable to revoke private feed.');
    } finally {
      setRevokingId(null);
    }
  };

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <div className={styles.titleRow}>
          <Rss size={20} aria-hidden="true" />
          <h2 className={styles.title}>Private Podcast Feed</h2>
        </div>
        <p className={styles.description}>
          Add this RSS URL to Apple Podcasts, Overcast, Pocket Casts, or any podcast app. It
          includes your ready episodes regardless of visibility.
        </p>
      </div>

      <div className={styles.createRow}>
        <Input
          label="Feed name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder={DEFAULT_FEED_NAME}
          maxLength={100}
        />
        <Button onClick={createFeed} loading={creating} disabled={creating}>
          Create Feed URL
        </Button>
      </div>

      {createdFeed && (
        <div className={styles.createdPanel} role="status">
          <div>
            <strong>{createdFeed.name}</strong>
            <p>Copy this URL now. Sotto stores only a hash and cannot show the raw token again.</p>
          </div>
          <div className={styles.feedUrlRow}>
            <Input label="Private RSS URL" value={createdFeed.feedUrl} readOnly />
            <Button
              variant="secondary"
              onClick={() => copyFeedUrl(createdFeed.feedUrl, createdFeed.id)}
            >
              {copiedId === createdFeed.id ? (
                <>
                  <Check size={16} aria-hidden="true" />
                  Copied
                </>
              ) : (
                <>
                  <Copy size={16} aria-hidden="true" />
                  Copy
                </>
              )}
            </Button>
          </div>
        </div>
      )}

      {errorMessage && <p className={styles.error}>{errorMessage}</p>}

      <div className={styles.tokenList} aria-label="Private feed URLs">
        {tokens.length === 0 ? (
          <p className={styles.empty}>No private feed URLs yet.</p>
        ) : (
          tokens.map((token) => (
            <div key={token.id} className={styles.tokenRow}>
              <div className={styles.tokenMeta}>
                <span className={styles.tokenName}>{token.name}</span>
                <span className={styles.tokenDetails}>
                  Created {formatDate(token.createdAt)} · Last used {formatDate(token.lastUsedAt)}
                </span>
              </div>
              <Button
                variant="danger"
                onClick={() => revokeFeed(token.id)}
                loading={revokingId === token.id}
                disabled={revokingId !== null}
              >
                <Trash2 size={16} aria-hidden="true" />
                Revoke
              </Button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
