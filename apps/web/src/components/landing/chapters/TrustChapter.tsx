import { ScrollChapter } from '../ScrollChapter';
import styles from './TrustChapter.module.css';

export function TrustChapter() {
  return (
    <ScrollChapter id="verification">
      <div className={styles.root}>
        {/* Trust strip */}
        <div className={styles.strip} data-reveal>
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            className={styles.shieldIcon}
          >
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            <path d="M9 12l2 2 4-4" />
          </svg>
          <span className={styles.stripText}>
            Every claim fact-checked. Every source verified. No hallucinations.
          </span>
        </div>

        {/* Verification summary */}
        <div className={styles.content}>
          <div className={styles.header} data-reveal>
            <span className={styles.overline}>Open Verification Standard</span>
            <div className={styles.pillRow}>
              <span className={styles.pill}>Bayesian v2</span>
            </div>
            <h2 className={styles.heading}>Domain-aware. Claim-level. Open source.</h2>
            <p className={styles.description}>
              Every reference is scored by its domain &mdash; because news articles don&apos;t
              need DOIs, and Wikipedia isn&apos;t held to the same bar as Nature.
            </p>
          </div>

          {/* Simplified verification card */}
          <div className={styles.card} data-reveal>
            <div className={styles.domains}>
              <div className={styles.domain}>
                <span
                  className={styles.domainDot}
                  style={{ background: '#1E3A5F' }}
                  aria-hidden="true"
                />
                <span className={styles.domainName}>Academic</span>
                <span className={styles.domainThreshold}>Bayes &ge; 82%</span>
              </div>
              <div className={styles.domain}>
                <span
                  className={styles.domainDot}
                  style={{ background: '#D97706' }}
                  aria-hidden="true"
                />
                <span className={styles.domainName}>News</span>
                <span className={styles.domainThreshold}>Bayes &ge; 65%</span>
              </div>
              <div className={styles.domain}>
                <span
                  className={styles.domainDot}
                  style={{ background: '#16A34A' }}
                  aria-hidden="true"
                />
                <span className={styles.domainName}>Government</span>
                <span className={styles.domainThreshold}>Bayes &ge; 72%</span>
              </div>
              <div className={styles.domain}>
                <span
                  className={styles.domainDot}
                  style={{ background: '#6B7280' }}
                  aria-hidden="true"
                />
                <span className={styles.domainName}>General</span>
                <span className={styles.domainThreshold}>Bayes &ge; 68%</span>
              </div>
            </div>

            <div className={styles.cardCallout}>
              <p>
                <strong>Claim-level verification</strong> &mdash; AI reads the exact sentence
                that cites each reference and checks whether the source actually supports
                the claim.
              </p>
            </div>
          </div>

          {/* Open source callout */}
          <p className={styles.footer} data-reveal>
            Scoring logic is open source &mdash;{' '}
            <a
              href="https://github.com/SottoFM/reference-verification-standard"
              target="_blank"
              rel="noopener noreferrer"
            >
              view on GitHub
            </a>
            . Community improvements welcome.
          </p>
        </div>
      </div>
    </ScrollChapter>
  );
}
