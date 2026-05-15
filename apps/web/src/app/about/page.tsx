import { BRAND } from '@sotto/shared';
import { PublicNav } from '@/components/layout/PublicNav';
import { Footer } from '@/components/layout/Footer';
import styles from './page.module.css';

export const metadata = {
  title: `About — ${BRAND.name}`,
  description: BRAND.description,
};

export default function AboutPage() {
  return (
    <>
      <PublicNav />
      <main className={styles.main}>
        <div className={styles.container}>
          <header className={styles.hero}>
            <h1 className={styles.heroTitle}>{BRAND.tagline}</h1>
            <p className={styles.heroSubtitle}>
              Sotto turns topics, sources, and meetings into private conversational
              podcasts you can interrupt and revisit. Built for curious minds who
              learn by listening.
            </p>
          </header>

          <section className={styles.features}>
            <div className={styles.feature}>
              <div className={styles.featureIcon} aria-hidden="true">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
                  <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                  <line x1="12" x2="12" y1="19" y2="22" />
                </svg>
              </div>
              <h2 className={styles.featureTitle}>Create</h2>
              <p className={styles.featureDescription}>
                Describe what you want to hear. Our AI creates a rich,
                multi-voice podcast with references and natural conversation
                flow — no editing required.
              </p>
            </div>

            <div className={styles.feature}>
              <div className={styles.featureIcon} aria-hidden="true">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="18" r="3" />
                  <circle cx="6" cy="6" r="3" />
                  <circle cx="18" cy="6" r="3" />
                  <path d="M18 9v2c0 .6-.4 1-1 1H7c-.6 0-1-.4-1-1V9" />
                  <path d="M12 12v3" />
                </svg>
              </div>
              <h2 className={styles.featureTitle}>Extend</h2>
              <p className={styles.featureDescription}>
                Save a briefing, ask follow-up questions, and generate a new angle
                from your own context. Your workspace stays private unless you
                choose otherwise.
              </p>
            </div>

            <div className={styles.feature}>
              <div className={styles.featureIcon} aria-hidden="true">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
                  <polyline points="16 6 12 2 8 6" />
                  <line x1="12" x2="12" y1="2" y2="15" />
                </svg>
              </div>
              <h2 className={styles.featureTitle}>Control</h2>
              <p className={styles.featureDescription}>
                Keep podcasts private by default, organize collections, and decide
                when a link should be shared. Knowledge work is more useful when
                you control access.
              </p>
            </div>
          </section>

          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>Accessible by Design</h2>
            <p className={styles.sectionText}>
              Sotto gives you one podcast every day for free — no credit card, no API keys.
              Platform AI and voices are included. Bring your own API keys (BYOK)
              for unlimited generation, duration, and model choice at cost price —
              connect Anthropic, OpenAI, or any of seven TTS providers.
            </p>
            <p className={styles.sectionText}>
              Your keys are encrypted with AES-256-GCM and never leave our servers unencrypted.
              You stay in full control of your usage and costs with your own provider accounts.
            </p>
          </section>

          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>Interactive by Nature</h2>
            <p className={styles.sectionText}>
              Pause any podcast mid-playback and ask a question. The AI answers
              in context — using what&apos;s been said so far — and you can bake
              that explanation right back into the episode. Podcasts that learn
              as you listen.
            </p>
          </section>

          <section className={styles.contact}>
            <h2 className={styles.sectionTitle}>Get in Touch</h2>
            <p className={styles.sectionText}>
              Questions, feedback, or just want to say hello? Reach out at{' '}
              <a href="mailto:support@sotto.fm">support@sotto.fm</a>.
            </p>
          </section>
        </div>
      </main>
      <Footer />
    </>
  );
}
