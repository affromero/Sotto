import Link from 'next/link';
import { PublicNav } from '@/components/layout/PublicNav';
import { Footer } from '@/components/layout/Footer';
import styles from './page.module.css';

const GITHUB_URL = 'https://github.com/affromero/Sotto';

export const metadata = {
  title: 'Free and Self-Hosted. Sotto',
  description:
    'Sotto is free and open-source. Run it yourself with your own agent and your own provider keys. No subscription, no waitlist.',
};

export default function PricingPage() {
  return (
    <>
      <PublicNav />
      <main className={styles.main}>
        <div className={styles.container}>
          <header className={styles.hero}>
            <h1 className={styles.heroTitle}>Free and self-hosted.</h1>
            <p className={styles.heroSubtitle}>
              Sotto has no price tag. It is open-source language-learning
              infrastructure that you run yourself, with your own agent and your
              own keys. There is no subscription and no waitlist.
            </p>
          </header>

          <section className={styles.plans}>
            <div className={`${styles.plan} ${styles.planFeatured}`}>
              <div className={styles.planBadge}>Free</div>
              <div className={styles.planHeader}>
                <h2 className={styles.planName}>Self-Hosted</h2>
                <p className={styles.planPrice}>$0</p>
              </div>
              <p className={styles.planDescription}>
                The whole stack, on your own machine. You pay your AI and audio
                providers directly for what you use. Nothing else.
              </p>
              <ul className={styles.planFeatures}>
                <li>Mastery-gated CEFR courses</li>
                <li>Five skills: grammar, reading, listening, speaking, writing</li>
                <li>A personal vocabulary memory graph you own</li>
                <li>Bring your own agent: Claude Code or Codex</li>
                <li>Bring your own keys (BYOK), billed by your providers</li>
                <li>Keys encrypted with AES-256-GCM on your instance</li>
                <li>Your data and progress stay on your stack</li>
                <li>No social layer, no public timeline</li>
              </ul>
              <a
                href={GITHUB_URL}
                target="_blank"
                rel="noopener noreferrer"
                className={styles.planButton}
              >
                Get it on GitHub
              </a>
            </div>
          </section>

          <section className={styles.cta}>
            <h2 className={styles.ctaTitle}>Ready to run your own?</h2>
            <p className={styles.ctaText}>
              Clone the repository, point it at your keys, and start learning.
              Setup notes and help live with the project.
            </p>
            <div className={styles.ctaButtons}>
              <a
                href={GITHUB_URL}
                target="_blank"
                rel="noopener noreferrer"
                className={styles.ctaButtonPrimary}
              >
                Read the self-host guide
              </a>
              <Link href="/support" className={styles.ctaButtonPrimary}>
                Get setup help
              </Link>
            </div>
          </section>
        </div>
      </main>
      <Footer />
    </>
  );
}
