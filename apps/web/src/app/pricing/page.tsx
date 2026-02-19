import Link from 'next/link';
import { PublicNav } from '@/components/layout/PublicNav';
import { Footer } from '@/components/layout/Footer';
import styles from './page.module.css';

export const metadata = {
  title: 'Pricing — Sotto',
  description:
    'Sotto is free, forever. Bring your own API keys and unlock unlimited podcast generation, Q&A, voice clones, and more.',
};

export default function PricingPage() {
  return (
    <>
      <PublicNav />
      <main className={styles.main}>
        <div className={styles.container}>
          <header className={styles.hero}>
            <h1 className={styles.heroTitle}>Free, forever.</h1>
            <p className={styles.heroSubtitle}>
              Sotto is free because you bring your own API keys. No
              subscriptions, no tiers, no usage caps. Just connect your keys
              and unlock everything.
            </p>
          </header>

          <section className={styles.plans}>
            <div className={styles.plan}>
              <div className={styles.planHeader}>
                <h2 className={styles.planName}>Listen</h2>
                <p className={styles.planPrice}>Free</p>
              </div>
              <p className={styles.planDescription}>
                Explore and enjoy everything on the network — no keys needed.
              </p>
              <ul className={styles.planFeatures}>
                <li>Browse the public feed</li>
                <li>Listen to any podcast</li>
                <li>Follow creators</li>
                <li>Fork public podcasts</li>
                <li>Build collections</li>
                <li>Comment and like</li>
              </ul>
              <Link href="/auth/signup" className={styles.planButton}>
                Get Started
              </Link>
            </div>

            <div className={`${styles.plan} ${styles.planFeatured}`}>
              <div className={styles.planHeader}>
                <h2 className={styles.planName}>Create</h2>
                <p className={styles.planPrice}>Free with BYOK</p>
              </div>
              <p className={styles.planDescription}>
                Bring your own API keys and unlock every feature on the
                platform — unlimited.
              </p>
              <ul className={styles.planFeatures}>
                <li>Everything in Listen</li>
                <li>Unlimited podcast generation</li>
                <li>Interactive Q&amp;A mid-playback</li>
                <li>Voice clones</li>
                <li>Private &amp; unlisted podcasts</li>
                <li>Downloads &amp; transcripts</li>
                <li>Import existing podcasts</li>
                <li>All current and future features</li>
              </ul>
              <Link href="/settings/api" className={styles.planButtonFeatured}>
                Set Up Your Keys
              </Link>
            </div>
          </section>

          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>How BYOK Works</h2>
            <p className={styles.sectionText}>
              BYOK stands for Bring Your Own Key. You create an account with
              an AI provider (like Anthropic or OpenAI) and a TTS provider
              (like ElevenLabs), then paste your API keys into Sotto. We
              encrypt them with AES-256-GCM, and your keys are only decrypted
              in-memory when processing your requests.
            </p>
            <p className={styles.sectionText}>
              You pay the provider directly for usage. Sotto never sees your
              bill, never marks up costs, and never stores your keys
              unencrypted. You stay in full control.
            </p>
          </section>

          <section className={styles.providers}>
            <h2 className={styles.sectionTitle}>Supported Providers</h2>
            <div className={styles.providerGrid}>
              <div className={styles.providerGroup}>
                <h3 className={styles.providerGroupTitle}>AI</h3>
                <ul className={styles.providerList}>
                  <li>Anthropic (Claude)</li>
                  <li>OpenAI (GPT)</li>
                </ul>
              </div>
              <div className={styles.providerGroup}>
                <h3 className={styles.providerGroupTitle}>Text-to-Speech</h3>
                <ul className={styles.providerList}>
                  <li>ElevenLabs</li>
                  <li>OpenAI</li>
                  <li>PlayHT</li>
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
              Create an account and start listening for free. When you&apos;re
              ready to create, add your API keys — it takes about two minutes.
            </p>
            <div className={styles.ctaButtons}>
              <Link href="/auth/signup" className={styles.ctaButtonPrimary}>
                Get Started
              </Link>
              <Link href="/settings/api" className={styles.ctaButtonSecondary}>
                Set Up Your Keys
              </Link>
            </div>
          </section>
        </div>
      </main>
      <Footer />
    </>
  );
}
