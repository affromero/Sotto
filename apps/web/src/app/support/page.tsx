import { PublicNav } from '@/components/layout/PublicNav';
import { Footer } from '@/components/layout/Footer';
import styles from './page.module.css';

export const metadata = {
  title: 'Support. Sotto',
  description:
    'Get help running your self-hosted Sotto instance. Connect your agent and keys, start a course, and browse common questions.',
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
            Running your own instance and stuck somewhere? Reach out directly or
            browse common questions below.
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
                  Reach the maintainers of your deployment at{' '}
                  <a href="mailto:support@example.com">support@example.com</a>.
                  Response times depend on whoever runs your instance.
                </p>
              </div>
            </div>
            <div className={styles.contactItem}>
              <span className={styles.contactIcon} aria-hidden="true">&#128172;</span>
              <div>
                <strong>Community</strong>
                <p>
                  Join our{' '}
                  <a href="https://discord.gg/Dm4T42RXa" target="_blank" rel="noopener noreferrer">Discord server</a>{' '}
                  to compare notes with other learners and self-hosters, and get
                  help from the community.
                </p>
              </div>
            </div>
            <div className={styles.contactItem}>
              <span className={styles.contactIcon} aria-hidden="true">&#128161;</span>
              <div>
                <strong>Product Feedback</strong>
                <p>
                  Have ideas or found a bug? Visit the{' '}
                  <a href="/feedback">feedback page</a> to share your thoughts, or
                  open an issue on the project.
                </p>
              </div>
            </div>
            <div className={styles.contactItem}>
              <span className={styles.contactIcon} aria-hidden="true">&#128994;</span>
              <div>
                <strong>Source Code</strong>
                <p>
                  Sotto is open-source. Read the code, file issues, and follow the
                  project on{' '}
                  <a href="https://github.com/affromero/Sotto" target="_blank" rel="noopener noreferrer">GitHub</a>.
                </p>
              </div>
            </div>
          </div>
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Frequently Asked Questions</h2>
          <div className={styles.faqList}>
            <div className={styles.faqItem}>
              <h3>How do I get my own instance running?</h3>
              <p>
                Sotto is open-source and self-hosted. Clone the repository, bring a
                local database and queue, and copy the example environment file. The
                setup script walks you through the rest. The project README and the
                local development guide cover each step.
              </p>
            </div>
            <div className={styles.faqItem}>
              <h3>Which agent do I connect, and how?</h3>
              <p>
                You bring your own agent, Claude Code or Codex, and choose what it may
                read. During onboarding you point Sotto at your agent and decide which
                sources it can draw context from. Your agent runs alongside your
                instance, never on someone else&apos;s servers.
              </p>
            </div>
            <div className={styles.faqItem}>
              <h3>What are BYOK keys and why do I need them?</h3>
              <p>
                BYOK means Bring Your Own Key. You provide API keys for your chosen AI
                and audio providers, and you pay those providers directly for what you
                use. There is no subscription on top. Add your keys in Settings under
                API Keys.
              </p>
            </div>
            <div className={styles.faqItem}>
              <h3>How does a course work?</h3>
              <p>
                A short placement test sets your starting CEFR level. From there you
                progress through mastery-gated classes across grammar, reading,
                listening, speaking, and writing. You advance when you demonstrate
                mastery, not when the clock runs out.
              </p>
            </div>
            <div className={styles.faqItem}>
              <h3>What is the vocabulary memory graph?</h3>
              <p>
                Every word and grammar point you meet becomes a node in a personal
                memory graph that lives on your instance. Spaced repetition surfaces
                review when a node is due, so the right material returns at the right
                time across all five skills.
              </p>
            </div>
            <div className={styles.faqItem}>
              <h3>Where does my learning data live?</h3>
              <p>
                On the stack you run. Because you host Sotto yourself, your courses,
                progress, and memory graph stay with you. BYOK keys are encrypted with
                AES-256-GCM at rest and decrypted only in memory when a request needs
                them. You can remove your keys at any time from Settings.
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
