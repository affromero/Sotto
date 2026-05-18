'use client';

import { useState } from 'react';
import type { ReferenceData } from '@/types/reference';
import { getVerificationStandardUrl } from '@/lib/public-links';
import styles from './ReferenceList.module.css';

interface ReferenceListProps {
  references: ReferenceData[];
}

const TYPE_LABELS: Record<string, string> = {
  WEB: 'Web',
  PAPER: 'Paper',
  BOOK: 'Book',
  ARTICLE: 'Article',
  VIDEO: 'Video',
  REPORT: 'Report',
};

const DOMAIN_LABELS: Record<string, string> = {
  ACADEMIC: 'Academic',
  NEWS: 'News',
  GOVERNMENT: 'Gov',
  EDUCATIONAL: 'Edu',
  GENERAL: 'General',
};

function DomainBadge({ domain }: { domain: string | null }) {
  if (!domain || !DOMAIN_LABELS[domain]) return null;
  return (
    <span className={`${styles.domainBadge} ${styles[`domain${domain.charAt(0) + domain.slice(1).toLowerCase()}`]}`}>
      {DOMAIN_LABELS[domain]}
    </span>
  );
}

const LAYER_LABELS: Record<string, string> = {
  url_check: 'URL Check',
  crossref: 'CrossRef',
  openalex: 'OpenAlex',
  ai_evaluation: 'AI Evaluation',
};

function VerificationBadge({ status }: { status: string }) {
  if (status === 'VERIFIED') {
    return (
      <span className={styles.verifiedBadge} title="Verified" aria-label="Verified">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      </span>
    );
  }
  if (status === 'FAILED') {
    return (
      <span className={styles.failedBadge} title="Verification failed" aria-label="Verification failed">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </span>
    );
  }
  return (
    <span className={styles.pendingBadge} title="Pending verification" aria-label="Pending verification">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <circle cx="12" cy="12" r="5" />
      </svg>
    </span>
  );
}

interface CheckEntry {
  layer: string;
  passed: boolean;
  confidence?: number;
  detail?: string;
}

function VerificationDetails({ details }: { details: Record<string, unknown> | null }) {
  if (!details) return null;

  const checks = (details.checks as CheckEntry[] | undefined) ?? [];
  if (checks.length === 0) return null;

  return (
    <div className={styles.verificationDetails}>
      {checks.map((check, i) => (
        <div key={`${check.layer}-${i}`} className={styles.layerRow}>
          <span className={check.passed ? styles.layerPassed : styles.layerFailed}>
            {check.passed ? (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            ) : (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            )}
          </span>
          <span className={styles.layerName}>{LAYER_LABELS[check.layer] || check.layer}</span>
          {check.detail && (
            <span className={styles.layerDetail}>{check.detail}</span>
          )}
        </div>
      ))}
    </div>
  );
}

export function ReferenceList({ references }: ReferenceListProps) {
  const [expanded, setExpanded] = useState(references.length <= 10);
  const [expandedRef, setExpandedRef] = useState<string | null>(null);
  const verificationStandardUrl = getVerificationStandardUrl();

  if (references.length === 0) return null;

  const sorted = [...references].sort((a, b) => a.number - b.number);

  return (
    <section className={styles.root} aria-label="References">
      <button
        className={styles.header}
        onClick={() => setExpanded((prev) => !prev)}
        aria-expanded={expanded}
        type="button"
      >
        <h3 className={styles.heading}>
          References
          <span className={styles.count}>({references.length})</span>
        </h3>
        <svg
          className={`${styles.chevron} ${expanded ? styles.chevronOpen : ''}`}
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {expanded && (
        <div className={styles.content}>
          <ol className={styles.list}>
            {sorted.map((ref) => {
              const isExpanded = expandedRef === ref.id;
              const hasDetails = ref.verificationDetails !== null;
              return (
                <li key={ref.id} className={styles.item} value={ref.number}>
                  <div className={styles.refBody}>
                    <span className={styles.titleRow}>
                      <span className={styles.title}>{ref.title}</span>
                      <DomainBadge domain={ref.contentDomain} />
                      <VerificationBadge status={ref.verificationStatus} />
                      {hasDetails && (
                        <button
                          className={styles.detailsToggle}
                          onClick={() => setExpandedRef(isExpanded ? null : ref.id)}
                          aria-expanded={isExpanded}
                          aria-label={isExpanded ? 'Hide verification details' : 'Show verification details'}
                          type="button"
                        >
                          {isExpanded ? 'Hide details' : 'Details'}
                        </button>
                      )}
                    </span>
                    {ref.authors.length > 0 && (
                      <span className={styles.authors}>
                        {ref.authors.join(', ')}
                      </span>
                    )}
                    <span className={styles.meta}>
                      {ref.year && <span>{ref.year}</span>}
                      {ref.publisher && (
                        <>
                          {ref.year && ' \u00B7 '}
                          <span>{ref.publisher}</span>
                        </>
                      )}
                      {' \u00B7 '}
                      <span className={styles.typeBadge}>
                        {TYPE_LABELS[ref.type] || ref.type}
                      </span>
                    </span>
                    {ref.url && (
                      <a
                        href={ref.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={styles.link}
                      >
                        {ref.url}
                      </a>
                    )}
                    {ref.doi && (
                      <span className={styles.doi}>DOI: {ref.doi}</span>
                    )}
                    {isExpanded && (
                      <VerificationDetails details={ref.verificationDetails} />
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
          <p className={styles.disclaimer}>
            References verified using domain-aware scoring for academic, news, government,
            educational, and general sources.
            {verificationStandardUrl && (
              <>
                {' '}
                <a
                  href={verificationStandardUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={styles.disclaimerLink}
                >
                  View the verification standard.
                </a>
              </>
            )}
          </p>
        </div>
      )}
    </section>
  );
}
