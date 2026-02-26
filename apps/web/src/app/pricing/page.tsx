import Link from 'next/link';
import { PublicNav } from '@/components/layout/PublicNav';
import { Footer } from '@/components/layout/Footer';
import styles from './page.module.css';

export const metadata = {
  title: 'Pricing — Sotto',
  description:
    'Sotto is free during early access. Join the waitlist, get approved, and create unlimited AI podcasts — no credit card required.',
};

export default function PricingPage() {
  return (
    <>
      <PublicNav />
      <main className={styles.main}>
        <div className={styles.container}>
          <header className={styles.hero}>
            <h1 className={styles.heroTitle}>Free during early access.</h1>
            <p className={styles.heroSubtitle}>
              We&apos;re launching Sotto with a small group of early members.
              Everything is free while we refine the experience — early members
              will be grandfathered into the best plan when we introduce pricing.
            </p>
          </header>

          <section className={styles.plans}>
            <div className={`${styles.plan} ${styles.planFeatured}`}>
              <div className={styles.planBadge}>Early Access</div>
              <div className={styles.planHeader}>
                <h2 className={styles.planName}>All Features</h2>
                <p className={styles.planPrice}>$0 / early access</p>
              </div>
              <p className={styles.planDescription}>
                Approved waitlist members get full access to everything Sotto
                offers — no limits, no credit card.
              </p>
              <ul className={styles.planFeatures}>
                <li>Unlimited podcasts</li>
                <li>Platform AI + voices included</li>
                <li>Web search for current information</li>
                <li>Q&amp;A interactions while listening</li>
                <li>Fork and remix any podcast</li>
                <li>Import existing podcasts</li>
                <li>Browse, listen, and share</li>
                <li>Collections and social features</li>
              </ul>
              <Link href="/" className={styles.planButton}>
                Join the Waitlist
              </Link>
            </div>
          </section>

          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>Bring Your Own Keys</h2>
            <p className={styles.sectionText}>
              Want to use your own AI and TTS providers? Sotto supports BYOK
              (Bring Your Own Keys) — connect your accounts with Anthropic,
              OpenAI, Groq, ElevenLabs, Cartesia, Hume, Fal, or
              Replicate. We encrypt your keys with AES-256-GCM and only decrypt
              them in-memory during your request.
            </p>
          </section>

          <section className={styles.providers}>
            <h2 className={styles.sectionTitle}>BYOK Provider Support</h2>
            <div className={styles.providerGrid}>
              <div className={styles.providerGroup}>
                <h3 className={styles.providerGroupTitle}>AI Models</h3>
                <ul className={styles.providerList}>
                  <li>Anthropic</li>
                  <li>OpenAI</li>
                  <li>Groq</li>
                </ul>
              </div>
              <div className={styles.providerGroup}>
                <h3 className={styles.providerGroupTitle}>Text-to-Speech</h3>
                <ul className={styles.providerList}>
                  <li>ElevenLabs</li>
                  <li>OpenAI TTS</li>
                  <li>Cartesia</li>
                  <li>Hume</li>
                  <li>Fal</li>
                  <li>Replicate</li>
                </ul>
              </div>
            </div>
          </section>

          <section className={styles.cta}>
            <h2 className={styles.ctaTitle}>Ready to start?</h2>
            <p className={styles.ctaText}>
              Join the waitlist and we&apos;ll let you know when your spot is
              ready.
            </p>
            <div className={styles.ctaButtons}>
              <Link href="/" className={styles.ctaButtonPrimary}>
                Join the Waitlist
              </Link>
            </div>
          </section>
        </div>
      </main>
      <Footer />
    </>
  );
}
