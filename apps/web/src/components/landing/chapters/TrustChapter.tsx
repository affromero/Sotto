import { ScrollChapter } from '../ScrollChapter';
import styles from './TrustChapter.module.css';

const DOMAINS = [
  { name: 'Academic', threshold: 82, dotClass: 'dotAcademic' },
  { name: 'News', threshold: 65, dotClass: 'dotNews' },
  { name: 'Government', threshold: 72, dotClass: 'dotGovernment' },
  { name: 'General', threshold: 68, dotClass: 'dotGeneral' },
] as const;

export function TrustChapter() {
  return (
    <ScrollChapter id="verification">
      <div className={styles.root}>
        {/* Trust strip — full bleed */}
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

        {/* Asymmetric 2-column */}
        <div className={styles.columns}>
          <div className={styles.colText} data-reveal>
            <span className={styles.overline}>Open Verification Standard</span>
            <div className={styles.pillRow}>
              <span className={styles.pill}>Bayesian v2</span>
            </div>
            <h2 className={styles.heading}>Domain-aware. Claim-level. Open source.</h2>
            <p className={styles.description}>
              Every reference is scored by its domain. News articles don&apos;t
              need DOIs, and Wikipedia isn&apos;t held to the same bar as Nature.
            </p>
            <p className={styles.description}>
              We don&apos;t optimize for watch time or retention metrics. We optimize
              for genuine understanding. The goal isn&apos;t more content. It&apos;s better
              content that actually teaches you something.
            </p>

            <p className={styles.footer}>
              Scoring logic is open source.{' '}
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

          <div className={styles.colVisual} data-reveal>
            <div className={styles.card}>
              <div className={styles.domains}>
                {DOMAINS.map((d) => (
                  <div key={d.name} className={styles.domain}>
                    <span
                      className={`${styles.domainDot} ${styles[d.dotClass]}`}
                      aria-hidden="true"
                    />
                    <span className={styles.domainName}>{d.name}</span>
                    <span className={styles.domainThreshold}>
                      Bayes &ge; {d.threshold}%
                    </span>
                    <div className={styles.progressTrack}>
                      <div
                        className={styles.progressFill}
                        style={{ '--fill-pct': `${d.threshold}%` } as React.CSSProperties}
                      />
                    </div>
                  </div>
                ))}
              </div>

              <div className={styles.cardCallout}>
                <p>
                  <strong>Claim-level verification.</strong> The AI reads the exact sentence
                  that cites each reference and checks whether the source actually supports
                  the claim.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </ScrollChapter>
  );
}
