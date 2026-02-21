import { PublicNav } from '@/components/layout/PublicNav';
import { Footer } from '@/components/layout/Footer';
import styles from './page.module.css';

export const metadata = {
  title: 'Support — Sotto',
  description: 'Get help with Sotto. Contact us, browse FAQ, or submit feedback.',
};

export default function SupportPage() {
  return (
    <>
      <PublicNav />
      <main className={styles.main}>
      <div className={styles.container}>
        <header className={styles.header}>
          <h1 className={styles.title}>Support</h1>
          <p className={styles.subtitle}>
            Need help? We&apos;re here for you. Reach out directly or browse common
            questions below.
          </p>
        </header>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Contact Us</h2>
          <div className={styles.contactCard}>
            <div className={styles.contactItem}>
              <span className={styles.contactIcon} aria-hidden="true">&#9993;</span>
              <div>
                <strong>Email Support</strong>
                <p>
                  Reach us at{' '}
                  <a href="mailto:support@sotto.fm">support@sotto.fm</a>.
                  We typically respond within 24 hours.
                </p>
              </div>
            </div>
            <div className={styles.contactItem}>
              <span className={styles.contactIcon} aria-hidden="true">&#128172;</span>
              <div>
                <strong>Discord Community</strong>
                <p>
                  Join our{' '}
                  <a href="https://discord.gg/Dm4T42RXa" target="_blank" rel="noopener noreferrer">Discord server</a>{' '}
                  to chat with other creators, share podcasts, and get help
                  from the community.
                </p>
              </div>
            </div>
            <div className={styles.contactItem}>
              <span className={styles.contactIcon} aria-hidden="true">&#128161;</span>
              <div>
                <strong>Product Feedback</strong>
                <p>
                  Have ideas or found a bug? Visit our{' '}
                  <a href="/feedback">feedback page</a> to share your thoughts
                  directly with our team.
                </p>
              </div>
            </div>
          </div>
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Frequently Asked Questions</h2>
          <div className={styles.faqList}>
            <div className={styles.faqItem}>
              <h3>What are BYOK keys and why do I need them?</h3>
              <p>
                BYOK (Bring Your Own Key) removes daily generation limits and lets you
                use your own AI and TTS providers. You provide API keys for providers like
                Anthropic, OpenAI, or ElevenLabs — you pay them directly for what you use.
                Pro features like private podcasts, analytics, and voice tracks require a
                Pro subscription separately. Add your keys in Settings &gt; API Keys.
              </p>
            </div>
            <div className={styles.faqItem}>
              <h3>How do I create a podcast?</h3>
              <p>
                Go to the <a href="/create">Create</a> page and chat with our AI
                assistant. Describe what you want to learn about, and it will ask
                follow-up questions to understand your interests. Once ready, it
                generates a conversational podcast for you.
              </p>
            </div>
            <div className={styles.faqItem}>
              <h3>Can I delete my account?</h3>
              <p>
                Yes. Go to your profile settings and select &quot;Delete Account&quot;. This
                permanently removes all your data including podcasts, comments, and
                API keys. This action cannot be undone.
              </p>
            </div>
            <div className={styles.faqItem}>
              <h3>Is AI-generated content labeled?</h3>
              <p>
                Yes. All AI-generated podcasts are clearly labeled as
                &quot;AI-Generated&quot;. Imported human-created content is labeled as
                &quot;Human&quot;. This follows Apple App Store guideline 4.7 for AI
                content transparency.
              </p>
            </div>
            <div className={styles.faqItem}>
              <h3>What happens when I fork a podcast?</h3>
              <p>
                Forking creates a new version of a public podcast that you can customize.
                The original creator is always attributed. You can change the topic focus,
                tone, or depth of the forked version.
              </p>
            </div>
            <div className={styles.faqItem}>
              <h3>Are my API keys secure?</h3>
              <p>
                Yes. All BYOK keys are encrypted using AES-256-GCM before storage. Keys
                are only decrypted in memory when making API calls on your behalf. You
                can remove your keys at any time from Settings.
              </p>
            </div>
          </div>
        </section>
      </div>
    </main>
      <Footer />
    </>
  );
}
