'use client';

import { useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
import styles from './VersionHistory.module.css';

interface Version {
  id: string;
  version: number;
  audioUrl: string;
  duration: number | null;
  changeType: string;
  changeSummary: string | null;
  createdAt: string;
}

interface VersionHistoryProps {
  versions: Version[];
  currentVersion: number;
  onVersionSelect?: (version: Version) => void;
}

function getChangeTypeLabel(type: string): string {
  const labels: Record<string, string> = {
    initial: 'Initial',
    incorporation: 'Q&A Incorporated',
    regeneration: 'Regenerated',
  };
  return labels[type] || type;
}

function formatDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  return `${minutes}:${secs.toString().padStart(2, '0')}`;
}

export function VersionHistory({ versions, currentVersion, onVersionSelect }: VersionHistoryProps) {
  const [expanded, setExpanded] = useState(false);

  if (versions.length <= 1) return null;

  const displayVersions = expanded ? versions : versions.slice(0, 3);

  return (
    <div className={styles.root}>
      <button
        type="button"
        className={styles.toggle}
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
      >
        <h3 className={styles.heading}>Version History</h3>
        <span className={styles.count}>{versions.length} versions</span>
        <svg
          className={`${styles.chevron} ${expanded ? styles.chevronExpanded : ''}`}
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {expanded && (
        <div className={styles.timeline}>
          {displayVersions.map((version) => {
            const isActive = version.version === currentVersion;

            return (
              <button
                key={version.id}
                type="button"
                className={`${styles.item} ${isActive ? styles.itemActive : ''}`}
                onClick={() => onVersionSelect?.(version)}
                aria-label={`Version ${version.version}${isActive ? ' (current)' : ''}`}
                aria-pressed={isActive}
              >
                <div className={`${styles.dot} ${isActive ? styles.dotActive : ''}`} />

                <div className={styles.content}>
                  <div className={styles.itemHeader}>
                    <span className={styles.versionLabel}>v{version.version}</span>
                    <span
                      className={`${styles.changeType} ${styles[`changeType_${version.changeType}`] || ''}`}
                    >
                      {getChangeTypeLabel(version.changeType)}
                    </span>
                    {isActive && <span className={styles.currentBadge}>Current</span>}
                  </div>

                  {version.changeSummary && (
                    <p className={styles.summary}>{version.changeSummary}</p>
                  )}

                  <div className={styles.meta}>
                    {version.duration != null && (
                      <span className={styles.metaItem}>{formatDuration(version.duration)}</span>
                    )}
                    <span className={styles.metaItem}>
                      {formatDistanceToNow(new Date(version.createdAt), { addSuffix: true })}
                    </span>
                  </div>
                </div>
              </button>
            );
          })}

          {!expanded && versions.length > 3 && (
            <button type="button" className={styles.showMore} onClick={() => setExpanded(true)}>
              Show {versions.length - 3} more versions
            </button>
          )}
        </div>
      )}
    </div>
  );
}
