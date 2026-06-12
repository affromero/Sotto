'use client';

/**
 * ClassSources — the verified-sources panel for a sourced class. Renders the
 * class's references (surfaced from the LISTENING episode) as a calm, numbered
 * list in the aula design system, each with a verification badge and an optional
 * content-domain tag. When the class was built from a real link, a "Built from …"
 * attribution links out to the source.
 *
 * Built locally rather than reusing the player's `ReferenceList` because that
 * component is themed on the warm/amber player tokens (would clash inside the
 * aula-blue class stage) and collapses REPLACED/REMOVED into a generic "pending"
 * badge. Here the verification tone follows the class contract exactly.
 */

import {
  domainLabel,
  verificationTone,
  VERIFICATION_LABEL,
  type ClassReference,
} from './classTypes';
import styles from './ClassSources.module.css';

interface ClassSourcesProps {
  references: ClassReference[];
  sourceUrl: string | null;
  sourceTitle: string | null;
}

function VerifyBadge({ tone }: { tone: ReturnType<typeof verificationTone> }) {
  const label = VERIFICATION_LABEL[tone];
  if (tone === 'verified') {
    return (
      <span className={`${styles.badge} ${styles.badgeVerified}`} title={label}>
        <svg
          width="13"
          height="13"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <polyline points="20 6 9 17 4 12" />
        </svg>
        {label}
      </span>
    );
  }
  if (tone === 'checking') {
    return (
      <span className={`${styles.badge} ${styles.badgeChecking}`} title={label}>
        <span className={styles.checkingDot} aria-hidden="true" />
        {label}
      </span>
    );
  }
  return (
    <span className={`${styles.badge} ${styles.badgeUnverified}`} title="Could not be verified">
      {label}
    </span>
  );
}

export function ClassSources({ references, sourceUrl, sourceTitle }: ClassSourcesProps) {
  const hasRefs = references.length > 0;
  if (!hasRefs && !sourceUrl) return null;

  const sorted = [...references].sort((a, b) => a.number - b.number);
  const attribution = sourceTitle ?? sourceUrl;

  return (
    <section className={styles.root} aria-label="Class sources">
      <div className={styles.head}>
        <span className={styles.eyebrow}>Sources</span>
        <h2 className={styles.title}>Where this class came from.</h2>
      </div>

      {sourceUrl && attribution && (
        <p className={styles.builtFrom}>
          Built from{' '}
          <a href={sourceUrl} target="_blank" rel="noopener noreferrer" className={styles.builtLink}>
            {attribution}
          </a>
        </p>
      )}

      {hasRefs && (
        <ol className={styles.list}>
          {sorted.map((ref) => {
            const tone = verificationTone(ref.verificationStatus);
            const domain = domainLabel(ref.contentDomain);
            return (
              <li key={ref.number} className={styles.item} value={ref.number}>
                <span className={styles.num} aria-hidden="true">
                  [{ref.number}]
                </span>
                <div className={styles.body}>
                  <div className={styles.titleRow}>
                    {ref.url ? (
                      <a
                        href={ref.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={styles.refTitle}
                      >
                        {ref.title}
                      </a>
                    ) : (
                      <span className={styles.refTitle}>{ref.title}</span>
                    )}
                  </div>
                  <div className={styles.metaRow}>
                    {ref.authors.length > 0 && (
                      <span className={styles.authors}>{ref.authors.join(', ')}</span>
                    )}
                    {ref.year != null && <span className={styles.year}>{ref.year}</span>}
                    {domain && <span className={styles.domain}>{domain}</span>}
                    <VerifyBadge tone={tone} />
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
