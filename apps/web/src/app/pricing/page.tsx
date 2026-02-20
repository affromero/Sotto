import Link from 'next/link';
import { PublicNav } from '@/components/layout/PublicNav';
import { Footer } from '@/components/layout/Footer';
import styles from './page.module.css';

export const metadata = {
  title: 'Pricing — Sotto',
  description:
    '1 podcast every day, free forever — no credit card, no API keys. Upgrade to Pro for unlimited generation, priority queue, and creator analytics.',
};

export default function PricingPage() {
  return (
    <>
      <PublicNav />
      <main className={styles.main}>
        <div className={styles.container}>
          <header className={styles.hero}>
            <h1 className={styles.heroTitle}>Simple, honest pricing.</h1>
            <p className={styles.heroSubtitle}>
              Start free — no credit card, no API keys. Upgrade when you need more.
            </p>
          </header>

          <section className={styles.plans}>
            {/* Free plan */}
            <div className={styles.plan}>
              <div className={styles.planHeader}>
                <h2 className={styles.planName}>Free</h2>
                <p className={styles.planPrice}>$0 / forever</p>
              </div>
              <p className={styles.planDescription}>
                One podcast every day — platform AI and voices included. No keys, no card.
              </p>
              <ul className={styles.planFeatures}>
                <li>1 podcast per day</li>
                <li>Platform Groq AI + KittenTTS</li>
                <li>Up to 15 minutes</li>
                <li>3 Q&amp;A interactions per podcast</li>
                <li>Browse, listen, and fork</li>
                <li>Collections and social features</li>
              </ul>
              <Link href="/auth/signup" className={styles.planButton}>
                Get Started Free
              </Link>
            </div>

            {/* Pro plan */}
            <div className={`${styles.plan} ${styles.planFeatured}`}>
              <div className={styles.planBadge}>Most popular</div>
              <div className={styles.planHeader}>
                <h2 className={styles.planName}>Pro</h2>
                <p className={styles.planPrice}>$12 / month</p>
              </div>
              <p className={styles.planDescription}>
                Unlimited generation with better AI, priority queue, and creator analytics.
                No API keys needed.
              </p>
              <ul className={styles.planFeatures}>
                <li>Unlimited podcasts per day</li>
                <li>Groq Llama 70B (better scripts)</li>
                <li>Up to 30 minutes</li>
                <li>Unlimited Q&amp;A interactions</li>
                <li>Script review before audio</li>
                <li>Private &amp; unlisted podcasts</li>
                <li>Priority queue (faster generation)</li>
                <li>Creator analytics dashboard</li>
                <li>Everything in Free</li>
              </ul>
              <Link href="/auth/signup?upgrade=pro" className={styles.planButtonFeatured}>
                Start Pro — $12/month
              </Link>
            </div>

            {/* BYOK plan */}
            <div className={styles.plan}>
              <div className={styles.planHeader}>
                <h2 className={styles.planName}>BYOK</h2>
                <p className={styles.planPrice}>Free with your keys</p>
              </div>
              <p className={styles.planDescription}>
                Bring your own API keys for full model choice, voice cloning, and no caps.
              </p>
              <ul className={styles.planFeatures}>
                <li>Unlimited podcasts (no daily limit)</li>
                <li>Your choice of AI model</li>
                <li>Unlimited duration</li>
                <li>Unlimited Q&amp;A interactions</li>
                <li>Voice cloning marketplace</li>
                <li>All Pro features included</li>
                <li>7 TTS providers supported</li>
              </ul>
              <Link href="/settings/api" className={styles.planButton}>
                Set Up Your Keys
              </Link>
            </div>
          </section>

          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>Why Pro over BYOK?</h2>
            <p className={styles.sectionText}>
              Pro is for creators who want great results without managing API keys and bills.
              You get Groq&apos;s Llama 70B — the best open-source model for conversational
              scripts — with zero setup. BYOK is for power users who want custom models like
              Claude Opus, full voice cloning, and unlimited duration.
            </p>
          </section>

          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>How BYOK works</h2>
            <p className={styles.sectionText}>
              Create accounts with AI providers (Anthropic, OpenAI, or Groq) and TTS providers
              (ElevenLabs, OpenAI, PlayHT, Cartesia, Hume, Fal, or Replicate). Paste your API
              keys into Sotto — we encrypt them with AES-256-GCM and only decrypt them
              in-memory during your request. You pay providers directly, we never mark up costs.
            </p>
          </section>

          <section className={styles.providers}>
            <h2 className={styles.sectionTitle}>BYOK Provider Support</h2>
            <div className={styles.providerGrid}>
              <div className={styles.providerGroup}>
                <h3 className={styles.providerGroupTitle}>AI Models</h3>
                <ul className={styles.providerList}>
                  <li>Anthropic (Claude Opus / Sonnet / Haiku)</li>
                  <li>OpenAI (GPT-4o / Mini)</li>
                  <li>Groq (Llama 3.3 70B / 3.1 8B)</li>
                </ul>
              </div>
              <div className={styles.providerGroup}>
                <h3 className={styles.providerGroupTitle}>Text-to-Speech</h3>
                <ul className={styles.providerList}>
                  <li>ElevenLabs (voices + cloning)</li>
                  <li>OpenAI TTS</li>
                  <li>PlayHT</li>
                  <li>Cartesia</li>
                  <li>Hume</li>
                  <li>Fal (Qwen3-TTS)</li>
                  <li>Replicate</li>
                </ul>
              </div>
            </div>
          </section>

          <section className={styles.cta}>
            <h2 className={styles.ctaTitle}>Start listening today.</h2>
            <p className={styles.ctaText}>
              Create your first podcast free — no credit card, no API keys. Upgrade to Pro
              whenever you need more.
            </p>
            <div className={styles.ctaButtons}>
              <Link href="/auth/signup" className={styles.ctaButtonPrimary}>
                Get Started Free
              </Link>
              <Link href="/auth/signup?upgrade=pro" className={styles.ctaButtonSecondary}>
                Start Pro
              </Link>
            </div>
          </section>
        </div>
      </main>
      <Footer />
    </>
  );
}
