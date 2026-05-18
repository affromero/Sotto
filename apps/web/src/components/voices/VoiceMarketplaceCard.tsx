'use client';

import { useState, useRef } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import styles from './VoiceMarketplaceCard.module.css';

export interface BrowseVoice {
  id: string;
  name: string;
  description: string | null;
  sourceType: string;
  priceInCents: number | null;
  createdAt: string;
  externalVoiceId: string;
  provider: string;
  isVerified?: boolean;
  owner: {
    id: string;
    name: string | null;
    handle: string | null;
    image: string | null;
  };
  ownerStripeOnboarded: boolean;
  approvedCount: number;
  requestStatus: string | null;
  hasAccess: boolean;
}

interface VoiceMarketplaceCardProps {
  voice: BrowseVoice;
  currentUserId: string | null;
  isAuthenticated: boolean;
  onRequestStatusChange: (voiceId: string, status: string) => void;
}

export function VoiceMarketplaceCard({
  voice,
  currentUserId,
  isAuthenticated,
  onRequestStatusChange,
}: VoiceMarketplaceCardProps) {
  const [playing, setPlaying] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [showRequestForm, setShowRequestForm] = useState(false);
  const [requestMessage, setRequestMessage] = useState('');
  const [error, setError] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const isOwner = currentUserId === voice.owner.id;

  async function handlePreview() {
    if (!isAuthenticated) return;

    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
      setPlaying(false);
      return;
    }

    try {
      setPlaying(true);
      setError(null);

      const response = await fetch('/api/voices/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          voiceId: voice.externalVoiceId,
          text: 'Welcome to Sotto. Let me tell you something fascinating today.',
          provider: voice.provider,
        }),
      });

      if (!response.ok) {
        setPlaying(false);
        return;
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audioRef.current = audio;

      audio.onended = () => {
        setPlaying(false);
        audioRef.current = null;
        URL.revokeObjectURL(url);
      };
      audio.onerror = () => {
        setPlaying(false);
        audioRef.current = null;
        URL.revokeObjectURL(url);
      };

      await audio.play();
    } catch {
      setPlaying(false);
    }
  }

  async function handleSubmitRequest() {
    setRequesting(true);
    setError(null);

    try {
      const response = await fetch('/api/voices/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          voiceCloneId: voice.id,
          message: requestMessage.trim() || undefined,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to submit request');
      }

      onRequestStatusChange(voice.id, 'PENDING');
      setShowRequestForm(false);
      setRequestMessage('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit request');
    } finally {
      setRequesting(false);
    }
  }

  function getInitial(name: string | null, handle?: string | null): string {
    if (name) return name.charAt(0).toUpperCase();
    if (handle) return handle.charAt(0).toUpperCase();
    return 'U';
  }

  return (
    <div className={styles.card}>
      <div className={styles.cardHeader}>
        <div className={styles.ownerIdentity}>
          {voice.owner.image ? (
            <Image
              src={voice.owner.image}
              alt={`${voice.owner.name || 'User'}'s avatar`}
              width={40}
              height={40}
              className={styles.avatar}
            />
          ) : (
            <span className={styles.avatarFallback}>
              {getInitial(voice.owner.name, voice.owner.handle)}
            </span>
          )}
          <div className={styles.ownerInfo}>
            <span className={styles.ownerName}>{voice.owner.name || 'Anonymous'}</span>
            {voice.owner.handle && (
              <span className={styles.ownerHandle}>@{voice.owner.handle}</span>
            )}
          </div>
        </div>
      </div>

      <div className={styles.cardBody}>
        <h3 className={styles.voiceName}>
          {voice.name}
          {voice.isVerified && (
            <span className={styles.verifiedBadge} title="Verified Voice">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                <circle cx="7" cy="7" r="7" fill="#16a34a" />
                <path
                  d="M4 7l2 2 4-4"
                  stroke="white"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              Verified
            </span>
          )}
        </h3>
        {voice.description && <p className={styles.voiceDescription}>{voice.description}</p>}

        <div className={styles.meta}>
          <span
            className={`${styles.badge} ${voice.sourceType === 'RECORD' ? styles.badgeRecord : styles.badgeUpload}`}
          >
            {voice.sourceType === 'RECORD' ? 'Recorded' : 'Uploaded'}
          </span>
          {voice.priceInCents && voice.priceInCents > 0 ? (
            <span className={styles.priceBadge}>
              ${(voice.priceInCents / 100).toFixed(2)} / podcast
            </span>
          ) : (
            <span className={styles.freeBadge}>Free</span>
          )}
          {voice.hasAccess && !isOwner && voice.priceInCents && voice.priceInCents > 0 && (
            <span className={styles.accessBadge}>Access Granted</span>
          )}
          {voice.approvedCount > 0 && (
            <span className={styles.usedBy}>
              Used by {voice.approvedCount} {voice.approvedCount === 1 ? 'creator' : 'creators'}
            </span>
          )}
        </div>
      </div>

      {error && (
        <div className={styles.error} role="alert">
          {error}
        </div>
      )}

      <div className={styles.cardFooter}>
        <button
          type="button"
          className={styles.previewBtn}
          onClick={handlePreview}
          disabled={playing || !isAuthenticated}
          title={isAuthenticated ? `Preview ${voice.name}` : 'Sign in to preview'}
          aria-label={`Preview ${voice.name}`}
        >
          {playing ? (
            <span className={styles.spinner} />
          ) : (
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
              <path d="M4 2.5v11l9-5.5L4 2.5z" />
            </svg>
          )}
          {playing ? 'Playing...' : 'Preview'}
        </button>

        {isOwner ? (
          <span className={styles.ownerBadge}>Your voice</span>
        ) : voice.requestStatus === 'PENDING' ? (
          <span className={`${styles.statusBadge} ${styles.statusPending}`}>Request Pending</span>
        ) : voice.requestStatus === 'APPROVED' ? (
          <span className={`${styles.statusBadge} ${styles.statusApproved}`}>Approved</span>
        ) : voice.requestStatus === 'DENIED' ? (
          <span className={`${styles.statusBadge} ${styles.statusDenied}`}>Denied</span>
        ) : isAuthenticated ? (
          showRequestForm ? (
            <div className={styles.requestForm}>
              <textarea
                className={styles.requestTextarea}
                value={requestMessage}
                onChange={(e) => setRequestMessage(e.target.value)}
                placeholder="Add a message (optional)..."
                maxLength={500}
                rows={2}
              />
              <div className={styles.requestActions}>
                <button
                  type="button"
                  className={styles.cancelBtn}
                  onClick={() => {
                    setShowRequestForm(false);
                    setRequestMessage('');
                  }}
                  disabled={requesting}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className={styles.submitBtn}
                  onClick={handleSubmitRequest}
                  disabled={requesting}
                >
                  {requesting ? 'Sending...' : 'Send Request'}
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              className={styles.requestBtn}
              onClick={() => setShowRequestForm(true)}
            >
              Request Access
            </button>
          )
        ) : (
          <Link href="/auth/login" className={styles.signInLink}>
            Sign in to request
          </Link>
        )}
      </div>
    </div>
  );
}
