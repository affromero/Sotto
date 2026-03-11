import Link from 'next/link';
import { BRAND } from '@sotto/shared';
import { ScrollChapter } from '../ScrollChapter';
import { AuthCTA } from '../AuthCTA';
import styles from './ConvertChapter.module.css';

export function ConvertChapter() {
  return (
    <>
      {/* Early access pricing */}
      <ScrollChapter dark>
        <div className={styles.pricing}>
          <div className={styles.pricingGlow} aria-hidden="true" />
          <div className={styles.pricingContent}>
            <div className={styles.header} data-reveal>
              <span className={styles.overline}>Early access</span>
              <h2 className={styles.headingLight}>
                Free during
                <br />
                early access.
              </h2>
              <p className={styles.descLight}>
                Everything is free for early members &mdash; no limits, no card required.
                Generate podcasts with platform AI and voices, or bring your own API keys.
                We&apos;ll introduce plans later, and early members will be grandfathered in.
              </p>
            </div>
            <div className={styles.stats} data-reveal>
              <div className={styles.stat}>
                <span className={styles.statNum}>$0</span>
                <span className={styles.statLabel}>Early access</span>
              </div>
              <div className={styles.statDivider} aria-hidden="true" />
              <div className={styles.stat}>
                <span className={styles.statNum}>BYOK</span>
                <span className={styles.statLabel}>Bring your own keys</span>
              </div>
            </div>
          </div>
        </div>
      </ScrollChapter>

      {/* Final CTA */}
      <ScrollChapter dark>
        <div className={styles.cta}>
          <div className={styles.ctaGlow} aria-hidden="true" />
          <div className={styles.ctaContent} data-reveal>
            <h2 className={styles.ctaTitle}>
              Start creating <em>today.</em>
            </h2>
            <p className={styles.ctaSub}>{BRAND.subline}</p>
            <AuthCTA source="cta" />
          </div>
        </div>
      </ScrollChapter>

      {/* Footer */}
      <footer className={styles.footer}>
        <div className={styles.footerInner}>
          <div className={styles.footerBrand}>
            <span className={styles.footerLogo}>{BRAND.name}</span>
            <p>{BRAND.tagline}</p>
          </div>
          <div className={styles.footerCols}>
            <div>
              <strong className={styles.footerHeading}>Product</strong>
              <a href="#features">Features</a>
              <Link href="/voices">Voices</Link>
              <Link href="/feed">Feed</Link>
            </div>
            <div>
              <strong className={styles.footerHeading}>Company</strong>
              <Link href="/feedback" className={styles.footerFeedback}>
                Share Feedback
              </Link>
              <Link href="/about">About</Link>
              <Link href="/privacy">Privacy</Link>
              <Link href="/terms">Terms</Link>
              <Link href="/join">Join Us</Link>
            </div>
          </div>
        </div>
        <div className={styles.footerBottom}>
          &copy; {new Date().getFullYear()} Sotto. All rights reserved.
        </div>
      </footer>
    </>
  );
}
