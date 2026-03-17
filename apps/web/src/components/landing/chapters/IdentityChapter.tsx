import { ScrollChapter } from '../ScrollChapter';
import styles from './IdentityChapter.module.css';

export function IdentityChapter() {
  return (
    <ScrollChapter id="identity" alt>
      <div className={styles.root}>
        {/* Asymmetric 2-column */}
        <div className={styles.columns}>
          <div className={styles.colText} data-reveal>
            <span className={styles.overline}>Verified Identity</span>
            <h2 className={styles.heading}>
              Your Face. Your Voice. Your Podcast.
            </h2>
            <p className={styles.description}>
              Verified users can clone their voice and upload a portrait photo
              for lip-sync avatars &mdash; making every podcast truly theirs.
              Sound like yourself. Look like yourself. Own your content.
            </p>
            <p className={styles.description}>
              We gate these features behind identity verification because they
              matter. No one can clone your voice or use your face without your
              explicit consent. We have zero tolerance for impersonation or
              deepfakes &mdash; protecting creators and public figures isn&apos;t
              a policy footnote, it&apos;s a core design decision.
            </p>
            <p className={styles.footer}>
              Verification is quick and free &mdash; once verified, you unlock
              voice cloning, avatar uploads, and the ability to share with other
              creators. All AI-generated content is clearly labeled, always.
            </p>
          </div>

          <div className={styles.colVisual} data-reveal>
            <article className={styles.featureCard}>
              <div className={styles.cardIcon}>
                <svg
                  width="24"
                  height="24"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                  <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                  <line x1="12" y1="19" x2="12" y2="23" />
                  <line x1="8" y1="23" x2="16" y2="23" />
                </svg>
              </div>
              <h3 className={styles.cardTitle}>Voice Cloning</h3>
              <p className={styles.cardDesc}>
                Record or import your voice. Every episode sounds like you &mdash;
                across any topic, any length.
              </p>
              <span className={styles.verifiedBadge}>
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                  <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </svg>
                Verified users
              </span>
            </article>

            <article className={styles.featureCard}>
              <div className={styles.cardIcon}>
                <svg
                  width="24"
                  height="24"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                  <circle cx="12" cy="7" r="4" />
                </svg>
              </div>
              <h3 className={styles.cardTitle}>Avatar Images</h3>
              <p className={styles.cardDesc}>
                Upload your portrait. Lip-sync avatars bring your face to
                video podcasts &mdash; consent-verified and shareable.
              </p>
              <span className={styles.verifiedBadge}>
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                  <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </svg>
                Verified users
              </span>
            </article>
          </div>
        </div>

        {/* Loop strip */}
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
            className={styles.stripIcon}
          >
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            <path d="M9 12l2 2 4-4" />
          </svg>
          <span className={styles.stripText}>
            <span className={styles.loopStep}>Chat</span>
            <span className={styles.loopArrow} aria-hidden="true">&rarr;</span>
            <span className={styles.loopStep}>Script</span>
            <span className={styles.loopArrow} aria-hidden="true">&rarr;</span>
            <span className={styles.loopStepHighlight}>Your Voice</span>
            <span className={styles.loopArrow} aria-hidden="true">&rarr;</span>
            <span className={styles.loopStepHighlight}>Your Face</span>
            <span className={styles.loopArrow} aria-hidden="true">&rarr;</span>
            <span className={styles.loopStep}>Publish</span>
          </span>
        </div>
      </div>
    </ScrollChapter>
  );
}
