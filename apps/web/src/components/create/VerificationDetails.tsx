'use client';

import { useCallback, useEffect, useState } from 'react';
import type { VerificationDetailsResponse } from '@/app/api/podcasts/[podcastId]/verification-details/route';
import styles from './VerificationDetails.module.css';

interface VerificationDetailsProps {
  podcastId: string;
  failureReason: string;
  onRetrySuggestion?: (suggestion: string) => void;
}

interface ClaimItem {
  claim: string;
  speaker: string;
  turnIndex: number;
  note: string;
}

function ClaimList({ title, claims, variant }: { title: string; claims: ClaimItem[]; variant: string }) {
  const [expanded, setExpanded] = useState(false);

  if (claims.length === 0) return null;

  return (
    <div className={styles.section}>
      <button
        type="button"
        className={`${styles.sectionHeader} ${styles[variant]}`}
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
      >
        <span className={styles.sectionTitle}>
          {title}
          <span className={styles.sectionCount}>{claims.length}</span>
        </span>
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={expanded ? styles.chevronOpen : styles.chevron}
          aria-hidden="true"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {expanded && (
        <ul className={styles.claimList}>
          {claims.map((c, i) => (
            <li key={i} className={styles.claimItem}>
              <p className={styles.claimText}>&ldquo;{c.claim}&rdquo;</p>
              <p className={styles.claimMeta}>
                <span className={styles.claimSpeaker}>{c.speaker}</span>
                {' \u00b7 '}
                {c.note}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function VerificationDetails({ podcastId, failureReason, onRetrySuggestion }: VerificationDetailsProps) {
  const [details, setDetails] = useState<VerificationDetailsResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function fetchDetails() {
      try {
        const res = await fetch(`/api/podcasts/${podcastId}/verification-details`);
        if (!res.ok) return;
        const data: VerificationDetailsResponse = await res.json();
        if (!cancelled) setDetails(data);
      } catch {
        // Silently fail — the plain error message is still shown
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    fetchDetails();
    return () => { cancelled = true; };
  }, [podcastId]);

  const handleSuggestionClick = useCallback(() => {
    if (details?.feasibilitySuggestion && onRetrySuggestion) {
      onRetrySuggestion(details.feasibilitySuggestion);
    }
  }, [details?.feasibilitySuggestion, onRetrySuggestion]);

  return (
    <div className={styles.root} role="alert">
      <div className={styles.header}>
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={styles.headerIcon}
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
        <p className={styles.headerText}>{failureReason}</p>
      </div>

      {loading && (
        <p className={styles.loading}>Loading verification details...</p>
      )}

      {!loading && details?.hasClaims && (
        <div className={styles.details}>
          <div className={styles.summaryBar}>
            <span className={styles.summaryItem}>
              {details.summary.totalClaims} claims checked
            </span>
            {details.summary.adequatelySourcing > 0 && (
              <span className={`${styles.summaryItem} ${styles.summaryPassed}`}>
                {details.summary.adequatelySourcing} passed
              </span>
            )}
            {details.summary.unsupported > 0 && (
              <span className={`${styles.summaryItem} ${styles.summaryFailed}`}>
                {details.summary.unsupported} unsupported
              </span>
            )}
          </div>

          <ClaimList
            title="Unsupported Claims"
            claims={details.unsupportedClaims}
            variant="unsupported"
          />
          <ClaimList
            title="Unreliable Sources"
            claims={details.unreliableSourceClaims}
            variant="unreliable"
          />
          <ClaimList
            title="Misattributed Claims"
            claims={details.misattributedClaims}
            variant="misattributed"
          />
        </div>
      )}

      {!loading && details?.feasibilitySuggestion && (
        <div className={styles.suggestion}>
          <p className={styles.suggestionLabel}>Try a different angle:</p>
          <button
            type="button"
            className={styles.suggestionChip}
            onClick={handleSuggestionClick}
          >
            {details.feasibilitySuggestion}
          </button>
        </div>
      )}
    </div>
  );
}
