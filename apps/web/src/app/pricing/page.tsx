import Link from 'next/link';
import { PublicNav } from '@/components/layout/PublicNav';
import { Footer } from '@/components/layout/Footer';
import styles from './page.module.css';

export const metadata = {
  title: 'Pricing — Sotto',
  description:
    '1 podcast every day, free forever — no credit card, no API keys. Upgrade to Pro for private podcasts, analytics, and voice tracks. Bring your own keys for unlimited generation.',
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
                <li>Platform AI + voices included</li>
                <li>Up to 5 minutes</li>
                <li>3 Q&amp;A interactions per podcast</li>
                <li>Scripts auto-approved</li>
                <li>Browse, listen, and fork</li>
                <li>Single voice per podcast</li>
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
                <li>Better AI models</li>
                <li>Up to 30 minutes</li>
                <li>Unlimited Q&amp;A interactions</li>
                <li>Script review before audio</li>
                <li>Private, unlisted, and public podcasts</li>
                <li>Priority queue (faster generation)</li>
                <li>Up to 3 voice tracks per podcast</li>
                <li>Voice cloning marketplace</li>
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
                Use your own API keys — no daily cap, own model choice, unlimited duration.
                Add Pro for private podcasts, analytics, and voice tracks.
              </p>
              <ul className={styles.planFeatures}>
                <li>Unlimited podcasts (no daily limit)</li>
                <li>Your choice of AI model</li>
                <li>Unlimited duration</li>
                <li>7 TTS providers supported</li>
                <li>Combine with Pro for the full feature set</li>
              </ul>
              <Link href="/settings/api" className={styles.planButton}>
                Set Up Your Keys
              </Link>
            </div>
          </section>

          <section className={styles.comparisonSection}>
            <h2 className={styles.sectionTitle}>Plan Comparison</h2>
            <table className={styles.comparisonTable}>
              <thead>
                <tr>
                  <th>Feature</th>
                  <th>Free</th>
                  <th>Pro</th>
                  <th>BYOK</th>
                  <th className={styles.comparisonHighlight}>Pro + BYOK</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Daily podcasts</td>
                  <td>1</td>
                  <td>Unlimited</td>
                  <td>Unlimited</td>
                  <td>Unlimited</td>
                </tr>
                <tr>
                  <td>Max duration</td>
                  <td>5 min</td>
                  <td>30 min</td>
                  <td>Unlimited</td>
                  <td>Unlimited</td>
                </tr>
                <tr>
                  <td>Q&amp;A interactions</td>
                  <td>3 per podcast</td>
                  <td>Unlimited</td>
                  <td>3 per podcast</td>
                  <td>Unlimited</td>
                </tr>
                <tr>
                  <td>Voice tracks</td>
                  <td>&#8212;</td>
                  <td className={styles.comparisonHighlight}>Up to 3</td>
                  <td>&#8212;</td>
                  <td className={styles.comparisonHighlight}>Unlimited</td>
                </tr>
                <tr>
                  <td>Script review</td>
                  <td>Auto-approve</td>
                  <td>Manual review</td>
                  <td>Auto-approve</td>
                  <td>Manual review</td>
                </tr>
                <tr>
                  <td>Private / Unlisted</td>
                  <td>&#8212;</td>
                  <td>Yes</td>
                  <td>&#8212;</td>
                  <td>Yes</td>
                </tr>
                <tr>
                  <td>Priority queue</td>
                  <td>&#8212;</td>
                  <td>Yes</td>
                  <td>&#8212;</td>
                  <td>Yes</td>
                </tr>
                <tr>
                  <td>Creator analytics</td>
                  <td>&#8212;</td>
                  <td>Yes</td>
                  <td>&#8212;</td>
                  <td>Yes</td>
                </tr>
                <tr>
                  <td>Voice cloning</td>
                  <td>&#8212;</td>
                  <td>Yes</td>
                  <td>&#8212;</td>
                  <td>Yes</td>
                </tr>
                <tr>
                  <td>AI model</td>
                  <td>Platform</td>
                  <td>Better models</td>
                  <td>Your choice</td>
                  <td>Your choice</td>
                </tr>
                <tr>
                  <td>TTS provider</td>
                  <td>Platform</td>
                  <td>Platform</td>
                  <td>7 providers</td>
                  <td>7 providers</td>
                </tr>
              </tbody>
            </table>
          </section>

          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>Pro and BYOK: Better Together</h2>
            <p className={styles.sectionText}>
              Pro and BYOK serve different needs — and they work great together.
              Pro unlocks premium features: private podcasts, analytics, voice tracks,
              voice cloning, script review, and unlimited Q&amp;A. BYOK removes generation
              limits and gives you full model choice with your own API keys. Pair them
              for the complete Sotto experience — your preferred models with every
              feature unlocked.
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
